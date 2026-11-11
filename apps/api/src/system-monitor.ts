import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Db } from './db';
import { serial } from './transactions';
@Injectable()
export class SystemMonitor implements OnModuleDestroy {
  private pending = new Set<Promise<unknown>>();
  constructor(@Inject(Db) private db: Db) {}
  middleware = (req: Request, res: Response, next: NextFunction) => {
    const route = req.path;
    if (
      !route.startsWith('/api/v1/') ||
      route === '/api/v1/health' ||
      route.startsWith('/api/v1/branding/')
    )
      return next();
    const id = randomUUID(),
      start = performance.now();
    res.setHeader('X-Request-ID', id);
    res.once('finish', () => {
      const path = (typeof req.route?.path === 'string' ? req.route.path : route)
        .replace(/[^a-zA-Z0-9/_:.*-]/g, '_')
        .slice(0, 300);
      const write = this.db.httpLog
        .create({
          data: {
            id,
            method: req.method,
            path,
            status: res.statusCode,
            durationMs: Math.max(0, Math.round(performance.now() - start)),
            actorId: (req as any).harborActorId || null,
            apiKeyId: (req as any).harborApiKey?.id || null,
          },
        })
        .catch(() => {});
      this.pending.add(write);
      void write.finally(() => this.pending.delete(write));
    });
    next();
  };
  async onModuleDestroy() {
    await Promise.allSettled([...this.pending]);
  }
  async maintenance(run: () => Promise<unknown>, origin = 'scheduled', actorId?: string) {
    const task = await serial(this.db, async (tx) => {
      await tx.systemRun.updateMany({
        where: { task: 'maintenance', status: 'RUNNING', leaseUntil: { lt: new Date() } },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorCode: 'LEASE_EXPIRED',
          leaseUntil: null,
        },
      });
      if (await tx.systemRun.count({ where: { task: 'maintenance', status: 'RUNNING' } }))
        return null;
      const record = await tx.systemRun.create({
        data: { task: 'maintenance', origin, leaseUntil: new Date(Date.now() + 15 * 60000) },
      });
      if (actorId)
        await tx.auditLog.create({
          data: { actorId, action: 'system.maintenance.requested', targetId: record.id },
        });
      return record;
    });
    if (!task) return { skipped: true, message: 'Maintenance is already running' };
    const timer = setInterval(
      () =>
        void this.db.systemRun
          .updateMany({
            where: { id: task.id, status: 'RUNNING' },
            data: { leaseUntil: new Date(Date.now() + 15 * 60000) },
          })
          .catch(() => {}),
      30000,
    );
    try {
      await run();
      await this.db.mailLog.updateMany({
        where: { status: 'SENDING', createdAt: { lt: new Date(Date.now() - 10 * 60000) } },
        data: { status: 'UNKNOWN', errorCode: 'DELIVERY_UNCONFIRMED' },
      });
      await this.db.systemRun.update({
        where: { id: task.id },
        data: { status: 'COMPLETE', finishedAt: new Date(), leaseUntil: null },
      });
      await this.db.httpLog.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 30 * 86400000) } },
      });
      await this.db.mailLog.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 90 * 86400000) } },
      });
      await this.db.systemRun.deleteMany({
        where: {
          startedAt: { lt: new Date(Date.now() - 30 * 86400000) },
          status: { not: 'RUNNING' },
        },
      });
      return { complete: true, id: task.id };
    } catch {
      await this.db.systemRun.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          leaseUntil: null,
          errorCode: 'MAINTENANCE_FAILED',
        },
      });
      return {
        complete: false,
        id: task.id,
        message: 'Maintenance failed. Check the API and worker logs before retrying.',
      };
    } finally {
      clearInterval(timer);
    }
  }
  async status() {
    const [operations, maintenance, recentRuns, failures, mail] = await Promise.all([
      this.db.operation.groupBy({ by: ['status'], _count: true }),
      this.db.systemRun.findFirst({
        where: { task: 'maintenance', origin: 'scheduled' },
        orderBy: { startedAt: 'desc' },
      }),
      this.db.systemRun.findMany({
        where: { task: 'maintenance' },
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
      this.db.httpLog.count({
        where: { status: { gte: 500 }, createdAt: { gt: new Date(Date.now() - 86400000) } },
      }),
      this.db.mailLog.groupBy({
        by: ['status'],
        where: { createdAt: { gt: new Date(Date.now() - 86400000) } },
        _count: true,
      }),
    ]);
    return {
      version: '0.1.0',
      runtime: process.version,
      environment: process.env.NODE_ENV || 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      database: 'connected',
      worker: !maintenance
        ? 'WAITING'
        : maintenance.status === 'FAILED'
          ? 'FAILED'
          : Date.now() - maintenance.startedAt.getTime() > 180000
            ? 'DELAYED'
            : 'HEALTHY',
      maintenance,
      recentRuns,
      operations: Object.fromEntries(operations.map((r) => [r.status, r._count])),
      apiErrors24h: failures,
      mail24h: Object.fromEntries(mail.map((r) => [r.status, r._count])),
    };
  }
  async logs(kind: 'http' | 'audit', query: unknown) {
    const d = z
      .object({
        page: z.coerce.number().int().min(1).max(10000).default(1),
        search: z.string().trim().max(200).default(''),
        errorsOnly: z.enum(['true', 'false']).default('false'),
      })
      .parse(query);
    if (kind === 'audit') {
      const where = d.search
        ? {
            OR: [
              { action: { contains: d.search, mode: 'insensitive' as const } },
              { actorId: d.search },
              { targetId: d.search },
            ],
          }
        : {};
      const [total, items] = await Promise.all([
        this.db.auditLog.count({ where }),
        this.db.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (d.page - 1) * 25,
          take: 25,
        }),
      ]);
      return { total, page: d.page, items };
    }
    const where = {
      ...(d.errorsOnly === 'true' ? { status: { gte: 400 } } : {}),
      ...(d.search
        ? {
            OR: [
              { path: { contains: d.search, mode: 'insensitive' as const } },
              { id: d.search },
              { actorId: d.search },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.db.httpLog.count({ where }),
      this.db.httpLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (d.page - 1) * 25,
        take: 25,
      }),
    ]);
    return { total, page: d.page, items };
  }
  async jobs(query: unknown) {
    const d = z
      .object({
        page: z.coerce.number().int().min(1).max(10000).default(1),
        search: z.string().trim().max(200).default(''),
        status: z.enum(['', 'FAILED', 'PENDING', 'RUNNING', 'COMPLETE']).default('FAILED'),
      })
      .parse(query);
    const where = {
      ...(d.status ? { status: d.status } : {}),
      ...(d.search
        ? {
            OR: [
              { action: { contains: d.search, mode: 'insensitive' as const } },
              { service: { name: { contains: d.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.db.operation.count({ where }),
      this.db.operation.findMany({
        where,
        select: {
          id: true,
          status: true,
          action: true,
          attempts: true,
          error: true,
          createdAt: true,
          updatedAt: true,
          service: { select: { id: true, name: true, status: true, cancelAt: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (d.page - 1) * 25,
        take: 25,
      }),
    ]);
    return { total, page: d.page, items };
  }
}
