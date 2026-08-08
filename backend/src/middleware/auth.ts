import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole } from '@prisma/client';
import type { Redis } from 'ioredis';
import { prisma } from '../lib/prisma.js';
import { fail } from '../utils/response.js';
import { config } from '../config.js';

export type AuthRequest = FastifyRequest & { 
  user: { id: string; username: string; role: UserRole; iat?: number }
};

type CachedUser = {
  id: string;
  username: string;
  role: UserRole;
  enabled: boolean;
  status: string;
  passwordChangedAt: string | null;
};

type MemoryCacheEntry = { user: CachedUser; expiresAt: number };

const AUTH_CACHE_PREFIX = 'auth:user:';
const REDIS_CACHE_SECONDS = 30;
const MEMORY_CACHE_MS = 5_000;
let authCacheRedis: Redis | null = null;
const memoryCache = new Map<string, MemoryCacheEntry>();

const cacheCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) memoryCache.delete(key);
  }
}, 60_000);
cacheCleanupTimer.unref();

export function configureAuthCache(redis: Redis | null) {
  authCacheRedis = redis;
  memoryCache.clear();
}

export async function invalidateAuthCache(userId: string) {
  const key = `${AUTH_CACHE_PREFIX}${userId}`;
  memoryCache.delete(key);
  if (!authCacheRedis) return;
  try {
    await authCacheRedis.del(key);
  } catch {
    // Cache invalidation is best effort; the short TTL is the fallback.
  }
}

function memoryCacheUser(key: string, user: CachedUser) {
  while (memoryCache.size >= config.authCacheMaxEntries && !memoryCache.has(key)) {
    const oldest = memoryCache.keys().next().value as string | undefined;
    if (!oldest) break;
    memoryCache.delete(oldest);
  }
  memoryCache.set(key, { user, expiresAt: Date.now() + MEMORY_CACHE_MS });
}

export async function primeAuthCache(user: CachedUser) {
  await cacheUser(user);
}

async function getCachedUser(userId: string): Promise<CachedUser | null> {
  const key = `${AUTH_CACHE_PREFIX}${userId}`;
  const memory = memoryCache.get(key);
  if (memory && memory.expiresAt > Date.now()) return memory.user;
  if (memory) memoryCache.delete(key);

  if (!authCacheRedis) return null;
  try {
    const raw = await authCacheRedis.get(key);
    if (!raw) return null;
    const user = JSON.parse(raw) as CachedUser;
    if (!user?.id || !user.username || !user.role) return null;
    memoryCacheUser(key, user);
    return user;
  } catch {
    return null;
  }
}

async function cacheUser(user: CachedUser) {
  const key = `${AUTH_CACHE_PREFIX}${user.id}`;
  memoryCacheUser(key, user);
  if (!authCacheRedis) return;
  try {
    await authCacheRedis.set(key, JSON.stringify(user), 'EX', REDIS_CACHE_SECONDS);
  } catch {
    // PostgreSQL remains the source of truth when Redis is unavailable.
  }
}

async function loadUser(userId: string): Promise<CachedUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      role: true,
      enabled: true,
      status: true,
      passwordChangedAt: true,
    },
  });
  if (!user) return null;

  const cached: CachedUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    enabled: user.enabled,
    status: user.status,
    passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
  };
  await cacheUser(cached);
  return cached;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return fail(reply, 401, 'Unauthorized');
  }
  const tokenUser = request.user as { id?: string; iat?: number };
  if (!tokenUser.id) return fail(reply, 401, 'Unauthorized');
  
  const currentUser = await getCachedUser(tokenUser.id) ?? await loadUser(tokenUser.id);
  
  if (!currentUser?.enabled) return fail(reply, 401, 'Account disabled');
  if (currentUser.status === 'SUSPENDED' || currentUser.status === 'BANNED') {
    return fail(reply, 401, 'Account disabled');
  }
  if (currentUser.passwordChangedAt && tokenUser.iat) {
    const changedAtSeconds = Math.floor(new Date(currentUser.passwordChangedAt).getTime() / 1000);
    if (tokenUser.iat < changedAtSeconds) return fail(reply, 401, 'Session expired');
  }
  (request as AuthRequest).user = { 
    id: currentUser.id, 
    username: currentUser.username, 
    role: currentUser.role,
    iat: tokenUser.iat,
  };
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if ((request as AuthRequest).user.role !== 'ADMIN') {
    fail(reply, 403, 'Administrator access required');
  }
}

export function auth(request: FastifyRequest) { 
  return (request as AuthRequest).user; 
}
