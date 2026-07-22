import Redis from 'ioredis';
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import argon2 from 'argon2';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { Prisma, PrismaClient, type UserRole } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = Fastify({ logger: true, bodyLimit: 300 * 1024 * 1024 });
const storageDir = path.resolve(process.env.STORAGE_DIR || './storage');
const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || 250) * 1024 * 1024;
const maxArchiveEntries = Number(process.env.MAX_ARCHIVE_ENTRIES || 10000);
const maxUncompressedBytes = Number(process.env.MAX_UNCOMPRESSED_MB || 1024) * 1024 * 1024;
const maxArchiveEntryBytes = Number(process.env.MAX_ARCHIVE_ENTRY_MB || 100) * 1024 * 1024;
const loginRateLimitMax = Number(process.env.LOGIN_RATE_LIMIT_MAX || 10);
const loginRateLimitWindowMs = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS || 900) * 1000;
const downloadRateLimitMax = Number(process.env.DOWNLOAD_RATE_LIMIT_MAX || 30);
const downloadRateLimitWindowMs = Number(process.env.DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS || 60) * 1000;
const uploadRateLimitMax = Number(process.env.UPLOAD_RATE_LIMIT_MAX || 5);
const uploadRateLimitWindowMs = Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_SECONDS || 3600) * 1000;
const accessKey = process.env.MARKET_ACCESS_KEY || '';
const apiVersion = '0.3.1-phase3';

class ClientInputError extends Error {
  statusCode = 400;
}

await fsp.mkdir(storageDir, { recursive: true });
if (!accessKey || accessKey.length < 24) throw new Error('MARKET_ACCESS_KEY must be at least 24 characters.');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');

const allowedOrigins = new Set((process.env.CORS_ORIGIN || '').split(',').map((item) => item.trim()).filter(Boolean));
await app.register(cors, {
  origin: (origin, callback) => {
    // Electron loads the renderer from file://, which is reported as a null origin.
    // Only allow null origin in development to prevent CSRF in production.
    if (!origin || (process.env.NODE_ENV !== 'production' && origin === 'null') || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'), false);
  }
});
await app.register(jwt, { secret: process.env.JWT_SECRET });
await app.register(multipart, { limits: { fileSize: maxUploadBytes, files: 1 } });

type AuthRequest = FastifyRequest & { user: { id: string; username: string; role: UserRole } };
type RateLimitBucket = { count: number; resetAt: number };
const rateLimitBuckets = new Map<string, RateLimitBucket>();
// Periodically clean expired rate-limit buckets to prevent memory leaks.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
}, 60_000).unref();


/ --- Redis connection for shared rate limiting (Phase 2-8) ---
const REDIS_URL = process.env.REDIS_URL || '';
let redis: Redis | null = null;
if (REDIS_URL) {
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true, enableReadyCheck: false });
  redis.on('error', (err) => app.log.warn(err, 'Redis connection error'));
  try { await redis.connect(); app.log.info('Redis connected for shared rate limiting'); } catch { redis = null; app.log.warn('Redis unavailable, using in-memory rate limiter'); }
}
function consumeRateLimit(reply: FastifyReply, key: string, max: number, windowMs: number) {
  const now = Date.now();
  for (const [bucketKey, bucket] of rateLimitBuckets) if (bucket.resetAt <= now) rateLimitBuckets.delete(bucketKey);
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= max) {
    reply.header('Retry-After', Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
    fail(reply, 429, 'Too many requests. Please try again later.');
    return false;
  }
  bucket.count += 1;
  return true;
}


async function consumeRateLimitAsync(reply: FastifyReply, key: string, max: number, windowMs: number): Promise<boolean> {
  if (redis) {
    try {
      const redisKey = `rl:${key}`;
      const current = await redis.incr(redisKey);
      if (current === 1) await redis.pexpire(redisKey, windowMs);
      const ttl = await redis.pttl(redisKey);
      reply.header('X-RateLimit-Limit', String(max));
      reply.header('X-RateLimit-Remaining', String(Math.max(0, max - current)));
      reply.header('X-RateLimit-Reset', String(Math.ceil((Date.now() + (ttl > 0 ? ttl : windowMs)) / 1000)));
      if (current > max) {
        reply.code(429).send({ error: `请求过频频过过，请用后启心试` });
        return false;
      }
      return true;
    } catch {
      // Fall through to in-memory
    }
  }
  return consumeRateLimit(reply, key, max, windowMs);
}
function requestRateLimitKey(request: FastifyRequest, scope: string, suffix = '') {
  return `${scope}:${request.ip}:${suffix}`;
}

function fail(reply: FastifyReply, statusCode: number, message: string) {
  return reply.code(statusCode).send({ error: message });
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return fail(reply, 401, 'Unauthorized');
  }
  const tokenUser = request.user as { id?: string };
  if (!tokenUser.id) return fail(reply, 401, 'Unauthorized');
  const currentUser = await prisma.user.findUnique({ where: { id: tokenUser.id }, select: { id: true, username: true, role: true, enabled: true } });
  if (!currentUser?.enabled) return fail(reply, 401, 'Account disabled');
  (request as AuthRequest).user = { id: currentUser.id, username: currentUser.username, role: currentUser.role };
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if ((request as AuthRequest).user.role !== 'ADMIN') fail(reply, 403, 'Administrator access required');
}

function auth(request: FastifyRequest) { return (request as AuthRequest).user; }
function deckStoragePath(deckId: string) {
  const root = path.resolve(storageDir, 'decks');
  const target = path.resolve(root, deckId);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new ClientInputError('Invalid deck storage path');
  return target;
}
function sha256(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
  });
}

async function listFiles(root: string, prefix = ''): Promise<string[]> {
  let entries: fs.Dirent[];
  try { entries = await fsp.readdir(path.join(root, prefix), { withFileTypes: true }); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, relative));
    else if (entry.isFile()) files.push(path.resolve(root, relative));
  }
  return files;
}

function storageRelative(filePath: string) {
  const root = path.resolve(storageDir);
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : null;
}

