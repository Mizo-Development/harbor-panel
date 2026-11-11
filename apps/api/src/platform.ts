import { GameEggs, gameConfigSchema } from './game-eggs';
import { issueInvoice, remainingBalance, invoicePaymentBlocked } from './invoice-issue';
import {
  experience,
  accessPolicy,
  automationPolicy,
  supportPolicy,
  notificationPolicy,
  experienceSchema,
  accessSchema,
  automationSchema,
  supportPolicySchema,
  notificationPolicySchema,
  logoLink,
} from './settings-policy';
import {
  assertBindings,
  baseContract,
  cycleSchema,
  configuration,
  configureOffer,
  purchasePlans,
  offerFingerprint,
  selectionsSchema,
} from './offers';
import { paymentBlocked } from './cancellations';
import { calculateTax } from './taxes';
import { assertPurchasable, visibleCategories } from './catalog';
import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { customerRegion, pricingRegionSchema } from './pricing';
import { applyCoupon, couponCode } from './coupons';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Db, json } from './db';
import { Extensions } from './extensions';
import { Auth, Actor, emailSchema, passwordSchema, safeUser } from './auth';
import {
  decrypt,
  encrypt,
  hashPassword,
  safeEqual,
  token,
  validConnectionUrl,
  appUrl,
} from './security';
import { hostnameSchema, planSchema, serviceActionSchema, providerIds } from '@harbor/sdk';
import type { HostingService, ProviderConnection } from '@harbor/sdk';
import { Payments } from './payments';
import { serial } from './transactions';
import { WingsProvider, wingsNodeConfiguration } from './providers/wings';
import { isolatedWingsLayout, wingsInstanceLayout } from './providers/wings-layout';
import { PleskProvider } from './providers/plesk';
import { ProxmoxProvider } from './providers/proxmox';
import {
  billingAddressSchema,
  companyBillingSchema,
  invoiceSnapshot,
  walletSettingsSchema,
  walletPolicy,
} from './billing';
import {
  proxmoxConfigSchema,
  ipPoolSchema,
  ipv4Number,
  numberIpv4,
} from './providers/proxmox-config';
const currencySchema = z.enum([
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
const productSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000),
  category: z.enum(['game', 'vps', 'web']),
  taxable: z.boolean().optional(),
  catalogCategoryId: z.string().uuid().nullable().optional(),
  stock: z.number().int().min(0).max(1000000).nullable().optional(),
  perCustomerLimit: z.number().int().min(1).max(100000).nullable().optional(),
  provider: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  price: z.number().int().min(0).max(100000000),
  setupFee: z.number().int().min(0).max(100000000).optional(),
  cycle: cycleSchema.default('monthly'),
  active: z.boolean().default(false),
  listed: z.boolean().default(false),
  connectionId: z.string().uuid().nullable(),
  spec: planSchema,
  gameConfig: gameConfigSchema.optional(),
});
export const createCustomerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: emailSchema,
    password: passwordSchema,
    billingAddress: billingAddressSchema.optional(),
    adminNotes: z.string().max(10000).default(''),
    taxExempt: z.boolean().default(false),
  })
  .strict();
