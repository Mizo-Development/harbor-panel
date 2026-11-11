import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Db } from './db';
import { Mailer } from './mailer';
import { serial } from './transactions';
import type { Actor } from './auth';
import { appUrl } from './security';
import { invoiceFilename, invoiceReference, invoiceMoney, renderInvoicePdf } from './invoice-pdf';

@Injectable()
export class InvoiceDocuments {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Mailer) private mail: Mailer,
  ) {}
  async invoice(actor: Actor, id: string) {
    const invoice = await this.db.invoice.findFirst({
      where: { id, ...(actor.role === 'ADMIN' ? {} : { userId: actor.id }) },
      include: { service: true, lineItems: true, payments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
  async pdf(actor: Actor, id: string) {
    const invoice = await this.invoice(actor, id);
    return { filename: invoiceFilename(invoice), content: await renderInvoicePdf(invoice) };
  }
  async history(id: string) {
    const invoice = await this.db.invoice.findUnique({
      where: { id },
      include: { user: true, service: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return {
      smtpConfigured: await this.mail.configured(),
      recipient: invoice.user.email,
      isDemo: invoice.service?.provider === 'demo-game',
      deliveries: await this.db.invoiceDelivery.findMany({
        where: { invoiceId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          kind: true,
          recipient: true,
          status: true,
          attempts: true,
          lastError: true,
          createdAt: true,
          sentAt: true,
        },
      }),
    };
  }
  async request(actor: Actor, id: string, input: unknown) {
    const d = z.object({ idempotencyKey: z.string().uuid() }).strict().parse(input);
    return serial(this.db, async (tx) => {
      const requestKey = `manual-invoice-${d.idempotencyKey}`;
      const existing = await tx.invoiceDelivery.findUnique({ where: { requestKey } });
      if (existing) {
        if (existing.invoiceId !== id)
          throw new ConflictException('This request key belongs to another invoice');
        return { id: existing.id, status: existing.status };
      }
      const invoice = await tx.invoice.findUnique({
        where: { id },
        include: { user: true, service: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.service?.provider === 'demo-game')
        throw new ConflictException('Demo invoices cannot be emailed');
      z.email().parse(invoice.user.email);
      if (
        await tx.invoiceDelivery.count({
          where: { invoiceId: id, createdAt: { gt: new Date(Date.now() - 60000) } },
        })
      )
        throw new ConflictException(
          'An invoice email was recently queued. Wait a minute before sending another.',
        );
      const delivery = await tx.invoiceDelivery.create({
        data: { invoiceId: id, requestKey, recipient: invoice.user.email, kind: 'MANUAL' },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'invoice.email.queued',
          targetId: id,
          details: { deliveryId: delivery.id },
        },
      });
      return { id: delivery.id, status: delivery.status };
    });
  }
  async retry(actor: Actor, invoiceId: string, id: string, input: unknown) {
    const d = z
      .object({ acknowledgePossibleDuplicate: z.boolean().default(false) })
      .strict()
      .parse(input ?? {});
    return serial(this.db, async (tx) => {
      const delivery = await tx.invoiceDelivery.findFirst({ where: { id, invoiceId } });
      if (!delivery) throw new NotFoundException('Delivery not found');
      if (!['FAILED', 'UNKNOWN'].includes(delivery.status))
        throw new ConflictException('Only failed or uncertain deliveries can be retried');
      if (delivery.status === 'UNKNOWN' && !d.acknowledgePossibleDuplicate)
        throw new ConflictException(
          'The SMTP server may already have accepted this email. Confirm the possible duplicate before retrying.',
        );
      await tx.invoiceDelivery.update({
        where: { id },
        data: {
          status: 'PENDING',
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: new Date(),
          lastError: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'invoice.email.retry',
          targetId: invoiceId,
          details: { deliveryId: id, previousStatus: delivery.status },
        },
      });
      return { id, status: 'PENDING' };
    });
  }
  async scan() {
    // An expired SMTP lease is uncertain. Never automatically send it twice after a crash.
    await this.db.invoiceDelivery.updateMany({
      where: { status: 'SENDING', leaseUntil: { lt: new Date() } },
      data: {
        status: 'UNKNOWN',
        lastError: 'Worker stopped before confirming SMTP acceptance. Review before retrying.',
        leaseToken: null,
        leaseUntil: null,
      },
    });
    const pending = await this.db.invoiceDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: 10,
      select: { id: true },
    });
    for (const delivery of pending) await this.deliver(delivery.id);
  }
  async deliver(id: string) {
    if (!(await this.mail.configured())) {
      await this.db.invoiceDelivery.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          nextAttemptAt: new Date(Date.now() + 60000),
          lastError: 'SMTP is not configured. Delivery is waiting.',
        },
      });
      return;
    }
    const token = randomUUID();
    const claimed = await this.db.invoiceDelivery.updateMany({
      where: { id, status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      data: {
        status: 'SENDING',
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 5 * 60000),
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    if (!claimed.count) return;
    let smtpStarted = false;
    try {
      const delivery = await this.db.invoiceDelivery.findUniqueOrThrow({
        where: { id },
        include: {
          invoice: {
            include: {
              service: true,
              lineItems: true,
              payments: { orderBy: { createdAt: 'asc' } },
            },
          },
        },
      });
      const invoice = delivery.invoice,
        ref = invoiceReference(invoice);
      const content = await renderInvoicePdf(invoice);
      const messageId = `<harbor-invoice-${id}@${new URL(appUrl()).hostname}>`;
      smtpStarted = true;
      const sent = await this.mail.template(
        delivery.recipient,
        delivery.kind === 'PAID' ? 'invoice.paid' : 'invoice.issued',
        {
          company:
            (invoice.billingSnapshot as any)?.seller?.legalName ||
            (invoice.billingSnapshot as any)?.seller?.companyName ||
            'Harbor',
          number: ref,
          amount: invoiceMoney(invoice.amount, invoice.currency),
          balance: invoiceMoney(
            invoice.status === 'UNPAID' ? invoice.amount - invoice.paidAmount : 0,
            invoice.currency,
          ),
          currency: invoice.currency,
          status: invoice.status,
          link: `${appUrl()}/dashboard/invoices/${invoice.id}`,
        },
        [{ filename: invoiceFilename(invoice), content, contentType: 'application/pdf' }],
        messageId,
      );
      if (!sent) throw Object.assign(new Error('SMTP is not configured'), { code: 'ECONNECTION' });
      await this.db.invoiceDelivery.updateMany({
        where: { id, status: 'SENDING', leaseToken: token },
        data: { status: 'SENT', sentAt: new Date(), messageId, leaseToken: null, leaseUntil: null },
      });
    } catch (error) {
      const e = error as { code?: string; command?: string; responseCode?: number };
      // Do not persist SMTP responses, URLs, credentials, recipient bodies or exception stacks.
      const definiteFailure =
        !smtpStarted ||
        ['EAUTH', 'ECONNECTION', 'EDNS', 'EENVELOPE'].includes(e.code || '') ||
        (e.responseCode !== undefined && e.responseCode >= 400);
      const status = definiteFailure ? 'FAILED' : 'UNKNOWN';
      const message = definiteFailure
        ? 'SMTP rejected the message or could not connect. Check mail configuration before retrying.'
        : 'SMTP acceptance could not be confirmed. The message may have been delivered; review before retrying.';
      await this.db.invoiceDelivery.updateMany({
        where: { id, status: 'SENDING', leaseToken: token },
        data: { status, lastError: message, leaseToken: null, leaseUntil: null },
      });
    }
  }
}