function storedPackagePath(packagePath: string) {
  if (fs.existsSync(packagePath)) return packagePath;
  // Older rows may contain the host's absolute Windows storage path. Convert
  // that path to the active STORAGE_DIR when the API runs in Docker.
  const match = String(packagePath).match(/(?:^|[\\/])storage[\\/](.+)$/i);
  return match ? path.resolve(storageDir, ...match[1].split(/[\\/]+/)) : packagePath;
}

async function inspectStorage() {
  const versions = await prisma.deckVersion.findMany({ select: { id: true, deckId: true, version: true, packagePath: true } });
  const referenced = new Set(versions.map((version) => path.resolve(storedPackagePath(version.packagePath))));
  const packageRoot = path.join(storageDir, 'decks');
  const files = await listFiles(packageRoot);
  const missing = versions.filter((version) => !fs.existsSync(storedPackagePath(version.packagePath))).map((version) => ({ id: version.id, deckId: version.deckId, version: version.version, path: storageRelative(storedPackagePath(version.packagePath)) || version.packagePath }));
  const orphanFiles = files.filter((file) => !referenced.has(path.resolve(file))).map((file) => storageRelative(file) || file);
  const topLevel = await fsp.readdir(storageDir, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  const temporary = topLevel.filter((entry) => entry.isFile() && entry.name.startsWith('.upload-')).map((entry) => entry.name);
  const quarantine = topLevel.filter((entry) => entry.isDirectory() && entry.name.startsWith('.deleting-')).map((entry) => entry.name);
  return { referencedCount: versions.length, fileCount: files.length, missing, orphanFiles, temporary, quarantine, healthy: missing.length === 0 && orphanFiles.length === 0 && temporary.length === 0 && quarantine.length === 0 };
}

function normalizeCategoryName(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 80);
}

async function ensureCategory(name: string, createdById: string) {
  const normalized = normalizeCategoryName(name);
  const existing = await prisma.marketCategory.findUnique({ where: { name: normalized } });
  if (existing) return existing;
  const legacyDeck = await prisma.deck.findFirst({ where: { category: normalized }, select: { id: true } });
  return prisma.marketCategory.create({ data: { name: normalized, status: legacyDeck ? 'PUBLISHED' : 'PENDING', createdById } });
}

async function categoryIsApproved(name: string) {
  const category = await prisma.marketCategory.findUnique({ where: { name: normalizeCategoryName(name) }, select: { status: true } });
  return !category || category.status === 'PUBLISHED';
}

function dateFromQuery(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ClientInputError('Invalid date filter');
  return date;
}

async function readUpload(part: Awaited<ReturnType<FastifyRequest['file']>>) {
  if (!part) throw new ClientInputError('A deck ZIP file is required');
  if (!part.filename.toLowerCase().endsWith('.zip')) throw new ClientInputError('Only .zip deck packages are supported');
  const tempPath = path.join(storageDir, `.upload-${crypto.randomUUID()}.tmp`);
  try {
    await pipeline(part.file, fs.createWriteStream(tempPath));
    const stat = await fsp.stat(tempPath);
    if (stat.size > maxUploadBytes) throw new ClientInputError('Upload exceeds the configured size limit');
    return { tempPath, size: stat.size };
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    throw error;
  }
}

function validateArchiveEntries(zip: AdmZip) {
  const entries = zip.getEntries();
  if (!entries.length) throw new ClientInputError('ZIP package cannot be empty');
  if (entries.length > maxArchiveEntries) throw new ClientInputError(`ZIP package contains too many entries (maximum ${maxArchiveEntries})`);
  const seen = new Set<string>();
  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    const rawName = entry.entryName.replaceAll('\\', '/');
    const normalized = path.posix.normalize(rawName);
    const parts = normalized.split('/');
    const isDirectory = rawName.endsWith('/');
    if (!rawName || rawName.includes('\0') || path.posix.isAbsolute(rawName) || /^[A-Za-z]:[\\/]/.test(rawName) || parts.includes('..') || normalized === '.' || normalized.startsWith('../')) {
      throw new ClientInputError('ZIP package contains an unsafe path');
    }
    if (seen.has(normalized)) throw new ClientInputError(`ZIP package contains a duplicate path: ${normalized}`);
    seen.add(normalized);
    const size = Number(entry.header.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new ClientInputError('ZIP package contains an invalid file size');
    if (!isDirectory && size > maxArchiveEntryBytes) throw new ClientInputError(`ZIP entry exceeds the ${Math.floor(maxArchiveEntryBytes / 1024 / 1024)} MB limit`);
    totalUncompressedBytes += size;
    if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > maxUncompressedBytes) throw new ClientInputError(`ZIP package exceeds the ${Math.floor(maxUncompressedBytes / 1024 / 1024)} MB uncompressed limit`);
  }
  return entries;
}

