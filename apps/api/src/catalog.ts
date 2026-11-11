import { Injectable, Inject, ConflictException, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db';
import { serial } from './transactions';
import type { Actor } from './auth';

const categorySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    description: z.string().max(2000).default(''),
    active: z.boolean().default(true),
    position: z.number().int().min(0).max(10000).default(0),
    parentId: z.string().uuid().nullable().default(null),
  })
  .strict();

type Category = { id: string; active: boolean; parentId: string | null };
export function visibleCategories(categories: Category[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return new Set(
    categories
      .filter((category) => {
        let current: Category | undefined = category;
        const seen = new Set<string>();
        while (current) {
          if (!current.active || seen.has(current.id)) return false;
          seen.add(current.id);
          if (!current.parentId) return true;
          current = byId.get(current.parentId);
        }
        return false;
      })
      .map((c) => c.id),
  );
}
export async function assertPurchasable(db: any, product: any, userId: string) {
  if (product.catalogCategoryId) {
    const visible = visibleCategories(await db.catalogCategory.findMany());
    if (!visible.has(product.catalogCategoryId))
      throw new ConflictException('This category is unavailable');
  }
  if (product.stock !== null && product.stock !== undefined) {
    const count = await db.service.count({
      where: { productId: product.id, status: { not: 'TERMINATED' } },
    });
    if (count >= product.stock) throw new ConflictException('This plan is sold out');
  }
  if (product.perCustomerLimit !== null && product.perCustomerLimit !== undefined) {
    const count = await db.service.count({
      where: { productId: product.id, userId, status: { not: 'TERMINATED' } },
    });
    if (count >= product.perCustomerLimit)
      throw new ConflictException('You have reached the purchase limit for this plan');
  }
}
@Injectable()
export class Catalog {
  constructor(@Inject(Db) private db: Db) {}
  async list(admin: boolean) {
    const rows = await this.db.catalogCategory.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    const visible = visibleCategories(rows);
    return admin ? rows : rows.filter((c) => visible.has(c.id));
  }
  async save(actor: Actor, input: unknown, id?: string) {
    const d = categorySchema.parse(input);
    return serial(this.db, async (tx) => {
      const rows = await tx.catalogCategory.findMany();
      if (id && !rows.some((c) => c.id === id)) throw new BadRequestException('Unknown category');
      if (d.parentId && !rows.some((c) => c.id === d.parentId))
        throw new BadRequestException('Unknown parent category');
      const key = id || '__new__';
      const next = [...rows.filter((c) => c.id !== id), { ...d, id: key }];
      const byId = new Map(next.map((c) => [c.id, c]));
      // Validate every branch: moving a parent can also make its descendants too deep.
      for (const category of next) {
        const seen = new Set<string>();
        let current: typeof category | undefined = category;
        while (current) {
          if (seen.has(current.id)) throw new ConflictException('A category cannot contain itself');
          seen.add(current.id);
          if (seen.size > 5) throw new ConflictException('Categories support up to five levels');
          current = current.parentId ? byId.get(current.parentId) : undefined;
        }
      }
      const result = id
        ? await tx.catalogCategory.update({ where: { id }, data: d })
        : await tx.catalogCategory.create({ data: d });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'catalog.category.saved', targetId: result.id },
      });
      return result;
    });
  }
}
