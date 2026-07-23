import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

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
}