function validateManifest(zip: AdmZip) {
  validateArchiveEntries(zip);
  const manifestEntry = zip.getEntry('manifest.json');
  const cardsEntry = zip.getEntry('cards.json');
  if (!manifestEntry || !cardsEntry) throw new ClientInputError('Package must contain manifest.json and cards.json');
  let rawManifest: unknown;
  let cards: unknown;
  try {
    rawManifest = JSON.parse(manifestEntry.getData().toString('utf8').replace(/^\uFEFF/, ''));
    cards = JSON.parse(cardsEntry.getData().toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new ClientInputError('manifest.json and cards.json must contain valid JSON');
  }
  const manifest = z.object({
    format: z.string().default('knowledge-review-deck'),
    title: z.string().min(1).max(160),
    description: z.string().max(2000).default(''),
    category: z.string().min(1).max(80),
    version: z.number().int().positive(),
    cardCount: z.number().int().nonnegative().optional(),
    changelog: z.string().max(5000).optional()
  }).parse(rawManifest);
  if (!Array.isArray(cards)) throw new ClientInputError('cards.json must contain an array');
  if (manifest.cardCount !== undefined && manifest.cardCount !== cards.length) throw new ClientInputError('manifest.cardCount does not match cards.json');
  return { manifest, cards };
}

function inspectPackage(filePath: string) {
  try {
    return validateManifest(new AdmZip(filePath));
  } catch (error) {
    if (error instanceof ClientInputError || error instanceof z.ZodError) throw error;
    throw new ClientInputError('Invalid ZIP deck package');
  }
}

app.get('/health', async () => ({
  ok: true,
  service: 'knowledge-review-market',
  apiVersion,
  capabilities: { adminAuditLogs: true, adminStorageHealth: true, permanentDeckDelete: true, serverPagination: true, marketCategories: true, categoryManagement: true, versionChangelog: true },
  time: new Date().toISOString()
}));


// ─── User self-registration (Phase 2-9) ───
const REGISTER_ENABLED = process.env.ALLOW_SELF_REGISTER !== 'false';
const REGISTER_RATE_LIMIT_MAX = Number(process.env.REGISTER_RATE_LIMIT_MAX || 3);
const REGISTER_RATE_LIMIT_WINDOW_MS = Number(process.env.REGISTER_RATE_LIMIT_WINDOW_SECONDS || 3600) * 1000;

app.post('/api/v1/auth/register', async (request, reply) => {
  if (!REGISTER_ENABLED) return fail(reply, 403, 'Self-registration is disabled');
  const body = z.object({
    accessKey: z.string().min(1),
    username: z.string().min(3).max(80).regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, hyphens and underscores'),
    password: z.string().min(8).max(200)
  }).safeParse(request.body);
  if (!body.success) return fail(reply, 400, 'Invalid registration data');
  if (body.data.accessKey !== accessKey) return fail(reply, 401, 'Invalid server key');
  if (!await consumeRateLimitAsync(reply, requestRateLimitKey(request, 'register-ip'), REGISTER_RATE_LIMIT_MAX, REGISTER_RATE_LIMIT_WINDOW_MS)) return;
  const username = body.data.username.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return fail(reply, 409, 'Username already taken');
  const passwordHash = await argon2.hash(body.data.password);
  const user = await prisma.user.create({ data: { username, passwordHash, role: 'USER' } });
  await prisma.auditLog.create({ data: { userId: user.id, action: 'auth.register' } });
  const token = await app.jwt.sign({ id: user.id, username: user.username, role: user.role }, { expiresIn: '12h' });
  return { token, user: { id: user.id, username: user.username, role: user.role } };
});

app.post('/api/v1/auth/login', async (request, reply) => {
  const body = z.object({ accessKey: z.string().min(1), username: z.string().min(1), password: z.string().min(1) }).safeParse(request.body);
  const username = body.success ? body.data.username.trim().toLowerCase() : '';
  if (!await consumeRateLimitAsync(reply, requestRateLimitKey(request, 'login-ip'), loginRateLimitMax, loginRateLimitWindowMs)) return;
  if (username && !await consumeRateLimitAsync(reply, requestRateLimitKey(request, 'login-account', username), loginRateLimitMax, loginRateLimitWindowMs)) return;
  if (!body.success || body.data.accessKey !== accessKey) return fail(reply, 401, 'Invalid market credentials');
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.enabled || !(await argon2.verify(user.passwordHash, body.data.password))) return fail(reply, 401, 'Invalid market credentials');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await prisma.auditLog.create({ data: { userId: user.id, action: 'auth.login' } });
  const token = await app.jwt.sign({ id: user.id, username: user.username, role: user.role }, { expiresIn: '12h' });
  return { token, user: { id: user.id, username: user.username, role: user.role } };
});

app.get('/api/v1/me', { preHandler: requireAuth }, async (request) => {
  const user = auth(request);
  return { id: user.id, username: user.username, role: user.role };
});

app.get('/api/v1/categories', { preHandler: requireAuth }, async () => {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    SELECT "name" FROM "MarketCategory" WHERE "status" = 'PUBLISHED'
    UNION
    SELECT DISTINCT "category" AS "name" FROM "Deck" WHERE "status" = 'PUBLISHED'
    ORDER BY "name"
  `);
  return rows.map((row) => row.name);
});

app.patch('/api/v1/me/password', { preHandler: requireAuth }, async (request, reply) => {
  const data = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) }).parse(request.body);
  const user = await prisma.user.findUnique({ where: { id: auth(request).id }, select: { passwordHash: true } });
  if (!user || !(await argon2.verify(user.passwordHash, data.currentPassword))) return fail(reply, 401, 'Current password is incorrect');
  await prisma.user.update({ where: { id: auth(request).id }, data: { passwordHash: await argon2.hash(data.newPassword) } });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: 'auth.password.change', targetId: auth(request).id } });
  return { changed: true };
});

app.get('/api/v1/decks', { preHandler: requireAuth }, async (request) => {
  const query = z.object({ q: z.string().optional(), category: z.string().optional(), sort: z.enum(['latest', 'popular', 'cards']).default('latest'), page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().positive().max(100).default(20) }).parse(request.query);
  const start = (query.page - 1) * query.pageSize;
  const categoryClause = query.category && query.category !== 'all' ? Prisma.sql`AND d."category" = ${query.category}` : Prisma.empty;
  const searchClause = query.q ? Prisma.sql`AND (d."title" ILIKE ${`%${query.q}%`} OR d."description" ILIKE ${`%${query.q}%`})` : Prisma.empty;
  const orderClause = query.sort === 'popular'
    ? Prisma.sql`downloads DESC, d."updatedAt" DESC, d."id" DESC`
    : query.sort === 'cards'
      ? Prisma.sql`card_count DESC, d."updatedAt" DESC, d."id" DESC`
      : Prisma.sql`d."updatedAt" DESC, d."id" DESC`;
  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; title: string; description: string; category: string; author: string; version: number; downloads: number; updatedAt: Date; manifest: unknown; card_count: number }>>(Prisma.sql`
      SELECT d."id", d."title", d."description", d."category", u."username" AS author,
        v."version", COALESCE(downloads.count, 0)::int AS downloads, d."updatedAt", v."manifest",
        CASE WHEN jsonb_typeof(v."manifest"->'cardCount') = 'number' THEN (v."manifest"->>'cardCount')::int ELSE 0 END AS card_count
      FROM "Deck" d
      JOIN "User" u ON u."id" = d."ownerId"
      JOIN LATERAL (
        SELECT "version", "manifest"
        FROM "DeckVersion"
        WHERE "deckId" = d."id" AND "status" = 'PUBLISHED'
        ORDER BY "version" DESC
        LIMIT 1
      ) v ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS count FROM "DeckDownload" WHERE "deckId" = d."id"
      ) downloads ON TRUE
      WHERE d."status" = 'PUBLISHED' ${categoryClause} ${searchClause}
      ORDER BY ${orderClause}
      LIMIT ${query.pageSize} OFFSET ${start}
    `),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM "Deck" d
      WHERE d."status" = 'PUBLISHED'
        AND EXISTS (SELECT 1 FROM "DeckVersion" v WHERE v."deckId" = d."id" AND v."status" = 'PUBLISHED')
        ${categoryClause} ${searchClause}
    `)
  ]);
  const total = Number(totalRows[0]?.count || 0);
  return {
    items: rows.map((deck) => ({ id: deck.id, title: deck.title, description: deck.description, category: deck.category, author: deck.author, version: deck.version, downloads: Number(deck.downloads), updatedAt: deck.updatedAt.toISOString(), manifest: deck.manifest })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize))
  };
});

