import type { ComponentType, ReactNode } from 'react';
import { z } from 'zod';
import semver from 'semver';

export const SDK_VERSION = '1.0.0';
export const providerIds = ['wings', 'proxmox', 'plesk', 'native-web'] as const;
export const serviceActionSchema = z.enum([
  'start',
  'stop',
  'restart',
  'suspend',
  'unsuspend',
  'terminate',
  'rebuild',
  'backup',
  'restore',
]);
export type ServiceAction = z.infer<typeof serviceActionSchema>;
export const extensionManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  name: z.string().min(1).max(80),
  version: z.string().refine((v) => !!semver.valid(v), 'Invalid semantic version'),
  sdkVersion: z.string().refine((v) => !!semver.validRange(v), 'Invalid SDK range'),
  type: z.enum(['plugin', 'theme']),
  description: z.string().max(1000),
  permissions: z.array(
    z.enum([
      'services:read',
      'services:write',
      'billing:read',
      'billing:write',
      'settings:read',
      'settings:write',
      'pages:register',
      'events:subscribe',
    ]),
  ),
  dependencies: z.record(z.string(), z.string()).default({}),
  entry: z
    .string()
    .regex(/^dist\/[a-zA-Z0-9_./-]+\.js$/)
    .optional(),
  frontendEntry: z
    .string()
    .regex(/^ui\/[a-zA-Z0-9_./-]+\.(tsx|ts|jsx|js)$/)
    .optional(),
  areas: z.array(z.enum(['admin', 'customer', 'storefront'])).optional(),
});
export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;
export function validateManifest(input: unknown) {
  const manifest = extensionManifestSchema.parse(input);
  if (!semver.satisfies(SDK_VERSION, manifest.sdkVersion))
    throw new Error(`Extension requires SDK ${manifest.sdkVersion}; installed ${SDK_VERSION}`);
  if ([manifest.entry, manifest.frontendEntry].some((p) => p?.split('/').includes('..')))
    throw new Error('Unsafe extension entry');
  return manifest;
}
export const hostnameSchema = z
  .string()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    'A valid domain name is required',
  );
export const planSchema = z.object({
  memoryMb: z.number().int().min(128).max(1048576).default(1024),
  diskMb: z.number().int().min(256).max(104857600).default(10240),
  cpu: z.number().int().min(1).max(256).default(1),
  templateId: z.string().max(255).optional(),
  vmType: z.enum(['qemu', 'lxc']).default('qemu'),
  ipPool: z.string().trim().max(80).optional(),
  swapMb: z.number().int().min(0).max(1048576).default(512),
  servicePlan: z.string().max(100).optional(),
  javaVersion: z.enum(['17', '21']).default('21'),
});
export type HostingPlan = z.infer<typeof planSchema>;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface ProviderConnection {
  id: string;
  provider: string;
  url: string;
  config: Record<string, unknown>;
  secret: Record<string, string>;
}
export interface HostingService {
  id: string;
  externalId: string | null;
  name: string;
  domain: string | null;
  user: { id: string; email: string; name: string };
  plan: HostingPlan;
  metadata: Record<string, unknown>;
}
export interface ProvisionResult {
  externalId: string;
  metadata?: Record<string, unknown>;
  pending?: boolean;
}
export interface HostingProvider {
  id: string;
  capabilities: readonly string[];
  health(connection: ProviderConnection): Promise<Record<string, unknown>>;
  provision(connection: ProviderConnection, service: HostingService): Promise<ProvisionResult>;
  action(
    connection: ProviderConnection,
    service: HostingService,
    action: ServiceAction,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  inspect(
    connection: ProviderConnection,
    service: HostingService,
  ): Promise<Record<string, unknown>>;
}
export interface PaymentGateway {
  id: string;
  checkout(
    invoice: {
      id: string;
      amount: number;
      currency: string;
      returnUrl: string;
      description?: string;
    },
    config: Record<string, string>,
  ): Promise<{ url: string; externalId: string }>;
}
export interface ExtensionContext {
  registerProvider(provider: HostingProvider): void;
  registerGateway(gateway: PaymentGateway): void;
  registerRoute(route: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    admin: boolean;
    handler: (request: {
      user: { id: string; role: string };
      body: unknown;
      query: Record<string, unknown>;
    }) => Promise<unknown>;
  }): void;
  registerPage(page: {
    id: string;
    area: 'admin' | 'customer' | 'storefront';
    label: string;
    path: string;
  }): void;
  on(
    event: 'service.created' | 'service.updated' | 'invoice.paid',
    listener: (payload: Record<string, unknown>) => Promise<void>,
  ): void;
  log(message: string): void;
}
export interface HarborPlugin {
  activate(context: ExtensionContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}
export interface ThemeTokens {
  light: Record<string, string>;
  dark: Record<string, string>;
}
export interface HarborTheme {
  tokens: ThemeTokens;
  areas: Partial<
    Record<'admin' | 'customer' | 'storefront', { name: string; description?: string }>
  >;
}
export function assertMinorAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error('Amount must be a positive integer in minor currency units');
}
export type BillingTerm = { unit: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'; period: number };
export function calculateDueDate(start: Date, cycle: 'monthly' | 'annual' | BillingTerm): Date {
  const term: BillingTerm =
    typeof cycle === 'string' ? { unit: cycle === 'annual' ? 'YEAR' : 'MONTH', period: 1 } : cycle;
  if (
    !Number.isInteger(term.period) ||
    term.period < 1 ||
    term.period > 120 ||
    !['DAY', 'WEEK', 'MONTH', 'YEAR'].includes(term.unit)
  )
    throw new Error('Invalid billing term');
  const due = new Date(start);
  if (Number.isNaN(due.getTime())) throw new Error('Invalid billing date');
  if (term.unit === 'DAY' || term.unit === 'WEEK') {
    due.setUTCDate(due.getUTCDate() + term.period * (term.unit === 'WEEK' ? 7 : 1));
    return due;
  }
  const day = due.getUTCDate();
  due.setUTCDate(1);
  due.setUTCMonth(due.getUTCMonth() + term.period * (term.unit === 'YEAR' ? 12 : 1));
  const lastDay = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
  due.setUTCDate(Math.min(day, lastDay));
  return due;
}

export interface FrontendContext {
  area: 'admin' | 'customer' | 'storefront';
  settings: Record<string, any>;
  user?: Record<string, any>;
  children?: ReactNode;
}
export interface HarborFrontendModule {
  ThemeLayout?: ComponentType<FrontendContext>;
  pages?: Record<
    string,
    {
      area: 'admin' | 'customer' | 'storefront';
      label: string;
      Component: ComponentType<FrontendContext>;
    }
  >;
  slots?: Record<string, ComponentType<FrontendContext>>;
}

// Shared HTTP contracts used to describe OpenAPI and generate the browser client.
const apiUser = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  role: z.enum(['admin', 'customer']),
  totpEnabled: z.boolean().optional(),
});
const apiProduct = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    provider: z.string(),
    kind: z.enum(['game', 'vps', 'web']),
    price: z.number().int(),
    currency: z.string(),
    cycle: z.enum(['monthly', 'annual']),
    interval: z.enum(['month', 'year']),
    active: z.boolean(),
    available: z.boolean(),
    requiresDomain: z.boolean(),
  })
  .passthrough();
