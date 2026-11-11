import { Injectable, Inject } from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db';
import type { Actor } from './auth';
import { serial } from './transactions';
const schema = z
  .object({
    name: z.string().trim().min(1).max(100),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^(\*|[A-Z]{2})$/),
    basisPoints: z.number().int().min(0).max(10000),
    active: z.boolean().default(true),
  })
  .strict();

// Prices and tax are integer minor units. Round once per invoice, after discounts.
export function taxAmounts(amount: number, basisPoints: number, inclusive: boolean) {
  const tax = inclusive
    ? Math.round((amount * basisPoints) / (10000 + basisPoints))
    : Math.round((amount * basisPoints) / 10000);
  return {
    amount: tax,
    net: inclusive ? amount - tax : amount,
    total: inclusive ? amount : amount + tax,
  };
}
export async function calculateTax(
  db: any,
  settings: any,
  customer: any,
  amount: number,
  inclusive: boolean,
  taxable = true,
) {
  const country = String(customer.billingAddress?.country || '').toUpperCase();
  const rates =
    settings.taxEnabled && taxable && !customer.taxExempt
      ? await db.taxRate.findMany({ where: { active: true, country: { in: [country, '*'] } } })
      : [];
  const rate =
    rates.find((r: any) => r.country === country) || rates.find((r: any) => r.country === '*');
  const basisPoints = rate?.basisPoints || 0;
  return {
    ...taxAmounts(amount, basisPoints, inclusive),
    name: rate?.name || 'Tax',
    basisPoints,
    inclusive,
    country,
    exempt: !!customer.taxExempt,
    taxable,
  };
}
@Injectable()
export class Taxes {
  constructor(@Inject(Db) private db: Db) {}
  async list() {
    return this.db.taxRate.findMany({ orderBy: { country: 'asc' } });
  }
  async save(actor: Actor, input: unknown, id?: string) {
    const data = schema.parse(input);
    return serial(this.db, async (tx) => {
      const result = id
        ? await tx.taxRate.update({ where: { id }, data })
        : await tx.taxRate.create({ data });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'tax.rate.saved', targetId: result.id },
      });
      return result;
    });
  }
}