app.get('/api/v1/decks/:id/update', { preHandler: requireAuth }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const currentVersion = z.object({ version: z.coerce.number().int().nonnegative().max(1000000000).default(0) }).parse(request.query).version;
  const deck = await prisma.deck.findFirst({ where: { id, status: 'PUBLISHED' }, include: { versions: { where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' }, take: 1 } } });
  const latest = deck?.versions[0];
  if (!deck || !latest) return fail(reply, 404, 'Deck not found');
  const manifest = latest.manifest as { changelog?: string };
  return { deckId: id, hasUpdate: latest.version > currentVersion, currentVersion, latestVersion: latest.version, packageSize: latest.packageSize.toString(), sha256: latest.sha256, changelog: manifest?.changelog || '', publishedAt: latest.createdAt.toISOString(), manifest: latest.manifest };
});

app.get('/api/v1/my-decks', { preHandler: requireAuth }, async (request) => {
  const decks = await prisma.deck.findMany({ where: { ownerId: auth(request).id }, include: { versions: { orderBy: { version: 'desc' } } }, orderBy: { updatedAt: 'desc' } });
  return decks.map((deck) => {
    const latestManifest = (deck.versions[0]?.manifest || {}) as { description?: string; category?: string };
    return { ...deck, description: latestManifest.description || deck.description, category: latestManifest.category || deck.category, versions: deck.versions.map((version) => ({ ...version, packageSize: version.packageSize.toString() })) };
  });
});

app.get('/api/v1/decks/:id', { preHandler: requireAuth }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const deck = await prisma.deck.findFirst({ where: { id, status: 'PUBLISHED' }, include: { owner: { select: { username: true } }, versions: { where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' }, take: 1 } } });
  if (!deck) return fail(reply, 404, 'Deck not found');
  return { id: deck.id, title: deck.title, description: deck.description, category: deck.category, author: deck.owner.username, version: deck.versions[0].version, manifest: deck.versions[0].manifest };
});

app.get('/api/v1/decks/:id/download', { preHandler: requireAuth }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  if (!await consumeRateLimitAsync(reply, requestRateLimitKey(request, 'download', auth(request).id), downloadRateLimitMax, downloadRateLimitWindowMs)) return;
  const requestedVersion = z.object({ version: z.coerce.number().int().positive().max(1000000000).optional() }).parse(request.query).version;
  const deck = await prisma.deck.findFirst({ where: { id, status: 'PUBLISHED' } });
  if (!deck) return fail(reply, 404, 'Deck not found');
  const version = await prisma.deckVersion.findFirst({ where: { deckId: id, status: 'PUBLISHED', ...(requestedVersion ? { version: requestedVersion } : {}) }, orderBy: { version: 'desc' } });
  if (!version) return fail(reply, 404, 'Deck version not found');
  const packagePath = storedPackagePath(version.packagePath);
  try { await fsp.access(packagePath, fs.constants.R_OK); } catch { return fail(reply, 503, 'Deck package is temporarily unavailable'); }
  await prisma.deckDownload.create({ data: { deckId: id, userId: auth(request).id, version: version.version } });
  reply.header('Cache-Control', 'private, no-store').header('Content-Type', 'application/zip').header('Content-Length', version.packageSize.toString()).header('Content-Disposition', `attachment; filename="deck-${id}-v${version.version}.zip"`).header('X-Deck-Version', version.version);
  return reply.send(fs.createReadStream(packagePath));
});

app.post('/api/v1/my-decks', { preHandler: requireAuth }, async (request, reply) => {
  if (!await consumeRateLimitAsync(reply, requestRateLimitKey(request, 'upload', auth(request).id), uploadRateLimitMax, uploadRateLimitWindowMs)) return;
  const parts = request.parts();
  let metadata: { title?: string; description?: string; category?: string } = {};
  let upload: Awaited<ReturnType<typeof readUpload>> | null = null;
  for await (const part of parts) {
    if (part.type === 'field' && part.fieldname === 'metadata') {
      try { metadata = JSON.parse(String(part.value)); } catch { throw new ClientInputError('metadata must contain valid JSON'); }
    }
    if (part.type === 'file' && part.fieldname === 'package') upload = await readUpload(part);
  }
  if (!upload) return fail(reply, 400, 'A deck ZIP file is required');
  try {
    const checked = inspectPackage(upload.tempPath);
    const data = z.object({ title: z.string().min(1).max(160).optional(), description: z.string().max(2000).optional(), category: z.string().min(1).max(80).optional() }).parse(metadata);
    const title = data.title || checked.manifest.title;
    const description = data.description ?? checked.manifest.description;
    const category = normalizeCategoryName(data.category || checked.manifest.category);
    await ensureCategory(category, auth(request).id);
    const manifest = { ...checked.manifest, title, description, category };
    const duplicate = await prisma.deck.findFirst({ where: { ownerId: auth(request).id, title }, select: { id: true, status: true } });
    if (duplicate) return fail(reply, 409, duplicate.status === 'DISABLED' ? 'A disabled deck with this title already exists; re-list it or permanently delete it before creating a new deck' : 'A deck with this title already exists; upload a new version to that deck');
    const deck = await prisma.deck.create({ data: { ownerId: auth(request).id, title, description, category } });
    try {
      const result = await saveVersion(deck.id, manifest.version, upload, manifest);
      return reply.code(201).send({ id: deck.id, version: result.version, sha256: result.sha256, status: deck.status });
    } catch (error) {
      await prisma.deck.delete({ where: { id: deck.id } }).catch(() => undefined);
      throw error;
    }
  } finally { await fsp.rm(upload.tempPath, { force: true }); }
});

app.post('/api/v1/my-decks/:id/versions', { preHandler: requireAuth }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const deck = await prisma.deck.findFirst({ where: { id, ownerId: auth(request).id } });
  if (!deck) return fail(reply, 404, 'Deck not found');
  if (deck.status === 'DISABLED') return fail(reply, 409, 'Disabled decks cannot receive new versions');
  if (!await consumeRateLimitAsync(reply, requestRateLimitKey(request, 'upload', auth(request).id), uploadRateLimitMax, uploadRateLimitWindowMs)) return;
  const parts = request.parts();
  let upload: Awaited<ReturnType<typeof readUpload>> | null = null;
  for await (const part of parts) if (part.type === 'file' && part.fieldname === 'package') upload = await readUpload(part);
  if (!upload) return fail(reply, 400, 'A deck ZIP file is required');
  try {
    const checked = inspectPackage(upload.tempPath);
    const category = normalizeCategoryName(checked.manifest.category);
    await ensureCategory(category, auth(request).id);
    const result = await saveVersion(deck.id, checked.manifest.version, upload, { ...checked.manifest, category });
    return reply.code(201).send({ id: deck.id, version: result.version, sha256: result.sha256, status: deck.status });
  } finally { await fsp.rm(upload.tempPath, { force: true }); }
});

async function saveVersion(deckId: string, version: number, upload: { tempPath: string; size: number }, manifest: object) {
  const deck = await prisma.deck.findUnique({ where: { id: deckId }, select: { currentVersion: true } });
  if (!deck) throw new ClientInputError('Deck not found');
  if (version <= deck.currentVersion) throw new ClientInputError(`Version must be greater than the current version (${deck.currentVersion})`);
  const existing = await prisma.deckVersion.findUnique({ where: { deckId_version: { deckId, version } } });
  if (existing) throw new ClientInputError(`Version ${version} already exists`);
  const targetDir = path.join(storageDir, 'decks', deckId, `v${version}`);
  await fsp.mkdir(targetDir, { recursive: true });
  const target = path.join(targetDir, 'package.zip');
  await fsp.rename(upload.tempPath, target);
  try {
    const hash = await sha256(target);
    const saved = await prisma.$transaction(async (tx) => {
      const item = await tx.deckVersion.create({ data: { deckId, version, status: 'PENDING', packagePath: target, packageSize: BigInt(upload.size), sha256: hash, manifest } });
      await tx.deck.update({ where: { id: deckId }, data: { currentVersion: version } });
      return item;
    });
    return { version: saved.version, sha256: saved.sha256 };
  } catch (error) {
    await fsp.rm(target, { force: true });
    throw error;
  }
}

app.get('/api/v1/admin/users', { preHandler: requireAdmin }, async (request) => {
  const query = z.object({ page: z.coerce.number().int().positive().optional(), pageSize: z.coerce.number().int().positive().max(100).default(20) }).parse(request.query);
  const users = await prisma.user.findMany({ select: { id: true, username: true, role: true, enabled: true, createdAt: true, lastLoginAt: true }, orderBy: { createdAt: 'desc' }, ...(query.page ? { skip: (query.page - 1) * query.pageSize, take: query.pageSize } : {}) });
  if (!query.page) return users;
  const total = await prisma.user.count();
  return { items: users, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
});

app.get('/api/v1/admin/audit-logs', { preHandler: requireAdmin }, async (request) => {
  const query = z.object({ page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().positive().max(100).default(25), action: z.string().max(120).optional(), userId: z.string().uuid().optional(), targetId: z.string().max(120).optional(), from: z.string().optional(), to: z.string().optional() }).parse(request.query);
  const from = dateFromQuery(query.from);
  const to = dateFromQuery(query.to);
  const where = { ...(query.action ? { action: { contains: query.action, mode: 'insensitive' as const } } : {}), ...(query.userId ? { userId: query.userId } : {}), ...(query.targetId ? { targetId: query.targetId } : {}), ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) };
  const [total, items] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, include: { user: { select: { username: true, role: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize })
  ]);
  return { items, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
});

app.get('/api/v1/admin/stats', { preHandler: requireAdmin }, async () => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [users, enabledUsers, decks, publishedDecks, disabledDecks, pendingVersions, downloads, recentDownloads, storage] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { enabled: true } }),
    prisma.deck.count(),
    prisma.deck.count({ where: { status: 'PUBLISHED' } }),
    prisma.deck.count({ where: { status: 'DISABLED' } }),
    prisma.deckVersion.count({ where: { status: 'PENDING' } }),
    prisma.deckDownload.count(),
    prisma.deckDownload.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    inspectStorage()
  ]);
  const dailyDownloads = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.now() - (6 - index) * 24 * 60 * 60 * 1000);
    const day = date.toISOString().slice(0, 10);
    return { date: day, count: recentDownloads.filter((item) => item.createdAt.toISOString().slice(0, 10) === day).length };
  });
  return { users, enabledUsers, disabledUsers: users - enabledUsers, decks, publishedDecks, disabledDecks, pendingVersions, downloads, dailyDownloads, storage };
});

