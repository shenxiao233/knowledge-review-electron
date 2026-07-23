import type { FastifyInstance } from 'fastify';
import { CollabService } from '../services/collab.service.js';
import { requireAuth, auth } from '../middleware/auth.js';
import { fail } from '../utils/response.js';

export default async function collabRoutes(
  app: FastifyInstance,
  opts: { collabService: CollabService }
) {
  const { collabService } = opts;

  // POST /api/v2/decks/:id/fork - Fork a deck
  app.post('/api/v2/decks/:id/fork', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as any;
      const body = request.body as any;
      const forkedDeck = await collabService.forkDeck(
        auth(request).id,
        id,
        body?.newTitle
      );
      return reply.code(201).send(forkedDeck);
    } catch (error: any) {
      return fail(reply, error.statusCode || 400, error.message);
    }
  });

  // POST /api/v2/decks/:id/commits - Create a commit
  app.post('/api/v2/decks/:id/commits', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as any;
      const body = request.body as any;
      const commit = await collabService.createCommit(
        auth(request).id,
        id,
        body.message,
        body.changes
      );
      return reply.code(201).send(commit);
    } catch (error: any) {
      return fail(reply, error.statusCode || 400, error.message);
    }
  });

  // POST /api/v2/pull-requests - Create a pull request
  app.post('/api/v2/pull-requests', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const pr = await collabService.createPullRequest(
        auth(request).id,
        request.body as any
      );
      return reply.code(201).send(pr);
    } catch (error: any) {
      return fail(reply, error.statusCode || 400, error.message);
    }
  });

  // GET /api/v2/pull-requests/:id - Get pull request details
  app.get('/api/v2/pull-requests/:id', { preHandler: requireAuth }, async (request, reply) => {
    const pr = await collabService.getPullRequest(auth(request).id, (request.params as any).id);
    if (!pr) return fail(reply, 404, 'Pull request not found');
    return pr;
  });

  // GET /api/v2/decks/:id/pull-requests - List pull requests for a deck
  app.get('/api/v2/decks/:id/pull-requests', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as any;
    const query = request.query as any;
    return collabService.listPullRequests(auth(request).id, id, query?.status);
  });

  // POST /api/v2/pull-requests/:id/review - Review a pull request
  app.post('/api/v2/pull-requests/:id/review', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as any;
      const body = request.body as any;
      const review = await collabService.reviewPullRequest(
        auth(request).id,
        id,
        body.decision,
        body.comment
      );
      return reply.code(201).send(review);
    } catch (error: any) {
      return fail(reply, error.statusCode || 400, error.message);
    }
  });

  // POST /api/v2/pull-requests/:id/merge - Merge a pull request
  app.post('/api/v2/pull-requests/:id/merge', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as any;
      const merged = await collabService.mergePullRequest(auth(request).id, id);
      return merged;
    } catch (error: any) {
      return fail(reply, error.statusCode || 400, error.message);
    }
  });

  // POST /api/v2/pull-requests/:id/close - Close a pull request
  app.post('/api/v2/pull-requests/:id/close', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as any;
      const closed = await collabService.closePullRequest(auth(request).id, id);
      return closed;
    } catch (error: any) {
      return fail(reply, error.statusCode || 400, error.message);
    }
  });

  // POST /api/v2/pull-requests/:id/comments - Add a comment to a PR
  app.post('/api/v2/pull-requests/:id/comments', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as any;
      const body = request.body as any;
      const comment = await collabService.addPRComment(
        auth(request).id,
        id,
        body.content
      );
      return reply.code(201).send(comment);
    } catch (error: any) {
      return fail(reply, error.statusCode || 400, error.message);
    }
  });

  // POST /api/v2/decks/:id/collaborators - Invite a collaborator
  app.post('/api/v2/decks/:id/collaborators', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as any;
      const body = request.body as any;
      const collaborator = await collabService.inviteCollaborator(
        auth(request).id,
        id,
        body.userId,
        body.role || 'editor'
      );
      return reply.code(201).send(collaborator);
    } catch (error: any) {
      return fail(reply, error.statusCode || 400, error.message);
    }
  });

  // POST /api/v2/decks/:id/collaborators/accept - Accept collaboration
  app.post('/api/v2/decks/:id/collaborators/accept', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as any;
      const collaborator = await collabService.acceptCollaboration(auth(request).id, id);
      return collaborator;
    } catch (error: any) {
      return fail(reply, 400, error.message);
    }
  });

  // DELETE /api/v2/decks/:id/collaborators/:userId - Remove a collaborator
  app.delete('/api/v2/decks/:id/collaborators/:userId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id, userId } = request.params as any;
      await collabService.removeCollaborator(auth(request).id, id, userId);
      return { removed: true };
    } catch (error: any) {
      return fail(reply, 400, error.message);
    }
  });
}
