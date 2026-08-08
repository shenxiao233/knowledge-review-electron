import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SyncService } from '../services/sync.service.js';
import { requireAuth, auth } from '../middleware/auth.js';
import { fail } from '../utils/response.js';

function syncFailure(reply: FastifyReply, error: any) {
  if (error instanceof z.ZodError) {
    return fail(reply, 400, error.issues[0]?.message || 'Invalid sync request');
  }
  if (error?.code === 'P2034') {
    return fail(reply, 503, 'Sync transaction was busy. Please retry.');
  }
  if (error?.code === 'P2025') return fail(reply, 404, 'Sync object not found');
  return fail(reply, 500, 'Sync service temporarily unavailable');
}

export default async function syncRoutes(
  app: FastifyInstance,
  opts: { syncService: SyncService },
) {
  const { syncService } = opts;

  // POST /api/v2/sync - Sync a single object
  app.post('/api/v2/sync', { preHandler: requireAuth }, async (request, reply) => {
    try {
      return await syncService.syncObject(auth(request).id, request.body as any);
    } catch (error: any) {
      return syncFailure(reply, error);
    }
  });

  // POST /api/v2/sync/batch - Batch sync multiple objects
  app.post('/api/v2/sync/batch', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const body = request.body as any;
      if (!body || !Array.isArray(body.requests)) {
        return fail(reply, 400, 'requests must be an array');
      }
      if (body.requests.length > 100) {
        return fail(reply, 400, 'Batch size exceeds the 100-item limit');
      }

      const keys = new Set<string>();
      for (const item of body.requests) {
        if (!item || typeof item !== 'object') continue;
        const key = `${String(item.objectType)}\u0000${String(item.objectId)}`;
        if (keys.has(key)) return fail(reply, 400, 'A batch cannot contain duplicate objects');
        keys.add(key);
      }

      const responses = await syncService.batchSync(auth(request).id, body.requests);
      return { responses };
    } catch (error: any) {
      return syncFailure(reply, error);
    }
  });

  // GET /api/v2/sync/full - Full or incremental sync pull
  app.get('/api/v2/sync/full', { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as any;
    const lastSyncAt = query?.lastSyncAt ? new Date(query.lastSyncAt) : undefined;
    if (lastSyncAt && isNaN(lastSyncAt.getTime())) {
      return fail(reply, 400, 'lastSyncAt is invalid');
    }
    return syncService.getFullSync(auth(request).id, lastSyncAt);
  });

  // GET /api/v2/sync/history - Get sync history for an object
  app.get('/api/v2/sync/history', { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as any;
    if (!query?.objectType || !query?.objectId) {
      return fail(reply, 400, 'objectType and objectId are required');
    }
    return syncService.getSyncHistory(
      auth(request).id,
      query.objectType,
      query.objectId,
      query?.limit ? Number(query.limit) : 10,
    );
  });

  // DELETE /api/v2/sync/:objectType/:objectId - Delete a sync object
  app.delete('/api/v2/sync/:objectType/:objectId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const params = z.object({
        objectType: z.string().min(1).max(50),
        objectId: z.string().min(1).max(100),
      }).safeParse(request.params);
      if (!params.success) return fail(reply, 400, 'Invalid parameters');
      return syncService.deleteSyncObject(
        auth(request).id,
        params.data.objectType,
        params.data.objectId,
      );
    } catch (error: any) {
      return syncFailure(reply, error);
    }
  });

  // POST /api/v2/sync/device/:deviceId - Update device sync time
  app.post('/api/v2/sync/device/:deviceId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const updated = await syncService.updateDeviceSync(
        auth(request).id,
        (request.params as any).deviceId,
      );
      if (!updated) return fail(reply, 404, 'Device not found');
      return { synced: true };
    } catch (error: any) {
      return syncFailure(reply, error);
    }
  });
}
