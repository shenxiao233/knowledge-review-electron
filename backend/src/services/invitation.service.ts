import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import crypto from 'node:crypto';
import { z } from 'zod';
import { ClientInputError } from '../utils/errors.js';

type InvitationDb = Prisma.TransactionClient;

export class InvitationService {
  /**
   * Generate a unique invitation code
   */
  async generateCode(createdById: string, options?: {
    maxUses?: number;
    expiresAt?: Date;
  }) {
    const validated = z.object({
      maxUses: z.number().int().positive().max(100000).default(1),
      expiresAt: z.date().optional(),
    }).parse(options || {});
    if (validated.expiresAt && validated.expiresAt <= new Date()) {
      throw new ClientInputError('Invitation expiration must be in the future');
    }

    const code = crypto.randomBytes(8).toString('base64url').toUpperCase();
    
    const invitation = await prisma.invitationCode.create({
      data: {
        code,
        status: 'ACTIVE',
        maxUses: validated.maxUses,
        expiresAt: validated.expiresAt,
        createdById,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: createdById,
        action: 'invitation.create',
        targetId: invitation.id,
      },
    });

    return invitation;
  }

  /**
   * Validate an invitation code
   */
  async validateCode(code: string): Promise<{
    valid: boolean;
    invitation?: any;
    reason?: string;
  }> {
    const invitation = await prisma.invitationCode.findUnique({
      where: { code: code.trim().toUpperCase() },
    });

    if (!invitation) {
      return { valid: false, reason: 'Invalid invitation code' };
    }

    if (invitation.status !== 'ACTIVE') {
      return { valid: false, reason: 'Invitation code is no longer active' };
    }

    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      await prisma.invitationCode.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      return { valid: false, reason: 'Invitation code has expired' };
    }

    if (invitation.currentUses >= invitation.maxUses) {
      return { valid: false, reason: 'Invitation code has reached maximum uses' };
    }

    return { valid: true, invitation };
  }

  /**
   * Use an invitation code (increment usage count)
   */
  async useCode(code: string, usedById: string, db: InvitationDb = prisma) {
    const normalizedCode = code.trim().toUpperCase();
    const changed = await db.$executeRaw`
      UPDATE "InvitationCode"
      SET "currentUses" = "currentUses" + 1,
          "usedById" = ${usedById}::uuid,
          "usedAt" = CURRENT_TIMESTAMP,
          "status" = CASE
            WHEN "currentUses" + 1 >= "maxUses" THEN 'USED'::"InvitationCodeStatus"
            ELSE "status"
          END
      WHERE "code" = ${normalizedCode}
        AND "status" = 'ACTIVE'::"InvitationCodeStatus"
        AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
        AND "currentUses" < "maxUses"
    `;
    if (changed !== 1) {
      throw new ClientInputError('Invalid or exhausted invitation code');
    }

    const invitation = await db.invitationCode.findUnique({ where: { code: normalizedCode } });
    if (!invitation) throw new ClientInputError('Invalid invitation code');
    return invitation;
  }

  /**
   * Revoke an invitation code
   */
  async revokeCode(codeId: string, revokedById: string) {
    const invitation = await prisma.invitationCode.update({
      where: { id: codeId },
      data: { status: 'REVOKED' },
    });

    await prisma.auditLog.create({
      data: {
        userId: revokedById,
        action: 'invitation.revoke',
        targetId: codeId,
      },
    });

    return invitation;
  }

  async deleteCode(codeId: string, deletedById: string) {
    const invitation = await prisma.invitationCode.findUnique({ where: { id: codeId } });
    if (!invitation) throw new ClientInputError('Invitation not found');
    await prisma.invitationCode.delete({ where: { id: codeId } });
    await prisma.auditLog.create({
      data: {
        userId: deletedById,
        action: 'invitation.delete',
        targetId: codeId,
        metadata: { code: invitation.code, status: invitation.status },
      },
    });
    return { id: codeId, deleted: true };
  }

  /**
   * List invitation codes (admin or creator)
   */
  async listCodes(options?: {
    createdById?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: any = {};
    if (options?.createdById) where.createdById = options.createdById;
    if (options?.status) where.status = options.status;

    const codes = await prisma.invitationCode.findMany({
      where,
      include: {
        createdBy: { select: { username: true } },
        usedBy: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...(options?.page ? {
        skip: (options.page - 1) * (options.pageSize || 20),
        take: options.pageSize || 20,
      } : {}),
    });

    if (!options?.page) return { codes };

    const total = await prisma.invitationCode.count({ where });
    return {
      codes,
      page: options.page,
      pageSize: options.pageSize || 20,
      total,
      totalPages: Math.max(1, Math.ceil(total / (options.pageSize || 20))),
    };
  }

  /**
   * Get invitation code details
   */
  async getCode(codeId: string) {
    return prisma.invitationCode.findUnique({
      where: { id: codeId },
      include: {
        createdBy: { select: { username: true } },
        usedBy: { select: { username: true } },
      },
    });
  }
}
