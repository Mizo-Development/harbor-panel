import { z } from 'zod';
export const currencySchema = z.enum([
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'JPY',
  'BRL',
  'INR',
]);
export const pricingRegionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    country: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .transform((v) => v.toUpperCase()),
    currency: currencySchema,
    active: z.boolean().default(true),
  })
  .strict();
export async function customerRegion(db: any, settings: any, userId?: string) {
  if (!settings.regionalPricingEnabled || !userId) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { billingAddress: true },
  });
  const country = String(user?.billingAddress?.country || '').toUpperCase();
  return db.pricingRegion.findFirst({ where: { country, active: true } });
}
export async function quoteProduct(db: any, settings: any, product: any, userId?: string) {
  const region = await customerRegion(db, settings, userId);
  const override = region
    ? await db.regionalPrice.findUnique({
        where: { productId_regionId: { productId: product.id, regionId: region.id } },
      })
    : null;
  return override
    ? {
        amount: override.amount,
        setupFee: override.setupFee,
        currency: region.currency,
        regionId: region.id,
        regional: true,
      }
    : {
        amount: product.price,
        setupFee: product.setupFee || 0,
        currency: settings.currency,
        regionId: null,
        regional: false,
      };
}
