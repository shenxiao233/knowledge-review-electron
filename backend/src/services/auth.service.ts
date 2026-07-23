import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { fail } from '../utils/response.js';
import { RateLimiter } from '../plugins/rate-limit.js';
import { requestRateLimitKey } from '../utils/helpers.js';
import { InvitationService } from './invitation.service.js';

const prisma = new PrismaClient();

export class AuthService {
  private invitationService: InvitationService;

  constructor(private app: FastifyInstance, private rateLimiter: RateLimiter) {
    this.invitationService = new InvitationService();
  }
  
  /**
   * V2 Registration with invitation code
   */
  async registerV2(request: FastifyRequest, reply: FastifyReply) {
    if (!config.allowSelfRegister) {
      return fail(reply, 403, 'Self-registration is disabled');
    }
    
    const body = z.object({
      invitationCode: z.string().min(1),
      accessKey: z.string().min(1),
      username: z.string().min(3).max(80).regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, hyphens and underscores'),
      password: z.string().min(8).max(200)
    }).safeParse(request.body);
    
    if (!body.success) return fail(reply, 400, 'Invalid registration data');
    if (body.data.accessKey !== config.marketAccessKey) {
      return fail(reply, 401, 'Invalid server key');
    }
    
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
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return fail(reply, 409, 'Username already taken');
    
    const passwordHash = await argon2.hash(body.data.password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          passwordHash,
          role: 'USER',
          status: 'INCOMPLETE'
        }
      });
      await this.invitationService.useCode(body.data.invitationCode, created.id, tx);
      await tx.auditLog.create({
        data: { userId: created.id, action: 'auth.register.v2' }
      });
      return created;
    });
    
    const token = await this.app.jwt.sign(
      { id: user.id, username: user.username, role: user.role, status: user.status }, 
      { expiresIn: '12h' }
    );
    
    return { 
      token, 
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
   * V1 Registration (legacy, without invitation code)
   */
  async register(request: FastifyRequest, reply: FastifyReply) {
    if (!config.allowSelfRegister) {
      return fail(reply, 403, 'Self-registration is disabled');
    }
    
    const body = z.object({
      accessKey: z.string().min(1),
      username: z.string().min(3).max(80).regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, hyphens and underscores'),
      password: z.string().min(8).max(200)
    }).safeParse(request.body);
    
    if (!body.success) return fail(reply, 400, 'Invalid registration data');
    if (body.data.accessKey !== config.marketAccessKey) {
      return fail(reply, 401, 'Invalid server key');
    }
    
    if (!await this.rateLimiter.consume(
      reply, 
      requestRateLimitKey(request, 'register-ip'), 
      config.registerRateLimitMax, 
      config.registerRateLimitWindowSeconds * 1000
    )) return;
    
    const username = body.data.username.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return fail(reply, 409, 'Username already taken');
    
    const passwordHash = await argon2.hash(body.data.password);
    const user = await prisma.user.create({ 
      data: { username, passwordHash, role: 'USER' } 
    });
    
    await prisma.auditLog.create({ 
      data: { userId: user.id, action: 'auth.register' } 
    });
    
    const token = await this.app.jwt.sign(
      { id: user.id, username: user.username, role: user.role }, 
      { expiresIn: '12h' }
    );
    
    return { token, user: { id: user.id, username: user.username, role: user.role } };
  }
  
  async login(request: FastifyRequest, reply: FastifyReply) {
    const body = z.object({ 
      accessKey: z.string().min(1), 
      username: z.string().min(1), 
      password: z.string().min(1) 
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
    
    if (!body.success || body.data.accessKey !== config.marketAccessKey) {
      return fail(reply, 401, 'Invalid market credentials');
    }
    
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.enabled || user.status === 'SUSPENDED' || user.status === 'BANNED' || !(await argon2.verify(user.passwordHash, body.data.password))) {
      return fail(reply, 401, 'Invalid market credentials');
    }
    
    await prisma.user.update({ 
      where: { id: user.id }, 
      data: { lastLoginAt: new Date() } 
    });
    
    await prisma.auditLog.create({ 
      data: { userId: user.id, action: 'auth.login' } 
    });
    
    const token = await this.app.jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role, 
        status: user.status,
        uid: user.uid 
      }, 
      { expiresIn: '12h' }
    );
    
    return { 
      token, 
      user: { 
        id: user.id, 
        username: user.username, 
        role: user.role, 
        status: user.status,
        uid: user.uid,
        nickname: user.nickname,
        avatar: user.avatar,
        needsProfileCompletion: user.status === 'INCOMPLETE'
      } 
    };
  }
  
  async changePassword(request: FastifyRequest, reply: FastifyReply, userId: string) {
    const data = z.object({ 
      currentPassword: z.string().min(1), 
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
    
    await prisma.auditLog.create({ 
      data: { userId, action: 'auth.password.change', targetId: userId } 
    });
    
    return { changed: true };
  }
}
