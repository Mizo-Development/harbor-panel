import { createHash } from 'node:crypto';
import { queueInvoiceDelivery } from './invoice-delivery-queue';
import {
  issueInvoice,
  remainingBalance,
  invoicePaymentBlocked,
  creditFunding,
  serviceInvoiceWhere,
} from './invoice-issue';
import { walletPolicy } from './billing';
import { baseContract } from './offers';
import { paymentBlocked } from './cancellations';
import { z } from 'zod';
import type { Actor } from './auth';
import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Db, json } from './db';
import { Extensions } from './extensions';
import { appUrl } from './security';
import { calculateDueDate } from '@harbor/sdk';
import { stripeConfig, paypalConfig, paypalOrigin, paypalToken } from './gateways';
import { requestJson } from './providers/http';
import Stripe from 'stripe';
import type { Request } from 'express';
import { serial } from './transactions';
import type { Prisma } from '@prisma/client';
@Injectable()
export class Payments {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Extensions) private extensions: Extensions,
  ) {}
  async available() {
    const enabled = await this.db.extension.findMany({
      where: { id: { in: ['stripe', 'paypal', 'manual'] }, enabled: true },
    });
    const result = [];
    for (const e of enabled) {
      const c = await this.extensions.configuration(e.id);
      if (
        e.id === 'manual' ||
        (e.id === 'stripe' && stripeConfig(c).secretKey) ||
        (e.id === 'paypal' && paypalConfig(c).clientId && paypalConfig(c).clientSecret)
      )
        result.push({ id: e.id, name: (e.manifest as any).name });
    }
    return result;
  }
  async announcePaid(invoiceId: string, kind: string) {
    await this.extensions.emit('invoice.paid', { invoiceId, kind });
  }
  async checkout(invoiceId: string, gatewayId: string) {
    const invoice = await this.db.invoice.findUnique({
      where: { id: invoiceId },
      include: { service: true, linkedServices: { include: { service: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'UNPAID' || invoicePaymentBlocked(invoice))
      throw new ConflictException('This invoice cannot be paid');
    if (invoice.service?.provider === 'demo-game')
      throw new BadRequestException(
        'Demo invoices cannot use payment gateways. Use Complete demo order.',
      );
    if (gatewayId === 'manual')
      return {
        message:
          'Contact the hosting company with this invoice number for offline payment instructions.',
      };
    const gateway = await this.extensions.gateway(gatewayId);
    const existing = await this.db.checkout.findFirst({
      where: {
        invoiceId,
        gateway: gatewayId,
        amount: remainingBalance(invoice),
        currency: invoice.currency,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing && Date.now() - existing.createdAt.getTime() < 3 * 60 * 60 * 1000)
      return { url: existing.url, externalId: existing.externalId };
    const result = await gateway.checkout(
      {
        id: invoice.id,
        amount: remainingBalance(invoice),
        currency: invoice.currency,
        returnUrl: `${appUrl()}/dashboard/invoices/${invoice.id}`,
        description: invoice.description || `Invoice ${invoice.number || invoice.id.slice(0, 8)}`,
      },
      await this.extensions.configuration(gatewayId),
    );
    await this.db.checkout.upsert({
      where: { externalId: result.externalId },
      create: {
        invoiceId,
        gateway: gatewayId,
        amount: remainingBalance(invoice),
        currency: invoice.currency,
        ...result,
      },
      update: result,
    });
    return result;
  }
  async settle(
    input: {
      gateway: string;
      eventId: string;
      paymentId: string;
      invoiceId: string;
      amount: number;
      currency: string;
      walletUserId?: string;
      strictIdempotency?: boolean;
    },
    transaction?: Prisma.TransactionClient,
  ) {
    z.object({
      eventId: z.string().min(1).max(400),
      paymentId: z.string().min(1).max(400),
      invoiceId: z.string().min(1).max(200),
      currency: z.string().regex(/^[A-Za-z]{3}$/),
      amount: z.number().int().min(0).max(2000000000),
    })
      .passthrough()
      .parse(input);
    const perform = async (tx: Prisma.TransactionClient): Promise<any> => {
      const previous = await tx.payment.findUnique({
        where: { gateway_externalId: { gateway: input.gateway, externalId: input.paymentId } },
      });
      if (previous && previous.invoiceId !== input.invoiceId)
        throw new ConflictException(
          'This payment reference is already assigned to another invoice',
        );
      if (
        previous &&
        (input.gateway !== 'wallet' || input.strictIdempotency) &&
        (previous.amount !== input.amount || previous.currency !== input.currency.toUpperCase())
      )
        throw new ConflictException('Payment reference reused with a different amount or currency');
      const seen = await tx.paymentEvent.findUnique({
        where: { gateway_externalId: { gateway: input.gateway, externalId: input.eventId } },
      });
      if (seen) {
        if (input.gateway === 'manual' && !previous)
          throw new ConflictException('This bank transaction has already funded a wallet');
        return { duplicate: true };
      }
      const invoice = await tx.invoice.findUnique({
        where: { id: input.invoiceId },
        include: {
          service: { include: { product: true } },
          linkedServices: { include: { service: { include: { product: true } } } },
        },
      });
      if (!invoice) throw new BadRequestException('Payment references an unknown invoice');
      if ((invoice.service?.provider === 'demo-game') !== (input.gateway === 'demo'))
        throw new BadRequestException('Demo completion and real payments must remain separate');
      if (invoice.currency !== input.currency.toUpperCase())
        throw new BadRequestException('Payment currency does not match the invoice');
      if (input.gateway === 'wallet' && invoice.kind === 'WALLET_FUNDING')
        throw new ConflictException('Wallet funding invoices cannot be paid from a wallet');
      if (previous) {
        await tx.paymentEvent.create({
          data: { gateway: input.gateway, externalId: input.eventId },
        });
        return { duplicate: true };
      }
      if (input.gateway === 'wallet' && invoice.status === 'PAID') return { duplicate: true };
      const zero = input.gateway === 'promotion' && invoice.amount === 0 && input.amount === 0;
      if (
        !Number.isSafeInteger(input.amount) ||
        (!zero && input.amount <= 0) ||
        input.amount > 2000000000
      )
        throw new BadRequestException('Invalid payment amount');
      if (input.gateway === 'promotion' && !zero)
        throw new BadRequestException('Promotion payments require a zero-value invoice');
      if (input.gateway === 'demo' && input.amount !== invoice.amount)
        throw new BadRequestException('Demo amount does not match the invoice');
      const blocked = invoicePaymentBlocked(invoice),
        remaining = remainingBalance(invoice);
      if (
        (blocked || invoice.status === 'PAID') &&
        ['wallet', 'promotion', 'demo'].includes(input.gateway)
      )
        throw new ConflictException('This invoice cannot be paid after cancellation');
      if (input.gateway === 'wallet') {
        if (input.walletUserId !== invoice.userId)
          throw new BadRequestException('Pay only your own invoice from your wallet');
        if (input.amount > remaining)
          throw new ConflictException(
            'The remaining balance changed. Refresh the invoice before paying.',
          );
        const wallet = await tx.wallet.findUnique({
          where: { userId_currency: { userId: invoice.userId, currency: invoice.currency } },
        });
        if (!wallet) throw new ConflictException('Wallet unavailable or currency mismatch');
        const debit = await tx.wallet.updateMany({
          where: { id: wallet.id, balance: { gte: input.amount } },
          data: { balance: { decrement: input.amount } },
        });
        if (!debit.count) throw new ConflictException('Insufficient wallet balance');
        const updated = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
        await tx.walletEntry.create({
          data: {
            walletId: wallet.id,
            amount: -input.amount,
            balanceAfter: updated.balance,
            kind: 'INVOICE',
            reference: `payment-${input.gateway}-${input.paymentId}`,
            description: `Payment for ${invoice.number || `INV-${invoice.id.slice(0, 8).toUpperCase()}`}`,
          },
        });
      }
      const applied = blocked || invoice.status === 'PAID' ? 0 : Math.min(input.amount, remaining),
        excess = input.amount - applied;
      const reviewRequired = blocked || excess > 0;
      const reviewReason = blocked
        ? 'Payment received for a void invoice or a cancelled service period'
        : excess > 0
          ? invoice.status === 'PAID'
            ? 'Additional charge against an already paid invoice'
            : 'Payment exceeds the remaining balance; excess requires reconciliation'
          : null;
      await tx.paymentEvent.create({ data: { gateway: input.gateway, externalId: input.eventId } });
      await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          gateway: input.gateway,
          externalId: input.paymentId,
          amount: input.amount,
          appliedAmount: applied,
          currency: invoice.currency,
          reviewRequired,
          reviewReason,
        },
      });
      if (reviewRequired)
        await tx.auditLog.create({
          data: {
            action: blocked
              ? 'payment.cancelled-service-review-required'
              : 'payment.extra-charge-review-required',
            targetId: invoice.id,
            details: {
              gateway: input.gateway,
              paymentId: input.paymentId,
              amount: input.amount,
              appliedAmount: applied,
            },
          },
        });
      if (blocked || invoice.status === 'PAID') return { received: true, reviewRequired: true };
      const paidAmount = invoice.paidAmount + applied,
        paid = paidAmount === invoice.amount;
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { paidAmount, ...(paid ? { status: 'PAID', paidAt: new Date() } : {}) },
      });
      if (!paid) {
        await tx.auditLog.create({
          data: {
            action: 'invoice.part-paid',
            targetId: invoice.id,
            details: {
              gateway: input.gateway,
              amount: applied,
              remaining: invoice.amount - paidAmount,
            },
          },
        });
        return {
          paid: false,
          partial: true,
          remaining: invoice.amount - paidAmount,
          invoiceId: invoice.id,
        };
      }
      if (invoice.kind === 'WALLET_FUNDING') {
        const funding = await creditFunding(tx, invoice.id);
        if (!funding.credited) {
          await tx.auditLog.create({
            data: {
              action: 'invoice.paid',
              targetId: invoice.id,
              details: {
                gateway: input.gateway,
                amount: input.amount,
                kind: invoice.kind,
                fundingHeld: true,
              },
            },
          });
          return {
            paid: true,
            invoiceId: invoice.id,
            kind: invoice.kind,
            reviewRequired: true,
            funding,
          };
        }
      } else {
        const services = invoice.service
          ? [invoice.service]
          : invoice.linkedServices.map((link) => link.service);
        for (const service of services) {
          if (service.userId !== invoice.userId)
            throw new ConflictException('Checkout service ownership mismatch');
          await tx.couponRedemption.updateMany({
            where: { orderId: service.orderId, state: 'RESERVED' },
            data: { state: 'REDEEMED' },
          });
          const contract =
            (service.metadata as any).billingContract || baseContract(service.product);
          const periodEnd =
            contract.type === 'RECURRING' && input.gateway !== 'demo'
              ? calculateDueDate(invoice.periodStart, contract)
              : null;
          await tx.service.update({
            where: { id: service.id },
            data: {
              nextDueAt: !periodEnd
                ? null
                : service.nextDueAt && service.nextDueAt > periodEnd
                  ? service.nextDueAt
                  : periodEnd,
            },
          });
          const settings = await tx.setting.findUniqueOrThrow({ where: { id: 'installation' } });
          const otherOverdue =
            service.status === 'SUSPENDED'
              ? await tx.invoice.count({
                  where: {
                    ...serviceInvoiceWhere(service.id),
                    status: 'UNPAID',
                    id: { not: invoice.id },
                    dueAt: { lt: new Date(Date.now() - settings.graceDays * 86400000) },
                  },
                })
              : 0;
          if (['PENDING', 'FAILED', 'SUSPENDED'].includes(service.status) && !otherOverdue) {
            const action = service.status === 'SUSPENDED' ? 'unsuspend' : 'provision';
            const key =
              invoice.kind === 'CART'
                ? `invoice-${invoice.id}-${service.id}`
                : `invoice-${invoice.id}`;
            await tx.operation.upsert({
              where: { idempotencyKey: key },
              create: { serviceId: service.id, action, idempotencyKey: key },
              update: {},
            });
          }
        }
      }
      await tx.auditLog.create({
        data: {
          action: 'invoice.paid',
          targetId: invoice.id,
          details: { gateway: input.gateway, amount: input.amount, kind: invoice.kind },
        },
      });
      await queueInvoiceDelivery(tx, invoice.id, 'PAID');
      return {
        paid: true,
        invoiceId: invoice.id,
        kind: invoice.kind,
        ...(reviewRequired ? { reviewRequired: true } : {}),
      };
    };
    const result: any = transaction ? await perform(transaction) : await serial(this.db, perform);
    if (!transaction && 'paid' in result && result.paid && input.gateway !== 'demo')
      await this.extensions.emit('invoice.paid', {
        invoiceId: input.invoiceId,
        kind: 'kind' in result ? result.kind : undefined,
      });
    return result;
  }
  async reviewQueue() {
    return this.db.payment.findMany({
      where: { reviewRequired: true },
      include: {
        invoice: {
          select: {
            id: true,
            number: true,
            kind: true,
            description: true,
            status: true,
            user: { select: { name: true, email: true } },
            service: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ reviewedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 200,
    });
  }
  async resolveReview(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({ resolution: z.string().trim().min(10).max(3000) })
      .strict()
      .parse(input);
    return serial(this.db, async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id } });
      if (!payment?.reviewRequired) throw new NotFoundException('Review payment not found');
      if (payment.reviewedAt) throw new ConflictException('This payment has already been reviewed');
      const result = await tx.payment.update({
        where: { id },
        data: { reviewedAt: new Date(), reviewedById: actor.id, reviewResolution: d.resolution },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'payment.review.resolved',
          targetId: payment.invoiceId,
          details: { paymentId: id, resolution: d.resolution },
        },
      });
      return result;
    });
  }
  async verifyCapture(checkout: any, amount: number, currency: string) {
    z.object({
      amount: z.number().int().min(1).max(2000000000),
      currency: z.string().regex(/^[A-Za-z]{3}$/),
    }).parse({ amount, currency });
    const invoice = await this.db.invoice.findUniqueOrThrow({ where: { id: checkout.invoiceId } });
    if (
      amount !== (checkout.amount ?? invoice.amount) ||
      currency.toUpperCase() !== (checkout.currency || invoice.currency)
    )
      throw new BadRequestException('Captured amount or currency does not match the checkout');
  }
  async stripeWebhook(raw: Buffer, signature: string) {
    const c = stripeConfig(await this.extensions.configuration('stripe'));
    if (!c.secretKey || !c.webhookSecret)
      throw new BadRequestException('Stripe webhook is not configured');
    let event: Stripe.Event;
    try {
      event = new Stripe(c.secretKey).webhooks.constructEvent(raw, signature, c.webhookSecret);
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === 'paid') {
        const checkout = await this.db.checkout.findUnique({ where: { externalId: session.id } });
        if (
          !checkout ||
          checkout.gateway !== 'stripe' ||
          checkout.invoiceId !== session.metadata?.invoiceId
        )
          throw new BadRequestException('Unknown Stripe checkout');
        const paymentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id;
        if (!paymentId) throw new BadRequestException('Missing Stripe payment intent');
        await this.verifyCapture(checkout, session.amount_total!, session.currency!);
        return this.settle({
          gateway: 'stripe',
          eventId: event.id,
          paymentId,
          invoiceId: checkout.invoiceId,
          amount: session.amount_total!,
          currency: session.currency!,
        });
      }
    }
    return { received: true };
  }
  async paypalWebhook(req: Request) {
    const c = paypalConfig(await this.extensions.configuration('paypal'));
    if (!c.webhookId) throw new BadRequestException('PayPal webhook is not configured');
    const token = await paypalToken(c);
    const verification = await requestJson(
      `${paypalOrigin(c)}/v1/notifications/verify-webhook-signature`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_algo: req.get('paypal-auth-algo'),
          cert_url: req.get('paypal-cert-url'),
          transmission_id: req.get('paypal-transmission-id'),
          transmission_sig: req.get('paypal-transmission-sig'),
          transmission_time: req.get('paypal-transmission-time'),
          webhook_id: c.webhookId,
          webhook_event: req.body,
        }),
      },
    );
    if (verification.verification_status !== 'SUCCESS')
      throw new BadRequestException('Invalid PayPal webhook signature');
    const event = req.body;
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
      const checkout = await this.db.checkout.findUnique({ where: { externalId: orderId || '' } });
      if (!checkout || checkout.gateway !== 'paypal')
        throw new BadRequestException('Unknown PayPal checkout');
      z.object({
        id: z.string().min(1),
        amount: z.object({
          value: z.string().max(40),
          currency_code: z.string().regex(/^[A-Za-z]{3}$/),
        }),
      })
        .passthrough()
        .parse(event.resource);
      const currency = event.resource.amount.currency_code;
      await this.verifyCapture(
        checkout,
        minorUnits(event.resource.amount.value, currency),
        currency,
      );
      return this.settle({
        gateway: 'paypal',
        eventId: event.id,
        paymentId: event.resource.id,
        invoiceId: checkout.invoiceId,
        amount: minorUnits(event.resource.amount.value, currency),
        currency,
      });
    }
    return { received: true };
  }
  async capturePayPal(invoiceId: string, orderId?: string) {
    const checkout = await this.db.checkout.findFirst({
      where: { invoiceId, gateway: 'paypal', ...(orderId ? { externalId: orderId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    if (!checkout) throw new NotFoundException('PayPal checkout not found');
    const c = paypalConfig(await this.extensions.configuration('paypal'));
    const token = await paypalToken(c);
    const result = await requestJson(
      `${paypalOrigin(c)}/v2/checkout/orders/${encodeURIComponent(checkout.externalId)}/capture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': createHash('sha256')
            .update(`capture:${checkout.externalId}`)
            .digest('hex')
            .slice(0, 32),
        },
        body: '{}',
      },
    );
    const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
    if (result.status !== 'COMPLETED' || capture?.status !== 'COMPLETED')
      throw new ConflictException('PayPal payment is not complete');
    z.object({
      id: z.string().min(1),
      amount: z.object({
        value: z.string().max(40),
        currency_code: z.string().regex(/^[A-Za-z]{3}$/),
      }),
    })
      .passthrough()
      .parse(capture);
    await this.verifyCapture(
      checkout,
      minorUnits(capture.amount.value, capture.amount.currency_code),
      capture.amount.currency_code,
    );
    return this.settle({
      gateway: 'paypal',
      eventId: `capture-${capture.id}`,
      paymentId: capture.id,
      invoiceId,
      amount: minorUnits(capture.amount.value, capture.amount.currency_code),
      currency: capture.amount.currency_code,
    });
  }
}
export function minorUnits(value: string, currency: string) {
  const decimals = ['JPY', 'KRW', 'VND'].includes(currency) ? 0 : 2;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new BadRequestException('Invalid payment amount');
  const amount = Number(value) * 10 ** decimals;
  if (!Number.isSafeInteger(Math.round(amount)) || Math.abs(amount - Math.round(amount)) > 1e-6)
    throw new BadRequestException('Invalid currency precision');
  return Math.round(amount);
}
