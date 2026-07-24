import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { requireAuth, auth } from '../middleware/auth.js';
import { fail } from '../utils/response.js';

export default async function socialRoutes(app: FastifyInstance) {

  // ─── Reviews ───

  // GET /api/v1/decks/:id/reviews
  app.get('/api/v1/decks/:id/reviews', async (request) => {
    const { id } = request.params as { id: string };
    const reviews = await prisma.deckReview.findMany({
      where: { deckId: id },
      include: { user: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const stats = await prisma.deckReview.aggregate({
      where: { deckId: id },
      _avg: { rating: true },
      _count: true,
    });
    return {
      reviews,
      avgRating: stats._avg.rating || 0,
      totalReviews: stats._count,
    };
  });

  // POST /api/v1/decks/:id/reviews
  app.post('/api/v1/decks/:id/reviews', { preHandler: requireAuth }, async (request, reply) => {
    const userId = auth(request).id;
    const { id: deckId } = request.params as { id: string };
    const body = z.object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(2000).default(''),
    }).safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'Invalid review data');

    const deck = await prisma.deck.findUnique({ where: { id: deckId } });
    if (!deck) return fail(reply, 404, 'Deck not found');
    if (deck.ownerId === userId) return fail(reply, 400, 'Cannot review your own deck');

    const existing = await prisma.deckReview.findUnique({
      where: { deckId_userId: { deckId, userId } },
    });
    if (existing) {
      const updated = await prisma.deckReview.update({
        where: { id: existing.id },
        data: { rating: body.data.rating, comment: body.data.comment },
      });
      return { review: updated, updated: true };
    }

    const review = await prisma.deckReview.create({
      data: { deckId, userId, rating: body.data.rating, comment: body.data.comment },
    });
    await prisma.auditLog.create({ data: { userId, action: 'deck.review', targetId: deckId } });
    return { review, updated: false };
  });

  // DELETE /api/v1/decks/:id/reviews
  app.delete('/api/v1/decks/:id/reviews', { preHandler: requireAuth }, async (request) => {
    const userId = auth(request).id;
    const { id: deckId } = request.params as { id: string };
    const deleted = await prisma.deckReview.deleteMany({ where: { deckId, userId } });
    return { deleted: deleted.count > 0 };
  });

  // ─── Favorites ───

  // GET /api/v1/favorites
  app.get('/api/v1/favorites', { preHandler: requireAuth }, async (request) => {
    const userId = auth(request).id;
    const favorites = await prisma.deckFavorite.findMany({
      where: { userId },
      include: { deck: { select: { id: true, title: true, category: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      favorites: favorites.map((f) => ({
        id: f.id,
        deckId: f.deckId,
        deck: f.deck,
        createdAt: f.createdAt,
      })),
    };
  });

  // POST /api/v1/favorites/:deckId
  app.post('/api/v1/favorites/:deckId', { preHandler: requireAuth }, async (request, reply) => {
    const userId = auth(request).id;
    const { deckId } = request.params as { deckId: string };
    const deck = await prisma.deck.findUnique({ where: { id: deckId } });
    if (!deck) return fail(reply, 404, 'Deck not found');

    const existing = await prisma.deckFavorite.findUnique({
      where: { deckId_userId: { deckId, userId } },
    });
    if (existing) return { favorited: true, alreadyExisted: true };

    await prisma.deckFavorite.create({ data: { deckId, userId } });
    await prisma.auditLog.create({ data: { userId, action: 'deck.favorite', targetId: deckId } });
    return { favorited: true, alreadyExisted: false };
  });

  // DELETE /api/v1/favorites/:deckId
  app.delete('/api/v1/favorites/:deckId', { preHandler: requireAuth }, async (request, reply) => {
    const userId = auth(request).id;
    const { deckId } = request.params as { deckId: string };
    const deleted = await prisma.deckFavorite.deleteMany({ where: { deckId, userId } });
    return { unfavorited: true, count: deleted.count };
  });
}
