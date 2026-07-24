import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

export interface SyncRequest {
  objectType: string;
  objectId: string;
  objectVersion: number;
  data?: any;
  metadata?: any;
  deviceId: string;
}

export interface SyncResponse {
  objectType: string;
  objectId: string;
  serverVersion: number;
  data?: any;
  conflict: boolean;
  resolution?: string;
}

export class SyncService {
  /**
   * Sync a single object to the server
   */
  async syncObject(userId: string, request: SyncRequest): Promise<SyncResponse> {
    const validated = z.object({
      objectType: z.enum(['DECK', 'DOCUMENT', 'CARD', 'SETTINGS']),
      objectId: z.string().min(1).max(100),
      objectVersion: z.number().int().positive(),
      data: z.any().optional(),
      metadata: z.any().optional(),
      deviceId: z.string().min(1).max(50),
    }).parse(request);

    const syncData = validated.data === undefined ? Prisma.JsonNull : validated.data;
    return prisma.$transaction(async (tx) => {
      const existing = await tx.syncObject.findUnique({
        where: {
          userId_objectType_objectId: {
            userId,
            objectType: validated.objectType,
            objectId: validated.objectId,
          },
        },
      });

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

        await tx.syncObjectHistory.create({
          data: {
            syncObjectId: created.id,
            version: 1,
            data: syncData,
            modifiedBy: validated.deviceId,
          },
        });

        return {
          objectType: validated.objectType,
          objectId: validated.objectId,
          serverVersion: 1,
          conflict: false,
        };
      }

      // Client is behind the server — return current server data so the client can merge.
      if (validated.objectVersion < existing.objectVersion) {
        return {
          objectType: validated.objectType,
          objectId: validated.objectId,
          serverVersion: existing.objectVersion,
          data: existing.data,
          conflict: true,
          resolution: 'SERVER_WINS',
        };
      }

      // Client version >= server version: accept the client's data and bump the version.
      const newVersion = existing.objectVersion + 1;

      // BUG-C3 fix: only overwrite `data` when the client actually provided it.
      // A metadata-only update (data omitted) must NOT wipe the existing object data
      // with Prisma.JsonNull.
      const updateFields: any = {
        objectVersion: newVersion,
        metadata: validated.metadata,
        lastModifiedBy: validated.deviceId,
      };
      if (validated.data !== undefined) {
        updateFields.data = validated.data;
      }

      await tx.syncObject.update({
        where: { id: existing.id },
        data: updateFields,
      });

      // History record: preserve existing data when the client omitted `data`,
      // so the version snapshot reflects the object's actual state.
      await tx.syncObjectHistory.create({
        data: {
          syncObjectId: existing.id,
          version: newVersion,
          data: validated.data !== undefined ? validated.data : existing.data,
          modifiedBy: validated.deviceId,
        },
      });

      return {
        objectType: validated.objectType,
        objectId: validated.objectId,
        serverVersion: newVersion,
        conflict: false,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Batch sync multiple objects
   */
  async batchSync(userId: string, requests: SyncRequest[]): Promise<SyncResponse[]> {
    const responses: SyncResponse[] = [];
    for (const request of requests) {
      const response = await this.syncObject(userId, request);
      responses.push(response);
    }
    return responses;
  }

  /**
   * Get all sync objects for a user (full sync)
   */
  async getFullSync(userId: string, lastSyncAt?: Date) {
    const where: any = { userId };
    if (lastSyncAt) {
      where.updatedAt = { gte: lastSyncAt };
    }

    const objects = await prisma.syncObject.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });

    return {
      objects: objects.map((obj) => ({
        objectType: obj.objectType,
        objectId: obj.objectId,
        objectVersion: obj.objectVersion,
        data: obj.data,
        metadata: obj.metadata,
        updatedAt: obj.updatedAt,
      })),
      syncTime: new Date(),
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
    await prisma.syncObject.delete({
      where: {
        userId_objectType_objectId: {
          userId,
          objectType: objectType as any,
          objectId,
        },
      },
    });
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
