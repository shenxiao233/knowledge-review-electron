console.log('[DEBUG] invitation.routes.ts loaded');
import type { FastifyInstance } from 'fastify';
import { InvitationService } from '../services/invitation.service.js';
import { requireAuth, requireAdmin, auth } from '../middleware/auth.js';
import { fail } from '../utils/response.js';

export default async function invitationRoutes(
  app: FastifyInstance,
  opts: { invitationService: InvitationService }
) {
  const { invitationService } = opts;

  // POST /api/v2/invitations - Create invitation code (admin or authorized users)
  app.post('/api/v2/invitations', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const body = request.body as any;
      const invitation = await invitationService.generateCode(
        auth(request).id,
        {
          maxUses: body?.maxUses,
          expiresAt: body?.expiresAt ? new Date(body.expiresAt) : undefined,
        }
      );
      return reply.code(201).send(invitation);
    } catch (error: any) {
      return fail(reply, 400, error.message);
    }
  });

  // GET /api/v2/invitations - List invitation codes
  app.get('/api/v2/invitations', { preHandler: requireAdmin }, async (request) => {
    const query = request.query as any;
    return invitationService.listCodes({
      status: query?.status,
      page: query?.page ? Number(query.page) : undefined,
      pageSize: query?.pageSize ? Number(query.pageSize) : undefined,
    });
  });

  // GET /api/v2/invitations/:id - Get invitation details
  app.get('/api/v2/invitations/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const invitation = await invitationService.getCode((request.params as any).id);
    if (!invitation) return fail(reply, 404, 'Invitation not found');
    return invitation;
  });

  // POST /api/v2/invitations/validate - Validate invitation code (public)
  app.post('/api/v2/invitations/validate', async (request, reply) => {
    const body = request.body as any;
    if (!body?.code) return fail(reply, 400, 'Code is required');
    return invitationService.validateCode(body.code);
  });

  // DELETE /api/v2/invitations/:id - Permanently delete invitation code
  app.delete('/api/v2/invitations/:id', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return await invitationService.deleteCode((request.params as any).id, auth(request).id);
    } catch (error: any) {
      return fail(reply, 400, error.message);
    }
  });
}

