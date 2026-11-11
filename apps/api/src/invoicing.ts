import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Db, json } from './db';
import { serial } from './transactions';
import { invoiceSnapshot, billingAddressSchema, walletPolicy } from './billing';
import { calculateTax } from './taxes';
import { currencySchema } from './pricing';
import { issueInvoice, voidInvoices, creditFunding } from './invoice-issue';
import { Payments } from './payments';
import { Wallets } from './wallet';
import type { Actor } from './auth';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const adHocSchema = z
  .object({
    userId: z.string().uuid(),
    description: z.string().trim().min(3).max(2000),
    currency: currencySchema,
    dueAt: z.coerce.date(),
    items: z
      .array(
        z
          .object({
            description: z.string().trim().min(1).max(255),
            quantity: z.number().int().min(1).max(10000),
            unitAmount: z.number().int().min(0).max(100000000),
            taxable: z.boolean().default(true),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
async function compose(tx: any, d: z.infer<typeof adHocSchema>) {
  const customer = await tx.user.findFirst({ where: { id: d.userId, role: 'CUSTOMER' } });
  if (!customer) throw new NotFoundException('Customer not found');
  if (!billingAddressSchema.safeParse(customer.billingAddress).success)
    throw new BadRequestException('Add the customer billing address before issuing an invoice');
  const settings = await tx.setting.findUniqueOrThrow({ where: { id: 'installation' } });
  const lines = d.items.map((item) => ({
    name: item.description,
    kind: 'CUSTOM',
    quantity: item.quantity,
    unitAmount: item.unitAmount,
    amount: item.quantity * item.unitAmount,
    taxable: item.taxable,
  }));
  const subtotal = lines.reduce((n, l) => n + l.amount, 0),
    taxable = lines.filter((l) => l.taxable).reduce((n, l) => n + l.amount, 0);
  if (subtotal > 100000000)
    throw new BadRequestException('Invoice total exceeds the supported limit');
  const tax = await calculateTax(tx, settings, customer, taxable, settings.taxInclusive, true),
    total = tax.total + (subtotal - taxable);
  const billingSnapshot = {
    ...invoiceSnapshot(settings, customer),
    pricing: {
      subtotal,
      discount: 0,
      lines,
      tax: {
        ...tax,
        net: tax.net + (subtotal - taxable),
        total,
        nonTaxableSubtotal: subtotal - taxable,
      },
    },
  };
  return { total, billingSnapshot, quoteId: hash({ request: d, billingSnapshot }) };
}
@Injectable()
export class Invoicing {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Payments) private payments: Payments,
    @Inject(Wallets) private wallets: Wallets,
  ) {}
  async quote(actor: Actor, input: unknown) {
    const d = adHocSchema.parse(input);
    return compose(this.db, d);
  }
  async create(actor: Actor, input: unknown) {
    const { idempotencyKey, expectedQuoteId, ...d } = adHocSchema
      .extend({
        idempotencyKey: z.string().uuid(),
        expectedQuoteId: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .parse(input);
    const fingerprint = hash({ d, expectedQuoteId }),
      requestKey = `adhoc-${actor.id}-${idempotencyKey}`;
    const invoice = await serial(this.db, async (tx) => {
      const existing = await tx.invoice.findUnique({ where: { requestKey } });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint)
          throw new ConflictException('This request key was used for another invoice');
        return existing;
      }
      const quote = await compose(tx, d);
      if (expectedQuoteId && quote.quoteId !== expectedQuoteId)
        throw new ConflictException(
          'Invoice quote changed. Review the updated total before issuing.',
        );
      const result = await issueInvoice(tx, {
        userId: d.userId,
        kind: 'ADHOC',
        description: d.description,
        amount: quote.total,
        currency: d.currency,
        dueAt: d.dueAt,
        periodStart: new Date(),
        requestKey,
        requestFingerprint: fingerprint,
        billingSnapshot: quote.billingSnapshot,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'invoice.issued',
          targetId: result.id,
          details: { kind: 'ADHOC', amount: quote.total, currency: d.currency },
        },
      });
      return result;
    });
    if (invoice.amount === 0 && invoice.status === 'UNPAID')
      await this.payments.settle({
        gateway: 'promotion',
        eventId: `promotion-${invoice.id}`,
        paymentId: `promotion-${invoice.id}`,
        invoiceId: invoice.id,
        amount: 0,
        currency: invoice.currency,
      });
    return invoice;
  }
  async fund(actor: Actor, input: unknown) {
    const d = z
      .object({
        amount: z.number().int().min(1).max(100000000),
        currency: currencySchema.optional(),
        idempotencyKey: z.string().uuid(),
      })
      .strict()
      .parse(input);
    const requestKey = `funding-${actor.id}-${d.idempotencyKey}`;
    const previous = await this.db.invoice.findUnique({ where: { requestKey } });
    if (previous) {
      if (previous.amount !== d.amount || (d.currency && previous.currency !== d.currency))
        throw new ConflictException('This request key was used for another deposit');
      return previous;
    }
    const summary = await this.wallets.summary(actor.id, d.currency),
      currency = summary.currency;
    return serial(this.db, async (tx) => {
      const prior = await tx.invoice.findUnique({ where: { requestKey } });
      if (prior) {
        if (prior.amount !== d.amount || prior.currency !== currency)
          throw new ConflictException('This request key was used for another deposit');
        return prior;
      }
      const settings = await tx.setting.findUniqueOrThrow({ where: { id: 'installation' } }),
        policy = walletPolicy(settings);
      if (!policy.depositsEnabled) throw new ConflictException('Wallet deposits are disabled');
      if (d.amount < policy.minDeposit || d.amount > policy.maxDeposit)
        throw new BadRequestException('Deposit amount is outside the configured limits');
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: summary.id } });
      const pending = await tx.invoice.findMany({
        where: { userId: actor.id, kind: 'WALLET_FUNDING', currency, status: 'UNPAID' },
        select: { amount: true, paidAmount: true },
      });
      if (wallet.balance + pending.reduce((n, i) => n + i.amount, 0) + d.amount > policy.maxBalance)
        throw new ConflictException(
          'Existing funding invoices and this deposit exceed the wallet balance limit',
        );
      const customer = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
      if (!billingAddressSchema.safeParse(customer.billingAddress).success)
        throw new BadRequestException('Add your billing address before creating a funding invoice');
      const invoice = await issueInvoice(tx, {
        userId: actor.id,
        kind: 'WALLET_FUNDING',
        description: `Wallet funding (${currency})`,
        amount: d.amount,
        currency,
        dueAt: new Date(Date.now() + 86400000),
        periodStart: new Date(),
        requestKey,
        requestFingerprint: hash({ amount: d.amount, currency }),
        billingSnapshot: {
          ...invoiceSnapshot(settings, customer),
          pricing: {
            subtotal: d.amount,
            discount: 0,
            lines: [
              {
                name: 'Wallet funding',
                kind: 'FUNDING',
                quantity: 1,
                unitAmount: d.amount,
                amount: d.amount,
                taxable: false,
              },
            ],
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'wallet.funding.requested',
          targetId: invoice.id,
          details: { amount: d.amount, currency },
        },
      });
      return invoice;
    });
  }
  async void(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({ reason: z.string().trim().min(5).max(1000) })
      .strict()
      .parse(input);
    return serial(this.db, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          id,
          ...(actor.role === 'ADMIN' ? {} : { userId: actor.id, kind: 'WALLET_FUNDING' }),
        },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.kind === 'CART')
        throw new ConflictException(
          'Cancel this checkout to release all of its service reservations',
        );
      if (invoice.kind === 'HOSTING')
        throw new ConflictException('Use the service cancellation workflow for hosting invoices');
      if (invoice.status !== 'UNPAID')
        throw new ConflictException('Only unpaid invoices can be voided');
      if (actor.role !== 'ADMIN' && invoice.paidAmount > 0)
        throw new ConflictException('Contact staff to reconcile a part-paid funding invoice');
      await voidInvoices(tx, { id }, d.reason);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'invoice.voided',
          targetId: id,
          details: { reason: d.reason },
        },
      });
      return tx.invoice.findUniqueOrThrow({ where: { id } });
    });
  }
  async retryCredit(actor: Actor, id: string) {
    return serial(this.db, async (tx) => {
      const result = await creditFunding(tx, id, actor.id);
      if (!result.credited) throw new ConflictException(result.reason);
      return result;
    });
  }
}
