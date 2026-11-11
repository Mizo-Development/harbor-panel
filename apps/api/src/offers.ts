import { Injectable, Inject, BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { planSchema, hostnameSchema } from '@harbor/sdk';
import { Db, json } from './db';
import { serial } from './transactions';
import { customerRegion, quoteProduct, currencySchema } from './pricing';
import type { Actor } from './auth';

const amount = z.number().int().min(0).max(100000000);
export const cycleSchema = z.enum([
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
  'biennial',
  'one_time',
  'free',
]);
export const selectionsSchema = z
  .record(
    z.string().uuid(),
    z.union([z.string().max(2000), z.number().int().min(0).max(1000000), z.boolean()]),
  )
  .default({});
const priceSchema = z
  .object({
    planId: z.string().uuid().nullable().default(null),
    currency: currencySchema,
    amount,
    setupFee: amount.default(0),
  })
  .strict();
const choiceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
    name: z.string().trim().min(1).max(100),
    value: z.string().max(255),
    active: z.boolean().default(true),
    prices: z.array(priceSchema).max(120).default([]),
  })
  .strict();
const optionSchema = z
  .object({
    id: z.string().uuid(),
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,39}$/)
      .refine((k) => !['constructor', 'prototype'].includes(k)),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000).default(''),
    active: z.boolean().default(true),
    required: z.boolean().default(false),
    kind: z.enum(['SELECT', 'QUANTITY', 'TOGGLE', 'TEXT']),
    binding: z
      .enum(['memoryMb', 'diskMb', 'cpu', 'swapMb', 'javaVersion'])
      .nullable()
      .default(null),
    min: z.number().int().min(0).max(1000000).default(0),
    max: z.number().int().min(1).max(1000000).default(100),
    step: z.number().int().min(1).max(1000000).default(1),
    validation: z.enum(['text', 'hostname', 'email', 'slug']).default('text'),
    maxLength: z.number().int().min(1).max(2000).default(255),
    choices: z.array(choiceSchema).max(30).default([]),
    prices: z.array(priceSchema).max(120).default([]),
  })
  .strict();
const extraPlanSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    active: z.boolean().default(true),
    type: z.enum(['RECURRING', 'ONE_TIME', 'FREE']),
    unit: z.enum(['DAY', 'WEEK', 'MONTH', 'YEAR']).default('MONTH'),
    period: z.number().int().min(1).max(120).default(1),
    amount,
    setupFee: amount.default(0),
    regionalPrices: z
      .array(
        z.object({ regionId: z.string().uuid(), amount, setupFee: amount.default(0) }).strict(),
      )
      .max(250)
      .default([]),
  })
  .strict();
export const configurationSchema = z
  .object({
    plans: z.array(extraPlanSchema).max(20).default([]),
    options: z.array(optionSchema).max(30).default([]),
  })
  .strict();
