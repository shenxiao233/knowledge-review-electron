import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import argon2 from 'argon2';
import { DeckService } from '../services/deck.service.js';
import { requireAdmin, auth } from '../middleware/auth.js';
import { config } from '../config.js';
import { deckStoragePath, storageRelative, storedPackagePath } from '../utils/storage.js';
import { normalizeCategoryName, dateFromQuery, sanitizeBigInt } from '../utils/helpers.js';
import { fail } from '../utils/response.js';
import { ClientInputError } from '../utils/errors.js';

const prisma = new PrismaClient();

export default async function adminRoutes(
  app: FastifyInstance,
  opts: { deckService: DeckService }
) {
  const { deckService } = opts;

  // GET /api/v1/admin/users - List users (paginated)
  app.get('/api/v1/admin/users', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().max(100).default(20),
    }).parse(request.query);

    const users = await prisma.user.findMany({
      select: {
        id: true, username: true, role: true, enabled: true,
        createdAt: true, lastLoginAt: true,
      },
      orderBy: { createdAt: 'desc' },
      ...(query.page ? { skip: (query.page - 1) * query.pageSize, take: query.pageSize } : {}),
    });

    if (!query.page) return users;
    const total = await prisma.user.count();
    return {
      items: users, page: query.page, pageSize: query.pageSize,
      total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  });

  // POST /api/v1/admin/users - Admin creates a user
  app.post('/api/v1/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
    const body = z.object({
      username: z.string().min(3).max(80).regex(/^[a-zA-Z0-9_-]+$/),
      password: z.string().min(8).max(200),
      role: z.enum(['USER', 'ADMIN']).default('USER'),
    }).parse(request.body);

    const username = body.username.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return fail(reply, 409, 'Username already taken');

    const passwordHash = await argon2.hash(body.password);
    const user = await prisma.user.create({
      data: { username, passwordHash, role: body.role },
    });

    await prisma.auditLog.create({
      data: { userId: auth(request).id, action: 'admin.user.create', targetId: user.id },
    });

    return { id: user.id, username: user.username, role: user.role };
  });

  // PATCH /api/v1/admin/users/:id/:action - Enable/disable user
  app.patch('/api/v1/admin/users/:id/:action', { preHandler: requireAdmin }, async (request, reply) => {
    const { id, action } = z.object({
      id: z.string().uuid(),
      action: z.enum(['enable', 'disable']),
    }).parse(request.params);

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!target) return fail(reply, 404, 'User not found');
    if (target.id === auth(request).id) return fail(reply, 400, 'Cannot modify your own account');

    const user = await prisma.user.update({
      where: { id },
      data: { enabled: action === 'enable' },
      select: { id: true, username: true, enabled: true },
    });

    await prisma.auditLog.create({
      data: { userId: auth(request).id, action: `admin.user.${action}`, targetId: id },
    });

    return user;
  });

  // GET /api/v1/admin/decks - All decks (admin view)
  app.get('/api/v1/admin/decks', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({
      status: z.enum(['DRAFT', 'PENDING', 'PUBLISHED', 'DISABLED']).optional(),
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().max(100).default(20),
    }).parse(request.query);

    const where = query.status ? { status: query.status } : {};
    const decks = await prisma.deck.findMany({
      where,
      include: {
        owner: { select: { username: true } },
        versions: { orderBy: { version: 'desc' }, take: 1 },
        _count: { select: { downloads: true } },
      },
      orderBy: { updatedAt: 'desc' },
      ...(query.page ? { skip: (query.page - 1) * query.pageSize, take: query.pageSize } : {}),
    });

    if (!query.page) return sanitizeBigInt({ decks });
    const total = await prisma.deck.count({ where });
    return sanitizeBigInt({
      decks, page: query.page, pageSize: query.pageSize,
      total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    });
  });

  // PATCH /api/v1/admin/decks/:id/:action - Publish/disable/relist deck
  app.patch('/api/v1/admin/decks/:id/:action', { preHandler: requireAdmin }, async (request, reply) => {
    const { id, action } = z.object({
      id: z.string().uuid(),
      action: z.enum(['publish', 'disable', 'relist']),
    }).parse(request.params);

    const target = await prisma.deck.findUnique({ where: { id }, select: { status: true } });
    if (!target) return fail(reply, 404, 'Deck not found');

    let publishedVersion: number | null | undefined;
    if (action === 'publish') {
      const version = await prisma.deckVersion.findFirst({
        where: { deckId: id, status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      if (!version) return fail(reply, 409, 'Review and publish a deck version before publishing this deck');
      publishedVersion = version.version;
    }

    const deck = await prisma.deck.update({
      where: { id },
      data: {
        status: action === 'publish' ? 'PUBLISHED' : action === 'disable' ? 'DISABLED' : 'DRAFT',
        ...(action === 'publish' ? { publishedVersion } : {}),
      },
      select: { id: true, status: true, publishedVersion: true },
    });

    await prisma.auditLog.create({
      data: { userId: auth(request).id, action: `admin.deck.${action}`, targetId: id },
    });

    return deck;
  });

  // PATCH /api/v1/admin/decks/:id/versions/:version/:action - Review version
  app.patch('/api/v1/admin/decks/:id/versions/:version/:action', { preHandler: requireAdmin }, async (request, reply) => {
    const { id, version, action } = z.object({
      id: z.string().uuid(),
      version: z.coerce.number().int().positive(),
      action: z.enum(['publish', 'reject']),
    }).parse(request.params);

    const target = await prisma.deckVersion.findUnique({
      where: { deckId_version: { deckId: id, version } },
      include: { deck: { select: { id: true, status: true } } },
    });
    if (!target) return fail(reply, 404, 'Deck version not found');
    if (target.deck.status === 'DISABLED') return fail(reply, 409, 'Disabled decks must be re-listed before reviewing versions');
    if (target.status !== 'PENDING') return fail(reply, 400, 'Only pending versions can be reviewed');

    if (action === 'reject') {
      const rejected = await prisma.deckVersion.update({
        where: { id: target.id },
        data: { status: 'REJECTED' },
        select: { deckId: true, version: true, status: true },
      });
      await prisma.auditLog.create({
        data: { userId: auth(request).id, action: 'admin.deck.version.reject', targetId: target.id, metadata: { deckId: id, version } },
      });
      return rejected;
    }

    const manifest = target.manifest as { description?: string; category?: string };
    try {
      await fsp.access(storedPackagePath(target.packagePath));
    } catch {
      return fail(reply, 409, 'Deck package is missing from server storage');
    }
    if (manifest.category && !(await deckService.categoryIsApproved(manifest.category))) {
      return fail(reply, 409, 'Approve this deck category before publishing the version');
    }

    const published = await prisma.$transaction(async (tx) => {
      await tx.deckVersion.update({ where: { id: target.id }, data: { status: 'PUBLISHED' } });
      return tx.deck.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          publishedVersion: version,
          ...(manifest.description !== undefined ? { description: manifest.description } : {}),
          ...(manifest.category ? { category: normalizeCategoryName(manifest.category) } : {}),
        },
        select: { id: true, status: true, publishedVersion: true, description: true, category: true },
      });
    });

    await prisma.auditLog.create({
      data: { userId: auth(request).id, action: 'admin.deck.version.publish', targetId: target.id, metadata: { deckId: id, version } },
    });

    return published;
  });

  // DELETE /api/v1/admin/decks/:id - Permanent delete with quarantine
  app.delete('/api/v1/admin/decks/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const deck = await prisma.deck.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!deck) return fail(reply, 404, 'Deck not found');
    if (deck.status !== 'DISABLED') return fail(reply, 409, 'Only disabled decks can be permanently deleted');

    const storagePath = deckStoragePath(id);
    const quarantinePath = path.join(config.storageDir, `.deleting-${id}-${crypto.randomUUID()}`);
    let movedStorage = false;
    let databaseDeleted = false;

    try {
      await fsp.rename(storagePath, quarantinePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      movedStorage = true;

      await prisma.$transaction(async (tx) => {
        await tx.deck.delete({ where: { id } });
        await tx.auditLog.create({
          data: { userId: auth(request).id, action: 'admin.deck.delete', targetId: id },
        });
      });
      databaseDeleted = true;

      let storageCleanupPending = false;
      try {
        await fsp.rm(quarantinePath, { recursive: true, force: true });
      } catch (cleanupError) {
        storageCleanupPending = true;
        request.log.error(cleanupError, 'Deck database row deleted but storage cleanup is pending');
      }

      return { id, deleted: true, storageCleanupPending };
    } catch (error) {
      if (movedStorage && !databaseDeleted) {
        await fsp.rename(quarantinePath, storagePath).catch(() => undefined);
      }
      throw error;
    }
  });

  // PATCH /api/v1/admin/decks/:id/category - Change deck category
  app.patch('/api/v1/admin/decks/:id/category', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ category: z.string().min(1).max(80) }).parse(request.body);

    const deck = await prisma.deck.findUnique({ where: { id }, select: { id: true } });
    if (!deck) return fail(reply, 404, 'Deck not found');

    const category = normalizeCategoryName(body.category);
    await deckService.ensureCategory(category, auth(request).id);

    const updated = await prisma.deck.update({
      where: { id },
      data: { category },
      select: { id: true, category: true },
    });

    await prisma.auditLog.create({
      data: { userId: auth(request).id, action: 'admin.deck.category', targetId: id, metadata: { category } },
    });

    return updated;
  });

  // GET /api/v1/admin/categories - List categories
  app.get('/api/v1/admin/categories', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({
      status: z.enum(['PENDING', 'PUBLISHED', 'REJECTED']).optional(),
    }).parse(request.query);

    const where = query.status ? { status: query.status } : {};
    const categories = await prisma.marketCategory.findMany({
      where,
      include: { createdBy: { select: { username: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return { categories };
  });

  // POST /api/v1/admin/categories - Create category
  app.post('/api/v1/admin/categories', { preHandler: requireAdmin }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1).max(80),
      status: z.enum(['PENDING', 'PUBLISHED', 'REJECTED']).default('PUBLISHED'),
    }).parse(request.body);

    const category = await prisma.marketCategory.create({
      data: {
        name: normalizeCategoryName(body.name),
        status: body.status,
        createdById: auth(request).id,
      },
    });

    await prisma.auditLog.create({
      data: { userId: auth(request).id, action: 'admin.category.create', targetId: category.id },
    });

    return category;
  });

  // PATCH /api/v1/admin/categories/:id - Update category
  app.patch('/api/v1/admin/categories/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      status: z.enum(['PENDING', 'PUBLISHED', 'REJECTED']).optional(),
      name: z.string().min(1).max(80).optional(),
    }).parse(request.body);

    const existing = await prisma.marketCategory.findUnique({ where: { id } });
    if (!existing) return fail(reply, 404, 'Category not found');

    const nextName = body.name ? normalizeCategoryName(body.name) : existing.name;
    const category = await prisma.$transaction(async (tx) => {
      const updated = await tx.marketCategory.update({
        where: { id },
        data: {
          ...(body.name ? { name: nextName } : {}),
          ...(body.status ? { status: body.status } : {}),
        },
      });
      if (nextName !== existing.name) {
        await tx.deck.updateMany({
          where: { category: existing.name },
          data: { category: nextName },
        });
      }
      return updated;
    });

    await prisma.auditLog.create({
      data: { userId: auth(request).id, action: 'admin.category.update', targetId: id },
    });

    return category;
  });

  for (const [action, status] of [['approve', 'PUBLISHED'], ['reject', 'REJECTED']] as const) {
    app.patch(`/api/v1/admin/categories/:id/${action}`, { preHandler: requireAdmin }, async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const existing = await prisma.marketCategory.findUnique({ where: { id } });
      if (!existing) return fail(reply, 404, 'Category not found');
      const category = await prisma.marketCategory.update({ where: { id }, data: { status } });
      await prisma.auditLog.create({
        data: { userId: auth(request).id, action: `admin.category.${action}`, targetId: id },
      });
      return category;
    });
  }

  // DELETE /api/v1/admin/categories/:id - Delete category
  app.delete('/api/v1/admin/categories/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const existing = await prisma.marketCategory.findUnique({ where: { id } });
    if (!existing) return fail(reply, 404, 'Category not found');

    const deckCount = await prisma.deck.count({ where: { category: existing.name } });
    if (deckCount > 0) {
      return fail(reply, 409, `Cannot delete category with ${deckCount} decks using it`);
    }

    await prisma.marketCategory.delete({ where: { id } });
    await prisma.auditLog.create({
      data: { userId: auth(request).id, action: 'admin.category.delete', targetId: id },
    });

    return { deleted: true };
  });

  // GET /api/v1/admin/audit-logs - Paginated audit logs
  app.get('/api/v1/admin/audit-logs', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({
      page: z.coerce.number().int().positive().default(1),
      pageSize: z.coerce.number().int().positive().max(100).default(25),
      action: z.string().max(120).optional(),
      userId: z.string().uuid().optional(),
      targetId: z.string().max(120).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }).parse(request.query);

    const from = dateFromQuery(query.from);
    const to = dateFromQuery(query.to);

    const where: any = {
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };

    const [total, items] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { username: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items, page: query.page, pageSize: query.pageSize,
      total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  });

  // GET /api/v1/admin/stats - Dashboard stats
  app.get('/api/v1/admin/stats', { preHandler: requireAdmin }, async () => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [users, enabledUsers, decks, publishedDecks, disabledDecks, pendingVersions, downloads, recentDownloads, storage] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { enabled: true } }),
      prisma.deck.count(),
      prisma.deck.count({ where: { status: 'PUBLISHED' } }),
      prisma.deck.count({ where: { status: 'DISABLED' } }),
      prisma.deckVersion.count({ where: { status: 'PENDING' } }),
      prisma.deckDownload.count(),
      prisma.deckDownload.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      deckService.inspectStorage(),
    ]);

    const dailyDownloads = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.now() - (6 - index) * 24 * 60 * 60 * 1000);
      const day = date.toISOString().slice(0, 10);
      return {
        date: day,
        count: recentDownloads.filter((item) => item.createdAt.toISOString().slice(0, 10) === day).length,
      };
    });

    return {
      users: { total: users, enabled: enabledUsers, disabled: users - enabledUsers },
      decks: { total: decks, published: publishedDecks, disabled: disabledDecks, draft: decks - publishedDecks - disabledDecks },
      versions: { pendingReview: pendingVersions },
      downloads: { total: downloads, last7Days: dailyDownloads },
      storage,
    };
  });

  // GET /api/v1/admin/storage/health - Storage inspection
  app.get('/api/v1/admin/storage/health', { preHandler: requireAdmin }, async () => {
    return deckService.inspectStorage();
  });

  // POST /api/v1/admin/storage/cleanup - Temp file cleanup
  app.post('/api/v1/admin/storage/cleanup', { preHandler: requireAdmin }, async (request) => {
    const options = z.object({
      olderThanHours: z.coerce.number().positive().max(8760).default(24),
      removeOrphans: z.boolean().default(false),
      removeQuarantine: z.boolean().default(false),
    }).parse(request.body || {});
    const topLevel = await fsp.readdir(config.storageDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
    const temporary = topLevel.filter((e) => e.isFile() && e.name.startsWith('.upload-'));
    const quarantine = topLevel.filter((e) => e.isDirectory() && e.name.startsWith('.deleting-'));
    const report = options.removeOrphans ? await deckService.inspectStorage() : null;
    const cutoff = Date.now() - options.olderThanHours * 60 * 60 * 1000;
    const removed: string[] = [];

    for (const file of temporary) {
      const target = path.join(config.storageDir, file.name);
      const stat = await fsp.stat(target).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) {
        await fsp.rm(target, { force: true }).catch(() => undefined);
        removed.push(file.name);
      }
    }
    if (options.removeOrphans && report) {
      for (const relative of report.orphanFiles) {
        const target = path.resolve(config.storageDir, relative);
        if (!storageRelative(target)) continue;
        await fsp.rm(target, { force: true }).catch(() => undefined);
        removed.push(relative);
      }
    }
    if (options.removeQuarantine) {
      for (const dir of quarantine) {
        const target = path.join(config.storageDir, dir.name);
        const stat = await fsp.stat(target).catch(() => null);
        if (stat && stat.mtimeMs < cutoff) {
          await fsp.rm(target, { recursive: true, force: true }).catch(() => undefined);
          removed.push(dir.name);
        }
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: auth(request).id,
        action: 'admin.storage.cleanup',
        metadata: {
          olderThanHours: options.olderThanHours,
          removeOrphans: options.removeOrphans,
          removeQuarantine: options.removeQuarantine,
          removed,
        },
      },
    });

    return { removed, storage: await deckService.inspectStorage() };
  });

  // GET /api/v1/admin/audit-stats - Audit log stats
  app.get('/api/v1/admin/audit-stats', { preHandler: requireAdmin }, async () => {
    const total = await prisma.auditLog.count();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.auditRetentionDays);
    const recent = await prisma.auditLog.count({ where: { createdAt: { gte: cutoff } } });
    return {
      totalLogs: total,
      recentLogs: recent,
      pendingArchival: total - recent,
      retentionDays: config.auditRetentionDays,
    };
  });

  // POST /api/v1/admin/archive-audit - Trigger audit archival
  app.post('/api/v1/admin/archive-audit', { preHandler: requireAdmin }, async (request) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.auditRetentionDays);
    const result = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    await prisma.auditLog.create({
      data: { userId: auth(request).id, action: 'admin.audit.archive', metadata: { deleted: result.count } },
    });
    return { archived: true, deleted: result.count };
  });
}