app.get('/api/v1/admin/categories', { preHandler: requireAdmin }, async (request) => {
  const decks = await prisma.deck.findMany({ select: { category: true }, distinct: ['category'] });
  await Promise.all(decks.map((deck) => prisma.marketCategory.upsert({
    where: { name: deck.category },
    update: {},
    create: { name: deck.category, status: 'PUBLISHED', createdById: auth(request).id }
  })));
  const catalog = await prisma.marketCategory.findMany({ include: { createdBy: { select: { username: true } } }, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
  return catalog.map((item) => ({ ...item, legacy: false }));
});

app.post('/api/v1/admin/categories', { preHandler: requireAdmin }, async (request, reply) => {
  const data = z.object({ name: z.string().min(1).max(80) }).parse(request.body);
  const name = normalizeCategoryName(data.name);
  const category = await prisma.marketCategory.upsert({ where: { name }, update: { status: 'PUBLISHED' }, create: { name, status: 'PUBLISHED', createdById: auth(request).id } });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: 'admin.category.create', targetId: category.id, metadata: { name } } });
  return reply.code(201).send(category);
});

app.patch('/api/v1/admin/categories/:id', { preHandler: requireAdmin }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const { name: rawName } = z.object({ name: z.string().min(1).max(80) }).parse(request.body);
  const name = normalizeCategoryName(rawName);
  const existing = await prisma.marketCategory.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!existing) return fail(reply, 404, 'Category not found');
  const duplicate = await prisma.marketCategory.findUnique({ where: { name }, select: { id: true } });
  if (duplicate && duplicate.id !== id) return fail(reply, 409, 'A category with this name already exists');
  const category = await prisma.$transaction(async (tx) => {
    const updated = await tx.marketCategory.update({ where: { id }, data: { name } });
    await tx.deck.updateMany({ where: { category: existing.name }, data: { category: name } });
    const versions = await tx.deckVersion.findMany({ where: { deck: { category: name } }, select: { id: true, manifest: true } });
    for (const version of versions) {
      const manifest = version.manifest && typeof version.manifest === 'object' && !Array.isArray(version.manifest) ? version.manifest as Record<string, unknown> : {};
      await tx.deckVersion.update({ where: { id: version.id }, data: { manifest: { ...manifest, category: name } } });
    }
    return updated;
  });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: 'admin.category.update', targetId: id, metadata: { from: existing.name, name } } });
  return category;
});

