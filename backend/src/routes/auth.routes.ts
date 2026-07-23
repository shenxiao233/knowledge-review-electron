import type { FastifyInstance } from 'fastify';
import { AuthService } from '../services/auth.service.js';
import { requireAuth, auth } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

export default async function authRoutes(app: FastifyInstance, opts: { authService: AuthService }) {
  const { authService } = opts;
  
  // V1 Registration (legacy)
  app.post('/api/v1/auth/register', async (request, reply) => {
    return authService.register(request, reply);
  });
  
  // V2 Registration with invitation code
  app.post('/api/v2/auth/register', async (request, reply) => {
    return authService.registerV2(request, reply);
  });
  
  // Login (shared between v1 and v2)
  app.post('/api/v1/auth/login', async (request, reply) => {
    return authService.login(request, reply);
  });
  
  app.post('/api/v2/auth/login', async (request, reply) => {
    return authService.login(request, reply);
  });
  
  // Get current user info
  app.get('/api/v1/me', { preHandler: requireAuth }, async (request) => {
    const user = auth(request);
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true, username: true, role: true, status: true,
        uid: true, nickname: true, avatar: true,
      },
    });
    return dbUser;
  });

  app.get('/api/v2/me', { preHandler: requireAuth }, async (request) => {
    const user = auth(request);
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true, username: true, role: true, status: true,
        uid: true, nickname: true, avatar: true, bio: true, email: true,
      },
    });
    return dbUser;
  });
  
  // Change password
  app.patch('/api/v1/me/password', { preHandler: requireAuth }, async (request, reply) => {
    return authService.changePassword(request, reply, auth(request).id);
  });

  app.patch('/api/v2/me/password', { preHandler: requireAuth }, async (request, reply) => {
    return authService.changePassword(request, reply, auth(request).id);
  });
}
