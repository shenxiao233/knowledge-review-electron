import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';

export class AuditService {
  private timer: NodeJS.Timeout | null = null;

  startPeriodicArchival() {
    // Run archival on a schedule
    this.timer = setInterval(
      () => { void this.archiveOldLogs(); },
      config.auditArchiveIntervalHours * 3600 * 1000
    );
    this.timer.unref();

    // Run once on startup after a delay
    setTimeout(() => { void this.archiveOldLogs(); }, 30_000);
  }

  stopPeriodicArchival() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async archiveOldLogs() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.auditRetentionDays);
    try {
      const result = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (result.count > 0) {
        console.log(`[AuditService] Archived ${result.count} old audit logs (cutoff: ${cutoff.toISOString()})`);
      }
    } catch (err) {
      console.error('[AuditService] Failed to archive audit logs:', err);
    }
  }

  async getStats() {
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
  }
}