export const orderInputSchema = z.object({
  productId: z.string().uuid(),
  domain: hostnameSchema.optional(),
  sshKey: z
    .string()
    .trim()
    .max(16000)
    .regex(/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/=]+(?: [^\r\n]*)?$/)
    .optional(),
  idempotencyKey: z.string().uuid(),
  couponCode: couponCode.optional(),
  planId: z.string().uuid().nullable().optional(),
  options: selectionsSchema,
  expectedQuoteId: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  expectedTotal: z.number().int().min(0).optional(),
  expectedCurrency: z.string().optional(),
});
const includeService = {
  user: { select: safeUser },
  product: { include: { connection: true } },
  resource: true,
  invoiceLinks: {
    include: { invoice: { select: { id: true, kind: true, status: true, number: true } } },
  },
} as const;
@Injectable()
export class Platform {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(GameEggs) private eggs: GameEggs,
    @Inject(Extensions) readonly extensions: Extensions,
    @Inject(Payments) readonly payments: Payments,
    @Inject(Auth) readonly auth: Auth,
  ) {}
  async audit(actor: Actor, action: string, targetId?: string, details: unknown = {}) {
    await this.db.auditLog.create({
      data: {
        actorId: actor.id,
        action,
        targetId,
        details: json(
          actor.apiKeyId ? { ...(details as object), apiKeyId: actor.apiKeyId } : details,
        ),
      },
    });
  }
  async setup(input: unknown) {
    const d = z
      .object({
        companyName: z.string().trim().min(1).max(100),
        email: emailSchema,
        password: passwordSchema,
        currency: currencySchema.default('USD'),
        nodeMode: z.enum(['local', 'remote']),
        setupToken: z.string().min(1).max(200),
      })
      .parse(input);
    if (!process.env.SETUP_TOKEN || !safeEqual(d.setupToken, process.env.SETUP_TOKEN))
      throw new UnauthorizedException('The installation setup token is invalid');
    const passwordHash = await hashPassword(d.password);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(8675309)`;
      if (await tx.setting.findUnique({ where: { id: 'installation' } }))
        throw new ConflictException('Installation is already configured');
      const user = await tx.user.create({
        data: { email: d.email, name: 'Administrator', passwordHash, role: 'ADMIN' },
        select: safeUser,
      });
      await tx.setting.create({
        data: {
          id: 'installation',
          companyName: d.companyName,
          currency: d.currency,
          nodeMode: d.nodeMode,
        },
      });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'installation.created' } });
      return user;
    });
  }
  async settings() {
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
    if (!settings)
      return {
        companyName: 'Harbor',
        currency: 'USD',
        storefrontEnabled: false,
        setupRequired: true,
        themes: {},
      };
    const { mailConfig, ...visible } = settings;
    return {
      ...visible,
      walletSettings: walletPolicy(settings),
      companyBilling: companyBillingSchema.parse(settings.companyBilling || {}),
      experience: experience(settings),
      access: accessPolicy(settings),
      automation: automationPolicy(settings),
      supportPolicy: supportPolicy(settings),
      notifications: notificationPolicy(settings),
      enabledFrontendExtensions: (
        await this.db.extension.findMany({
          where: { enabled: true, builtin: false },
          select: { id: true },
        })
      ).map((e) => e.id),
      themes: await this.extensions.themes(settings.themes),
      gateways: await this.payments.available(),
    };
  }
  async updateSettings(actor: Actor, input: unknown) {
    const d = z
      .object({
        expectedVersion: z.number().int().min(0).optional(),
        experience: experienceSchema.optional(),
        access: accessSchema.optional(),
        automation: automationSchema.optional(),
        supportPolicy: supportPolicySchema.optional(),
        notifications: notificationPolicySchema.optional(),
        companyName: z.string().trim().min(1).max(100).optional(),
        companyBilling: companyBillingSchema.optional(),
        walletSettings: walletSettingsSchema.optional(),
        regionalPricingEnabled: z.boolean().optional(),
        taxEnabled: z.boolean().optional(),
        taxInclusive: z.boolean().optional(),
        storefrontEnabled: z.boolean().optional(),
        currency: currencySchema.optional(),
        graceDays: z.number().int().min(0).max(90).optional(),
        invoicePrefix: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9][A-Z0-9_-]{0,15}$/)
          .optional(),
        invoiceEmailsEnabled: z.boolean().optional(),
        logoUrl: logoLink.nullable().optional(),
        accentColor: z
          .string()
          .regex(/^#[a-fA-F0-9]{6}$/)
          .optional(),
        themes: z
          .object({ admin: z.string(), customer: z.string(), storefront: z.string() })
          .optional(),
      })
      .strict()
      .parse(input);
    if (
      d.currency &&
      ((await this.db.invoice.count()) ||
        (await this.db.wallet.count()) ||
        (await this.db.walletTopup.count()))
    ) {
      const s = await this.db.setting.findUniqueOrThrow({ where: { id: 'installation' } });
      if (s.currency !== d.currency)
        throw new ConflictException('Currency cannot change after invoices have been issued');
    }
    if (d.themes) await this.extensions.themes(d.themes);
    const { expectedVersion, ...changes } = d;
    if (changes.access?.requireStaffTwoFactor && !actor.totpEnabled)
      throw new ConflictException(
        'Enable two-factor authentication on your account before requiring it for staff',
      );
    await serial(this.db, async (tx) => {
      const result = await tx.setting.updateMany({
        where: {
          id: 'installation',
          ...(expectedVersion === undefined ? {} : { settingsVersion: expectedVersion }),
        },
        data: { ...changes, settingsVersion: { increment: 1 } },
      });
      if (!result.count)
        throw new ConflictException(
          'Settings changed in another session. Reload the latest settings before saving.',
        );
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'settings.updated',
          details: { fields: Object.keys(changes) },
        },
      });
    });
    return this.settings();
  }
  async connections() {
    return (
      await this.db.connection.findMany({
        include: { location: true, _count: { select: { products: true, resources: true } } },
        orderBy: { createdAt: 'desc' },
      })
    ).map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      kind: c.provider,
      url: c.url,
      config: c.config,
      locationId: c.locationId,
      location: c.location,
      status: c.health === 'ONLINE' ? 'online' : c.health === 'ERROR' ? 'offline' : 'unconfigured',
      health: c.health,
      lastCheckedAt: c.lastCheckedAt,
      createdAt: c.createdAt,
      products: c._count.products,
      allocations: c._count.resources,
    }));
  }
  async createConnection(actor: Actor, input: unknown) {
    const d = z
      .object({
        name: z.string().trim().min(1).max(100),
        provider: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
        url: z.string().max(1000),
        config: z.record(z.string(), z.unknown()).default({}),
        locationId: z.string().uuid().nullable().optional(),
        secret: z.record(z.string(), z.string().max(10000)),
      })
      .parse(input);
    if (d.config.behindProxy !== undefined)
      d.config.behindProxy = d.config.behindProxy === true || d.config.behindProxy === 'true';
    if (d.config.listenPort !== undefined)
      d.config.listenPort = z.coerce.number().int().min(1024).max(65535).parse(d.config.listenPort);
    await this.extensions.provider(d.provider);
    d.url = validConnectionUrl(d.url);
    if (d.provider === 'wings' && !d.secret.tokenId && !d.secret.token) {
      d.secret.tokenId = token().slice(0, 16);
      d.secret.token = token();
    }
    if (d.provider === 'wings')
      z.object({ tokenId: z.string().min(8).max(100), token: z.string().min(32).max(200) }).parse(
        d.secret,
      );
    if (d.provider === 'proxmox') {
      z.object({ tokenId: z.string().min(3), tokenSecret: z.string().min(10) }).parse(d.secret);
      d.config = proxmoxConfigSchema.parse(d.config);
    }
    if (d.provider === 'plesk') {
      z.object({ apiKey: z.string().min(8) }).parse(d.secret);
      z.object({ ip: z.ipv4() }).passthrough().parse(d.config);
    }
    if (d.provider === 'native-web') z.object({ token: z.string().min(64) }).parse(d.secret);
    const connection = await this.db.connection.create({
      data: { ...d, config: json(d.config), secret: encrypt(d.secret) },
    });
    await this.audit(actor, 'connection.created', connection.id, { provider: d.provider });
    return {
      id: connection.id,
      name: connection.name,
      provider: d.provider,
      status: 'unconfigured',
    };
  }
  async updateConnection(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        url: z.string().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        locationId: z.string().uuid().nullable().optional(),
        secret: z.record(z.string(), z.string()).optional(),
      })
      .parse(input);
    const c = await this.db.connection.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Connection not found');
    if (c.provider === 'proxmox' && d.config) d.config = proxmoxConfigSchema.parse(d.config);
    if (c.provider === 'proxmox' && d.secret)
      z.object({ tokenId: z.string().min(3), tokenSecret: z.string().min(10) }).parse({
        ...decrypt<Record<string, string>>(c.secret),
        ...d.secret,
      });
    await this.db.connection.update({
      where: { id },
      data: {
        ...d,
        url: d.url ? validConnectionUrl(d.url) : undefined,
        config: d.config ? json(d.config) : undefined,
        secret: d.secret
          ? encrypt({ ...decrypt<Record<string, string>>(c.secret), ...d.secret })
          : undefined,
        health: 'UNCONFIGURED',
      },
    });
    await this.audit(actor, 'connection.updated', id);
    return { updated: true };
  }
  connection(c: any): ProviderConnection {
    return {
      id: c.id,
      provider: c.provider,
      url: c.url,
      config: c.config,
      secret: decrypt(c.secret),
    };
  }
  async proxmoxInventory(id: string, node?: string, storage?: string) {
    const row = await this.db.connection.findUniqueOrThrow({ where: { id } });
    if (row.provider !== 'proxmox') throw new BadRequestException('Select a Proxmox connection');
    const provider = (await this.extensions.provider('proxmox')) as ProxmoxProvider;
    return provider.inventory(this.connection(row), node, storage);
  }
  async addProxmoxNode(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({
        name: z.string().trim().min(1).max(100),
        config: proxmoxConfigSchema,
        locationId: z.string().uuid().nullable().optional(),
      })
      .parse(input);
    const source = await this.db.connection.findUniqueOrThrow({ where: { id } });
    if (source.provider !== 'proxmox') throw new BadRequestException('Select a Proxmox cluster');
    return this.createConnection(actor, {
      ...d,
      provider: 'proxmox',
      url: source.url,
      secret: decrypt(source.secret),
    });
  }
  async addIpPool(id: string, input: unknown) {
    const d = ipPoolSchema.parse(input);
    const c = await this.db.connection.findUniqueOrThrow({ where: { id } });
    if (c.provider !== 'proxmox') throw new BadRequestException('IP pools require Proxmox');
    const start = ipv4Number(d.start),
      end = ipv4Number(d.end),
      gateway = ipv4Number(d.gateway);
    if (end < start || end - start >= 4096)
      throw new BadRequestException('Use a range of 1–4096 addresses');
    const mask = (0xffffffff << (32 - d.prefix)) >>> 0;
    const network = (start & mask) >>> 0;
    if ((start & mask) !== (end & mask))
      throw new BadRequestException('The range must stay inside one subnet');
    const data: Prisma.ResourceCreateManyInput[] = [];
    for (let ip = start; ip <= end; ip++) {
      if (ip === gateway) continue;
      if (d.prefix < 31 && (ip === network || ip === network + 2 ** (32 - d.prefix) - 1)) continue;
      data.push({
        connectionId: id,
        kind: 'ip',
        value: `${numberIpv4(ip)}/${d.prefix}`,
        config: json({ gateway: d.gateway, pool: d.pool }),
      });
    }
    if (!data.length) throw new BadRequestException('The range contains no usable addresses');
    return serial(this.db, async (tx) => {
      const existing = new Set(
        (
          await tx.resource.findMany({
            where: { connectionId: id, kind: 'ip' },
            select: { value: true },
          })
        ).map((r) => r.value.split('/')[0]),
      );
      return tx.resource.createMany({
        data: data.filter((r) => !existing.has(r.value.split('/')[0])),
        skipDuplicates: true,
      });
    });
  }
  async removeResource(id: string, resourceId: string) {
    const result = await this.db.resource.deleteMany({
      where: { id: resourceId, connectionId: id, serviceId: null },
    });
    if (!result.count)
      throw new ConflictException('Reserved or missing addresses cannot be removed');
    return { removed: true };
  }
  async connectionHealth(id: string) {
    const c = await this.db.connection.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Connection not found');
    try {
      const details = await (await this.extensions.provider(c.provider)).health(this.connection(c));
      if (details.ready === false) throw new Error('Provider prerequisites are incomplete');
      await this.db.connection.update({
        where: { id },
        data: { health: 'ONLINE', lastCheckedAt: new Date() },
      });
      return { status: 'online', ...details };
    } catch (error) {
      await this.db.connection.update({
        where: { id },
        data: { health: 'ERROR', lastCheckedAt: new Date() },
      });
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Connection check failed',
      );
    }
  }
  async nodeConfiguration(id: string) {
    const row = await this.db.connection.findUniqueOrThrow({ where: { id } });
    if (row.provider !== 'wings')
      throw new BadRequestException('Only Wings nodes have daemon configuration');
    const config = wingsNodeConfiguration(this.connection(row), appUrl());
    return {
      config,
      instance:
        (row.config as any).wingsLayout === isolatedWingsLayout ? wingsInstanceLayout(id) : null,
      instructions:
        (row.config as any).wingsLayout === isolatedWingsLayout
          ? `Use Install node to prepare this isolated instance. Its config is ${wingsInstanceLayout(id).config}; Docker gateway values are populated locally by the installer. Restart only ${wingsInstanceLayout(id).service}.`
          : 'Save this JSON (valid YAML) as /etc/pterodactyl/config.yml with mode 0600 on the node. Install the pinned Wings release and Docker, then start Wings. Or use Install node to generate a unique automatic setup command.',
    };
  }
  async resources(id: string, input: unknown) {
    const d = z
      .object({
        kind: z.enum(['allocation', 'ip']),
        value: z.string().min(1).max(200),
        config: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(input);
    const c = await this.db.connection.findUniqueOrThrow({ where: { id } });
    if (c.provider === 'wings') {
      z.object({ ip: z.ipv4(), port: z.number().int().min(1024).max(65535) }).parse(d.config);
      if (d.kind !== 'allocation') throw new BadRequestException('Wings requires an allocation');
      d.value = `${d.config.ip}:${d.config.port}`;
    }
    if (c.provider === 'proxmox') {
      if (d.kind !== 'ip' || !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(d.value))
        throw new BadRequestException('Use an IPv4 CIDR address');
      const [ip, prefix] = d.value.split('/');
      z.ipv4().parse(ip);
      if (Number(prefix) > 32) throw new BadRequestException('Invalid CIDR prefix');
      z.object({ gateway: z.ipv4() }).passthrough().parse(d.config);
      return serial(this.db, async (tx) => {
        if (
          await tx.resource.findFirst({
            where: { connectionId: id, kind: 'ip', value: { startsWith: `${ip}/` } },
          })
        )
          throw new ConflictException('This IP address is already allocated on this connection');
        return tx.resource.create({ data: { connectionId: id, ...d, config: json(d.config) } });
      });
    }
    return this.db.resource.create({ data: { connectionId: id, ...d, config: json(d.config) } });
  }
  async products(publicOnly: boolean, userId?: string) {
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
    if (publicOnly && !settings?.storefrontEnabled)
      throw new ForbiddenException('The storefront is disabled');
    let rows = await this.db.product.findMany({
      where: publicOnly ? { OR: [{ active: true }, { listed: true }] } : undefined,
      include: {
        connection: { select: { health: true } },
        _count: { select: { services: { where: { status: { not: 'TERMINATED' } } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const visible = visibleCategories(await this.db.catalogCategory.findMany());
    if (publicOnly)
      rows = rows.filter((p) => !p.catalogCategoryId || visible.has(p.catalogCategoryId));
    const owned =
      publicOnly && userId
        ? await this.db.service.groupBy({
            by: ['productId'],
            where: { userId, status: { not: 'TERMINATED' } },
            _count: true,
          })
        : [];
    const ownedCounts = new Map(owned.map((s) => [s.productId, s._count]));
    const region = publicOnly && settings ? await customerRegion(this.db, settings, userId) : null;
    const overrides = region
      ? await this.db.regionalPrice.findMany({
          where: { regionId: region.id, productId: { in: rows.map((p) => p.id) } },
        })
      : [];
    const prices = new Map(overrides.map((p) => [p.productId, p.amount]));
    return Promise.all(
      rows.map(async ({ connection, _count, ...p }) => ({
        ...p,
        gameConfig: publicOnly ? undefined : p.gameConfig,
        kind: p.category,
        isDemo: p.provider === 'demo-game',
        ...(publicOnly
          ? {
              price: prices.get(p.id) ?? p.price,
              currency: prices.has(p.id) ? region!.currency : settings!.currency,
              isRegional: prices.has(p.id),
            }
          : {}),
        ...(!publicOnly ? { currency: settings?.currency || 'USD' } : {}),
        setupFee: overrides.find((o) => o.productId === p.id)?.setupFee ?? p.setupFee,
        configuration: publicOnly
          ? {
              plans: configuration(p).plans.filter((plan) => plan.active),
              options: configuration(p)
                .options.filter((o) => o.active)
                .map((o) => ({ ...o, choices: o.choices.filter((c) => c.active) })),
            }
          : p.configuration,
        purchasePlans: await purchasePlans(this.db, settings, p, publicOnly ? userId : undefined),
        interval: baseContract(p).label,
        billingType: baseContract(p).type,
        stockRemaining: p.stock === null ? null : Math.max(0, p.stock - _count.services),
        unavailableReason: !accessPolicy(settings).ordersEnabled
          ? 'Orders paused'
          : p.stock !== null && _count.services >= p.stock
            ? 'Sold out'
            : p.perCustomerLimit !== null && (ownedCounts.get(p.id) || 0) >= p.perCustomerLimit
              ? 'Purchase limit reached'
              : !p.active || connection?.health !== 'ONLINE'
                ? 'Coming soon'
                : p.catalogCategoryId && !visible.has(p.catalogCategoryId)
                  ? 'Category unavailable'
                  : null,
        available:
          accessPolicy(settings).ordersEnabled &&
          p.active &&
          connection?.health === 'ONLINE' &&
          (!p.catalogCategoryId || visible.has(p.catalogCategoryId)) &&
          (p.stock === null || _count.services < p.stock) &&
          (p.perCustomerLimit === null || (ownedCounts.get(p.id) || 0) < p.perCustomerLimit),
        requiresDomain: p.category === 'web',
        specs: [
          { label: 'Memory', value: `${(p.spec as any).memoryMb} MB` },
          { label: 'Storage', value: `${(p.spec as any).diskMb / 1024} GB` },
          { label: 'CPU', value: `${(p.spec as any).cpu} cores` },
        ],
      })),
    );
  }
  async saveProduct(actor: Actor, input: unknown, id?: string) {
    const d = productSchema.parse(input);
    if (d.cycle === 'free' && d.price !== 0)
      throw new BadRequestException('Free plans require a zero price');
    if (
      d.catalogCategoryId &&
      !(await this.db.catalogCategory.findUnique({ where: { id: d.catalogCategoryId } }))
    )
      throw new BadRequestException('Unknown catalog category');
    if (id) {
      const existing = await this.db.product.findUniqueOrThrow({ where: { id } });
      assertBindings({ provider: d.provider, spec: d.spec }, configuration(existing).options);
    }
    const c = d.connectionId
      ? await this.db.connection.findUnique({ where: { id: d.connectionId } })
      : null;
    if (d.connectionId && (!c || c.provider !== d.provider))
      throw new BadRequestException('Choose a matching provider connection');
    const expected = { wings: 'game', proxmox: 'vps', plesk: 'web', 'native-web': 'web' }[
      d.provider
    ];
    if (expected && d.category !== expected)
      throw new BadRequestException('Product category does not match provider');
    await this.extensions.provider(d.provider);
    if (d.active && (!c || c.health !== 'ONLINE'))
      throw new ConflictException('Validate the connection before publishing products');
    if (d.provider === 'proxmox') {
      if (d.spec.vmType === 'lxc') {
        if (!/^[a-zA-Z0-9_.-]+:vztmpl\/[a-zA-Z0-9_.-]+$/.test(d.spec.templateId || ''))
          throw new BadRequestException('Choose a container template volume from Proxmox');
      } else if (!/^\d+$/.test(d.spec.templateId || ''))
        throw new BadRequestException('A numeric QEMU cloud-init template ID is required');
    }
    if (d.provider === 'plesk' && !d.spec.servicePlan)
      throw new BadRequestException('Select a Plesk service plan');
    if (
      id &&
      (await this.db.service.count({ where: { productId: id, status: { not: 'TERMINATED' } } }))
    ) {
      const existing = await this.db.product.findUniqueOrThrow({ where: { id } });
      if (
        existing.connectionId !== d.connectionId ||
        existing.provider !== d.provider ||
        existing.cycle !== d.cycle
      )
        throw new ConflictException(
          'Create a new product to change provider or billing cycle for existing services',
        );
    }
    if (d.provider === 'wings' && (d.gameConfig || !id))
      await this.eggs.assignment(d.gameConfig || {});
    if (d.provider !== 'wings' && d.gameConfig?.eggId)
      throw new BadRequestException('Eggs require the Wings provider');
    const p = id
      ? await this.db.product.update({ where: { id }, data: { ...d, spec: json(d.spec) } })
      : await this.db.product.create({ data: { ...d, spec: json(d.spec) } });
    await this.audit(actor, id ? 'product.updated' : 'product.created', p.id);
    return p;
  }
  async orderQuote(actor: Actor, input: unknown) {
    const d = z
      .object({
        productId: z.string().uuid(),
        couponCode: couponCode.optional(),
        planId: z.string().uuid().nullable().optional(),
        options: selectionsSchema,
      })
      .strict()
      .parse(input);
    const product = await this.db.product.findUnique({
      where: { id: d.productId },
      include: { connection: true },
    });
    if (!product?.active || product.connection?.health !== 'ONLINE')
      throw new ConflictException('This plan is not available for orders');
    await assertPurchasable(this.db, product, actor.id);
    const settings = await this.db.setting.findUniqueOrThrow({ where: { id: 'installation' } });
    if (!settings.storefrontEnabled && actor.role !== 'ADMIN')
      throw new ForbiddenException('New orders are disabled');
    const quote = await configureOffer(this.db, settings, product, actor.id, d.planId, d.options),
      discount = await applyCoupon(this.db, d.couponCode, actor.id, product, quote);
    const customer = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    const taxable = product.taxable && product.provider !== 'demo-game';
    const tax = await calculateTax(
      this.db,
      settings,
      customer,
      discount.total + quote.setupFee,
      settings.taxInclusive,
      taxable,
    );
    const recurringTax = await calculateTax(
      this.db,
      settings,
      customer,
      discount.recurringAmount,
      settings.taxInclusive,
      taxable,
    );
    return {
      productId: product.id,
      subtotal: quote.amount + quote.setupFee,
      setupFee: quote.setupFee,
      lineItems: quote.lines,
      spec: quote.spec,
      billingContract: quote.contract,
      quoteId: offerFingerprint(quote, discount, tax),
      total: tax.total,
      tax,
      discount: discount.discount,
      currency: quote.currency,
      recurringAmount: quote.contract.type === 'RECURRING' ? recurringTax.total : 0,
      couponCode: discount.coupon?.code || null,
    };
  }
  async order(
    actor: Actor,
    input: unknown,
    transaction?: Prisma.TransactionClient,
    deferInvoice = false,
    ignoredOrderIds: string[] = [],
    issuedBy?: Actor,
  ) {
    const d = orderInputSchema.parse(input);
    const perform = async (tx: Prisma.TransactionClient): Promise<any> => {
      const prior = await tx.order.findUnique({
        where: { userId_idempotencyKey: { userId: actor.id, idempotencyKey: d.idempotencyKey } },
        include: {
          service: { include: { invoices: true, invoiceLinks: { include: { invoice: true } } } },
        },
      });
      if (prior) {
        if (deferInvoice)
          throw new ConflictException(
            'A cart item was already purchased. Remove it and add it again.',
          );
        const invoice = prior.service!.invoices[0] || prior.service!.invoiceLinks[0]?.invoice;
        if (!invoice) throw new ConflictException('The existing order is still being finalized');
        return {
          id: prior.id,
          serviceId: prior.service!.id,
          invoiceId: invoice.id,
          status: invoice.status === 'PAID' ? 'paid' : 'awaiting_payment',
          total: invoice.amount,
          currency: invoice.currency,
        };
      }
      const settings = await tx.setting.findUniqueOrThrow({ where: { id: 'installation' } });
      if (!settings.storefrontEnabled && actor.role !== 'ADMIN')
        throw new ForbiddenException('New orders are disabled');
      if (!accessPolicy(settings).ordersEnabled)
        throw new ForbiddenException('New orders are temporarily paused');
      const product = await tx.product.findUnique({
        where: { id: d.productId },
        include: { connection: true },
      });
      if (!product?.active || product.connection?.health !== 'ONLINE')
        throw new ConflictException('This product is unavailable');
      await assertPurchasable(tx, product, actor.id);
      await this.extensions.provider(product.provider);
      if (product.category === 'web' && !d.domain)
        throw new BadRequestException('A domain name is required');
      if (product.provider === 'proxmox' && !d.sshKey)
        throw new BadRequestException('An SSH public key is required for a VPS');
      const customer = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
      if (customer.suspendedAt) throw new ForbiddenException('Your account is suspended');
      if (accessPolicy(settings).requireVerifiedEmail && !customer.emailVerifiedAt)
        throw new ForbiddenException(
          'Verify your email address in Account before ordering hosting',
        );
      const quote = await configureOffer(tx, settings, product, actor.id, d.planId, d.options);
      const discount = await applyCoupon(
        tx,
        d.couponCode,
        actor.id,
        product,
        quote,
        ignoredOrderIds,
      );
      const taxable = product.taxable && product.provider !== 'demo-game';
      const tax = await calculateTax(
        tx,
        settings,
        customer,
        discount.total + quote.setupFee,
        settings.taxInclusive,
        taxable,
      );
      if (
        (d.expectedTotal !== undefined && d.expectedTotal !== tax.total) ||
        (d.expectedCurrency && d.expectedCurrency !== quote.currency) ||
        (d.expectedQuoteId && d.expectedQuoteId !== offerFingerprint(quote, discount, tax))
      )
        throw new ConflictException('The price changed. Refresh the quote before ordering.');
      if (
        product.provider !== 'demo-game' &&
        !billingAddressSchema.safeParse(customer.billingAddress).success
      )
        throw new BadRequestException(
          'Add your billing address in Account before placing a hosting order',
        );
      if (
        d.domain &&
        (await tx.service.count({ where: { domain: d.domain, status: { not: 'TERMINATED' } } }))
      )
        throw new ConflictException('This domain already has a hosting service');
      const order = await tx.order.create({
        data: { userId: actor.id, productId: product.id, idempotencyKey: d.idempotencyKey },
      });
      if (discount.coupon)
        await tx.couponRedemption.create({
          data: { couponId: discount.coupon.id, userId: actor.id, orderId: order.id },
        });
      const service = await tx.service.create({
        data: {
          name: d.domain || `${product.name} ${order.id.slice(0, 6)}`,
          userId: actor.id,
          productId: product.id,
          orderId: order.id,
          provider: product.provider,
          domain: d.domain,
          spec: json(quote.spec),
          recurringAmount: discount.recurringAmount,
          recurringCurrency: quote.currency,
          metadata: json({
            ...(product.provider === 'wings'
              ? { gameAssignment: await this.eggs.assignment(product.gameConfig, tx) }
              : {}),
            billingContract: quote.contract,
            configuration: quote.selections,
            pricingLines: quote.lines.filter((line) => line.kind !== 'SETUP'),
            taxPolicy: { inclusive: settings.taxInclusive, taxable },
            ...(discount.coupon
              ? {
                  coupon: {
                    id: discount.coupon.id,
                    code: discount.coupon.code,
                    recurring: discount.coupon.recurring,
                    discount: discount.discount,
                    subtotal: quote.amount,
                  },
                }
              : {}),
            ...(d.sshKey ? { sshKey: d.sshKey } : {}),
            ...(product.provider === 'proxmox' ? { proxmox: product.connection!.config } : {}),
          }),
        },
      });
      if (['wings', 'proxmox'].includes(product.provider)) {
        const resource = await tx.resource.findFirst({
          where: {
            connectionId: product.connectionId!,
            kind: product.provider === 'wings' ? 'allocation' : 'ip',
            serviceId: null,
            ...(product.provider === 'proxmox' && (quote.spec as any).ipPool
              ? { config: { path: ['pool'], equals: (quote.spec as any).ipPool } }
              : {}),
          },
          orderBy: { id: 'asc' },
        });
        if (!resource)
          throw new ConflictException('No hosting allocations are available for this plan');
        const reserved = await tx.resource.updateMany({
          where: { id: resource.id, serviceId: null },
          data: { serviceId: service.id },
        });
        if (reserved.count !== 1)
          throw new ConflictException('Allocation was reserved by another order; retry');
      }
      const invoiceInput = {
        description: service.name,
        userId: actor.id,
        serviceId: service.id,
        amount: tax.total,
        billingSnapshot: json({
          ...invoiceSnapshot(settings, customer),
          pricing: {
            subtotal: quote.amount + quote.setupFee,
            setupFee: quote.setupFee,
            lines: quote.lines,
            billingContract: quote.contract,
            options: quote.selections,
            discount: discount.discount,
            couponCode: discount.coupon?.code || null,
            tax,
          },
        }),
        currency: quote.currency,
        dueAt: new Date(Date.now() + automationPolicy(settings).invoiceDueDays * 86400000),
        periodStart: new Date(),
      };
      const invoice = deferInvoice
        ? null
        : await issueInvoice(tx, invoiceInput, product.provider === 'demo-game');
      await tx.auditLog.create({
        data: {
          actorId: issuedBy?.id || actor.id,
          action: 'order.created',
          targetId: order.id,
          details: json({
            ...(issuedBy ? { customerId: actor.id } : {}),
            ...((issuedBy || actor).apiKeyId ? { apiKeyId: (issuedBy || actor).apiKeyId } : {}),
          }),
        },
      });
      return {
        id: order.id,
        status: 'awaiting_payment',
        total: tax.total,
        currency: quote.currency,
        invoiceId: invoice?.id,
        ...(deferInvoice ? { invoiceInput } : {}),
        serviceId: service.id,
      };
    };
    const result: any = transaction ? await perform(transaction) : await serial(this.db, perform);
    if (!transaction && result.total === 0) {
      await this.payments.settle({
        gateway: 'promotion',
        eventId: `promotion-${result.invoiceId}`,
        paymentId: `promotion-${result.invoiceId}`,
        invoiceId: result.invoiceId,
        amount: 0,
        currency: result.currency,
      });
      return { ...result, status: 'paid' };
    }
    return result;
  }
  async rawService(actor: Actor, id: string) {
    const s = await this.db.service.findFirst({
      where: { id, ...(actor.role === 'ADMIN' ? {} : { userId: actor.id }) },
      include: includeService,
    });
    if (!s) throw new NotFoundException('Service not found');
    return s;
  }
  hostingService(s: any): HostingService {
    return {
      id: s.id,
      externalId: s.externalId,
      name: s.name,
      domain: s.domain,
      user: s.user,
      plan: planSchema.parse(s.spec),
      metadata: {
        ...s.metadata,
        lifecycleStatus: s.status,
        resource: s.resource ? { value: s.resource.value, config: s.resource.config } : undefined,
      },
    };
  }
  async serviceView(s: any) {
    const spec = planSchema.parse(s.spec);
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
    const p = await this.extensions.provider(s.provider).catch(() => null);
    return {
      id: s.id,
      name: s.name,
      kind: s.product.category,
      provider: s.provider,
      isDemo: s.provider === 'demo-game',
      status: (
        {
          ACTIVE: 'active',
          PENDING: 'pending',
          PROVISIONING: 'provisioning',
          INSTALLING: 'provisioning',
          SUSPENDED: 'suspended',
          FAILED: 'error',
          TERMINATED: 'terminated',
        } as any
      )[s.status],
      ...(s.provider === 'demo-game' && s.status === 'ACTIVE'
        ? { status: (s.metadata as any).powerState || 'stopped' }
        : {}),
      lifecycleStatus: s.status,
      plan: s.product.name,
      nodeName: s.product.connection?.name || 'Unassigned',
      customer: s.user,
      domain: s.domain,
      address: s.resource?.value || s.domain,
      price: s.recurringAmount ?? s.product.price,
      currency: s.recurringCurrency || settings?.currency,
      interval: (s.metadata as any).billingContract?.label || baseContract(s.product).label,
      billingType: (s.metadata as any).billingContract?.type || 'RECURRING',
      billingContract: (s.metadata as any).billingContract || baseContract(s.product),
      configuration: (s.metadata as any).configuration || [],
      createdAt: s.createdAt,
      renewsAt: s.nextDueAt,
      cancelsAt: s.cancelAt,
      unpaidCheckoutInvoiceId:
        s.invoiceLinks?.find(
          (link: any) => link.invoice.kind === 'CART' && link.invoice.status === 'UNPAID',
        )?.invoice.id || null,
      error: s.error,
      capabilities: p?.capabilities || [],
      resources: { memoryLimit: spec.memoryMb * 1048576, diskLimit: spec.diskMb * 1048576 },
      sftp:
        s.provider === 'wings' && s.product.connection
          ? {
              host: new URL(s.product.connection.url).hostname,
              port: Number((s.product.connection.config as any).sftpPort || 2022),
              username: `${s.user.email}.${s.id}`,
            }
          : null,
      game:
        s.provider === 'wings'
          ? {
              software:
                (s.metadata as any).gameRuntime?.name ||
                (s.metadata as any).gameAssignment?.name ||
                'Paper',
              version: (s.metadata as any).gameRuntime?.release?.version || 'latest',
              build: (s.metadata as any).gameRuntime?.release?.build || null,
              image: (s.metadata as any).gameRuntime?.image || null,
              resolvedAt: (s.metadata as any).gameRuntime?.resolvedAt || null,
            }
          : null,
      vps: s.provider === 'proxmox' ? { cores: spec.cpu, ipv4: s.resource?.value } : null,
      web:
        s.product.category === 'web'
          ? { panelUrl: s.provider === 'plesk' ? s.product.connection?.url : null }
          : null,
    };
  }
  async services(actor: Actor) {
    return Promise.all(
      (
        await this.db.service.findMany({
          where: actor.role === 'ADMIN' ? {} : { userId: actor.id },
          include: includeService,
          orderBy: { createdAt: 'desc' },
        })
      ).map((s) => this.serviceView(s)),
    );
  }
  async action(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({
        action: z.string(),
        command: z.string().max(1000).optional(),
        path: z.string().max(2000).optional(),
        idempotencyKey: z.string().uuid().optional(),
        confirmation: z.string().optional(),
        backupId: z.string().uuid().optional(),
        archive: z.string().max(1000).optional(),
      })
      .parse(input);
    const s = await this.rawService(actor, id);
    const p = await this.extensions.provider(s.provider);
    const c = this.connection(s.product.connection);
    const hs = this.hostingService(s);
    if (s.cancelAt && s.cancelAt <= new Date())
      throw new ConflictException('This service has reached its cancellation cutoff');
    if (['PENDING', 'TERMINATED', 'PROVISIONING', 'INSTALLING', 'FAILED'].includes(s.status))
      throw new ConflictException('This service is not ready for management');
    if (actor.role !== 'ADMIN' && s.status === 'SUSPENDED')
      throw new ForbiddenException(
        'This service is suspended; resolve outstanding invoices or contact support',
      );
    if (d.action === 'console.tail' && s.provider === 'wings') {
      const response = await (p as WingsProvider).call(c, `/servers/${id}/logs?size=100`);
      return { lines: response.data || [] };
    }
    if (d.action === 'console.send' && s.provider === 'wings') {
      if (!d.command) throw new BadRequestException('Enter a console command');
      await (p as WingsProvider).call(c, `/servers/${id}/commands`, 'POST', {
        commands: [d.command],
      });
      await this.audit(actor, 'console.command', id);
      return { message: 'Command sent' };
    }
    if (d.action === 'files.list') {
      if (s.provider === 'wings') {
        const list = await (p as WingsProvider).files(c, hs, d.path || '/');
        return {
          path: d.path || '/',
          entries: (Array.isArray(list) ? list : list.data || []).map((f: any) => ({
            name: f.name,
            type: f.file ? 'file' : 'directory',
            size: f.size,
            modifiedAt: f.modified_at,
          })),
        };
      }
      if (s.provider === 'native-web')
        return (p as any).call(c, `/sites/${id}/files?path=${encodeURIComponent(d.path || '/')}`);
    }
    const action = serviceActionSchema.parse(d.action);
    if (!p.capabilities.includes(action))
      throw new BadRequestException('This operation is not supported by the provider');
    if (['suspend', 'unsuspend', 'terminate'].includes(action) && actor.role !== 'ADMIN')
      throw new ForbiddenException('Administrator access required');
    if (['terminate', 'rebuild', 'restore'].includes(action) && d.confirmation !== s.name)
      throw new BadRequestException('Confirm this operation by entering the service name');
    if (action === 'restore' && s.provider === 'wings') {
      const backups = (s.metadata as any).backups || {};
      if (!d.backupId || !backups[d.backupId]?.completed)
        throw new BadRequestException('Choose a completed backup belonging to this server');
    }
    const key = `${actor.id}-${d.idempotencyKey || randomUUID()}`;
    return serial(this.db, async (tx) => {
      const prior = await tx.operation.findUnique({ where: { idempotencyKey: key } });
      if (prior) {
        if (prior.serviceId !== id || prior.action !== action)
          throw new ConflictException('Idempotency key was used for a different operation');
        return {
          operationId: prior.id,
          status: prior.status,
          message: 'Operation already recorded',
        };
      }
      const current = await tx.service.findUniqueOrThrow({ where: { id } });
      if (current.status === 'TERMINATED' || (current.cancelAt && current.cancelAt <= new Date()))
        throw new ConflictException('This service has reached its cancellation cutoff');
      if (
        await tx.operation.count({
          where: { serviceId: id, status: { in: ['PENDING', 'RUNNING'] } },
        })
      )
        throw new ConflictException('Another operation is in progress');
      const op = await tx.operation.create({
        data: {
          serviceId: id,
          action,
          input: json({ ...d, backupId: action === 'backup' ? randomUUID() : d.backupId }),
          idempotencyKey: key,
        },
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: `service.${action}.requested`, targetId: id },
      });
      return {
        operationId: op.id,
        status: op.status,
        message: 'Operation queued. Status updates after the provider responds.',
      };
    });
  }
  async invoices(actor: Actor) {
    return (
      await this.db.invoice.findMany({
        where: actor.role === 'ADMIN' ? {} : { userId: actor.id },
        include: {
          service: true,
          user: { select: safeUser },
          payments: true,
          lineItems: true,
          linkedServices: {
            include: {
              service: { select: { id: true, name: true, status: true, cancelAt: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    ).map((i) => ({
      ...i,
      payments:
        actor.role === 'ADMIN'
          ? i.payments
          : i.payments.map((p) => ({
              id: p.id,
              gateway: p.gateway,
              externalId: p.externalId,
              amount: p.amount,
              appliedAmount: p.appliedAmount,
              currency: p.currency,
              createdAt: p.createdAt,
              reviewRequired: p.reviewRequired,
              reviewedAt: p.reviewedAt,
            })),
      canPay: i.status === 'UNPAID' && !invoicePaymentBlocked(i),
      remaining: remainingBalance(i),
      balanceDue: i.status === 'UNPAID' ? remainingBalance(i) : 0,
      number:
        i.number ||
        `${i.service?.provider === 'demo-game' ? 'DEMO' : 'INV'}-${i.id.slice(0, 8).toUpperCase()}`,
      isDemo: i.service?.provider === 'demo-game',
      description: i.description || i.service?.name || 'Invoice',
      status:
        i.status === 'PAID'
          ? 'paid'
          : i.status === 'VOID'
            ? 'void'
            : i.dueAt < new Date()
              ? 'overdue'
              : 'open',
      total: i.amount,
      customer: i.user,
      issuedAt: i.createdAt,
    }));
  }
  async invoice(actor: Actor, id: string) {
    const i = await this.db.invoice.findFirst({
      where: { id, ...(actor.role === 'ADMIN' ? {} : { userId: actor.id }) },
    });
    if (!i) throw new NotFoundException('Invoice not found');
    return i;
  }
  async customers() {
    return this.db.user.findMany({
      where: { role: 'CUSTOMER' },
      select: {
        ...safeUser,
        lastLoginAt: true,
        wallets: { select: { balance: true, currency: true } },
        _count: { select: { services: true, invoices: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async customer(id: string) {
    const customer = await this.db.user.findFirst({
      where: { id, role: 'CUSTOMER' },
      select: {
        ...safeUser,
        lastLoginAt: true,
        lastLoginIp: true,
        lastLoginUserAgent: true,
        passwordChangedAt: true,
        adminNotes: true,
        _count: { select: { services: true, invoices: true } },
        wallets: { include: { entries: { orderBy: { createdAt: 'desc' }, take: 100 } } },
        suspensionReason: true,
        services: {
          select: {
            id: true,
            name: true,
            provider: true,
            status: true,
            domain: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        invoices: {
          select: {
            id: true,
            amount: true,
            paidAmount: true,
            number: true,
            kind: true,
            description: true,
            currency: true,
            status: true,
            createdAt: true,
            dueAt: true,
            paidAt: true,
            service: { select: { name: true, provider: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const [logins, activity, activeSessions, settings] = await Promise.all([
      this.db.auditLog.findMany({
        where: { actorId: id, action: 'auth.login' },
        select: { id: true, createdAt: true, details: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.db.auditLog.findMany({
        where: { OR: [{ actorId: id }, { targetId: id }] },
        select: { id: true, action: true, createdAt: true, details: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.db.session.count({ where: { userId: id, expiresAt: { gt: new Date() } } }),
      this.db.setting.findUnique({ where: { id: 'installation' }, select: { currency: true } }),
    ]);
    return {
      ...customer,
      logins,
      activity,
      activeSessions,
      wallet:
        customer.wallets.find((w) => w.currency === settings?.currency) ||
        customer.wallets[0] ||
        null,
      currency: settings?.currency || 'USD',
    };
  }
  async suspendCustomer(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({ suspended: z.boolean(), reason: z.string().trim().min(3).max(1000) })
      .strict()
      .parse(input);
    return serial(this.db, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id, role: 'CUSTOMER' },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('Customer not found');
      await tx.user.update({
        where: { id },
        data: {
          suspendedAt: d.suspended ? new Date() : null,
          suspensionReason: d.suspended ? d.reason : null,
        },
      });
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.resetToken.deleteMany({ where: { userId: id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: d.suspended ? 'customer.suspended' : 'customer.unsuspended',
          targetId: id,
          details: { reason: d.reason },
        },
      });
      return { suspended: d.suspended };
    });
  }
  async pricingRegions() {
    return this.db.pricingRegion.findMany({ include: { prices: true }, orderBy: { name: 'asc' } });
  }
  async savePricingRegion(actor: Actor, input: unknown, id?: string) {
    const data = pricingRegionSchema.parse(input);
    return serial(this.db, async (tx) => {
      if (id) {
        const current = await tx.pricingRegion.findUniqueOrThrow({
          where: { id },
          include: { _count: { select: { prices: true } } },
        });
        if (current.currency !== data.currency) {
          const products = await tx.product.findMany({ select: { configuration: true } });
          if (
            current._count.prices ||
            products.some((p) =>
              configuration(p).plans.some((plan) =>
                plan.regionalPrices.some((price) => price.regionId === id),
              ),
            )
          )
            throw new ConflictException(
              'Remove product and billing-plan overrides before changing this region’s currency',
            );
        }
      }
      const result = id
        ? await tx.pricingRegion.update({ where: { id }, data })
        : await tx.pricingRegion.create({ data });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'pricing.region.saved', targetId: result.id },
      });
      return result;
    });
  }
  async saveRegionalPrice(actor: Actor, input: unknown) {
    const data = z
      .object({
        productId: z.string().uuid(),
        regionId: z.string().uuid(),
        setupFee: z.number().int().min(0).max(100000000).default(0),
        amount: z.number().int().min(0).max(100000000),
      })
      .strict()
      .parse(input);
    const product = await this.db.product.findUniqueOrThrow({ where: { id: data.productId } });
    if (product.cycle === 'free' && data.amount !== 0)
      throw new BadRequestException('Free plans require zero regional recurring prices');
    const result = await this.db.regionalPrice.upsert({
      where: { productId_regionId: { productId: data.productId, regionId: data.regionId } },
      create: data,
      update: { amount: data.amount, setupFee: data.setupFee },
    });
    await this.audit(actor, 'pricing.price.saved', result.id);
    return result;
  }
  async createCustomer(actor: Actor, input: unknown) {
    const d = createCustomerInputSchema.parse(input);
    const passwordHash = await hashPassword(d.password);
    return serial(this.db, async (tx) => {
      const created = await tx.user.create({
        data: {
          name: d.name,
          email: d.email,
          passwordHash,
          role: 'CUSTOMER',
          billingAddress: json(d.billingAddress || {}),
          adminNotes: d.adminNotes,
          taxExempt: d.taxExempt,
        },
        select: safeUser,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'customer.created',
          targetId: created.id,
          details: json(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}),
        },
      });
      return created;
    });
  }
  async customerOrder(actor: Actor, id: string, input: unknown, quote = false) {
    const customer = await this.db.user.findFirst({
      where: { id, role: 'CUSTOMER' },
      select: safeUser,
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.suspendedAt) throw new ForbiddenException('Customer account is suspended');
    return quote
      ? this.orderQuote(customer, input)
      : this.order(customer, input, undefined, false, [], actor);
  }
  async editCustomer(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        email: emailSchema.optional(),
        billingAddress: z.union([billingAddressSchema, z.object({}).strict()]).optional(),
        adminNotes: z.string().max(10000).optional(),
        taxExempt: z.boolean().optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, 'Supply a field to update')
      .parse(input);
    return serial(this.db, async (tx) => {
      const current = await tx.user.findFirst({ where: { id, role: 'CUSTOMER' } });
      if (!current) throw new NotFoundException('Customer not found');
      const emailChanged = d.email !== undefined && d.email !== current.email;
      const result = await tx.user.update({
        where: { id },
        data: {
          ...d,
          ...(emailChanged ? { emailVerifiedAt: null } : {}),
          billingAddress: d.billingAddress ? json(d.billingAddress) : undefined,
        },
        select: safeUser,
      });
      if (emailChanged) {
        await tx.apiKey.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.session.deleteMany({ where: { userId: id } });
        await tx.resetToken.deleteMany({ where: { userId: id } });
        await tx.verificationToken.deleteMany({ where: { userId: id } });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'customer.updated',
          targetId: id,
          details: json({ fields: Object.keys(d), emailChanged }),
        },
      });
      return { ...result, sessionsRevoked: emailChanged };
    });
  }
  async changeCustomerPassword(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({ password: passwordSchema, confirmPassword: passwordSchema })
      .strict()
      .refine((v) => v.password === v.confirmPassword, 'Passwords must match')
      .parse(input);
    const passwordHash = await hashPassword(d.password);
    return serial(this.db, async (tx) => {
      if (!(await tx.user.findFirst({ where: { id, role: 'CUSTOMER' }, select: { id: true } })))
        throw new NotFoundException('Customer not found');
      await tx.user.update({
        where: { id },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await tx.apiKey.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const sessions = await tx.session.deleteMany({ where: { userId: id } });
      await tx.resetToken.deleteMany({ where: { userId: id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'customer.password.changed',
          targetId: id,
          details: { sessionsRevoked: sessions.count },
        },
      });
      return { changed: true, sessionsRevoked: sessions.count };
    });
  }
  async revokeCustomerSessions(actor: Actor, id: string) {
    return serial(this.db, async (tx) => {
      if (!(await tx.user.findFirst({ where: { id, role: 'CUSTOMER' }, select: { id: true } })))
        throw new NotFoundException('Customer not found');
      const result = await tx.session.deleteMany({ where: { userId: id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'customer.sessions.revoked',
          targetId: id,
          details: { count: result.count },
        },
      });
      return { revoked: result.count };
    });
  }
  async orders() {
    return this.db.order.findMany({
      include: {
        user: { select: safeUser },
        product: true,
        service: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async dashboard(actor: Actor) {
    const where = actor.role === 'ADMIN' ? {} : { userId: actor.id };
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
    const [services, invoices, users, paid] = await Promise.all([
      this.db.service.count({
        where: { ...where, status: 'ACTIVE', provider: { not: 'demo-game' } },
      }),
      this.db.invoice.count({
        where: {
          ...where,
          status: 'UNPAID',
          OR: [{ kind: 'ADHOC' }, { kind: 'HOSTING', service: { provider: { not: 'demo-game' } } }],
        },
      }),
      this.db.user.count({ where: { role: 'CUSTOMER' } }),
      this.db.payment.findMany({
        where: {
          gateway: { not: 'demo' },
          invoice: {
            kind: { not: 'WALLET_FUNDING' },
            ...(actor.role === 'ADMIN' ? {} : { userId: actor.id }),
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const region =
      actor.role === 'CUSTOMER' && settings
        ? await customerRegion(this.db, settings, actor.id)
        : null;
    const reportingCurrency = region?.currency || settings?.currency || 'USD';
    const totals = new Map<string, number>();
    for (const payment of paid)
      totals.set(payment.currency, (totals.get(payment.currency) || 0) + payment.amount);
    const series = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      series.set(date, 0);
    }
    for (const p of paid) {
      if (p.currency !== reportingCurrency) continue;
      const day = p.createdAt.toISOString().slice(0, 10);
      if (series.has(day)) series.set(day, series.get(day)! + p.amount);
    }
    return {
      currency: reportingCurrency,
      currencyTotals: [...totals].map(([currency, amount]) => ({ currency, amount })),
      metrics: [
        {
          key: 'revenue',
          label: actor.role === 'ADMIN' ? 'Collected payments' : 'Total paid',
          value: totals.get(reportingCurrency) || 0,
          format: 'currency',
          description: `Recorded payments in ${reportingCurrency}`,
        },
        { key: 'services', label: 'Active services', value: services, format: 'number' },
        { key: 'invoices', label: 'Unpaid invoices', value: invoices, format: 'number' },
        ...(actor.role === 'ADMIN'
          ? [{ key: 'customers', label: 'Customers', value: users, format: 'number' }]
          : []),
      ],
      revenueSeries: [...series].map(([date, revenue]) => ({ date, revenue })),
    };
  }
}
