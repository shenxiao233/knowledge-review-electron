import type { FastifyInstance } from 'fastify';
import { UserService } from '../services/user.service.js';
import { requireAuth, auth } from '../middleware/auth.js';
import { fail } from '../utils/response.js';

export default async function userRoutes(
  app: FastifyInstance,
  opts: { userService: UserService }
) {
  const { userService } = opts;

  // GET /api/v2/me/profile - Get user profile
  app.get('/api/v2/me/profile', { preHandler: requireAuth }, async (request, reply) => {
    const profile = await userService.getProfile(auth(request).id);
    if (!profile) return fail(reply, 404, 'User not found');
    return profile;
  });

  // POST /api/v2/me/profile - Complete profile after registration
  app.post('/api/v2/me/profile', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const profile = await userService.completeProfile(auth(request).id, request.body as any);
      return reply.code(201).send(profile);
    } catch (error: any) {
      return fail(reply, 400, error.message);
    }
  });

  // PATCH /api/v2/me/profile - Update profile
  app.patch('/api/v2/me/profile', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const profile = await userService.updateProfile(auth(request).id, request.body as any);
      return profile;
    } catch (error: any) {
      return fail(reply, 400, error.message);
    }
  });

  // POST /api/v2/me/devices - Register device
  app.post('/api/v2/me/devices', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const device = await userService.registerDevice(auth(request).id, request.body as any);
      return reply.code(201).send(device);
    } catch (error: any) {
      return fail(reply, 400, error.message);
    }
  });

  // GET /api/v2/me/devices - List user's devices
  app.get('/api/v2/me/devices', { preHandler: requireAuth }, async (request) => {
    return userService.getDevices(auth(request).id);
  });

  // PATCH /api/v2/me/devices/:id/sync - Update device sync time
  app.patch('/api/v2/me/devices/:id/sync', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const device = await userService.updateDeviceSync(auth(request).id, (request.params as any).id);
      if (!device) return fail(reply, 404, 'Device not found');
      return device;
    } catch (error: any) {
      return fail(reply, 400, error.message);
    }
  });
}
