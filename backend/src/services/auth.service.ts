import { prisma } from '../lib/prisma.js';
import argon2 from 'argon2';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { fail } from '../utils/response.js';
import { RateLimiter } from '../plugins/rate-limit.js';
import { requestRateLimitKey } from '../utils/helpers.js';
import { InvitationService } from './invitation.service.js';
import { publicUser } from '../utils/avatar.js';
import { invalidateAuthCache } from '../middleware/auth.js';
import { primeAuthCache } from '../middleware/auth.js';
import { createHash, randomBytes } from 'node:crypto';

export class AuthService {
  private invitationService: InvitationService;
  private refreshCleanupTimer: NodeJS.Timeout | null = null;

  constructor(private app: FastifyInstance, private rateLimiter: RateLimiter) {
    this.invitationService = new InvitationService();
  }

  startMaintenance() {
    if (this.refreshCleanupTimer) return;
    this.refreshCleanupTimer = setInterval(() => {
      void this.cleanupRefreshTokens();
    }, 6 * 60 * 60 * 1000);
    this.refreshCleanupTimer.unref();
    setTimeout(() => { void this.cleanupRefreshTokens(); }, 60_000).unref();
  }

  stopMaintenance() {
    if (!this.refreshCleanupTimer) return;
    clearInterval(this.refreshCleanupTimer);
    this.refreshCleanupTimer = null;
  }

