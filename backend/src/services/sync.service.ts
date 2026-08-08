import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { ClientInputError } from '../utils/errors.js';
import { config, maxSyncBatchBytes, maxSyncObjectBytes } from '../config.js';
import { metrics } from '../observability/metrics.js';

export interface SyncRequest {
  objectType: string;
  objectId: string;
  objectVersion: number;
  data?: any;
  metadata?: any;
  operation?: string;
  deviceId: string;
}

export interface SyncResponse {
  objectType: string;
  objectId: string;
  serverVersion: number;
  data?: any;
  metadata?: any;
  deleted?: boolean;
  conflict: boolean;
  resolution?: string;
}

const syncRequestSchema = z.object({
  objectType: z.enum(['DECK', 'DOCUMENT', 'CARD', 'SETTINGS']),
  objectId: z.string().min(1).max(100),
  objectVersion: z.number().int().positive(),
  data: z.any().optional(),
  metadata: z.any().optional(),
  operation: z.enum(['upsert', 'delete']).optional(),
  deviceId: z.string().min(1).max(50),
});

type ValidatedSyncRequest = z.infer<typeof syncRequestSchema>;

type SyncCursor = {
  highWaterAt: string;
  lastUpdatedAt: string;
  lastId: string;
};

type FullSyncOptions = {
  cursor?: string;
  lastSyncAt?: Date;
  limit?: number;
};

type BatchSyncResult = {
  responses: SyncResponse[];
  errors: Array<{
    objectType: string;
    objectId: string;
    message: string;
  }>;
};

export class SyncService {
  private historyCleanupTimer: NodeJS.Timeout | null = null;

  startHistoryMaintenance() {
    if (!config.syncHistoryCleanupEnabled || this.historyCleanupTimer) return;
    const intervalMs = config.syncHistoryCleanupIntervalHours * 3600 * 1000;
    this.historyCleanupTimer = setInterval(() => {
      void this.cleanupHistory();
    }, intervalMs);
    this.historyCleanupTimer.unref();
    setTimeout(() => { void this.cleanupHistory(); }, 60_000).unref();
  }

  stopHistoryMaintenance() {
    if (!this.historyCleanupTimer) return;
    clearInterval(this.historyCleanupTimer);
    this.historyCleanupTimer = null;
  }

  async cleanupHistory() {
    const cutoff = new Date(Date.now() - config.syncHistoryRetentionDays * 24 * 60 * 60 * 1000);
    const keepVersions = Math.max(1, Math.floor(config.syncHistoryKeepVersions));
    const deleted = await prisma.$executeRaw`
      WITH ranked AS (
        SELECT
          id,
          "createdAt",
          ROW_NUMBER() OVER (
            PARTITION BY "syncObjectId"
            ORDER BY version DESC
          ) AS version_rank
        FROM "SyncObjectHistory"
      )
      DELETE FROM "SyncObjectHistory" history
      USING ranked
      WHERE history.id = ranked.id
        AND ranked.version_rank > ${keepVersions}
        AND ranked."createdAt" < ${cutoff}
    `;
    let tombstones = 0;
    if (config.syncTombstoneCleanupEnabled) {
      tombstones = await this.cleanupTombstones();
    }
    if (deleted > 0 || tombstones > 0) {
      console.info(
        `[SyncService] Removed ${deleted} old sync history rows and ${tombstones} tombstones`,
      );
    }
    return { deleted, tombstones, cutoff, keepVersions };
  }

  /**
   * Tombstones are intentionally retained for a long period so an offline
   * device cannot resurrect an object deleted on another device. This method
   * is opt-in through SYNC_TOMBSTONE_CLEANUP_ENABLED.
   */
  async cleanupTombstones() {
    const cutoff = new Date(
      Date.now() - config.syncTombstoneRetentionDays * 24 * 60 * 60 * 1000,
    );
    return prisma.$executeRaw`
      DELETE FROM "SyncObject"
      WHERE "metadata"->>'deleted' = 'true'
        AND ("metadata"->>'deletedAt')::timestamptz < ${cutoff}
    `;
  }

  private validateRequest(request: SyncRequest): ValidatedSyncRequest {
    const validated = syncRequestSchema.parse(request);
    const dataBytes = this.jsonBytes(validated.data);
    const metadataBytes = this.jsonBytes(validated.metadata);
    if (dataBytes > maxSyncObjectBytes) {
      throw new ClientInputError(
        `Sync object data exceeds the ${Math.floor(maxSyncObjectBytes / 1024)} KB limit`,
      );
    }
    if (metadataBytes > Math.min(maxSyncObjectBytes, 128 * 1024)) {
      throw new ClientInputError('Sync object metadata exceeds the size limit');
    }
    return validated;
  }

