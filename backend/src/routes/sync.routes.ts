import type { FastifyInstance } from 'fastify';
import { SyncService } from '../services/sync.service.js';
import { requireAuth, auth } from '../middleware/auth.js';
import { fail } from '../utils/response.js';

export default async function syncRoutes(
  app: FastifyInstance,
  opts: { syncService: SyncService }
) {
  const { syncService } = opts;

  // POST /api/v2/sync - Sync a single object
  app.post('/api/v2/sync', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const response = await syncService.syncObject(
        auth(request).id,
        request.body as any
      );
      return response;
    } catch (error: any) {
      return fail(reply, 400, error.message);
    }
  });

  // POST /api/v2/sync/batch - Batch sync multiple objects
  app.post('/api/v2/sync/batch', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const body = request.body as any;
      if (!Array.isArray(body.requests)) {
        return fail(reply, 400, 'requests must be an array');
      }
      const responses = await syncService.batchSync(auth(request).id, body.requests);
      return { responses };
    } catch (error: any) {
      return fail(reply, 400, error.message);
    }
  });

  // GET /api/v2/sync/full - Full sync (get all objects)
  app.get('/api/v2/sync/full', { preHandler: requireAuth }, async (request) => {
    const query = request.query as any;
    const lastSyncAt = query?.lastSyncAt ? new Date(query.lastSyncAt) : undefined;
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
      query?.limit ? Number(query.limit) : 10
    );
  });

  // DELETE /api/v2/sync/:objectType/:objectId - Delete a sync object
  app.delete('/api/v2/sync/:objectType/:objectId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { objectType, objectId } = request.params as any;
      await syncService.deleteSyncObject(auth(request).id, objectType, objectId);
      return { deleted: true };
    } catch (error: any) {
      return fail(reply, 400, error.message);
    }
  });

  // POST /api/v2/sync/device/:deviceId - Update device sync time
  app.post('/api/v2/sync/device/:deviceId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const updated = await syncService.updateDeviceSync(auth(request).id, (request.params as any).deviceId);
      if (!updated) return fail(reply, 404, 'Device not found');
      return { synced: true };
    } catch (error: any) {
      return fail(reply, 400, error.message);
    }
  });
}
