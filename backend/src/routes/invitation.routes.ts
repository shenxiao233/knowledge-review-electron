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
      const body = z.object({
        maxUses: z.number().int().min(1).max(1000).optional(),
        expiresAt: z.string().datetime().optional(),
      }).safeParse(request.body);
      if (!body.success) return fail(reply, 400, '邀请码参数无效');
      const { maxUses, expiresAt } = body.data;
      const invitation = await invitationService.generateCode(
        auth(request).id,
        {
          maxUses,
          expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        }
      );
      return reply.code(201).send(invitation);
    } catch (error: any) {
      const msg = error?.issues?.[0]?.message || error?.message || '操作失败';
      return fail(reply, 400, msg);
    }
  });

  // GET /api/v2/invitations - List invitation codes
  app.get('/api/v2/invitations', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({
      page: z.string().optional(),
      pageSize: z.string().optional(),
    }).safeParse(request.query);
    const pageNum = Math.max(1, Number(query.success ? query.data.page : '1') || 1);
    const pageSizeNum = Math.min(100, Number(query.success ? query.data.pageSize : '20') || 20);
    return invitationService.listCodes({
      page: pageNum,
      pageSize: pageSizeNum,
    });
  });

  // GET /api/v2/invitations/:id - Get invitation details
  app.get('/api/v2/invitations/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return fail(reply, 400, '无效的 ID');
    const invitation = await invitationService.getCode(params.data.id);
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
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return fail(reply, 400, '无效的 ID');
      return await invitationService.deleteCode(params.data.id, auth(request).id);
    } catch (error: any) {
      const msg = error?.issues?.[0]?.message || error?.message || '操作失败';
      return fail(reply, 400, msg);
    }
  });
}

