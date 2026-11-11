import { wingsSettings, wingsProcess } from './providers/wings';
import { GameEggs } from './game-eggs';
import {
  issueInvoice,
  invoicePaymentBlocked,
  voidInvoices,
  serviceInvoiceWhere,
} from './invoice-issue';
import { Cancellations, finalizeTermination, paymentBlocked } from './cancellations';
import { calculateTax } from './taxes';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Db, json } from './db';
import { Platform } from './platform';
import { serial } from './transactions';
import { ServiceAction } from '@harbor/sdk';
import { Mailer } from './mailer';
import { invoiceSnapshot } from './billing';
import { automationPolicy, notificationPolicy } from './settings-policy';
@Injectable()
export class Jobs {
  private log = new Logger('Jobs');
  constructor(
    @Inject(Db) private db: Db,
    @Inject(GameEggs) private eggs: GameEggs,
    @Inject(Platform) private platform: Platform,
    @Inject(Mailer) private mail: Mailer,
    @Inject(Cancellations) private cancellations: Cancellations,
  ) {}
  async execute(id: string) {
    const op = await serial(this.db, async (tx) => {
      const job = await tx.operation.findUnique({ where: { id } });
      if (!job || job.status !== 'PENDING') return null;
      const service = await tx.service.findUniqueOrThrow({ where: { id: job.serviceId } });
      if (
        service.status === 'TERMINATED' ||
        (job.action !== 'terminate' && service.cancelAt && service.cancelAt <= new Date())
      ) {
        await tx.operation.update({
          where: { id },
          data: {
            status: 'COMPLETE',
            leaseUntil: null,
            result: { skipped: 'Service terminated or cancellation cutoff reached' },
          },
        });
        return null;
      }
      if (await tx.operation.count({ where: { serviceId: job.serviceId, status: 'RUNNING' } }))
        return null;
      return tx.operation.update({
        where: { id },
        data: {
          status: 'RUNNING',
          attempts: { increment: 1 },
          leaseUntil: new Date(Date.now() + 15 * 60000),
          error: null,
        },
      });
    });
    if (!op) return;
    const heartbeat = setInterval(() => {
      void this.db.operation
        .updateMany({
          where: { id, status: 'RUNNING' },
          data: { leaseUntil: new Date(Date.now() + 15 * 60000) },
        })
        .catch(() => {});
    }, 60000);
    let previousStatus: string | undefined;
    try {
      const s = await this.db.service.findUniqueOrThrow({
        where: { id: op.serviceId },
        include: { product: { include: { connection: true } }, user: true, resource: true },
      });
      if (
        s.user.suspendedAt &&
        ['provision', 'start', 'restart', 'rebuild', 'unsuspend'].includes(op.action)
      )
        throw new Error(
          'Customer account suspended. Restore access before retrying this operation.',
        );
      const provider = await this.platform.extensions.provider(s.provider);
      const connection = this.platform.connection(s.product.connection);
      let hs = this.platform.hostingService(s);
      let result: Record<string, unknown>;
      if (op.action === 'provision') {
        const paid = await this.db.invoice.count({
          where: { ...serviceInvoiceWhere(s.id), status: 'PAID' },
        });
        if (!paid) throw new Error('A paid invoice is required before provisioning');
        if (s.status === 'TERMINATED')
          throw new Error('A terminated service cannot be provisioned');
        if (s.status !== 'ACTIVE')
          await this.db.service.update({
            where: { id: s.id },
            data: { status: 'PROVISIONING', error: null },
          });
        if (s.provider === 'wings') {
          s.metadata = json(await this.eggs.prepare(s, op.id, connection));
          hs = this.platform.hostingService(s);
        }
        const created = await provider.provision(connection, hs);
        result = { ...created };
        await this.db.$transaction(async (tx) => {
          const current = await tx.service.findUniqueOrThrow({ where: { id: s.id } });
          // An installation callback may arrive before the provider response.
          await tx.service.update({
            where: { id: s.id },
            data: {
              externalId: created.externalId,
              status:
                current.status === 'ACTIVE' || current.status === 'FAILED'
                  ? current.status
                  : created.pending
                    ? 'INSTALLING'
                    : 'ACTIVE',
              metadata: json({ ...(current.metadata as object), ...created.metadata }),
            },
          });
        });
      } else {
        if (['suspend', 'unsuspend'].includes(op.action)) {
          previousStatus = s.status;
          const shouldRun = await serial(this.db, async (tx) => {
            if (op.action === 'unsuspend' && op.idempotencyKey.startsWith('invoice-')) {
              const settings = await tx.setting.findUniqueOrThrow({
                where: { id: 'installation' },
              });
              if (
                await tx.invoice.count({
                  where: {
                    ...serviceInvoiceWhere(s.id),
                    status: 'UNPAID',
                    dueAt: { lt: new Date(Date.now() - settings.graceDays * 86400000) },
                  },
                })
              )
                return false;
            }
            if (op.action === 'suspend' && op.idempotencyKey.startsWith('overdue-')) {
              if (
                !automationPolicy(await tx.setting.findUnique({ where: { id: 'installation' } }))
                  .autoSuspendEnabled
              )
                return false;
              const invoice = await tx.invoice.findUnique({
                where: { id: op.idempotencyKey.slice(8) },
              });
              if (!invoice || invoice.status !== 'UNPAID') return false;
            }
            await tx.service.update({
              where: { id: s.id },
              data: { status: op.action === 'suspend' ? 'SUSPENDED' : 'ACTIVE' },
            });
            return true;
          });
          if (!shouldRun) {
            await this.db.operation.update({
              where: { id },
              data: {
                status: 'COMPLETE',
                result: json({ skipped: 'Billing state changed before the operation ran' }),
                leaseUntil: null,
              },
            });
            return;
          }
        }
        if (s.provider === 'wings' && op.action === 'rebuild') {
          s.metadata = json(await this.eggs.prepare(s, op.id, connection));
          hs = this.platform.hostingService(s);
          previousStatus = s.status;
          await this.db.service.update({
            where: { id: s.id },
            data: { status: 'INSTALLING', error: null },
          });
          // Reinstall must use the selected image and startup configuration as well as its install script.
          await (provider as any).call(connection, `/servers/${s.id}/sync`, 'POST', {
            ...wingsSettings(hs),
            process_configuration: wingsProcess(hs),
          });
        }
        result = await provider.action(
          connection,
          hs,
          op.action as ServiceAction,
          op.input as Record<string, unknown>,
        );
        if (result.metadata && typeof result.metadata === 'object')
          await serial(this.db, async (tx) => {
            const current = await tx.service.findUniqueOrThrow({ where: { id: s.id } });
            await tx.service.update({
              where: { id: s.id },
              data: {
                metadata: json({ ...(current.metadata as object), ...(result.metadata as object) }),
              },
            });
          });
        if (op.action === 'terminate') await serial(this.db, (tx) => finalizeTermination(tx, s.id));
      }
      await this.db.operation.update({
        where: { id },
        data: { status: 'COMPLETE', result: json(result), leaseUntil: null },
      });
      await this.db.auditLog.create({
        data: { action: `service.${op.action}.completed`, targetId: s.id },
      });
      if (s.provider !== 'demo-game')
        await this.platform.extensions.emit(
          op.action === 'provision' ? 'service.created' : 'service.updated',
          { serviceId: s.id, action: op.action },
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Operation failed';
      await this.db.operation.update({
        where: { id },
        data: { status: 'FAILED', error: message, leaseUntil: null },
      });
      await this.db.serviceCancellation.updateMany({
        where: { operationId: id, status: 'PROCESSING' },
        data: { status: 'FAILED' },
      });
      if (op.action === 'provision')
        await this.db.service.update({
          where: { id: op.serviceId },
          data: { status: 'FAILED', error: message },
        });
      else if (previousStatus)
        await this.db.service.update({
          where: { id: op.serviceId },
          data: { status: previousStatus as any, error: message },
        });
      this.log.warn(`Operation ${id} failed: ${message}`);
    } finally {
      clearInterval(heartbeat);
    }
  }
  async renewalInvoice(serviceId: string, periodStart: Date, settings: any) {
    return serial(this.db, async (tx) => {
      const s = await tx.service.findUniqueOrThrow({
        where: { id: serviceId },
        include: { product: true, user: true },
      });
      if (
        !['ACTIVE', 'SUSPENDED'].includes(s.status) ||
        ((s.metadata as any).billingContract &&
          (s.metadata as any).billingContract.type !== 'RECURRING') ||
        !s.nextDueAt ||
        s.nextDueAt.getTime() !== periodStart.getTime() ||
        paymentBlocked(s, periodStart)
      )
        return null;
      const existing = await tx.invoice.findUnique({
        where: { serviceId_periodStart: { serviceId, periodStart } },
      });
      if (existing) return { invoice: existing, created: false };
      const policy = (s.metadata as any).taxPolicy || {
        inclusive: false,
        taxable: s.provider !== 'demo-game',
      };
      const tax = await calculateTax(
        tx,
        settings,
        s.user,
        s.recurringAmount ?? s.product.price,
        policy.inclusive,
        policy.taxable,
      );
      const coupon = (s.metadata as any).coupon;
      const invoice = await issueInvoice(tx, {
        description: s.name,
        serviceId,
        userId: s.userId,
        amount: tax.total,
        currency: s.recurringCurrency || settings.currency,
        dueAt: periodStart,
        periodStart,
        billingSnapshot: json({
          ...invoiceSnapshot(settings, s.user),
          pricing: {
            tax,
            lines: (s.metadata as any).pricingLines,
            billingContract: (s.metadata as any).billingContract,
            options: (s.metadata as any).configuration,
            ...(coupon?.recurring
              ? { subtotal: coupon.subtotal, discount: coupon.discount, couponCode: coupon.code }
              : { subtotal: s.recurringAmount ?? s.product.price, discount: 0 }),
          },
        }),
      });
      return { invoice, created: true };
    });
  }
  async maintenance() {
    const now = new Date();
    await this.db.operation.updateMany({
      where: { status: 'RUNNING', leaseUntil: { lt: now } },
      data: {
        status: 'FAILED',
        error: 'Worker lease expired. Reconcile provider state before retrying.',
        leaseUntil: null,
      },
    });
    await this.db.session.deleteMany({ where: { expiresAt: { lt: now } } });
    await this.db.resetToken.deleteMany({ where: { expiresAt: { lt: now } } });
    await this.db.service.updateMany({
      where: { status: 'INSTALLING', updatedAt: { lt: new Date(Date.now() - 3600000) } },
      data: {
        status: 'FAILED',
        error: 'Installation did not complete within one hour. Inspect the node before retrying.',
      },
    });
    await this.cancellations.scheduleDue();
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
    if (!settings) return;
    const automation = automationPolicy(settings);
    await this.db.verificationToken.deleteMany({ where: { expiresAt: { lt: now } } });
    const due = await this.db.service.findMany({
      where: {
        status: { in: ['ACTIVE', 'SUSPENDED'] },
        nextDueAt: { lte: new Date(Date.now() + automation.renewalLeadDays * 86400000) },
      },
      include: { product: true, user: true },
    });
    for (const s of due) {
      const renewal = await this.renewalInvoice(s.id, s.nextDueAt!, settings);
      const invoice = renewal?.invoice;
      if (
        renewal?.created &&
        notificationPolicy(settings).renewalEmails &&
        !settings.invoiceEmailsEnabled
      )
        await this.mail
          .template(s.user.email, 'renewal.ready', {
            company: settings.companyName,
            service: s.name,
            link: `${process.env.APP_URL}/dashboard/invoices/${invoice!.id}`,
          })
          .catch(() => {});
      if (invoice?.amount === 0 && invoice.status === 'UNPAID') {
        try {
          await this.platform.payments.settle({
            gateway: 'promotion',
            eventId: `promotion-${invoice.id}`,
            paymentId: `promotion-${invoice.id}`,
            invoiceId: invoice.id,
            amount: 0,
            currency: invoice.currency,
          });
        } catch (error) {
          const current = await this.db.invoice.findUniqueOrThrow({
            where: { id: invoice.id },
            include: { service: true },
          });
          if (!invoicePaymentBlocked(current)) throw error;
        }
      }
      if (
        invoice &&
        invoice.status === 'UNPAID' &&
        invoice.amount > 0 &&
        automation.automaticRenewalCredit &&
        s.user.autoPayWallet &&
        !s.user.suspendedAt
      ) {
        const wallet = await this.db.wallet.findUnique({
          where: { userId_currency: { userId: s.userId, currency: invoice.currency } },
        });
        if (wallet && wallet.balance >= invoice.amount - invoice.paidAmount)
          try {
            await this.platform.payments.settle({
              gateway: 'wallet',
              eventId: `renewal-wallet-${invoice.id}`,
              paymentId: `renewal-wallet-${invoice.id}`,
              invoiceId: invoice.id,
              amount: invoice.amount - invoice.paidAmount,
              currency: invoice.currency,
              walletUserId: s.userId,
            });
          } catch (error) {
            if (!(
              error instanceof Error &&
              [
                'Insufficient wallet balance',
                'This invoice cannot be paid after cancellation',
                'The remaining balance changed. Refresh the invoice before paying.',
              ].includes(error.message)
            ))
              throw error;
          }
      }
      const overdue = await this.db.invoice.findFirst({
        where: {
          serviceId: s.id,
          status: 'UNPAID',
          dueAt: { lt: new Date(Date.now() - settings.graceDays * 86400000) },
        },
      });
      if (overdue && s.status === 'ACTIVE' && automation.autoSuspendEnabled)
        await this.db.operation.upsert({
          where: { idempotencyKey: `overdue-${overdue.id}` },
          create: { serviceId: s.id, action: 'suspend', idempotencyKey: `overdue-${overdue.id}` },
          update: {},
        });
    }
    await serial(this.db, (tx) =>
      voidInvoices(
        tx,
        { kind: 'WALLET_FUNDING', dueAt: { lt: now } },
        'Unpaid funding invoice expired',
      ),
    );
    const expired = await this.db.service.findMany({
      where: {
        status: 'PENDING',
        OR: [
          { invoices: { some: { status: 'UNPAID', dueAt: { lt: now } } } },
          { invoiceLinks: { some: { invoice: { status: 'UNPAID', dueAt: { lt: now } } } } },
          {
            createdAt: {
              lt: new Date(now.getTime() - automation.unpaidOrderExpiryHours * 3600000),
            },
            OR: [
              { invoices: { some: { status: 'UNPAID' } } },
              { invoiceLinks: { some: { invoice: { status: 'UNPAID' } } } },
            ],
          },
        ],
      },
    });
    for (const s of expired)
      await serial(this.db, async (tx) => {
        if (
          (await tx.invoice.count({ where: { ...serviceInvoiceWhere(s.id), status: 'PAID' } })) ||
          (await tx.operation.count({
            where: { serviceId: s.id, action: 'provision', attempts: { gt: 0 } },
          }))
        )
          return;
        await finalizeTermination(tx, s.id);
      });
  }
}
