import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { Redis } from 'ioredis';
import fsp from 'node:fs/promises';
import { z } from 'zod';
import { config, maxUploadBytes } from './config.js';
import { RateLimiter } from './plugins/rate-limit.js';
import { AuthService } from './services/auth.service.js';
import { DeckService } from './services/deck.service.js';
import { AuditService } from './services/audit.service.js';
import { UserService } from './services/user.service.js';
import { InvitationService } from './services/invitation.service.js';
import { SyncService } from './services/sync.service.js';
import { CollabService } from './services/collab.service.js';
import { ClientInputError } from './utils/errors.js';
import { fail } from './utils/response.js';

import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import deckRoutes from './routes/deck.routes.js';
import myDecksRoutes from './routes/my-decks.routes.js';
import adminRoutes from './routes/admin.routes.js';
import socialRoutes from './routes/social.routes.js';
import userRoutes from './routes/user.routes.js';
import invitationRoutes from './routes/invitation.routes.js';
import syncRoutes from './routes/sync.routes.js';
import collabRoutes from './routes/collab.routes.js';

const app = Fastify({ logger: true, bodyLimit: 300 * 1024 * 1024, trustProxy: config.trustProxy });

await fsp.mkdir(config.storageDir, { recursive: true });

await app.register(cors, {
  origin: (origin, callback) => {
    const allowedOrigins = new Set(config.corsOrigin.split(',').map((s: string) => s.trim()).filter(Boolean));
    if (!origin || (config.nodeEnv !== 'production' && origin === 'null') || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin is not allowed'), false);
  },
});

await app.register(jwt, { secret: config.jwtSecret });
await app.register(multipart, { limits: { fileSize: maxUploadBytes, files: 1 } });

let redis: Redis | null = null;
if (config.redisUrl) {
  redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true, enableReadyCheck: false });
  redis.on('error', (err: Error) => app.log.warn(err, 'Redis error'));
  try { await redis.connect(); app.log.info('Redis connected'); } catch { redis = null; }
}

const rateLimiter = new RateLimiter(redis);
const authService = new AuthService(app, rateLimiter);
const deckService = new DeckService(rateLimiter);
const auditService = new AuditService();
const userService = new UserService();
const invitationService = new InvitationService();
const syncService = new SyncService();
const collabService = new CollabService();

auditService.startPeriodicArchival();

// V1 routes
await app.register(healthRoutes);
await app.register(authRoutes, { authService });
await app.register(deckRoutes, { deckService, rateLimiter });
await app.register(myDecksRoutes, { deckService, rateLimiter });
await app.register(adminRoutes, { deckService });
await app.register(socialRoutes);

// V2 routes
await app.register(userRoutes, { userService });
await app.register(invitationRoutes, { invitationService, rateLimiter });
await app.register(syncRoutes, { syncService });
await app.register(collabRoutes, { collabService });

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
    return fail(reply, 413, 'Upload exceeds size limit');
  }
  if (error instanceof ClientInputError) return fail(reply, error.statusCode, error.message);
  if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
    return fail(reply, error.statusCode, error instanceof Error ? error.message : 'Request failed');
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
    return fail(reply, 409, 'Duplicate record');
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
    return fail(reply, 404, 'Record not found');
  }
  if (error instanceof z.ZodError) {
    const firstIssue = error.issues[0];
    const message = firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : 'Invalid request';
    return fail(reply, 400, message);
  }
  return fail(reply, 500, 'Internal server error');
});

await app.listen({ host: config.host, port: config.port });
app.log.info(`Server on ${config.host}:${config.port}`);

process.once('SIGTERM', async () => {
  auditService.stopPeriodicArchival();
  await app.close();
  if (redis) await redis.quit();
});