app.delete('/api/v1/admin/categories/:id', { preHandler: requireAdmin }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const category = await prisma.marketCategory.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!category) return fail(reply, 404, 'Category not found');
  const deckCount = await prisma.deck.count({ where: { category: category.name } });
  if (deckCount > 0) return fail(reply, 409, `Move ${deckCount} deck(s) to another category before deleting this category`);
  await prisma.marketCategory.delete({ where: { id } });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: 'admin.category.delete', targetId: id, metadata: { name: category.name } } });
  return { deleted: true, id, name: category.name };
});

app.patch('/api/v1/admin/categories/:id/:action', { preHandler: requireAdmin }, async (request, reply) => {
  const { id, action } = z.object({ id: z.string().uuid(), action: z.enum(['approve', 'reject']) }).parse(request.params);
  const category = await prisma.marketCategory.update({ where: { id }, data: { status: action === 'approve' ? 'PUBLISHED' : 'REJECTED' } });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: `admin.category.${action}`, targetId: id, metadata: { name: category.name } } });
  return category;
});

app.patch('/api/v1/admin/decks/:id/category', { preHandler: requireAdmin }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const { category } = z.object({ category: z.string().min(1).max(80) }).parse(request.body);
  const name = normalizeCategoryName(category);
  const deck = await prisma.deck.findUnique({ where: { id }, select: { id: true } });
  if (!deck) return fail(reply, 404, 'Deck not found');
  await prisma.marketCategory.upsert({ where: { name }, update: { status: 'PUBLISHED' }, create: { name, status: 'PUBLISHED', createdById: auth(request).id } });
  const updated = await prisma.$transaction(async (tx) => {
    const deckUpdate = await tx.deck.update({ where: { id }, data: { category: name }, select: { id: true, category: true } });
    const versions = await tx.deckVersion.findMany({ where: { deckId: id }, select: { id: true, manifest: true } });
    for (const version of versions) {
      const manifest = version.manifest && typeof version.manifest === 'object' && !Array.isArray(version.manifest) ? version.manifest as Record<string, unknown> : {};
      await tx.deckVersion.update({ where: { id: version.id }, data: { manifest: { ...manifest, category: name } } });
    }
    return deckUpdate;
  });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: 'admin.deck.category.update', targetId: id, metadata: { category: name } } });
  return updated;
});

app.get('/api/v1/admin/storage/health', { preHandler: requireAdmin }, async () => inspectStorage());

app.post('/api/v1/admin/storage/cleanup', { preHandler: requireAdmin }, async (request, reply) => {
  const data = z.object({ olderThanHours: z.coerce.number().positive().max(8760).default(24), removeOrphans: z.boolean().default(false), removeQuarantine: z.boolean().default(false) }).parse(request.body || {});
  const report = await inspectStorage();
  const cutoff = Date.now() - data.olderThanHours * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const name of report.temporary) {
    const target = path.join(storageDir, name);
    const stat = await fsp.stat(target).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) { await fsp.rm(target, { force: true }); removed.push(name); }
  }
  if (data.removeOrphans) for (const relative of report.orphanFiles) { const target = path.resolve(storageDir, relative); if (storageRelative(target)) { await fsp.rm(target, { force: true }); removed.push(relative); } }
  if (data.removeQuarantine) for (const name of report.quarantine) { const target = path.join(storageDir, name); await fsp.rm(target, { recursive: true, force: true }); removed.push(name); }
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: 'admin.storage.cleanup', metadata: { olderThanHours: data.olderThanHours, removeOrphans: data.removeOrphans, removeQuarantine: data.removeQuarantine, removed } } });
  return reply.send({ removed, storage: await inspectStorage() });
});

