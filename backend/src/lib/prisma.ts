import { PrismaClient } from '@prisma/client';

/**
 * Shared PrismaClient singleton.
 * All modules must import this instance instead of creating their own
 * to avoid exhausting the PostgreSQL connection pool.
 */
export const prisma = new PrismaClient();
