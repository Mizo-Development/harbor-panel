import {
  Injectable,
  Inject,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Db, json } from './db';
import { Platform, orderInputSchema } from './platform';
import { Payments } from './payments';
import { serial } from './transactions';
import { issueInvoice } from './invoice-issue';
import { finalizeTermination } from './cancellations';
import { taxAmounts } from './taxes';
import type { Actor } from './auth';
const entrySchema = orderInputSchema
  .omit({
    idempotencyKey: true,
    expectedQuoteId: true,
    expectedTotal: true,
    expectedCurrency: true,
  })
  .strict();
const fingerprint = (data: unknown) =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex');
const quoteInput = (item: any) => ({
  productId: item.productId,
  planId: item.planId,
  options: item.options,
  couponCode: item.couponCode,
});
function splitAmount(amount: number, weights: number[]) {
  const total = weights.reduce((sum, n) => sum + BigInt(n), 0n);
  if (!total) return weights.map(() => 0);
  const parts = weights.map((n, index) => ({
    index,
    amount: Number((BigInt(amount) * BigInt(n)) / total),
    remainder: (BigInt(amount) * BigInt(n)) % total,
  }));
  let remaining = amount - parts.reduce((sum, p) => sum + p.amount, 0);
  for (const part of [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (!remaining--) break;
    part.amount++;
  }
  return parts.map((p) => p.amount);
}
@Injectable()
export class Carts {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Platform) private platform: Platform,
    @Inject(Payments) private payments: Payments,
  ) {}
  async current(actor: Actor) {
    const cart = await this.db.cart.findFirst({ where: { userId: actor.id, status: 'OPEN' } });
    return cart
      ? this.quote(actor, cart)
      : { id: null, version: 0, items: [], ready: false, total: 0, currency: null };
  }
  async add(actor: Actor, input: unknown) {
    const d = z
      .object({ item: entrySchema, expectedVersion: z.number().int().min(0) })
      .strict()
      .parse(input);
    const product = await this.db.product.findUnique({ where: { id: d.item.productId } });
    if (!product || product.provider === 'demo-game')
      throw new BadRequestException('Choose a real hosting plan for the cart');
    await this.platform.orderQuote(actor, quoteInput(d.item));
    const cart = await serial(this.db, async (tx) => {
      const current = await tx.cart.findFirst({ where: { userId: actor.id, status: 'OPEN' } });
      if ((current?.version || 0) !== d.expectedVersion)
        throw new ConflictException('Your cart changed. Refresh it before adding another item.');
      const items = (current?.items || []) as any[];
      if (items.length >= 10)
        throw new ConflictException('A checkout can contain up to ten services');
      const updated = [...items, { id: randomUUID(), ...d.item }];
      return current
        ? tx.cart.update({
            where: { id: current.id },
            data: { items: json(updated), version: { increment: 1 } },
          })
        : tx.cart.create({ data: { userId: actor.id, items: json(updated), version: 1 } });
    });
    return this.quote(actor, cart);
  }
  async edit(actor: Actor, id: string, input: unknown, remove = false) {
    const d = z
      .object({
        cartId: z.string().uuid(),
        expectedVersion: z.number().int().min(0),
        item: entrySchema.optional(),
      })
      .strict()
      .parse(input);
    const cart = await serial(this.db, async (tx) => {
      const current = await tx.cart.findFirst({
        where: { id: d.cartId, userId: actor.id, status: 'OPEN' },
      });
      if (!current) throw new NotFoundException('Cart not found');
      if (current.version !== d.expectedVersion)
        throw new ConflictException('Your cart changed. Refresh before editing it.');
      const items = current.items as any[];
      if (!items.some((item) => item.id === id)) throw new NotFoundException('Cart item not found');
      if (!remove && !d.item) throw new BadRequestException('Supply the updated item');
      return tx.cart.update({
        where: { id: current.id },
        data: {
          items: json(
            remove
              ? items.filter((item) => item.id !== id)
              : items.map((item) => (item.id === id ? { ...d.item, id } : item)),
          ),
          version: { increment: 1 },
        },
      });
    });
    return this.quote(actor, cart);
  }
  private async quote(actor: Actor, cart: any) {
    const items: any[] = [],
      errors: string[] = [];
    const requirements: { connectionId: string; kind: string; pool?: string }[] = [];
    for (const item of cart.items as any[]) {
      const product = await this.db.product.findUnique({
        where: { id: item.productId },
        select: {
          id: true,
          name: true,
          provider: true,
          category: true,
          stock: true,
          perCustomerLimit: true,
          connectionId: true,
        },
      });
      try {
        if (!product || product.provider === 'demo-game')
          throw new BadRequestException('This plan is no longer available');
        if (product.category === 'web' && !item.domain)
          throw new BadRequestException('Enter a domain for this web hosting item');
        if (product.provider === 'proxmox' && !item.sshKey)
          throw new BadRequestException('Enter an SSH public key for this VPS');
        const quote = await this.platform.orderQuote(actor, quoteInput(item));
        if (product.connectionId && ['wings', 'proxmox'].includes(product.provider))
          requirements.push({
            connectionId: product.connectionId,
            kind: product.provider === 'wings' ? 'allocation' : 'ip',
            ...(product.provider === 'proxmox' && quote.spec.ipPool
              ? { pool: String(quote.spec.ipPool) }
              : {}),
          });
        items.push({ ...item, name: product.name, quote });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'This item is unavailable';
        errors.push(message);
        items.push({ ...item, name: product?.name || 'Unavailable plan', error: message });
      }
    }
    if (requirements.length) {
      const resources = await this.db.resource.findMany({
          where: {
            serviceId: null,
            connectionId: { in: [...new Set(requirements.map((r) => r.connectionId))] },
          },
          orderBy: { id: 'asc' },
        }),
        used = new Set<string>();
      for (const requirement of [...requirements].sort(
        (a, b) => Number(!!b.pool) - Number(!!a.pool),
      )) {
        const free = resources.find(
          (r) =>
            !used.has(r.id) &&
            r.connectionId === requirement.connectionId &&
            r.kind === requirement.kind &&
            (!requirement.pool || (r.config as any)?.pool === requirement.pool),
        );
        if (free) used.add(free.id);
        else
          errors.push(
            'Not enough hosting allocations are available for every item in this checkout',
          );
      }
    }
    const currencies = [...new Set(items.filter((i) => i.quote).map((i) => i.quote.currency))];
    if (currencies.length > 1)
      errors.push(
        'A checkout must use one currency. Purchase differently priced currencies separately.',
      );
    const domains = items.map((i) => i.domain).filter(Boolean);
    if (new Set(domains).size !== domains.length)
      errors.push('Each hosting service must use a unique domain');
    const products = new Map<string, number>();
    for (const item of items) products.set(item.productId, (products.get(item.productId) || 0) + 1);
    for (const [productId, count] of products) {
      const product = await this.db.product.findUnique({ where: { id: productId } });
      if (!product) continue;
      const where = { productId, status: { not: 'TERMINATED' as const } };
      if (
        product.stock !== null &&
        (await this.db.service.count({ where })) + count > product.stock
      )
        errors.push(`Not enough stock for ${product.name}`);
      if (
        product.perCustomerLimit !== null &&
        (await this.db.service.count({ where: { ...where, userId: actor.id } })) + count >
          product.perCustomerLimit
      )
        errors.push(`Purchase limit exceeded for ${product.name}`);
    }
    const coupons = new Map<string, number>();
    for (const item of items)
      if (item.couponCode) coupons.set(item.couponCode, (coupons.get(item.couponCode) || 0) + 1);
    for (const [code, count] of coupons) {
      const coupon = await this.db.coupon.findUnique({ where: { code } });
      if (!coupon) continue;
      const used = { couponId: coupon.id, state: { not: 'RELEASED' } };
      if (
        coupon.maxUses !== null &&
        (await this.db.couponRedemption.count({ where: used })) + count > coupon.maxUses
      )
        errors.push(`Coupon ${code} has insufficient uses remaining`);
      if (
        (await this.db.couponRedemption.count({ where: { ...used, userId: actor.id } })) + count >
        coupon.perCustomerLimit
      )
        errors.push(`Coupon ${code} exceeds your usage limit`);
    }
    const valid = items.filter((item) => item.quote),
      taxes = valid.map((item) => item.quote.tax),
      policy = taxes.find((t) => t.taxable) || taxes[0];
    const taxPolicies = new Set(
      taxes
        .filter((t) => t.taxable)
        .map((t) => JSON.stringify([t.basisPoints, t.inclusive, t.country, t.exempt, t.name])),
    );
    if (taxPolicies.size > 1) errors.push('Tax policy changed while quoting. Refresh your cart.');
    const taxable = valid.reduce(
      (sum, item) =>
        sum +
        (item.quote.tax.taxable ? (policy?.inclusive ? item.quote.total : item.quote.tax.net) : 0),
      0,
    );
    const computed = taxAmounts(taxable, policy?.basisPoints || 0, policy?.inclusive || false);
    const taxParts = splitAmount(
      computed.amount,
      valid.map((item) => (item.quote.tax.taxable ? item.quote.tax.net : 0)),
    );
    valid.forEach((item, index) => {
      item.cartAmount =
        currencies.length > 1 || policy?.inclusive
          ? item.quote.total
          : item.quote.tax.net + taxParts[index];
    });
    const total = currencies.length > 1 ? 0 : valid.reduce((sum, item) => sum + item.cartAmount, 0);
    const tax =
      currencies.length > 1
        ? null
        : policy
          ? {
              ...policy,
              amount: computed.amount,
              net: total - computed.amount,
              total,
              taxable: taxes.some((t) => t.taxable),
            }
          : null;
    if (!Number.isSafeInteger(total) || total > 2000000000)
      errors.push('Checkout total exceeds the supported invoice limit');
    const quoteId = fingerprint({
      id: cart.id,
      version: cart.version,
      items: items.map(({ quote, error, ...item }) => ({
        ...item,
        quoteId: quote?.quoteId,
        error,
      })),
    });
    return {
      id: cart.id,
      version: cart.version,
      items,
      total,
      tax,
      currency: currencies[0] || null,
      quoteId,
      ready: items.length > 0 && errors.length === 0,
      errors: [...new Set(errors)],
    };
  }
  async checkout(actor: Actor, input: unknown) {
    const d = z
      .object({
        cartId: z.string().uuid(),
        expectedVersion: z.number().int().min(0),
        expectedQuoteId: z.string().regex(/^[a-f0-9]{64}$/),
        idempotencyKey: z.string().uuid(),
      })
      .strict()
      .parse(input);
    const requestFingerprint = fingerprint(d);
    const previous = await this.db.cart.findUnique({
      where: { userId_requestKey: { userId: actor.id, requestKey: d.idempotencyKey } },
    });
    if (previous) {
      if (previous.id !== d.cartId || previous.requestFingerprint !== requestFingerprint)
        throw new ConflictException('Checkout request key was reused with different items');
      return { invoiceId: previous.invoiceId, cartId: previous.id, status: previous.status };
    }
    const cart = await this.db.cart.findFirst({
      where: { id: d.cartId, userId: actor.id, status: 'OPEN' },
    });
    if (!cart) throw new NotFoundException('Cart not found');
    const quoted = await this.quote(actor, cart);
    if (!quoted.ready)
      throw new ConflictException(quoted.errors.join('. ') || 'Add an item before checking out');
    if (cart.version !== d.expectedVersion || quoted.quoteId !== d.expectedQuoteId)
      throw new ConflictException(
        'Your cart or its prices changed. Review the latest quote before checkout.',
      );
    const result = await serial(this.db, async (tx) => {
      const prior = await tx.cart.findUnique({
        where: { userId_requestKey: { userId: actor.id, requestKey: d.idempotencyKey } },
      });
      if (prior) {
        if (prior.id !== d.cartId || prior.requestFingerprint !== requestFingerprint)
          throw new ConflictException('Checkout request key was reused');
        return { invoiceId: prior.invoiceId!, cartId: prior.id, status: prior.status };
      }
      const current = await tx.cart.findFirst({
        where: { id: d.cartId, userId: actor.id, status: 'OPEN' },
      });
      if (!current) throw new ConflictException('This cart was already checked out');
      if (current.version !== d.expectedVersion)
        throw new ConflictException('Your cart changed before checkout');
      const byItem = new Map<string, any>();
      // Each reservation and coupon redemption remains inside this single transaction.
      for (const item of [...quoted.items].sort(
        (a, b) => Number(!!b.quote.spec?.ipPool) - Number(!!a.quote.spec?.ipPool),
      )) {
        const { id, name, quote, error, ...entry } = item;
        byItem.set(
          id,
          await this.platform.order(
            actor,
            {
              ...entry,
              idempotencyKey: id,
              expectedQuoteId: quote.quoteId,
              expectedTotal: quote.total,
              expectedCurrency: quote.currency,
            },
            tx,
            true,
            [...byItem.values()].map((order) => order.id),
          ),
        );
      }
      const created = quoted.items.map((item) => byItem.get(item.id));
      const drafts = created.map((order) => order.invoiceInput),
        pricing = drafts.map((draft) => draft.billingSnapshot.pricing),
        taxes = pricing.map((p) => p.tax);
      const taxed = taxes.find((t) => t.taxable) || taxes[0];
      const tax = quoted.tax;
      const invoice = await issueInvoice(tx, {
        kind: 'CART',
        userId: actor.id,
        description: `Hosting checkout · ${created.length} services`,
        amount: quoted.total,
        currency: quoted.currency,
        dueAt: drafts[0].dueAt,
        periodStart: new Date(),
        billingSnapshot: json({
          ...drafts[0].billingSnapshot,
          pricing: {
            subtotal: pricing.reduce((sum, p) => sum + p.subtotal, 0),
            setupFee: pricing.reduce((sum, p) => sum + (p.setupFee || 0), 0),
            discount: pricing.reduce((sum, p) => sum + p.discount, 0),
            couponCode: [...new Set(pricing.map((p) => p.couponCode).filter(Boolean))].join(', '),
            tax,
            lines: pricing.flatMap((p, index) =>
              p.lines.map((line: any) => ({
                ...line,
                name: `${quoted.items[index].name} · ${line.name}`,
                taxable: p.tax.taxable,
              })),
            ),
          },
        }),
      });
      await tx.invoiceService.createMany({
        data: created.map((order, index) => ({
          invoiceId: invoice.id,
          serviceId: order.serviceId,
          amount: quoted.items[index].cartAmount,
        })),
      });
      if (quoted.total === 0)
        await this.payments.settle(
          {
            gateway: 'promotion',
            eventId: `promotion-${invoice.id}`,
            paymentId: `promotion-${invoice.id}`,
            invoiceId: invoice.id,
            amount: 0,
            currency: invoice.currency,
          },
          tx,
        );
      await tx.cart.update({
        where: { id: current.id },
        data: {
          status: 'CHECKED_OUT',
          version: { increment: 1 },
          requestKey: d.idempotencyKey,
          requestFingerprint,
          invoiceId: invoice.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'cart.checked-out',
          targetId: current.id,
          details: { invoiceId: invoice.id, services: created.map((order) => order.serviceId) },
        },
      });
      return { invoiceId: invoice.id, cartId: current.id, status: 'CHECKED_OUT', created: true };
    });
    if (quoted.total === 0 && 'created' in result && result.created)
      await this.payments.announcePaid(result.invoiceId, 'CART');
    return result;
  }
  async cancel(actor: Actor, invoiceId: string, input: unknown) {
    const d = z
      .object({ reason: z.string().trim().min(5).max(1000) })
      .strict()
      .parse(input);
    return serial(this.db, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          id: invoiceId,
          kind: 'CART',
          ...(actor.role === 'ADMIN' ? {} : { userId: actor.id }),
        },
        include: { linkedServices: true },
      });
      if (!invoice) throw new NotFoundException('Checkout invoice not found');
      if (invoice.status === 'VOID') return { cancelled: true };
      if (invoice.status === 'PAID')
        throw new ConflictException('Paid services use their individual cancellation workflow');
      if (actor.role !== 'ADMIN' && invoice.paidAmount > 0)
        throw new ConflictException('Contact staff to reconcile this part-paid checkout');
      for (const link of invoice.linkedServices)
        await finalizeTermination(tx, link.serviceId, false, d.reason);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'cart.cancelled',
          targetId: invoiceId,
          details: { reason: d.reason },
        },
      });
      return { cancelled: true };
    });
  }
}