  private hashRefreshToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async createRefreshToken(userId: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashRefreshToken(token),
        expiresAt,
      },
    });
    return token;
  }

  private async accessToken(user: {
    id: string;
    username: string;
    role: string;
    status: string;
    uid?: string | null;
  }) {
    return this.app.jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        ...(user.uid ? { uid: user.uid } : {}),
      },
      { expiresIn: config.jwtAccessTtl },
    );
  }

  private async session(user: {
    id: string;
    username: string;
    role: any;
    status: any;
    uid?: string | null;
    nickname?: string | null;
    avatar?: string | null;
  }) {
    const [token, refreshToken] = await Promise.all([
      this.accessToken(user),
      this.createRefreshToken(user.id),
    ]);
    return { token, refreshToken };
  }

  async refresh(rawToken: unknown, reply: FastifyReply) {
    const parsed = z.string().min(20).max(200).safeParse(rawToken);
    if (!parsed.success) return fail(reply, 401, 'Invalid refresh token');

    const tokenHash = this.hashRefreshToken(parsed.data);
    const record = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            role: true,
            status: true,
            enabled: true,
            uid: true,
            nickname: true,
            avatar: true,
          },
        },
      },
    });
    const now = new Date();
    if (
      !record ||
      record.revokedAt ||
      record.expiresAt <= now ||
      !record.user.enabled ||
      record.user.status === 'SUSPENDED' ||
      record.user.status === 'BANNED'
    ) {
      return fail(reply, 401, 'Invalid refresh token');
    }

    const replacement = randomBytes(32).toString('base64url');
    const replacementExpiresAt = new Date(
      Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
    const rotated = await prisma.$transaction(async (tx) => {
      const consumed = await tx.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (consumed.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          userId: record.userId,
          tokenHash: this.hashRefreshToken(replacement),
          expiresAt: replacementExpiresAt,
        },
      });
      return true;
    });
    if (!rotated) return fail(reply, 401, 'Invalid refresh token');

    const token = await this.accessToken(record.user);
    await primeAuthCache({
      id: record.user.id,
      username: record.user.username,
      role: record.user.role,
      enabled: record.user.enabled,
      status: record.user.status,
      passwordChangedAt: null,
    });
    return {
      token,
      refreshToken: replacement,
      user: publicUser(record.user),
    };
  }

  async revokeRefreshToken(rawToken: unknown) {
    const parsed = z.string().min(20).max(200).safeParse(rawToken);
    if (!parsed.success) return { revoked: false };
    const result = await prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashRefreshToken(parsed.data), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: result.count > 0 };
  }

  async cleanupRefreshTokens() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    try {
      const result = await prisma.refreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { revokedAt: { lt: cutoff } },
          ],
        },
      });
      if (result.count > 0) {
        console.info(`[AuthService] Removed ${result.count} expired refresh tokens`);
      }
      return result.count;
    } catch (error) {
      console.error('[AuthService] Failed to clean refresh tokens:', error);
      return 0;
    }
  }
  
  /**
   * V2 Registration with invitation code
   */
  async registerV2(request: FastifyRequest, reply: FastifyReply) {
    if (!config.allowSelfRegister) {
      return fail(reply, 403, 'Self-registration is disabled');
    }
    
    const body = z.object({
      invitationCode: z.string().min(1).max(200),
      accessKey: z.string().optional(),
      username: z.string().min(3).max(80).regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, hyphens and underscores'),
      password: z.string().min(8).max(200)
    }).safeParse(request.body);

    if (!body.success) return fail(reply, 400, 'Invalid registration data');
    
    if (!await this.rateLimiter.consume(
      reply, 
      requestRateLimitKey(request, 'register-ip'), 
      config.registerRateLimitMax, 
      config.registerRateLimitWindowSeconds * 1000
    )) return;
    
    // Validate invitation code
    const codeValidation = await this.invitationService.validateCode(body.data.invitationCode);
    if (!codeValidation.valid) {
      return fail(reply, 400, codeValidation.reason || 'Invalid invitation code');
    }
    
    const username = body.data.username.trim().toLowerCase();
    const passwordHash = await argon2.hash(body.data.password);
    
    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { username } });
        if (existing) throw new Error('USERNAME_TAKEN');
        const created = await tx.user.create({
          data: {
            username,
            passwordHash,
            role: 'USER',
            status: 'INCOMPLETE'
          }
        });
        await this.invitationService.useCode(body.data.invitationCode, created.id, tx);
        return created;
      });
    } catch (error: any) {
      if (error?.message === 'USERNAME_TAKEN') {
        return fail(reply, 409, 'Username already taken');
      }
      throw error;
    }
    
    const session = await this.session(user);
    void prisma.auditLog.create({
      data: { userId: user.id, action: 'auth.register.v2' },
    }).catch(() => undefined);
    
    return { 
      token: session.token,
      refreshToken: session.refreshToken,
      user: { 
        id: user.id, 
        username: user.username, 
        role: user.role, 
        status: user.status,
        needsProfileCompletion: true 
      } 
    };
  }

  /**
   * V1 Registration (legacy — now delegates to V2 to enforce invitation code requirement)
   */
  async register(request: FastifyRequest, reply: FastifyReply) {
    return this.registerV2(request, reply);
  }
  
  private dummyHash: string | null = null;

  private async getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = await argon2.hash('dummy-password-never-matches-any-real-user');
    }
    return this.dummyHash;
  }

  async login(request: FastifyRequest, reply: FastifyReply) {
    const body = z.object({
      accessKey: z.string().optional(),
      username: z.string().min(1).max(80),
      password: z.string().min(1).max(200)
    }).safeParse(request.body);

    const username = body.success ? body.data.username.trim().toLowerCase() : '';

    if (!await this.rateLimiter.consume(
      reply,
      requestRateLimitKey(request, 'login-ip'),
      config.loginRateLimitMax,
      config.loginRateLimitWindowSeconds * 1000
    )) return;

    if (username && !await this.rateLimiter.consume(
      reply,
      requestRateLimitKey(request, 'login-account', username),
      config.loginRateLimitMax,
      config.loginRateLimitWindowSeconds * 1000
    )) return;

    if (!body.success) {
      return fail(reply, 401, 'Invalid market credentials');
    }
    
    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        role: true,
        enabled: true,
        status: true,
        uid: true,
        nickname: true,
        avatar: true,
        lastLoginAt: true,
      },
    });
    if (!user) {
      // Dummy verify to prevent timing-based username enumeration
      await argon2.verify(await this.getDummyHash(), body.data.password);
      return fail(reply, 401, 'Invalid market credentials');
    }
    if (!user.enabled || user.status === 'SUSPENDED' || user.status === 'BANNED' || !(await argon2.verify(user.passwordHash, body.data.password))) {
      return fail(reply, 401, 'Invalid market credentials');
    }
    
    const now = new Date();
    const shouldTouchLastLogin =
      !user.lastLoginAt || now.getTime() - user.lastLoginAt.getTime() >= 5 * 60 * 1000;
    if (shouldTouchLastLogin) {
      void prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: now },
      }).catch(() => undefined);
    }
    // Audit logging must not hold the login response hostage. The database is
    // still updated, but the authentication path only waits for Argon2 and
    // token issuance.
    void prisma.auditLog.create({
      data: { userId: user.id, action: 'auth.login' },
    }).catch(() => undefined);

    const session = await this.session(user);
    await primeAuthCache({
      id: user.id,
      username: user.username,
      role: user.role,
      enabled: user.enabled,
      status: user.status,
      passwordChangedAt: null,
    });
    
    return {
      token: session.token,
      refreshToken: session.refreshToken,
      user: {
        ...publicUser({
          id: user.id,
          username: user.username,
          role: user.role,
          status: user.status,
          uid: user.uid,
          nickname: user.nickname,
          avatar: user.avatar,
        }),
        needsProfileCompletion: user.status === 'INCOMPLETE',
      },
    };
  }
  
  async changePassword(request: FastifyRequest, reply: FastifyReply, userId: string) {
    if (!await this.rateLimiter.consume(
      reply,
      requestRateLimitKey(request, 'password-change', userId),
      config.passwordChangeRateLimitMax,
      config.passwordChangeRateLimitWindowSeconds * 1000
    )) return;

    const data = z.object({ 
      currentPassword: z.string().min(1).max(200), 
      newPassword: z.string().min(8).max(200) 
    }).parse(request.body);
    
    const user = await prisma.user.findUnique({ 
      where: { id: userId }, 
      select: { passwordHash: true } 
    });
    
    if (!user || !(await argon2.verify(user.passwordHash, data.currentPassword))) {
      return fail(reply, 401, 'Current password is incorrect');
    }
    
    await prisma.user.update({ 
      where: { id: userId },
      data: { 
        passwordHash: await argon2.hash(data.newPassword),
        passwordChangedAt: new Date()
      } 
    });
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await invalidateAuthCache(userId);
    
    await prisma.auditLog.create({ 
      data: { userId, action: 'auth.password.change', targetId: userId } 
    });
    
    return { changed: true };
  }
}