app.get('/api/v1/admin/decks', { preHandler: requireAdmin }, async (request) => {
  const query = z.object({ status: z.enum(['DRAFT', 'PENDING', 'PUBLISHED', 'DISABLED']).optional(), page: z.coerce.number().int().positive().optional(), pageSize: z.coerce.number().int().positive().max(100).default(20) }).parse(request.query);
  const where = query.status ? { status: query.status } : {};
  const decks = await prisma.deck.findMany({ where, include: { owner: { select: { username: true } }, versions: { orderBy: { version: 'desc' }, take: 10 }, _count: { select: { downloads: true } } }, orderBy: { updatedAt: 'desc' }, ...(query.page ? { skip: (query.page - 1) * query.pageSize, take: query.pageSize } : {}) });
  const items = decks.map((deck) => ({ ...deck, downloads: deck._count.downloads, publishedVersion: deck.publishedVersion, versions: deck.versions.map((version) => ({ ...version, packageSize: version.packageSize.toString() })) }));
  if (!query.page) return items;
  const total = await prisma.deck.count({ where });
  return { items, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
});

app.post('/api/v1/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
  const data = z.object({ username: z.string().min(3).max(80).regex(/^[a-zA-Z0-9_.-]+$/), password: z.string().min(8).max(200) }).parse(request.body);
  const user = await prisma.user.create({ data: { username: data.username.toLowerCase(), passwordHash: await argon2.hash(data.password) }, select: { id: true, username: true, role: true, enabled: true } });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: 'admin.user.create', targetId: user.id } });
  return reply.code(201).send(user);
});

app.patch('/api/v1/admin/users/:id/:action', { preHandler: requireAdmin }, async (request, reply) => {
  const { id, action } = z.object({ id: z.string().uuid(), action: z.enum(['enable', 'disable']) }).parse(request.params);
  if (action === 'disable' && id === auth(request).id) return fail(reply, 409, 'Administrators cannot disable themselves');
  if (action === 'disable') {
    const target = await prisma.user.findUnique({ where: { id }, select: { role: true, enabled: true } });
    if (!target) return fail(reply, 404, 'User not found');
    if (target.role === 'ADMIN' && target.enabled && await prisma.user.count({ where: { role: 'ADMIN', enabled: true } }) <= 1) return fail(reply, 409, 'At least one enabled administrator is required');
  }
  const user = await prisma.user.update({ where: { id }, data: { enabled: action === 'enable' }, select: { id: true, username: true, role: true, enabled: true } });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: `admin.user.${action}`, targetId: id } });
  return user;
});

app.patch('/api/v1/admin/decks/:id/:action', { preHandler: requireAdmin }, async (request, reply) => {
  const { id, action } = z.object({ id: z.string().uuid(), action: z.enum(['publish', 'disable']) }).parse(request.params);
  const existingDeck = await prisma.deck.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!existingDeck) return fail(reply, 404, 'Deck not found');
  if (action === 'disable') {
    const deck = await prisma.deck.update({ where: { id }, data: { status: 'DISABLED' }, select: { id: true, status: true, publishedVersion: true } });
    await prisma.auditLog.create({ data: { userId: auth(request).id, action: `admin.deck.${action}`, targetId: id } });
    return deck;
  }
  const pending = await prisma.deckVersion.findFirst({ where: { deckId: id, status: 'PENDING' }, orderBy: { version: 'desc' } });
  const published = pending || await prisma.deckVersion.findFirst({ where: { deckId: id, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
  if (!published) return fail(reply, 400, 'Deck has no reviewable version');
  const manifest = published.manifest as { description?: string; category?: string };
  if (manifest.category && !(await categoryIsApproved(manifest.category))) return fail(reply, 409, 'This deck uses a category that still requires administrator approval');
  const deck = await prisma.$transaction(async (tx) => {
    if (published.status === 'PENDING') await tx.deckVersion.update({ where: { id: published.id }, data: { status: 'PUBLISHED' } });
    return tx.deck.update({ where: { id }, data: { status: 'PUBLISHED', publishedVersion: published.version, ...(manifest.description !== undefined ? { description: manifest.description } : {}), ...(manifest.category ? { category: normalizeCategoryName(manifest.category) } : {}) }, select: { id: true, status: true, publishedVersion: true, description: true, category: true } });
  });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: `admin.deck.${action}`, targetId: id } });
  return deck;
});

app.patch('/api/v1/admin/decks/:id/versions/:version/:action', { preHandler: requireAdmin }, async (request, reply) => {
  const { id, version, action } = z.object({ id: z.string().uuid(), version: z.coerce.number().int().positive(), action: z.enum(['publish', 'reject']) }).parse(request.params);
  const target = await prisma.deckVersion.findUnique({ where: { deckId_version: { deckId: id, version } }, include: { deck: { select: { id: true, status: true } } } });
  if (!target) return fail(reply, 404, 'Deck version not found');
  if (target.deck.status === 'DISABLED') return fail(reply, 409, 'Disabled decks must be re-listed before reviewing versions');
  if (target.status !== 'PENDING') return fail(reply, 400, 'Only pending versions can be reviewed');
  if (action === 'reject') {
    const rejected = await prisma.deckVersion.update({ where: { id: target.id }, data: { status: 'REJECTED' }, select: { deckId: true, version: true, status: true } });
    await prisma.auditLog.create({ data: { userId: auth(request).id, action: 'admin.deck.version.reject', targetId: target.id, metadata: { deckId: id, version } } });
    return rejected;
  }
  const manifest = target.manifest as { description?: string; category?: string };
  if (manifest.category && !(await categoryIsApproved(manifest.category))) return fail(reply, 409, 'Approve this deck category before publishing the version');
  const published = await prisma.$transaction(async (tx) => {
    await tx.deckVersion.update({ where: { id: target.id }, data: { status: 'PUBLISHED' } });
    return tx.deck.update({ where: { id }, data: { status: 'PUBLISHED', publishedVersion: version, ...(manifest.description !== undefined ? { description: manifest.description } : {}), ...(manifest.category ? { category: normalizeCategoryName(manifest.category) } : {}) }, select: { id: true, status: true, publishedVersion: true, description: true, category: true } });
  });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: 'admin.deck.version.publish', targetId: target.id, metadata: { deckId: id, version } } });
  return published;
});