export type Configuration = z.infer<typeof configurationSchema>;
export function baseContract(product: any) {
  const cycles: Record<string, [string, string, number]> = {
    daily: ['RECURRING', 'DAY', 1],
    weekly: ['RECURRING', 'WEEK', 1],
    monthly: ['RECURRING', 'MONTH', 1],
    quarterly: ['RECURRING', 'MONTH', 3],
    semiannual: ['RECURRING', 'MONTH', 6],
    annual: ['RECURRING', 'YEAR', 1],
    biennial: ['RECURRING', 'YEAR', 2],
    one_time: ['ONE_TIME', 'MONTH', 1],
    free: ['FREE', 'MONTH', 1],
  };
  const [type, unit, period] = cycles[product.cycle] || cycles.monthly;
  return { id: null, name: product.name, type, unit, period, label: termLabel(type, unit, period) };
}
export function termLabel(type: string, unit: string, period: number) {
  if (type === 'ONE_TIME') return 'one-time';
  if (type === 'FREE') return 'free';
  return period === 1 ? unit.toLowerCase() : `${period} ${unit.toLowerCase()}s`;
}
export function assertBindings(product: any, options: Configuration['options']) {
  const allowed =
    product.provider === 'wings'
      ? ['memoryMb', 'diskMb', 'cpu', 'swapMb', 'javaVersion']
      : product.provider === 'proxmox'
        ? ['memoryMb', 'diskMb', 'cpu', ...(product.spec?.vmType === 'lxc' ? ['swapMb'] : [])]
        : product.provider === 'native-web'
          ? ['diskMb']
          : [];
  if (options.some((o) => o.active && o.binding && !allowed.includes(o.binding)))
    throw new BadRequestException('This resource binding is unsupported by the hosting provider');
}
export function configuration(product: any): Configuration {
  return configurationSchema.parse(product.configuration || {});
}
function unique(values: string[], message: string) {
  if (new Set(values).size !== values.length) throw new BadRequestException(message);
}
@Injectable()
export class Offers {
  constructor(@Inject(Db) private db: Db) {}
  async get(id: string) {
    const product = await this.db.product.findUniqueOrThrow({ where: { id } });
    return { ...configuration(product), version: product.configurationVersion, productId: id };
  }
  async save(actor: Actor, id: string, input: unknown) {
    const { expectedVersion, ...data } = configurationSchema
      .extend({ expectedVersion: z.number().int().min(0) })
      .parse(input);
    unique(
      data.plans.map((p) => p.id),
      'Billing plan IDs must be unique',
    );
    unique(
      data.options.map((o) => o.id),
      'Option IDs must be unique',
    );
    unique(
      data.options.map((o) => o.key),
      'Option keys must be unique',
    );
    unique(
      data.options.filter((o) => o.active && o.binding).map((o) => o.binding!),
      'Only one active option may change each resource',
    );
    const plans = new Set(data.plans.map((p) => p.id));
    const checkPrices = (prices: z.infer<typeof priceSchema>[]) => {
      unique(
        prices.map((p) => `${p.planId}:${p.currency}`),
        'Each term and currency needs one price',
      );
      if (prices.some((p) => p.planId && !plans.has(p.planId)))
        throw new BadRequestException('An option price references an unknown billing plan');
    };
    for (const plan of data.plans) {
      unique(
        plan.regionalPrices.map((p) => p.regionId),
        'A plan can have one price per region',
      );
      if (
        plan.type === 'FREE' &&
        (plan.amount !== 0 || plan.regionalPrices.some((p) => p.amount !== 0))
      )
        throw new BadRequestException('Free plans must have a zero recurring price');
    }
    for (const option of data.options) {
      if (option.min > option.max)
        throw new BadRequestException('Option minimum must not exceed its maximum');
      if (option.binding && !['SELECT', 'QUANTITY'].includes(option.kind))
        throw new BadRequestException('Resource bindings require a selection or quantity');
      if (option.binding === 'javaVersion' && option.kind !== 'SELECT')
        throw new BadRequestException('Java versions require a selection');
      if (
        option.kind === 'TEXT' &&
        (option.prices.length || option.choices.length || option.binding)
      )
        throw new BadRequestException('Text properties cannot carry prices or resource bindings');
      if (option.kind === 'SELECT' && !option.choices.some((c) => c.active))
        throw new BadRequestException('Select options need an enabled choice');
      unique(
        option.choices.map((c) => c.id),
        'Choice IDs must be unique within each option',
      );
      checkPrices(option.prices);
      for (const choice of option.choices) {
        checkPrices(choice.prices);
        if (option.binding === 'javaVersion' && !['17', '21'].includes(choice.value))
          throw new BadRequestException('Choose a supported Java version');
        if (option.binding && option.binding !== 'javaVersion' && !/^\d{1,9}$/.test(choice.value))
          throw new BadRequestException('Resource choices require a non-negative integer value');
      }
    }
    return serial(this.db, async (tx) => {
      const product = await tx.product.findUniqueOrThrow({ where: { id } });
      assertBindings(product, data.options);
      if (
        data.plans.some(
          (p) =>
            p.amount + p.setupFee > 100000000 ||
            p.regionalPrices.some((r) => r.amount + r.setupFee > 100000000),
        )
      )
        throw new BadRequestException('Plan total exceeds the supported invoice limit');
      if (product.configurationVersion !== expectedVersion)
        throw new ConflictException('Configuration changed. Reload before saving.');
      const regions = await tx.pricingRegion.findMany({ select: { id: true } });
      if (
        data.plans.some((p) =>
          p.regionalPrices.some((r) => !regions.some((region) => region.id === r.regionId)),
        )
      )
        throw new BadRequestException('Unknown pricing region');
      await tx.product.update({
        where: { id },
        data: { configuration: json(data), configurationVersion: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'product.configuration.updated',
          targetId: id,
          details: { version: expectedVersion + 1 },
        },
      });
      return { ...data, version: expectedVersion + 1, productId: id };
    });
  }
}
export async function purchasePlans(db: any, settings: any, product: any, userId?: string) {
  const config = configuration(product),
    region = await customerRegion(db, settings, userId),
    base = await quoteProduct(db, settings, product, userId);
  return [
    {
      ...baseContract(product),
      amount: base.amount,
      setupFee: base.setupFee,
      currency: base.currency,
    },
    ...config.plans
      .filter((p) => p.active)
      .map((p) => {
        const regional = region && p.regionalPrices.find((r) => r.regionId === region.id);
        return {
          id: p.id,
          name: p.name,
          type: p.type,
          unit: p.unit,
          period: p.period,
          label: termLabel(p.type, p.unit, p.period),
          amount: regional ? regional.amount : p.amount,
          setupFee: regional ? regional.setupFee : p.setupFee,
          currency: regional ? region.currency : settings.currency,
        };
      }),
  ];
}
export async function configureOffer(
  db: any,
  settings: any,
  product: any,
  userId: string,
  planId?: string | null,
  input: unknown = {},
) {
  const selected = selectionsSchema.parse(input),
    config = configuration(product);
  assertBindings(product, config.options);
  const plan = (await purchasePlans(db, settings, product, userId)).find(
    (p) => p.id === (planId || null),
  );
  if (!plan) throw new ConflictException('This billing plan is unavailable');
  for (const id of Object.keys(selected))
    if (!config.options.some((o) => o.id === id && o.active))
      throw new BadRequestException('Unknown or disabled configuration option');
  const spec: Record<string, unknown> = { ...product.spec },
    selections: any[] = [],
    lines: any[] = [
      { name: plan.name, kind: 'PLAN', amount: plan.amount, quantity: 1, unitAmount: plan.amount },
    ];
  let amount = plan.amount,
    setupFee = plan.setupFee;
  for (const option of config.options.filter((o) => o.active)) {
    const value = selected[option.id];
    if (value === undefined || value === '' || (option.kind === 'TOGGLE' && value === false)) {
      if (option.required) throw new BadRequestException(`Choose ${option.name}`);
      continue;
    }
    let choice: Configuration['options'][number]['choices'][number] | undefined,
      quantity = 1;
    if (option.kind === 'SELECT') {
      choice = option.choices.find((c) => c.id === value && c.active);
      if (!choice) throw new BadRequestException(`Choose a valid ${option.name}`);
    } else if (option.kind === 'QUANTITY') {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < option.min ||
        value > option.max ||
        (value - option.min) % option.step
      )
        throw new BadRequestException(`Choose an allowed quantity for ${option.name}`);
      quantity = value;
    } else if (option.kind === 'TOGGLE') {
      if (typeof value !== 'boolean')
        throw new BadRequestException(`Choose a valid ${option.name}`);
    } else {
      if (typeof value !== 'string' || !value.trim() || value.length > option.maxLength)
        throw new BadRequestException(`Enter a valid ${option.name}`);
      const valid =
        option.validation === 'hostname'
          ? hostnameSchema.safeParse(value).success
          : option.validation === 'email'
            ? z.email().safeParse(value).success
            : option.validation === 'slug'
              ? /^[a-zA-Z0-9_-]+$/.test(value)
              : true;
      if (!valid) throw new BadRequestException(`Enter a valid ${option.name}`);
    }
    const price =
      option.kind === 'TEXT'
        ? { amount: 0, setupFee: 0 }
        : (choice?.prices || option.prices).find(
            (p) => p.planId === plan.id && p.currency === plan.currency,
          );
    if (!price)
      throw new ConflictException(`${option.name} has no price for this term and currency`);
    const optionAmount = price.amount * quantity,
      optionSetupFee = price.setupFee * quantity;
    amount += optionAmount;
    setupFee += optionSetupFee;
    if (option.binding) {
      if (option.binding === 'javaVersion') spec.javaVersion = choice!.value;
      else
        spec[option.binding] =
          Number(spec[option.binding] || 0) + (choice ? Number(choice.value) : quantity);
    }
    selections.push({
      id: option.id,
      key: option.key,
      name: option.name,
      kind: option.kind,
      value: choice ? choice.value : value,
      choiceId: choice?.id || null,
      choiceName: choice?.name || null,
      amount: optionAmount,
      setupFee: optionSetupFee,
      quantity,
      unitAmount: price.amount,
    });
    lines.push({
      name: choice ? `${option.name}: ${choice.name}` : option.name,
      kind: 'OPTION',
      amount: optionAmount,
      quantity,
      unitAmount: price.amount,
    });
  }
  if (amount + setupFee > 100000000)
    throw new BadRequestException('Configured price exceeds the supported invoice limit');
  if (plan.type === 'FREE' && amount !== 0)
    throw new BadRequestException('Paid options cannot be added to a free plan');
  if (setupFee)
    lines.push({
      name: 'Setup fees',
      kind: 'SETUP',
      amount: setupFee,
      quantity: 1,
      unitAmount: setupFee,
    });
  return {
    amount,
    setupFee,
    currency: plan.currency,
    spec: planSchema.parse(spec),
    selections,
    lines,
    contract: plan,
  };
}
export function offerFingerprint(offer: any, discount: any, tax: any) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        spec: offer.spec,
        selections: offer.selections,
        contract: offer.contract,
        setupFee: offer.setupFee,
        amount: offer.amount,
        total: tax.total,
        tax,
        discount: discount.discount,
        coupon: discount.coupon?.code || null,
        recurringAmount: discount.recurringAmount,
      }),
    )
    .digest('hex');
}
