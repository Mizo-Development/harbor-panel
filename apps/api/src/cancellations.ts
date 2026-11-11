import { voidInvoices } from './invoice-issue';
import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db';
import { serial } from './transactions';
import type { Actor } from './auth';

export const openCancellationStates = ['PENDING', 'APPROVED', 'PROCESSING', 'FAILED'];
export function paymentBlocked(
  service: { status: string; cancelAt?: Date | null },
  periodStart: Date,
  now = new Date(),
) {
  return (
    service.status === 'TERMINATED' ||
    !!(service.cancelAt && (service.cancelAt <= now || periodStart >= service.cancelAt))
  );
}
export async function finalizeTermination(
  tx: any,
  serviceId: string,
  skipCart = false,
  reason = 'Checkout cancelled or expired',
) {
  if (!skipCart) {
    const groups = await tx.invoice.findMany({
      where: { kind: 'CART', status: 'UNPAID', linkedServices: { some: { serviceId } } },
      include: { linkedServices: { include: { service: true } } },
    });
    for (const invoice of groups) {
      const ids = invoice.linkedServices.map((link: any) => link.serviceId);
      if (
        invoice.linkedServices.some(
          (link: any) => !['PENDING', 'FAILED', 'TERMINATED'].includes(link.service.status),
        ) ||
        (await tx.operation.count({
          where: { serviceId: { in: ids }, action: 'provision', attempts: { gt: 0 } },
        }))
      )
        throw new ConflictException(
          'This checkout has provisioned services. Staff must reconcile it before cancellation.',
        );
      await voidInvoices(tx, { id: invoice.id }, reason);
      await tx.cart.updateMany({
        where: { invoiceId: invoice.id },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      for (const id of ids) if (id !== serviceId) await finalizeTermination(tx, id, true, reason);
    }
  }
  const service = await tx.service.update({
    where: { id: serviceId },
    data: { status: 'TERMINATED', nextDueAt: null, error: null },
  });
  await tx.resource.updateMany({ where: { serviceId }, data: { serviceId: null } });
  await voidInvoices(tx, { serviceId }, 'Service terminated');
  await tx.couponRedemption.updateMany({
    where: { orderId: service.orderId, state: 'RESERVED' },
    data: { state: 'RELEASED' },
  });
  await tx.serviceCancellation.updateMany({
    where: { serviceId, status: { in: openCancellationStates } },
    data: { status: 'COMPLETE', completedAt: new Date() },
  });
}
@Injectable()
export class Cancellations {
  constructor(@Inject(Db) private db: Db) {}
  async list(actor: Actor, serviceId?: string) {
    if (
      serviceId &&
      !(await this.db.service.findFirst({
        where: { id: serviceId, ...(actor.role === 'ADMIN' ? {} : { userId: actor.id }) },
      }))
    )
      throw new NotFoundException('Service not found');
    return this.db.serviceCancellation.findMany({
      where: {
        ...(serviceId ? { serviceId } : {}),
        ...(actor.role === 'ADMIN' ? {} : { service: { userId: actor.id } }),
      },
      include: {
        service: {
          select: {
            id: true,
            name: true,
            status: true,
            nextDueAt: true,
            user: { select: { name: true, email: true } },
          },
        },
        operation: { select: { id: true, status: true, error: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
  async request(actor: Actor, serviceId: string, input: unknown) {
    const d = z
      .object({
        mode: z.enum(['IMMEDIATE', 'END_OF_TERM']),
        reason: z.string().trim().min(5).max(3000),
        confirmation: z.string(),
      })
      .strict()
      .parse(input);
    return serial(this.db, async (tx) => {
      const service = await tx.service.findFirst({
        where: { id: serviceId, ...(actor.role === 'ADMIN' ? {} : { userId: actor.id }) },
      });
      if (!service) throw new NotFoundException('Service not found');
      if (await tx.invoiceService.count({ where: { serviceId, invoice: { status: 'UNPAID' } } }))
        throw new ConflictException(
          'This service belongs to an unpaid checkout. Cancel the checkout invoice, or contact staff about partial payments.',
        );
      if (service.status === 'TERMINATED')
        throw new ConflictException('This service is already terminated');
      if (d.confirmation !== service.name)
        throw new BadRequestException('Confirm the exact service name');
      if (
        await tx.serviceCancellation.count({
          where: { serviceId, status: { in: openCancellationStates } },
        })
      )
        throw new ConflictException('A cancellation request is already open');
      if (d.mode === 'END_OF_TERM' && (!service.nextDueAt || service.nextDueAt <= new Date()))
        throw new ConflictException('There is no future paid term. Choose immediate cancellation.');
      const result = await tx.serviceCancellation.create({
        data: { serviceId, requestedById: actor.id, mode: d.mode, reason: d.reason },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'service.cancellation.requested',
          targetId: serviceId,
          details: { cancellationId: result.id, mode: d.mode },
        },
      });
      return result;
    });
  }
  async review(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({
        decision: z.enum(['APPROVE', 'REJECT']),
        note: z.string().trim().min(5).max(3000),
        confirmation: z.string().optional(),
      })
      .strict()
      .parse(input);
    return serial(this.db, async (tx) => {
      const request = await tx.serviceCancellation.findUnique({
        where: { id },
        include: { service: true },
      });
      if (!request) throw new NotFoundException('Cancellation not found');
      if (request.status !== 'PENDING')
        throw new ConflictException('Only pending requests can be reviewed');
      const now = new Date(),
        service = request.service;
      if (d.decision === 'REJECT') {
        const result = await tx.serviceCancellation.update({
          where: { id },
          data: { status: 'REJECTED', reviewNote: d.note, reviewedAt: now, reviewedById: actor.id },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'service.cancellation.rejected',
            targetId: service.id,
            details: { cancellationId: id },
          },
        });
        return result;
      }
      if (d.confirmation !== service.name)
        throw new BadRequestException('Confirm the exact service name before approving deletion');
      if (service.status === 'TERMINATED')
        throw new ConflictException('Service is already terminated');
      if (
        ['PROVISIONING', 'INSTALLING'].includes(service.status) ||
        (await tx.operation.count({ where: { serviceId: service.id, status: 'RUNNING' } }))
      )
        throw new ConflictException(
          'Wait for the running operation or installation to finish before approving',
        );
      const attempted = await tx.operation.count({
        where: { serviceId: service.id, action: 'provision', attempts: { gt: 0 } },
      });
      if (!service.externalId && attempted && ['FAILED', 'PENDING'].includes(service.status))
        throw new ConflictException(
          'Reconcile partial provisioning and identify the remote resource before approving cancellation',
        );
      const effectiveAt = request.mode === 'IMMEDIATE' ? now : service.nextDueAt;
      if (!effectiveAt || (request.mode === 'END_OF_TERM' && effectiveAt <= now))
        throw new ConflictException(
          'The paid term has ended. Reject this request and submit immediate cancellation.',
        );
      await tx.service.update({ where: { id: service.id }, data: { cancelAt: effectiveAt } });
      const result = await tx.serviceCancellation.update({
        where: { id },
        data: {
          status: 'APPROVED',
          effectiveAt,
          reviewedAt: now,
          reviewedById: actor.id,
          reviewNote: d.note,
        },
      });
      // Do not charge for a new term past the approved cutoff. Store exactly which voids withdrawal may restore.
      await voidInvoices(
        tx,
        {
          serviceId: service.id,
          ...(request.mode === 'IMMEDIATE' ? {} : { periodStart: { gte: effectiveAt } }),
        },
        'Service cancellation approved',
        id,
      );
      if (effectiveAt <= now) {
        await tx.operation.updateMany({
          where: { serviceId: service.id, status: 'PENDING' },
          data: {
            status: 'COMPLETE',
            result: { skipped: 'Cancellation approved before execution' },
          },
        });
        if (!service.externalId && !attempted && ['PENDING', 'FAILED'].includes(service.status)) {
          await finalizeTermination(tx, service.id);
        } else {
          const op = await tx.operation.create({
            data: {
              serviceId: service.id,
              action: 'terminate',
              idempotencyKey: `cancellation-${id}`,
            },
          });
          await tx.serviceCancellation.update({
            where: { id },
            data: { status: 'PROCESSING', operationId: op.id },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'service.cancellation.approved',
          targetId: service.id,
          details: { cancellationId: id, effectiveAt: effectiveAt.toISOString() },
        },
      });
      return tx.serviceCancellation.findUniqueOrThrow({ where: { id } });
    });
  }
  async withdraw(actor: Actor, id: string) {
    return serial(this.db, async (tx) => {
      const request = await tx.serviceCancellation.findFirst({
        where: { id, ...(actor.role === 'ADMIN' ? {} : { service: { userId: actor.id } }) },
      });
      if (!request) throw new NotFoundException('Cancellation not found');
      if (
        !['PENDING', 'APPROVED'].includes(request.status) ||
        (request.effectiveAt && request.effectiveAt <= new Date())
      )
        throw new ConflictException('Cancellation has reached its cutoff or is being processed');
      if (
        request.status === 'APPROVED' &&
        (await tx.payment.count({
          where: {
            invoice: { cancellationId: id, status: 'VOID' },
            appliedAmount: { gt: 0 },
            reviewedAt: { not: null },
          },
        }))
      )
        throw new ConflictException(
          'Staff must reconcile reviewed payments before withdrawing this cancellation',
        );
      if (request.status === 'APPROVED') {
        await tx.service.update({ where: { id: request.serviceId }, data: { cancelAt: null } });
        await tx.invoice.updateMany({
          where: { cancellationId: id, status: 'VOID' },
          data: { status: 'UNPAID', cancellationId: null, voidReason: null },
        });
      }
      await tx.payment.updateMany({
        where: {
          invoice: { serviceId: request.serviceId, status: 'UNPAID' },
          reviewRequired: true,
          reviewedAt: null,
          reviewReason: 'Part-paid invoice voided; allocation requires reconciliation',
        },
        data: { reviewRequired: false, reviewReason: null },
      });
      const result = await tx.serviceCancellation.update({
        where: { id },
        data: { status: 'WITHDRAWN' },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'service.cancellation.withdrawn',
          targetId: request.serviceId,
          details: { cancellationId: id },
        },
      });
      return result;
    });
  }
  async scheduleDue() {
    const due = await this.db.serviceCancellation.findMany({
      where: { status: 'APPROVED', effectiveAt: { lte: new Date() } },
      select: { id: true },
    });
    for (const item of due)
      await serial(this.db, async (tx) => {
        const request = await tx.serviceCancellation.findUniqueOrThrow({
          where: { id: item.id },
          include: { service: true },
        });
        if (
          request.status !== 'APPROVED' ||
          !request.effectiveAt ||
          request.effectiveAt > new Date()
        )
          return;
        if (request.service.status === 'TERMINATED') {
          await finalizeTermination(tx, request.serviceId);
          return;
        }
        const op = await tx.operation.upsert({
          where: { idempotencyKey: `cancellation-${request.id}` },
          create: {
            serviceId: request.serviceId,
            action: 'terminate',
            idempotencyKey: `cancellation-${request.id}`,
          },
          update: {},
        });
        await tx.serviceCancellation.update({
          where: { id: request.id },
          data: { status: 'PROCESSING', operationId: op.id },
        });
      });
    await this.db.serviceCancellation.updateMany({
      where: { status: 'PROCESSING', operation: { status: 'FAILED' } },
      data: { status: 'FAILED' },
    });
  }
}
