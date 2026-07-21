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
import { PrismaClient, type UserRole } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = Fastify({ logger: true, bodyLimit: 300 * 1024 * 1024 });
const storageDir = path.resolve(process.env.STORAGE_DIR || './storage');
const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || 250) * 1024 * 1024;
const accessKey = process.env.MARKET_ACCESS_KEY || '';

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
    if (!origin || origin === 'null' || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'), false);
  }
});
await app.register(jwt, { secret: process.env.JWT_SECRET });
await app.register(multipart, { limits: { fileSize: maxUploadBytes, files: 1 } });

type AuthRequest = FastifyRequest & { user: { id: string; username: string; role: UserRole } };

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
function sha256(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
  });
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

function validateManifest(zip: AdmZip) {
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
    cardCount: z.number().int().nonnegative().optional()
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

app.get('/health', async () => ({ ok: true, service: 'knowledge-review-market', time: new Date().toISOString() }));

app.post('/api/v1/auth/login', async (request, reply) => {
  const body = z.object({ accessKey: z.string().min(1), username: z.string().min(1), password: z.string().min(1) }).safeParse(request.body);
  if (!body.success || body.data.accessKey !== accessKey) return fail(reply, 401, 'Invalid market credentials');
  const user = await prisma.user.findUnique({ where: { username: body.data.username } });
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

app.get('/api/v1/decks', { preHandler: requireAuth }, async (request) => {
  const query = z.object({ q: z.string().optional(), category: z.string().optional(), sort: z.enum(['latest', 'popular', 'cards']).default('latest') }).parse(request.query);
  const decks = await prisma.deck.findMany({ where: { status: 'PUBLISHED', ...(query.category ? { category: query.category } : {}), ...(query.q ? { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { description: { contains: query.q, mode: 'insensitive' } }] } : {}) }, include: { owner: { select: { username: true } }, versions: { orderBy: { version: 'desc' }, take: 1 }, _count: { select: { downloads: true } } } });
  return decks.sort((a, b) => query.sort === 'popular' ? b._count.downloads - a._count.downloads : query.sort === 'cards' ? Number((b.versions[0]?.manifest as { cardCount?: number })?.cardCount || 0) - Number((a.versions[0]?.manifest as { cardCount?: number })?.cardCount || 0) : b.updatedAt.getTime() - a.updatedAt.getTime()).map((deck) => ({ id: deck.id, title: deck.title, description: deck.description, category: deck.category, author: deck.owner.username, version: deck.currentVersion, downloads: deck._count.downloads, manifest: deck.versions[0]?.manifest }));
});

app.get('/api/v1/my-decks', { preHandler: requireAuth }, async (request) => {
  const decks = await prisma.deck.findMany({ where: { ownerId: auth(request).id }, include: { versions: { orderBy: { version: 'desc' } } }, orderBy: { updatedAt: 'desc' } });
  return decks.map((deck) => ({ ...deck, versions: deck.versions.map((version) => ({ ...version, packageSize: version.packageSize.toString() })) }));
});

app.get('/api/v1/decks/:id', { preHandler: requireAuth }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const deck = await prisma.deck.findFirst({ where: { id, status: 'PUBLISHED' }, include: { owner: { select: { username: true } }, versions: { orderBy: { version: 'desc' }, take: 1 } } });
  if (!deck) return fail(reply, 404, 'Deck not found');
  return { id: deck.id, title: deck.title, description: deck.description, category: deck.category, author: deck.owner.username, version: deck.currentVersion, manifest: deck.versions[0]?.manifest };
});

app.get('/api/v1/decks/:id/download', { preHandler: requireAuth }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const requestedVersion = z.object({ version: z.coerce.number().int().positive().optional() }).parse(request.query).version;
  const deck = await prisma.deck.findFirst({ where: { id, status: 'PUBLISHED' } });
  if (!deck) return fail(reply, 404, 'Deck not found');
  const version = await prisma.deckVersion.findFirst({ where: { deckId: id, ...(requestedVersion ? { version: requestedVersion } : {}) }, orderBy: { version: 'desc' } });
  if (!version) return fail(reply, 404, 'Deck version not found');
  await prisma.deckDownload.create({ data: { deckId: id, userId: auth(request).id, version: version.version } });
  reply.header('Content-Type', 'application/zip').header('Content-Length', version.packageSize.toString()).header('Content-Disposition', `attachment; filename="deck-${id}-v${version.version}.zip"`).header('X-Deck-Version', version.version);
  return reply.send(fs.createReadStream(version.packagePath));
});

