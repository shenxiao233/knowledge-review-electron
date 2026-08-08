import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    ok: true,
    service: 'knowledge-review-market',
    apiVersion: config.apiVersion,
    capabilities: { 
      adminAuditLogs: true, 
      adminStorageHealth: true, 
      permanentDeckDelete: true, 
      serverPagination: true, 
      marketCategories: true, 
      categoryManagement: true, 
      versionChangelog: true 
    },
    time: new Date().toISOString()
  }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, database: 'up', time: new Date().toISOString() };
    } catch {
      return reply.code(503).send({
        ok: false,
        database: 'down',
        time: new Date().toISOString(),
      });
    }
  });
}
