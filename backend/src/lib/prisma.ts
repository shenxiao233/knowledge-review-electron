import { PrismaClient } from '@prisma/client';

/**
 * Shared PrismaClient singleton.
 * All modules must import this instance instead of creating their own
 * to avoid exhausting the PostgreSQL connection pool.
 *
 * Connection pool tuning:
 * The DATABASE_URL should include `?connection_limit=8&pool_timeout=20`
 * (set in docker-compose.prod.yml or .env). On a 2GB VPS with
 * max_connections=50, this leaves headroom for migrations + admin queries.
 * If connection_limit is omitted, Prisma defaults to num_cpus × 2 + 1,
 * which is only 3 on a 1-vCore machine — too low for concurrent requests.
 */
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV !== 'production' ? ['warn', 'error'] : ['error'],
});
