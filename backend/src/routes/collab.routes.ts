import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CollabService } from '../services/collab.service.js';
import { requireAuth, auth } from '../middleware/auth.js';

export default async function collabRoutes(
  app: FastifyInstance,
  opts: { collabService: CollabService }
) {
  const { collabService } = opts;

  // POST /api/v2/decks/:id/card-contributions - Push a card to a published deck
  app.post('/api/v2/decks/:id/card-contributions', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      action: z.enum(['ADD', 'MODIFY']),
      cardId: z.string().min(1).max(100),
      cardData: z.record(z.string(), z.any()),
    }).parse(request.body);
    const contribution = await collabService.pushCard(auth(request).id, id, body);
    return reply.code(201).send(contribution);
  });

  // GET /api/v2/decks/:id/card-contributions - List contributions (owner sees all, others see own)
  app.get('/api/v2/decks/:id/card-contributions', { preHandler: requireAuth }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }).parse(request.query || {});
    return collabService.listContributions(auth(request).id, id, query.status);
  });

  // GET /api/v2/card-contributions/:id - Get contribution details
  app.get('/api/v2/card-contributions/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return collabService.getContribution(auth(request).id, id);
  });

  // POST /api/v2/card-contributions/:id/review - Review (approve/reject) a contribution
  app.post('/api/v2/card-contributions/:id/review', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      decision: z.enum(['APPROVED', 'REJECTED']),
      note: z.string().max(2000).optional(),
      editedCardData: z.record(z.string(), z.any()).optional(),
    }).parse(request.body);
    const updated = await collabService.reviewContribution(auth(request).id, id, body.decision, body.note, body.editedCardData);
    return reply.code(200).send(updated);
  });

  // GET /api/v2/my-contributions - List current user's contributions (push status + review opinions)
  app.get('/api/v2/my-contributions', { preHandler: requireAuth }, async (request) => {
    return collabService.listMyContributions(auth(request).id);
  });

  // GET /api/v2/my-incoming-contributions - List incoming contributions for decks owned by user
  app.get('/api/v2/my-incoming-contributions', { preHandler: requireAuth }, async (request) => {
    return collabService.listIncomingContributions(auth(request).id);
  });
}