export const httpContracts = [
  {
    method: 'post',
    path: '/api/v1/setup',
    request: z.object({
      companyName: z.string().min(1).max(100),
      email: z.email(),
      password: z.string().min(12).max(200),
      currency: z.string().length(3).default('USD'),
      nodeMode: z.enum(['local', 'remote']),
      setupToken: z.string().min(1).max(200),
    }),
    response: apiUser,
  },
  {
    method: 'post',
    path: '/api/v1/auth/login',
    request: z.object({
      email: z.email(),
      password: z.string().max(200),
      totp: z.string().length(6).optional(),
    }),
    response: apiUser,
  },
  {
    method: 'post',
    path: '/api/v1/auth/register',
    request: z.object({
      name: z.string().min(1).max(100),
      email: z.email(),
      password: z.string().min(12).max(200),
    }),
    response: apiUser,
  },
  { method: 'get', path: '/api/v1/auth/me', response: apiUser },
  { method: 'get', path: '/api/v1/products', response: z.array(apiProduct) },
  {
    method: 'post',
    path: '/api/v1/products',
    request: z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(2000),
      category: z.enum(['game', 'vps', 'web']),
      provider: z.string(),
      price: z.number().int().positive(),
      cycle: z.enum(['monthly', 'annual']).default('monthly'),
      active: z.boolean().default(false),
      connectionId: z.uuid(),
      spec: planSchema,
    }),
  },
  {
    method: 'post',
    path: '/api/v1/orders',
    request: z.object({
      productId: z.uuid(),
      domain: hostnameSchema.optional(),
      sshKey: z.string().optional(),
      idempotencyKey: z.uuid(),
    }),
    response: z.object({
      id: z.string(),
      status: z.string(),
      invoiceId: z.string(),
      serviceId: z.string(),
      total: z.number().optional(),
      currency: z.string().optional(),
    }),
  },
  {
    method: 'post',
    path: '/api/v1/services/{id}/actions',
    request: z.object({
      action: z.string(),
      command: z.string().optional(),
      path: z.string().optional(),
      idempotencyKey: z.uuid().optional(),
      confirmation: z.string().optional(),
      backupId: z.uuid().optional(),
      archive: z.string().optional(),
    }),
  },
  {
    method: 'post',
    path: '/api/v1/nodes',
    request: z.object({
      name: z.string(),
      provider: z.string(),
      url: z.url(),
      config: z.record(z.string(), z.unknown()).default({}),
      secret: z.record(z.string(), z.string()),
    }),
  },
  {
    method: 'post',
    path: '/api/v1/invoices/{id}/checkout',
    request: z.object({ gateway: z.string() }),
  },
  {
    method: 'post',
    path: '/api/v1/invoices/{id}/manual-payment',
    request: z.object({ reference: z.string().min(3).max(200) }),
  },
] as const;