app.delete('/api/v1/admin/decks/:id', { preHandler: requireAdmin }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const deck = await prisma.deck.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!deck) return fail(reply, 404, 'Deck not found');
  if (deck.status !== 'DISABLED') return fail(reply, 409, 'Only disabled decks can be permanently deleted');

  const storagePath = deckStoragePath(id);
  const quarantinePath = path.join(storageDir, `.deleting-${id}-${crypto.randomUUID()}`);
  let movedStorage = false;
  let databaseDeleted = false;
  try {
    // Quarantine files before deleting database rows so a failed transaction can be restored.
    await fsp.rename(storagePath, quarantinePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    movedStorage = true;
    await prisma.$transaction(async (tx) => {
      await tx.deck.delete({ where: { id } });
      await tx.auditLog.create({ data: { userId: auth(request).id, action: 'admin.deck.delete', targetId: id } });
    });
    databaseDeleted = true;
    let storageCleanupPending = false;
    try { await fsp.rm(quarantinePath, { recursive: true, force: true }); } catch (cleanupError) {
      storageCleanupPending = true;
      request.log.error(cleanupError, 'Deck database row deleted but storage cleanup is pending');
    }
    return { id, deleted: true, storageCleanupPending };
  } catch (error) {
    if (movedStorage && !databaseDeleted) await fsp.rename(quarantinePath, storagePath).catch(() => undefined);
    throw error;
  }
});



// ─── Deck reviews and ratings (Phase 2-10) ───
app.get('/api/v1/decks/:id/reviews', async (request) => {
  const { id } = request.params as { id: string };
  const reviews = await prisma.deckReview.findMany({
    where: { deckId: id },
    include: { user: { select: { username: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  const stats = await prisma.deckReview.aggregate({
    where: { deckId: id },
    _avg: { rating: true },
    _count: true
  });
  return { reviews, avgRating: stats._avg.rating || 0, totalReviews: stats._count };
});

app.post('/api/v1/decks/:id/reviews', { preHandler: requireAuth }, async (request, reply) => {
  const userId = auth(request).id;
  const { id: deckId } = request.params as { id: string };
  const body = z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(2000).default('')
  }).safeParse(request.body);
  if (!body.success) return fail(reply, 400, 'Invalid review data');
  const deck = await prisma.deck.findUnique({ where: { id: deckId } });
  if (!deck) return fail(reply, 404, 'Deck not found');
  if (deck.ownerId === userId) return fail(reply, 400, 'Cannot review your own deck');
  const existing = await prisma.deckReview.findUnique({ where: { deckId_userId: { deckId, userId } } });
  if (existing) {
    const updated = await prisma.deckReview.update({
      where: { id: existing.id },
      data: { rating: body.data.rating, comment: body.data.comment }
    });
    return { review: updated, updated: true };
  }
  const review = await prisma.deckReview.create({
    data: { deckId, userId, rating: body.data.rating, comment: body.data.comment }
  });
  await prisma.auditLog.create({ data: { userId, action: 'deck.review', targetId: deckId } });
  return { review, updated: false };
});

app.delete('/api/v1/decks/:id/reviews', { preHandler: requireAuth }, async (request) => {
  const userId = auth(request).id;
  const { id: deckId } = request.params as { id: string };
  const deleted = await prisma.deckReview.deleteMany({ where: { deckId, userId } });
  return { deleted: deleted.count > 0 };
});

// ─── Favorites / Bookmarks (Phase 1-5) ───
app.get('/api/v1/favorites', { preHandler: requireAuth }, async (request) => {
  const userId = auth(request).id;
  const favorites = await prisma.deckFavorite.findMany({
    where: { userId },
    include: { deck: { select: { id: true, title: true, category: true, status: true } } },
    orderBy: { createdAt: 'desc' }
  });
  return { favorites: favorites.map(f => ({ id: f.id, deckId: f.deckId, deck: f.deck, createdAt: f.createdAt })) };
});

app.post('/api/v1/favorites/:deckId', { preHandler: requireAuth }, async (request, reply) => {
  const userId = auth(request).id;
  const { deckId } = request.params as { deckId: string };
  const deck = await prisma.deck.findUnique({ where: { id: deckId } });
  if (!deck) return fail(reply, 404, 'Deck not found');
  const existing = await prisma.deckFavorite.findUnique({ where: { deckId_userId: { deckId, userId } } });
  if (existing) return { favorited: true, alreadyExisted: true };
  await prisma.deckFavorite.create({ data: { deckId, userId } });
  await prisma.auditLog.create({ data: { userId, action: 'deck.favorite', targetId: deckId } });
  return { favorited: true, alreadyExisted: false };
});

app.delete('/api/v1/favorites/:deckId', { preHandler: requireAuth }, async (request, reply) => {
  const userId = auth(request).id;
  const { deckId } = request.params as { deckId: string };
  const deleted = await prisma.deckFavorite.deleteMany({ where: { deckId, userId } });
  return { unfavorited: true, count: deleted.count };
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') return fail(reply, 413, 'Upload exceeds the configured size limit');
  if (error instanceof ClientInputError) return fail(reply, error.statusCode, error.message);
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return fail(reply, 409, 'A record with the same unique value already exists');
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') return fail(reply, 404, 'The requested record was not found');
  return fail(reply, error instanceof z.ZodError ? 400 : 500, error instanceof z.ZodError ? 'Invalid request' : 'Internal server error');
});

const port = Number(process.env.PORT || 4000);
await app.listen({ host: process.env.HOST || '0.0.0.0', port });
process.once('SIGTERM', async () => { await app.close(); await prisma.$disconnect(); if (redis) await redis.quit(); });
