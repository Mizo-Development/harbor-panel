import { Injectable, Inject, BadRequestException, ConflictException } from '@nestjs/common';
import { z } from 'zod';
import { Db, json } from './db';
import { serial } from './transactions';
import { currencySchema } from './pricing';
import type { Actor } from './auth';
export const couponCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,40}$/);
const schema = z
  .object({
    code: couponCode,
    description: z.string().max(500).default(''),
    active: z.boolean().default(true),
    type: z.enum(['PERCENT', 'FIXED']),
    value: z.number().int().positive().max(100000000),
    currency: currencySchema.nullable().default(null),
    recurring: z.boolean().default(false),
    firstPurchaseOnly: z.boolean().default(false),
    startsAt: z.coerce.date().nullable().default(null),
    endsAt: z.coerce.date().nullable().default(null),
    maxUses: z.number().int().min(1).max(1000000).nullable().default(null),
    perCustomerLimit: z.number().int().min(1).max(100000).default(1),
    countries: z
      .array(
        z
          .string()
          .regex(/^[A-Za-z]{2}$/)
          .transform((s) => s.toUpperCase()),
      )
      .max(250)
      .default([]),
    productIds: z.array(z.string().uuid()).max(500).default([]),
  })
  .strict()
  .refine((c) => c.type !== 'PERCENT' || c.value <= 10000, 'Percent discounts cannot exceed 100%')
  .refine((c) => c.type !== 'FIXED' || !!c.currency, 'Fixed discounts require a currency')
  .refine(
    (c) => !c.startsAt || !c.endsAt || c.startsAt < c.endsAt,
    'Expiry must be after the start date',
  );
@Injectable()
export class Coupons {
  constructor(@Inject(Db) private db: Db) {}
  async list() {
    return this.db.coupon.findMany({
      include: {
        products: { select: { productId: true } },
        _count: { select: { redemptions: { where: { state: { not: 'RELEASED' } } } } },
      },
      orderBy: { code: 'asc' },
    });
  }
  async save(actor: Actor, input: unknown, id?: string) {
    const d = schema.parse(input),
      { productIds, ...fields } = d;
    return serial(this.db, async (tx) => {
      const result = id
        ? await tx.coupon.update({
            where: { id },
            data: { ...fields, countries: json(fields.countries) },
          })
        : await tx.coupon.create({ data: { ...fields, countries: json(fields.countries) } });
      await tx.couponProduct.deleteMany({ where: { couponId: result.id } });
      if (productIds.length)
        await tx.couponProduct.createMany({
          data: [...new Set(productIds)].map((productId) => ({ couponId: result.id, productId })),
        });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'coupon.saved', targetId: result.id },
      });
      return result;
    });
  }
}
export async function applyCoupon(
  db: any,
  code: string | undefined,
  userId: string,
  product: any,
  quote: { amount: number; currency: string },
  ignoredOrderIds: string[] = [],
) {
  if (!code)
    return { discount: 0, total: quote.amount, recurringAmount: quote.amount, coupon: null };
  if (product.provider === 'demo-game')
    throw new BadRequestException('Coupons do not apply to demo orders');
  const coupon = await db.coupon.findUnique({
      where: { code: couponCode.parse(code) },
      include: { products: true },
    }),
    now = new Date();
  if (
    !coupon ||
    !coupon.active ||
    (coupon.startsAt && coupon.startsAt > now) ||
    (coupon.endsAt && coupon.endsAt < now)
  )
    throw new ConflictException('This coupon is unavailable or expired');
  if (coupon.products.length && !coupon.products.some((p: any) => p.productId === product.id))
    throw new BadRequestException('This coupon does not apply to the selected plan');
  if (coupon.type === 'FIXED' && coupon.currency !== quote.currency)
    throw new BadRequestException('This coupon is for a different currency');
  if (coupon.countries.length) {
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { billingAddress: true },
    });
    if (!coupon.countries.includes(user.billingAddress.country))
      throw new BadRequestException('This coupon is not available in your billing country');
  }
  if (
    coupon.firstPurchaseOnly &&
    (await db.order.count({
      where: {
        userId,
        ...(ignoredOrderIds.length ? { id: { notIn: ignoredOrderIds } } : {}),
        service: { provider: { not: 'demo-game' }, status: { not: 'TERMINATED' } },
      },
    }))
  )
    throw new BadRequestException('This coupon is only for a first purchase');
  const used = { couponId: coupon.id, state: { not: 'RELEASED' } };
  if (coupon.maxUses && (await db.couponRedemption.count({ where: used })) >= coupon.maxUses)
    throw new ConflictException('This coupon has reached its usage limit');
  if ((await db.couponRedemption.count({ where: { ...used, userId } })) >= coupon.perCustomerLimit)
    throw new ConflictException('You have already used this coupon');
  const discount = Math.min(
      quote.amount,
      coupon.type === 'PERCENT' ? Math.round((quote.amount * coupon.value) / 10000) : coupon.value,
    ),
    total = quote.amount - discount;
  return { discount, total, recurringAmount: coupon.recurring ? total : quote.amount, coupon };
}