  private jsonBytes(value: unknown) {
    if (value === undefined) return 0;
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8');
  }

  /**
   * Sync a single object to the server
   */
  async syncObject(
    userId: string,
    request: SyncRequest,
    transaction?: Prisma.TransactionClient,
  ): Promise<SyncResponse> {
    const validated = this.validateRequest(request);
    if (transaction) {
      return this.syncObjectInTransaction(transaction, userId, validated);
    }

    return prisma.$transaction(
      (tx) => this.syncObjectInTransaction(tx, userId, validated),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 3000,
        timeout: 10000,
      },
    );
  }

  private async syncObjectInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    validated: ValidatedSyncRequest,
  ): Promise<SyncResponse> {
    const syncData = validated.data === undefined ? Prisma.JsonNull : validated.data;
    const progressSync = this.isProgressSync(validated.metadata);
      const existing = await tx.syncObject.findUnique({
        where: {
          userId_objectType_objectId: {
            userId,
            objectType: validated.objectType,
            objectId: validated.objectId,
          },
        },
      });

      const requestIsDelete = validated.operation === 'delete';

      // A deletion is authoritative. Keep a tombstone instead of physically
      // removing the row so other devices can observe the deletion.
      if (requestIsDelete && existing) {
        if (this.isDeletedMetadata(existing.metadata)) {
          return {
            objectType: validated.objectType,
            objectId: validated.objectId,
            serverVersion: existing.objectVersion,
            data: null,
            metadata: existing.metadata,
            deleted: true,
            conflict: false,
          };
        }
        return this.deleteExistingSyncObject(tx, existing, validated.deviceId);
      }

      if (requestIsDelete) {
        return this.createDeletedSyncObject(
          tx,
          userId,
          validated.objectType,
          validated.objectId,
          validated.deviceId,
        );
      }

      if (!existing) {
        // CREATE: JsonNull is acceptable for a brand-new record (no prior data to wipe).
        const created = await tx.syncObject.create({
          data: {
            userId,
            objectType: validated.objectType,
            objectId: validated.objectId,
            objectVersion: 1,
            data: syncData,
            metadata: validated.metadata,
            lastModifiedBy: validated.deviceId,
          },
        });

        if (!progressSync && validated.objectType !== 'SETTINGS') {
          await tx.syncObjectHistory.create({
            data: {
              syncObjectId: created.id,
              version: 1,
              data: syncData,
              modifiedBy: validated.deviceId,
            },
          });
        }

        return {
          objectType: validated.objectType,
          objectId: validated.objectId,
          serverVersion: 1,
          conflict: false,
        };
      }

      if (this.isDeletedMetadata(existing.metadata)) {
        // Never let an offline device recreate an object deleted elsewhere.
        return {
          objectType: validated.objectType,
          objectId: validated.objectId,
          serverVersion: existing.objectVersion,
          data: null,
          metadata: existing.metadata,
          deleted: true,
          conflict: true,
          resolution: 'SERVER_WINS',
        };
      }

      // Client is behind the server — return current server data so the client can merge.
      if (validated.objectVersion < existing.objectVersion) {
        return {
          objectType: validated.objectType,
          objectId: validated.objectId,
          serverVersion: existing.objectVersion,
          data: existing.data,
          metadata: existing.metadata,
          conflict: true,
          resolution: 'SERVER_WINS',
        };
      }

      // Client version >= server version: accept the client's data and bump the version.
      const newVersion = existing.objectVersion + 1;

      // BUG-C3 fix: only overwrite `data` when the client actually provided it.
      // A metadata-only update (data omitted) must NOT wipe the existing object data
      // with Prisma.JsonNull.
      const nextData = progressSync
        ? this.mergeProgressData(existing.data, validated.data)
        : validated.data;
      const updateFields: any = {
        objectVersion: newVersion,
        metadata: progressSync ? existing.metadata : validated.metadata,
        lastModifiedBy: validated.deviceId,
      };
      if (validated.data !== undefined) {
        updateFields.data = nextData;
      }

      await tx.syncObject.update({
        where: { id: existing.id },
        data: updateFields,
      });

      // History record: preserve existing data when the client omitted `data`,
      // so the version snapshot reflects the object's actual state.
      if (!progressSync && validated.objectType !== 'SETTINGS') {
        await tx.syncObjectHistory.create({
          data: {
            syncObjectId: existing.id,
            version: newVersion,
            data: nextData === undefined ? existing.data : nextData,
            modifiedBy: validated.deviceId,
          },
        });
      }

      return {
        objectType: validated.objectType,
        objectId: validated.objectId,
        serverVersion: newVersion,
        conflict: false,
      };
  }

  /**
   * Batch sync multiple objects
   */
  async batchSync(userId: string, requests: SyncRequest[]): Promise<BatchSyncResult> {
    if (requests.length === 0) return { responses: [], errors: [] };
    if (requests.length > config.syncBatchMax) {
      throw new ClientInputError(
        `Batch size exceeds the ${config.syncBatchMax}-item limit`,
      );
    }
    if (this.jsonBytes(requests) > maxSyncBatchBytes) {
      throw new ClientInputError('Sync batch exceeds the configured size limit');
    }

    // Validate the complete batch before opening any transaction. Each object
    // is then committed independently, so one malformed/contended object no
    // longer rolls back all other review results in the same HTTP request.
    const validatedRequests = requests.map((request) => this.validateRequest(request));
    const startedAt = process.hrtime.bigint();
    const responses: SyncResponse[] = [];
    const errors: BatchSyncResult['errors'] = [];
    for (const request of validatedRequests) {
      try {
        responses.push(await prisma.$transaction(
          (tx) => this.syncObjectInTransaction(tx, userId, request),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 3000,
            timeout: 10000,
          },
        ));
      } catch (error: any) {
        errors.push({
          objectType: request.objectType,
          objectId: request.objectId,
          message: error?.code === 'P2034'
            ? 'Sync transaction was busy. Please retry.'
            : 'Sync object could not be saved. Please retry.',
        });
      }
    }
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    metrics.recordSyncBatch(requests.length, durationMs, errors.length > 0);
    return { responses, errors };
  }

  /**
   * Get all sync objects for a user (full sync)
   */
  async getFullSync(userId: string, options: FullSyncOptions = {}) {
    const limit = Math.min(
      Math.max(1, Math.floor(options.limit ?? config.syncPageSize)),
      config.syncPageMax,
    );
    const highWaterAt = new Date();
    const cursor = options.cursor
      ? this.decodeCursor(options.cursor)
      : null;
    const legacyLastSyncAt = cursor ? null : options.lastSyncAt ?? null;
    const pageHighWaterAt = cursor
      ? new Date(cursor.highWaterAt)
      : highWaterAt;
    const where: any = {
      userId,
      updatedAt: { lte: pageHighWaterAt },
    };

    if (cursor) {
      const lastUpdatedAt = new Date(cursor.lastUpdatedAt);
      where.OR = [
        { updatedAt: { gt: lastUpdatedAt, lte: pageHighWaterAt } },
        {
          updatedAt: lastUpdatedAt,
          id: { gt: cursor.lastId },
        },
      ];
    } else if (legacyLastSyncAt) {
      where.updatedAt = { gte: legacyLastSyncAt, lte: pageHighWaterAt };
    }

    const rows = await prisma.syncObject.findMany({
      where,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const objects = hasMore ? rows.slice(0, limit) : rows;
    const last = objects.at(-1);
    const nextCursor = this.encodeCursor({
      highWaterAt: pageHighWaterAt.toISOString(),
      lastUpdatedAt: (last?.updatedAt ?? (cursor ? new Date(cursor.lastUpdatedAt) : pageHighWaterAt)).toISOString(),
      lastId: last?.id ?? cursor?.lastId ?? '\uffff',
    });

    return {
      objects: objects.map((obj) => ({
        objectType: obj.objectType,
        objectId: obj.objectId,
        objectVersion: obj.objectVersion,
        data: obj.data,
        metadata: obj.metadata,
        deleted: this.isDeletedMetadata(obj.metadata),
        updatedAt: obj.updatedAt,
      })),
      hasMore,
      nextCursor,
      // Kept for older clients. New clients persist nextCursor instead of
      // treating a wall-clock timestamp as a durable sync position.
      syncTime: pageHighWaterAt.toISOString(),
    };
  }

  /**
   * Get sync history for an object
   */
  async getSyncHistory(userId: string, objectType: string, objectId: string, limit = 10) {
    const syncObject = await prisma.syncObject.findUnique({
      where: {
        userId_objectType_objectId: {
          userId,
          objectType: objectType as any,
          objectId,
        },
      },
    });

    if (!syncObject) return { history: [] };

    const history = await prisma.syncObjectHistory.findMany({
      where: { syncObjectId: syncObject.id },
      orderBy: { version: 'desc' },
      take: limit,
    });

    return {
      history: history.map((h) => ({
        version: h.version,
        data: h.data,
        modifiedBy: h.modifiedBy,
        createdAt: h.createdAt,
      })),
    };
  }

  /**
   * Delete a sync object
   */
  async deleteSyncObject(userId: string, objectType: string, objectId: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.syncObject.findUnique({
        where: {
          userId_objectType_objectId: {
            userId,
            objectType: objectType as any,
            objectId,
          },
        },
      });
      if (!existing) {
        await this.createDeletedSyncObject(
          tx,
          userId,
          objectType as any,
          objectId,
          'server-delete',
        );
        return { deleted: true };
      }
      await this.deleteExistingSyncObject(tx, existing, 'server-delete');
      return { deleted: true };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 3000,
      timeout: 10000,
    });
  }

  private isProgressSync(metadata: unknown): boolean {
    return Boolean(
      metadata &&
        typeof metadata === 'object' &&
        !Array.isArray(metadata) &&
        (metadata as Record<string, unknown>).syncMode === 'progress',
    );
  }

  private encodeCursor(cursor: SyncCursor) {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeCursor(value: string): SyncCursor {
    if (!value || value.length > 512) {
      throw new ClientInputError('Sync cursor is invalid');
    }
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SyncCursor>;
      const highWaterAt = new Date(parsed.highWaterAt || '');
      const lastUpdatedAt = new Date(parsed.lastUpdatedAt || '');
      if (
        !parsed.lastId ||
        parsed.lastId.length > 100 ||
        Number.isNaN(highWaterAt.getTime()) ||
        Number.isNaN(lastUpdatedAt.getTime()) ||
        lastUpdatedAt > highWaterAt
      ) {
        throw new Error('invalid cursor');
      }
      return {
        highWaterAt: highWaterAt.toISOString(),
        lastUpdatedAt: lastUpdatedAt.toISOString(),
        lastId: parsed.lastId,
      };
    } catch {
      throw new ClientInputError('Sync cursor is invalid');
    }
  }

  private mergeProgressData(existingData: unknown, progressData: unknown) {
    const current =
      existingData && typeof existingData === 'object' && !Array.isArray(existingData)
        ? { ...(existingData as Record<string, unknown>) }
        : {};
    if (!progressData || typeof progressData !== 'object' || Array.isArray(progressData)) {
      return existingData;
    }

    for (const key of ['dueAt', 'updatedAt', 'reviews', 'mastery', 'suspended', 'fsrs', 'progressReset']) {
      if (key in (progressData as Record<string, unknown>)) {
        current[key] = (progressData as Record<string, unknown>)[key];
      }
    }
    return current;
  }

  private isDeletedMetadata(metadata: unknown): boolean {
    return Boolean(
      metadata &&
        typeof metadata === 'object' &&
        !Array.isArray(metadata) &&
        (metadata as Record<string, unknown>).deleted === true,
    );
  }

  private async deleteExistingSyncObject(
    tx: Prisma.TransactionClient,
    existing: {
      id: string;
      objectType: any;
      objectId: string;
      objectVersion: number;
    },
    modifiedBy: string,
  ) {
    const newVersion = existing.objectVersion + 1;
    const metadata = {
      deleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: modifiedBy,
    };
    await tx.syncObject.update({
      where: { id: existing.id },
      data: {
        objectVersion: newVersion,
        data: Prisma.JsonNull,
        metadata,
        lastModifiedBy: modifiedBy,
      },
    });
    await tx.syncObjectHistory.create({
      data: {
        syncObjectId: existing.id,
        version: newVersion,
        data: Prisma.JsonNull,
        modifiedBy,
      },
    });
    return {
      objectType: existing.objectType,
      objectId: existing.objectId,
      serverVersion: newVersion,
      data: null,
      metadata,
      deleted: true,
      conflict: false,
    };
  }

  private async createDeletedSyncObject(
    tx: Prisma.TransactionClient,
    userId: string,
    objectType: any,
    objectId: string,
    modifiedBy: string,
  ) {
    const metadata = {
      deleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: modifiedBy,
    };
    const created = await tx.syncObject.create({
      data: {
        userId,
        objectType,
        objectId,
        objectVersion: 1,
        data: Prisma.JsonNull,
        metadata,
        lastModifiedBy: modifiedBy,
      },
    });
    await tx.syncObjectHistory.create({
      data: {
        syncObjectId: created.id,
        version: 1,
        data: Prisma.JsonNull,
        modifiedBy,
      },
    });
    return {
      objectType,
      objectId,
      serverVersion: 1,
      data: null,
      metadata,
      deleted: true,
      conflict: false,
    };
  }

  /**
   * Update device last sync time
   */
  async updateDeviceSync(userId: string, deviceId: string) {
    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId },
    });
    if (!device) return false;

    await prisma.device.update({
      where: { id: device.id },
      data: { lastSyncAt: new Date() },
    });
    return true;
  }
}
