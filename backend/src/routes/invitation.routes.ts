import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InvitationService } from '../services/invitation.service.js';
import { requireAuth, requireAdmin, auth } from '../middleware/auth.js';
import { fail } from '../utils/response.js';
import { RateLimiter } from '../plugins/rate-limit.js';
import { requestRateLimitKey } from '../utils/helpers.js';
import { config } from '../config.js';

export default async function invitationRoutes(
  app: FastifyInstance,
  opts: { invitationService: InvitationService; rateLimiter?: RateLimiter }
) {
  const { invitationService, rateLimiter } = opts;

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

  // POST /api/v2/invitations/validate - Validate invitation code (public, rate-limited)
  app.post('/api/v2/invitations/validate', async (request, reply) => {
    const body = z.object({ code: z.string().trim().min(1).max(50) }).safeParse(request.body || {});
    if (!body.success) return fail(reply, 400, 'Code is required');

    // Rate-limit the public endpoint to prevent DB-read amplification and code enumeration.
    if (rateLimiter && !await rateLimiter.consume(
      reply,
      requestRateLimitKey(request, 'invitation-validate'),
      config.invitationValidateRateLimitMax,
      config.invitationValidateRateLimitWindowSeconds * 1000
    )) return;

    const result = await invitationService.validateCode(body.data.code);
    // Only return minimal info — never leak the full invitation record (maxUses,
    // currentUses, usedById, etc.) to unauthenticated callers (BUG-A5 fix).
    return { valid: result.valid, reason: result.reason ?? undefined };
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

