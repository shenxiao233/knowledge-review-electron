import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { fail } from '../utils/response.js';

const prisma = new PrismaClient();

export type AuthRequest = FastifyRequest & { 
  user: { id: string; username: string; role: UserRole; iat?: number }
};

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return fail(reply, 401, 'Unauthorized');
  }
  const tokenUser = request.user as { id?: string; iat?: number };
  if (!tokenUser.id) return fail(reply, 401, 'Unauthorized');
  
  const currentUser = await prisma.user.findUnique({ 
    where: { id: tokenUser.id }, 
    select: { id: true, username: true, role: true, enabled: true, status: true, passwordChangedAt: true }
  });
  
  if (!currentUser?.enabled) return fail(reply, 401, 'Account disabled');
  if (currentUser.status === 'SUSPENDED' || currentUser.status === 'BANNED') {
    return fail(reply, 401, 'Account disabled');
  }
  if (currentUser.passwordChangedAt && tokenUser.iat) {
    const changedAtSeconds = Math.floor(currentUser.passwordChangedAt.getTime() / 1000);
    if (tokenUser.iat < changedAtSeconds) return fail(reply, 401, 'Session expired');
  }
  (request as AuthRequest).user = { 
    id: currentUser.id, 
    username: currentUser.username, 
    role: currentUser.role,
    iat: tokenUser.iat,
  };
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if ((request as AuthRequest).user.role !== 'ADMIN') {
    fail(reply, 403, 'Administrator access required');
  }
}

export function auth(request: FastifyRequest) { 
  return (request as AuthRequest).user; 
}
