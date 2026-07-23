import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { DeckService } from '../services/deck.service.js';
import { RateLimiter } from '../plugins/rate-limit.js';
import { requireAuth, auth } from '../middleware/auth.js';
import { config } from '../config.js';
import { storedPackagePath } from '../utils/storage.js';
import { fail } from '../utils/response.js';
import { requestRateLimitKey } from '../utils/helpers.js';
import { ClientInputError } from '../utils/errors.js';

const prisma = new PrismaClient();

export default async function deckRoutes(
  app: FastifyInstance,
  opts: { deckService: DeckService; rateLimiter: RateLimiter }
) {
  const { deckService, rateLimiter } = opts;

  // GET /api/v1/categories - List available categories
  app.get('/api/v1/categories', async () => []);

  // GET /api/v1/decks - Search published decks (paginated)
  app.get('/api/v1/decks', async (request, reply) => {
    const query = z.object({
      search: z.string().max(200).optional(),
      category: z.string().max(80).optional(),
      sort: z.enum(['newest', 'popular', 'downloads']).default('newest'),
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().max(100).default(20),
    }).parse(request.query);

    const where: any = { status: 'PUBLISHED' as const };
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const orderBy: any =
      query.sort === 'popular'
        ? { updatedAt: 'desc' }
        : query.sort === 'downloads'
        ? { downloads: { _count: 'desc' } }
        : { createdAt: 'desc' };

    const decks = await prisma.deck.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        status: true,
        currentVersion: true,
        publishedVersion: true,
        createdAt: true,
        updatedAt: true,
        owner: { select: { username: true } },
        versions: {
          where: { status: 'PUBLISHED' },
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true, manifest: true },
        },
        _count: { select: { downloads: true, favorites: true, reviews: true } },
      },
      orderBy,
      ...(query.page ? { skip: (query.page - 1) * query.pageSize, take: query.pageSize } : {}),
    });

    if (!query.page) return { decks };

    const total = await prisma.deck.count({ where });
    return {
      decks,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  });

  // GET /api/v1/decks/:id - Deck detail (published only)
  app.get('/api/v1/decks/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const deck = await prisma.deck.findFirst({
      where: { id, status: 'PUBLISHED' },
      include: {
        owner: { select: { username: true } },
        versions: {
          where: { status: 'PUBLISHED' },
          orderBy: { version: 'desc' },
          take: 1,
        },
        _count: { select: { downloads: true, favorites: true, reviews: true } },
      },
    });
    if (!deck) return fail(reply, 404, 'Deck not found');
    return {
      id: deck.id,
      title: deck.title,
      description: deck.description,
      category: deck.category,
      author: deck.owner.username,
      version: deck.versions[0]?.version ?? 0,
      manifest: deck.versions[0]?.manifest,
      downloadCount: deck._count.downloads,
      favoriteCount: deck._count.favorites,
      reviewCount: deck._count.reviews,
    };
  });

  // GET /api/v1/decks/:id/download - Download deck package
  app.get('/api/v1/decks/:id/download', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    if (!await rateLimiter.consume(
      reply,
      requestRateLimitKey(request, 'download', auth(request).id),
      config.downloadRateLimitMax,
      config.downloadRateLimitWindowSeconds * 1000
    )) return;

    const requestedVersion = z.object({
      version: z.coerce.number().int().positive().max(1000000000).optional(),
    }).parse(request.query).version;

    const deck = await prisma.deck.findFirst({ where: { id, status: 'PUBLISHED' } });
    if (!deck) return fail(reply, 404, 'Deck not found');

    const version = await prisma.deckVersion.findFirst({
      where: {
        deckId: id,
        status: 'PUBLISHED',
        ...(requestedVersion ? { version: requestedVersion } : {}),
      },
      orderBy: { version: 'desc' },
    });
    if (!version) return fail(reply, 404, 'Deck version not found');

    const packagePath = storedPackagePath(version.packagePath);
    try {
      await fsp.access(packagePath, fs.constants.R_OK);
    } catch {
      return fail(reply, 503, 'Deck package is temporarily unavailable');
    }

    await prisma.deckDownload.create({
      data: { deckId: id, userId: auth(request).id, version: version.version },
    });

    reply
      .header('Cache-Control', 'private, no-store')
      .header('Content-Type', 'application/zip')
      .header('Content-Length', version.packageSize.toString())
      .header('Content-Disposition', `attachment; filename="deck-${id}-v${version.version}.zip"`)
      .header('X-Deck-Version', String(version.version));

    return reply.send(fs.createReadStream(packagePath));
  });

  // GET /api/v1/decks/:id/update - Check for version update
  app.get('/api/v1/decks/:id/update', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = z.object({
      version: z.coerce.number().int().positive(),
    }).parse(request.query);

    const deck = await prisma.deck.findFirst({ where: { id, status: 'PUBLISHED' } });
    if (!deck) return fail(reply, 404, 'Deck not found');

    const latest = await prisma.deckVersion.findFirst({
      where: { deckId: id, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
      select: { version: true, sha256: true, manifest: true, createdAt: true },
    });

    if (!latest) return fail(reply, 404, 'No published version found');

    return {
      currentVersion: query.version,
      latestVersion: latest.version,
      hasUpdate: latest.version > query.version,
      sha256: latest.sha256,
      publishedAt: latest.createdAt,
      changelog: (latest.manifest as any)?.changelog || '',
    };
  });

  // GET /api/v1/decks/:id/changelog - Version history
  app.get('/api/v1/decks/:id/changelog', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const versions = await prisma.deckVersion.findMany({
      where: { deckId: id, status: 'PUBLISHED' },
      select: { version: true, createdAt: true, manifest: true },
      orderBy: { version: 'desc' },
    });

    return {
      versions: versions.map((v: any) => ({
        version: v.version,
        publishedAt: v.createdAt,
        cardCount: v.manifest?.cardCount ?? 0,
        changelog: v.manifest?.changelog || '',
      })),
    };
  });
}
