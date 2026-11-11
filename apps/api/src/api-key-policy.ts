import { BlockList, isIP } from 'node:net';
import { digest } from './security';
export const clientScopes = {
  'catalog:read': 'Read available products and categories',
  'profile:read': 'Read your profile and workspace overview',
  'profile:write': 'Update your billing profile and notification preferences',
  'services:read': 'Read your services, usage, operations and console logs',
  'services:control': 'Start, stop and restart your services',
  'services:console': 'Send game console commands and create Wings console tickets',
  'services:files:read': 'List and download service files',
  'services:files:write': 'Write service files',
  'services:backups': 'List, create and restore backups',
  'services:startup': 'Edit game startup variables for the next reinstall',
  'services:rebuild': 'Reinstall your services (destructive)',
  'services:database': 'Manage your web database credentials',
  'services:certificate': 'Request web certificates',
  'services:panel-login': 'Create Plesk login links',
  'orders:read': 'Read your cart and cancellation history',
  'orders:write': 'Quote/buy plans, edit/checkout your cart and request cancellations',
  'invoices:read': 'Read your invoices and download PDFs',
  'invoices:pay': 'Spend your wallet balance or initiate invoice gateway payments',
  'wallet:read': 'Read your wallets and ledger',
  'wallet:fund': 'Request wallet deposits and funding invoices',
  'support:read': 'Read your tickets, departments and attachments',
  'support:write': 'Create tickets, reply and change their status',
} as const;
export const adminScopes = {
  'admin:reports:read': 'Read panel reports and audit history',
  'admin:customers:read': 'Read customer profiles, addresses and account history',
  'admin:customers:write': 'Create/edit customers and suspend or restore access',
  'admin:customers:security': 'Reset customer passwords and revoke customer sessions',
  'admin:services:read': 'Read all services, usage, operations and console logs',
  'admin:services:control': 'Start/stop/restart/suspend services and send console commands',
  'admin:services:destructive': 'Reinstall, restore or terminate customer services',
  'admin:services:files': 'Read and write customer service files',
  'admin:services:backups': 'Read/create customer backups',
  'admin:services:credentials':
    'Request database credentials, certificate actions and Plesk login links',
  'admin:orders:read': 'Read all orders and cancellation requests',
  'admin:orders:write': 'Place orders for customers and review cancellation requests',
  'admin:billing:read': 'Read all invoices, payments, wallet statements and tax rates',
  'admin:billing:write':
    'Issue/void invoices, record receipts, review payments/deposits and edit tax rates',
  'admin:catalog:read': 'Read product configurations, coupons and regional prices',
  'admin:catalog:write': 'Create/edit products, categories, coupons and regional prices',
  'admin:infrastructure:read': 'Read nodes, locations, allocations and Proxmox inventory',
  'admin:infrastructure:write': 'Connect/edit nodes and manage locations, allocations and IP pools',
  'admin:infrastructure:install': 'Generate/revoke remote Wings setup grants',
  'admin:infrastructure:secrets': 'Read Wings configurations including daemon credentials',
  'admin:support:read': 'Read all tickets, departments, staff and private notes',
  'admin:support:write': 'Manage tickets, staff replies, assignment and support departments',
  'admin:settings:read': 'Read company settings, template metadata and mail delivery logs',
  'admin:settings:write': 'Update panel, branding, SMTP and notification settings',
  'admin:system:read': 'Read system status, HTTP/audit logs and operation history',
  'admin:system:write': 'Run maintenance and retry operations',
} as const;
export type ApiKeyKind = 'CLIENT' | 'ADMIN';
type Rules = Record<string, string[]>;
const clientRules: Rules = {
  'catalog:read': [
    'GET catalog/products',
    'GET products',
    'GET catalog/categories',
    'GET settings',
    'GET gateways',
    'GET health',
  ],
  'profile:read': ['GET profile', 'GET dashboard'],
  'profile:write': ['PATCH profile'],
  'services:read': [
    'GET services',
    'GET services/:id',
    'GET services/:id/usage',
    'GET services/:id/operations',
    'GET services/:id/startup',
  ],
  'services:startup': ['PATCH services/:id/startup'],
  'services:console': ['POST services/:id/console'],
  'services:files:read': ['GET services/:id/files/content', 'GET services/:id/files/download'],
  'services:files:write': [
    'POST services/:id/files/content',
    'POST services/:id/files/upload',
    'POST services/:id/files/operations',
  ],
  'services:backups': ['GET services/:id/backups'],
  'services:database': ['POST services/:id/database'],
  'services:certificate': ['POST services/:id/certificate'],
  'services:panel-login': ['POST services/:id/panel-login'],
  'orders:read': ['GET cart', 'GET cancellations', 'GET services/:id/cancellations'],
  'orders:write': [
    'POST orders/quote',
    'POST orders',
    'POST cart/items',
    'PATCH cart/items/:id',
    'DELETE cart/items/:id',
    'POST cart/checkout',
    'POST invoices/:id/cancel-checkout',
    'POST services/:id/cancellations',
    'POST cancellations/:id/withdraw',
  ],
  'invoices:read': ['GET invoices', 'GET invoices/:id', 'GET invoices/:id/pdf'],
  'invoices:pay': [
    'POST invoices/:id/wallet-payment',
    'POST invoices/:id/checkout',
    'POST invoices/:id/paypal/capture',
  ],
  'wallet:read': ['GET wallet'],
  'wallet:fund': ['POST wallet/topups', 'POST wallet/funding-invoices', 'POST invoices/:id/void'],
  'support:read': [
    'GET tickets',
    'GET tickets/:id',
    'GET support/departments',
    'GET support/attachments/:id',
  ],
  'support:write': ['POST tickets', 'PATCH tickets/:id', 'POST tickets/:id/messages'],
};
const adminRules: Rules = {
  'admin:reports:read': ['GET dashboard', 'GET audit'],
  'admin:customers:read': ['GET customers', 'GET customers/:id'],
  'admin:customers:write': [
    'POST customers',
    'PATCH customers/:id',
    'POST customers/:id/suspension',
  ],
  'admin:customers:security': ['POST customers/:id/password', 'POST customers/:id/revoke-sessions'],
  'admin:services:read': [
    'GET services',
    'GET services/:id',
    'GET services/:id/usage',
    'GET services/:id/operations',
    'GET services/:id/startup',
  ],
  'admin:services:control': [
    'PATCH services/:id/startup',
    'POST services/:id/console',
    'POST services/:id/retry-provision',
  ],
  'admin:services:files': [
    'GET services/:id/files/content',
    'GET services/:id/files/download',
    'POST services/:id/files/content',
    'POST services/:id/files/upload',
    'POST services/:id/files/operations',
  ],
  'admin:services:backups': ['GET services/:id/backups'],
  'admin:services:credentials': [
    'POST services/:id/database',
    'POST services/:id/certificate',
    'POST services/:id/panel-login',
  ],
  'admin:orders:read': ['GET orders', 'GET cancellations', 'GET services/:id/cancellations'],
  'admin:orders:write': [
    'POST customers/:id/orders/quote',
    'POST customers/:id/orders',
    'POST cancellations/:id/review',
    'POST services/:id/cancellations',
    'POST cancellations/:id/withdraw',
  ],
  'admin:billing:read': [
    'GET invoices',
    'GET invoices/:id',
    'GET invoices/:id/pdf',
    'GET invoices/:id/deliveries',
    'GET payments/review',
    'GET admin/wallets',
    'GET admin/wallets/:userId',
    'GET tax-rates',
  ],
  'admin:billing:write': [
    'POST invoices/quote',
    'POST invoices',
    'POST invoices/:id/void',
    'POST invoices/:id/cancel-checkout',
    'POST invoices/:id/manual-payment',
    'POST invoices/:id/funding-credit',
    'POST invoices/:id/deliveries',
    'POST invoices/:id/deliveries/:deliveryId/retry',
    'POST payments/:id/review',
    'POST admin/wallets/topups/:id/review',
    'POST tax-rates',
    'PATCH tax-rates/:id',
  ],
  'admin:catalog:read': [
    'GET admin/eggs',
    'GET products',
    'GET products/:id/configuration',
    'GET catalog/products',
    'GET catalog/categories',
    'GET coupons',
    'GET pricing/regions',
    'GET gateways',
  ],
  'admin:catalog:write': [
    'POST admin/eggs',
    'PATCH admin/eggs/:id',
    'POST products',
    'PATCH products/:id',
    'PATCH products/:id/configuration',
    'POST catalog/categories',
    'PATCH catalog/categories/:id',
    'POST coupons',
    'PATCH coupons/:id',
    'POST pricing/regions',
    'PATCH pricing/regions/:id',
    'POST pricing/prices',
    'DELETE pricing/prices/:id',
  ],
  'admin:infrastructure:read': [
    'GET nodes',
    'GET locations',
    'GET nodes/:id/resources',
    'GET nodes/:id/proxmox',
    'GET nodes/:id/installations',
  ],
  'admin:infrastructure:write': [
    'POST nodes',
    'PATCH nodes/:id',
    'POST nodes/:id/check',
    'POST nodes/:id/resources',
    'DELETE nodes/:id/resources/:resourceId',
    'POST nodes/:id/cluster-nodes',
    'POST nodes/:id/ip-pools',
    'POST locations',
    'PATCH locations/:id',
    'DELETE locations/:id',
  ],
  'admin:infrastructure:install': [
    'POST nodes/:id/installations',
    'POST nodes/:id/installations/:installationId/revoke',
  ],
  'admin:infrastructure:secrets': ['GET nodes/:id/configuration'],
  'admin:support:read': [
    'GET tickets',
    'GET tickets/:id',
    'GET support/departments',
    'GET support/agents',
    'GET support/attachments/:id',
  ],
  'admin:support:write': [
    'POST tickets',
    'PATCH tickets/:id',
    'POST tickets/:id/messages',
    'POST support/departments',
    'PATCH support/departments/:id',
  ],
  'admin:settings:read': [
    'GET settings',
    'GET admin/settings',
    'GET admin/settings/templates',
    'GET admin/settings/mail/logs',
  ],
  'admin:settings:write': [
    'PATCH settings',
    'PATCH admin/settings/mail',
    'POST admin/settings/mail/test',
    'PATCH admin/settings/templates/:key',
    'POST admin/settings/logo',
  ],
  'admin:system:read': [
    'GET admin/system',
    'GET admin/system/http',
    'GET admin/system/audit',
    'GET admin/system/jobs',
    'GET operations',
    'GET health',
  ],
  'admin:system:write': ['POST admin/system/maintenance', 'POST operations/:id/retry'],
};
function match(template: string, path: string) {
  const a = template.split('/'),
    b = path.split('/');
  return (
    a.length === b.length && a.every((p, i) => (p.startsWith(':') ? b[i].length > 0 : p === b[i]))
  );
}
export function apiScope(
  kind: ApiKeyKind,
  method: string,
  path: string,
  body?: any,
): string | null {
  path = path
    .split('?')[0]
    .replace(/^\/api\/v1\//, '')
    .replace(/\/$/, '');
  if (method === 'HEAD') method = 'GET';
  if (method === 'GET' && path === 'auth/me') return '@identity';
  if (method === 'POST' && match('services/:id/actions', path)) {
    const action = body?.action;
    const actions: Record<string, string> =
      kind === 'CLIENT'
        ? {
            start: 'services:control',
            stop: 'services:control',
            restart: 'services:control',
            rebuild: 'services:rebuild',
            backup: 'services:backups',
            restore: 'services:backups',
            'console.tail': 'services:read',
            'console.send': 'services:console',
            'files.list': 'services:files:read',
          }
        : {
            start: 'admin:services:control',
            stop: 'admin:services:control',
            restart: 'admin:services:control',
            suspend: 'admin:services:control',
            unsuspend: 'admin:services:control',
            terminate: 'admin:services:destructive',
            rebuild: 'admin:services:destructive',
            restore: 'admin:services:destructive',
            backup: 'admin:services:backups',
            'console.tail': 'admin:services:read',
            'console.send': 'admin:services:control',
            'files.list': 'admin:services:files',
          };
    return typeof action === 'string' && Object.hasOwn(actions, action) ? actions[action] : null;
  }

  for (const [scope, routes] of Object.entries(kind === 'ADMIN' ? adminRules : clientRules))
    if (
      routes.some((r) => {
        const [m, p] = r.split(' ');
        return m === method && match(p, path);
      })
    )
      return scope;
  return null;
}
export function apiKeyFingerprint(user: any) {
  return digest(
    JSON.stringify([user.passwordHash, user.email, user.role, user.totpEnabled, user.totpSecret]),
  );
}
export function normalizeCidr(input: string) {
  const [ip, suffix, ...rest] = input.trim().split('/'),
    family = isIP(ip);
  const prefix = suffix === undefined ? (family === 4 ? 32 : 128) : Number(suffix);
  if (
    !family ||
    rest.length ||
    suffix === '' ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > (family === 4 ? 32 : 128)
  )
    throw new Error('Use IPv4/IPv6 addresses or CIDR ranges');
  return `${ip}/${prefix}`;
}
export function apiIpAllowed(ip: string | undefined, cidrs: string[]) {
  if (!cidrs.length) return true;
  if (!ip) return false;
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  const family = isIP(ip);
  if (!family) return false;
  const block = new BlockList();
  for (const cidr of cidrs) {
    const [address, bits] = normalizeCidr(cidr).split('/');
    block.addSubnet(address, Number(bits), isIP(address) === 4 ? 'ipv4' : 'ipv6');
  }
  return block.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}
export function apiScopeCatalog(kind: ApiKeyKind) {
  const scopes = kind === 'ADMIN' ? adminScopes : clientScopes;
  return Object.entries(scopes).map(([id, description]) => ({ id, description }));
}
export function apiRouteCatalog(kind: ApiKeyKind) {
  return Object.entries(kind === 'ADMIN' ? adminRules : clientRules).flatMap(([scope, routes]) =>
    routes.map((route) => ({ scope, route })),
  );
}
