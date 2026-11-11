import { z } from 'zod';
export const walletSettingsSchema = z
  .object({
    depositsEnabled: z.boolean().default(true),
    minDeposit: z.number().int().min(1).max(100000000).default(100),
    maxDeposit: z.number().int().min(1).max(100000000).default(100000),
    maxBalance: z.number().int().min(1).max(2000000000).default(1000000),
  })
  .strict()
  .refine(
    (v) => v.minDeposit <= v.maxDeposit && v.maxDeposit <= v.maxBalance,
    'Deposit limits must be ordered: minimum ≤ maximum ≤ balance limit',
  );
export function walletPolicy(settings: any) {
  return walletSettingsSchema.parse(settings.walletSettings || {});
}
export const billingAddressSchema = z
  .object({
    company: z.string().trim().max(100).default(''),
    taxId: z.string().trim().max(100).default(''),
    phone: z.string().trim().max(40).default(''),
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).default(''),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().max(100).default(''),
    postalCode: z.string().trim().min(1).max(30),
    country: z
      .string()
      .trim()
      .length(2)
      .transform((v) => v.toUpperCase()),
  })
  .strict();
export const companyBillingSchema = z
  .object({
    legalName: z.string().trim().max(150).default(''),
    email: z.union([z.email(), z.literal('')]).default(''),
    phone: z.string().trim().max(40).default(''),
    website: z.union([z.url(), z.literal('')]).default(''),
    taxId: z.string().trim().max(100).default(''),
    registrationNumber: z.string().trim().max(100).default(''),
    line1: z.string().trim().max(200).default(''),
    line2: z.string().trim().max(200).default(''),
    city: z.string().trim().max(100).default(''),
    state: z.string().trim().max(100).default(''),
    postalCode: z.string().trim().max(30).default(''),
    country: z.union([z.string().length(2), z.literal('')]).default(''),
    paymentInstructions: z.string().trim().max(2000).default(''),
    invoiceFooter: z.string().trim().max(1000).default(''),
  })
  .strict();
export function invoiceSnapshot(settings: any, user: any) {
  return {
    seller: { ...settings.companyBilling, companyName: settings.companyName },
    buyer: { ...user.billingAddress, name: user.name, email: user.email },
  };
}
