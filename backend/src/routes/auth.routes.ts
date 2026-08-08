import type { FastifyInstance } from 'fastify';
import { AuthService } from '../services/auth.service.js';
import { requireAuth, auth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { decodeAvatarDataUrl, publicUser } from '../utils/avatar.js';
import { fail } from '../utils/response.js';

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

  // Rotate a refresh token and issue a fresh access token. The access token
  // remains short-lived/configurable without forcing the client to re-login.
  app.post('/api/v2/auth/refresh', async (request, reply) => {
    const body = z.object({
      refreshToken: z.string().min(20).max(200),
    }).safeParse(request.body);
    if (!body.success) return fail(reply, 401, 'Invalid refresh token');
    return authService.refresh(body.data.refreshToken, reply);
  });

  app.post('/api/v2/auth/logout', async (request) => {
    const body = z.object({
      refreshToken: z.string().min(20).max(200).optional(),
    }).safeParse(request.body || {});
    if (!body.success || !body.data.refreshToken) return { revoked: false };
    return authService.revokeRefreshToken(body.data.refreshToken);
  });

  // Lazy-load avatars so authentication and profile responses stay small.
  app.get('/api/v2/users/:id/avatar', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return fail(reply, 400, 'Invalid user ID');

    const user = await prisma.user.findUnique({
      where: { id: params.data.id },
      select: { avatar: true },
    });
    if (!user) return fail(reply, 404, 'User not found');

    const avatar = decodeAvatarDataUrl(user.avatar);
    if (!avatar) return fail(reply, 404, 'Avatar not found');

    const etag = `"${createHash('sha256').update(avatar.data).digest('hex')}"`;
    const ifNoneMatch = request.headers['if-none-match'];
    if (
      typeof ifNoneMatch === 'string' &&
      ifNoneMatch.split(',').some((value) => value.trim() === etag)
    ) {
      return reply.code(304).send();
    }

    return reply
      .header('Content-Type', avatar.mimeType)
      .header('Content-Length', avatar.data.length)
      .header('Cache-Control', 'public, max-age=86400, immutable')
      .header('ETag', etag)
      .header('X-Content-Type-Options', 'nosniff')
      .send(avatar.data);
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
    return dbUser ? publicUser(dbUser) : null;
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
    return dbUser ? publicUser(dbUser) : null;
  });
  
  // Change password
  app.patch('/api/v1/me/password', { preHandler: requireAuth }, async (request, reply) => {
    return authService.changePassword(request, reply, auth(request).id);
  });

  app.patch('/api/v2/me/password', { preHandler: requireAuth }, async (request, reply) => {
    return authService.changePassword(request, reply, auth(request).id);
  });
}