app.post('/api/v1/my-decks', { preHandler: requireAuth }, async (request, reply) => {
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
    const deck = await prisma.deck.create({ data: { ownerId: auth(request).id, title: data.title || checked.manifest.title, description: data.description ?? checked.manifest.description, category: data.category || checked.manifest.category } });
    try {
      const result = await saveVersion(deck.id, checked.manifest.version, upload, checked.manifest);
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
  const parts = request.parts();
  let upload: Awaited<ReturnType<typeof readUpload>> | null = null;
  for await (const part of parts) if (part.type === 'file' && part.fieldname === 'package') upload = await readUpload(part);
  if (!upload) return fail(reply, 400, 'A deck ZIP file is required');
  try {
    const checked = inspectPackage(upload.tempPath);
    const result = await saveVersion(deck.id, checked.manifest.version, upload, checked.manifest);
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
      const item = await tx.deckVersion.create({ data: { deckId, version, packagePath: target, packageSize: BigInt(upload.size), sha256: hash, manifest } });
      await tx.deck.update({ where: { id: deckId }, data: { currentVersion: version } });
      return item;
    });
    return { version: saved.version, sha256: saved.sha256 };
  } catch (error) {
    await fsp.rm(target, { force: true });
    throw error;
  }
}

app.get('/api/v1/admin/users', { preHandler: requireAdmin }, async () => prisma.user.findMany({ select: { id: true, username: true, role: true, enabled: true, createdAt: true, lastLoginAt: true }, orderBy: { createdAt: 'desc' } }));

app.get('/api/v1/admin/decks', { preHandler: requireAdmin }, async (request) => {
  const { status } = z.object({ status: z.enum(['DRAFT', 'PENDING', 'PUBLISHED', 'DISABLED']).optional() }).parse(request.query);
  const decks = await prisma.deck.findMany({ where: status ? { status } : {}, include: { owner: { select: { username: true } }, versions: { orderBy: { version: 'desc' }, take: 1 }, _count: { select: { downloads: true } } }, orderBy: { updatedAt: 'desc' } });
  return decks.map((deck) => ({ ...deck, downloads: deck._count.downloads, versions: deck.versions.map((version) => ({ ...version, packageSize: version.packageSize.toString() })) }));
});

app.post('/api/v1/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
  const data = z.object({ username: z.string().min(3).max(80).regex(/^[a-zA-Z0-9_.-]+$/), password: z.string().min(8).max(200) }).parse(request.body);
  const user = await prisma.user.create({ data: { username: data.username, passwordHash: await argon2.hash(data.password) }, select: { id: true, username: true, role: true, enabled: true } });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: 'admin.user.create', targetId: user.id } });
  return reply.code(201).send(user);
});

app.patch('/api/v1/admin/users/:id/:action', { preHandler: requireAdmin }, async (request, reply) => {
  const { id, action } = z.object({ id: z.string().uuid(), action: z.enum(['enable', 'disable']) }).parse(request.params);
  const user = await prisma.user.update({ where: { id }, data: { enabled: action === 'enable' }, select: { id: true, username: true, role: true, enabled: true } });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: `admin.user.${action}`, targetId: id } });
  return user;
});

app.patch('/api/v1/admin/decks/:id/:action', { preHandler: requireAdmin }, async (request, reply) => {
  const { id, action } = z.object({ id: z.string().uuid(), action: z.enum(['publish', 'disable']) }).parse(request.params);
  if (action === 'publish' && !(await prisma.deckVersion.count({ where: { deckId: id } }))) return fail(reply, 400, 'Deck has no uploaded version');
  const deck = await prisma.deck.update({ where: { id }, data: { status: action === 'publish' ? 'PUBLISHED' : 'DISABLED' }, select: { id: true, status: true } });
  await prisma.auditLog.create({ data: { userId: auth(request).id, action: `admin.deck.${action}`, targetId: id } });
  return deck;
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') return fail(reply, 413, 'Upload exceeds the configured size limit');
  if (error instanceof ClientInputError) return fail(reply, error.statusCode, error.message);
  return fail(reply, error instanceof z.ZodError ? 400 : 500, error instanceof z.ZodError ? 'Invalid request' : 'Internal server error');
});

const port = Number(process.env.PORT || 4000);
await app.listen({ host: process.env.HOST || '0.0.0.0', port });
process.once('SIGTERM', async () => { await app.close(); await prisma.$disconnect(); });
