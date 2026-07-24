import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import fsp from 'node:fs/promises';
import { DeckService } from '../services/deck.service.js';
import { RateLimiter } from '../plugins/rate-limit.js';
import { requireAuth, auth } from '../middleware/auth.js';
import { config } from '../config.js';
import { normalizeCategoryName, sanitizeBigInt } from '../utils/helpers.js';
import { requestRateLimitKey } from '../utils/helpers.js';
import { fail } from '../utils/response.js';
import { ClientInputError } from '../utils/errors.js';

export default async function myDecksRoutes(
  app: FastifyInstance,
  opts: { deckService: DeckService; rateLimiter: RateLimiter }
) {
  const { deckService, rateLimiter } = opts;

  // GET /api/v1/my-decks - List user's own decks
  app.get('/api/v1/my-decks', { preHandler: requireAuth }, async (request) => {
    const decks = await prisma.deck.findMany({
      where: { ownerId: auth(request).id },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
        _count: { select: { downloads: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return sanitizeBigInt({ decks });
  });

  // GET /api/v1/my-decks/check/:deckId - Check if a deck ID exists and ownership
  app.get('/api/v1/my-decks/check/:deckId', { preHandler: requireAuth }, async (request) => {
    const { deckId } = z.object({ deckId: z.string().uuid() }).parse(request.params);
    const deck = await prisma.deck.findUnique({
      where: { id: deckId },
      select: { id: true, ownerId: true, title: true, status: true, currentVersion: true },
    });
    if (!deck) return { exists: false, owned: false };
    const owned = deck.ownerId === auth(request).id;
    return {
      exists: true,
      owned,
      ...(owned ? { deck: sanitizeBigInt(deck) } : {}),
    };
  });

  // POST /api/v1/my-decks - Create a new deck (multipart upload)
  app.post('/api/v1/my-decks', { preHandler: requireAuth }, async (request, reply) => {
    if (!await rateLimiter.consume(
      reply,
      requestRateLimitKey(request, 'upload', auth(request).id),
      config.uploadRateLimitMax,
      config.uploadRateLimitWindowSeconds * 1000
    )) return;

    const parts = request.parts();
    let metadata: { title?: string; description?: string; category?: string } = {};
    let upload: Awaited<ReturnType<typeof deckService.readUpload>> | null = null;

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'metadata') {
        try {
          metadata = JSON.parse(String(part.value));
        } catch {
          throw new ClientInputError('metadata must contain valid JSON');
        }
      }
      if (part.type === 'file' && part.fieldname === 'package') {
        upload = await deckService.readUpload(part);
      }
    }

    if (!upload) return fail(reply, 400, 'A deck ZIP file is required');

    try {
      const checked = deckService.inspectPackage(upload.tempPath);
      const data = z.object({
        id: z.string().uuid().optional(),
        title: z.string().min(1).max(160).optional(),
        description: z.string().max(2000).optional(),
        category: z.string().min(1).max(80).optional(),
      }).parse(metadata);

      const title = data.title || checked.manifest.title;
      const description = data.description ?? checked.manifest.description;
      const manifest = { ...checked.manifest, title, description, category: '' };

      // If client provides a deck ID, check ownership before creating
      if (data.id) {
        const existing = await prisma.deck.findUnique({
          where: { id: data.id },
          select: { id: true, ownerId: true, status: true },
        });
        if (existing) {
          if (existing.ownerId !== auth(request).id) {
            return fail(reply, 403, 'This deck ID belongs to another user');
          }
          return fail(reply, 409, 'A deck with this ID already exists; upload a new version to that deck');
        }
      } else {
        // Fallback: title-based duplicate check when no client ID
        const duplicate = await prisma.deck.findFirst({
          where: { ownerId: auth(request).id, title },
          select: { id: true, status: true },
        });
        if (duplicate) {
          return fail(reply, 409,
            duplicate.status === 'DISABLED'
              ? 'A disabled deck with this title already exists; re-list it or permanently delete it before creating a new deck'
              : 'A deck with this title already exists; upload a new version to that deck'
          );
        }
      }

      const deck = await prisma.deck.create({
        data: { ...(data.id ? { id: data.id } : {}), ownerId: auth(request).id, title, description, category: '' },
      });

      try {
        const result = await deckService.saveVersion(deck.id, manifest.version as number, upload, manifest);
        return reply.code(201).send({
          id: deck.id,
          version: result.version,
          sha256: result.sha256,
          status: deck.status,
        });
      } catch (error) {
        await prisma.deck.delete({ where: { id: deck.id } }).catch(() => undefined);
        throw error;
      }
    } finally {
      await fsp.rm(upload!.tempPath, { force: true });
    }
  });

  // POST /api/v1/my-decks/:id/versions - Upload a new version
  app.post('/api/v1/my-decks/:id/versions', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const deck = await prisma.deck.findFirst({ where: { id, ownerId: auth(request).id } });
    if (!deck) return fail(reply, 404, 'Deck not found');
    if (deck.status === 'DISABLED') return fail(reply, 409, 'Disabled decks cannot receive new versions');

    if (!await rateLimiter.consume(
      reply,
      requestRateLimitKey(request, 'upload', auth(request).id),
      config.uploadRateLimitMax,
      config.uploadRateLimitWindowSeconds * 1000
    )) return;

    const parts = request.parts();
    let upload: Awaited<ReturnType<typeof deckService.readUpload>> | null = null;
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'package') {
        upload = await deckService.readUpload(part);
      }
    }

    if (!upload) return fail(reply, 400, 'A deck ZIP file is required');

    try {
      const checked = deckService.inspectPackage(upload.tempPath);
      const result = await deckService.saveVersion(
        deck.id,
        checked.manifest.version as number,
        upload,
        { ...checked.manifest, category: '' }
      );
      return reply.code(201).send({
        id: deck.id,
        version: result.version,
        sha256: result.sha256,
        status: deck.status,
      });
    } finally {
      await fsp.rm(upload!.tempPath, { force: true });
    }
  });

  // PATCH /api/v1/my-decks/:id/unpublish - Take down a published deck (owner only)
  app.patch('/api/v1/my-decks/:id/unpublish', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const deck = await prisma.deck.findFirst({ where: { id, ownerId: auth(request).id } });
    if (!deck) return fail(reply, 404, 'Deck not found');
    if (deck.status !== 'PUBLISHED') return fail(reply, 409, 'Only published decks can be unpublished');
    await prisma.deck.update({ where: { id }, data: { status: 'DRAFT' } });
    await prisma.auditLog.create({
      data: { userId: auth(request).id, action: 'deck.unpublish', targetId: id, metadata: { title: deck.title } },
    });
    return { id, status: 'DRAFT' };
  });
}
