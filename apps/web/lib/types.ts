/**
 * Shapes returned by the Harbor NestJS API (inside the `{ data }` envelope).
 * Monetary amounts are integers in the currency's minor unit (cents for USD).
 * Sizes are bytes. Percentages are 0-100. Dates are ISO 8601 strings.
 */

export type Role = 'admin' | 'customer';

export interface User {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
}

export interface CustomerRef {
  id?: string;
  name?: string | null;
  email: string;
}

/* Setup ---------------------------------------------------------------- */

export interface SetupStatus {
  completed: boolean;
}

export type NodeMode = 'local' | 'remote';

export interface SetupPayload {
  companyName: string;
  email: string;
  password: string;
  currency: string;
  nodeMode: NodeMode;
}

/* Dashboard ------------------------------------------------------------ */

export type MetricFormat = 'currency' | 'number' | 'percent';

export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  format: MetricFormat;
  /** Percentage change versus the previous period. */
  change?: number | null;
  description?: string | null;
}

export interface RevenuePoint {
  date: string;
  revenue: number;
}

export interface DashboardData {
  currency: string;
  metrics: DashboardMetric[];
  revenueSeries?: RevenuePoint[];
}

/* Services ------------------------------------------------------------- */

export type ServiceKind = 'game' | 'vps' | 'web';

export type ServiceStatus =
  | 'running'
  | 'stopped'
  | 'starting'
  | 'stopping'
  | 'provisioning'
  | 'suspended'
  | 'error'
  | 'offline';

export type BillingInterval = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface ServiceResources {
  cpu?: number | null;
  memoryUsed?: number | null;
  memoryLimit?: number | null;
  diskUsed?: number | null;
  diskLimit?: number | null;
}

export interface Service {
  id: string;
  name: string;
  kind: ServiceKind;
  status: ServiceStatus;
  plan?: string | null;
  nodeName?: string | null;
  customer?: CustomerRef | null;
  domain?: string | null;
  /** Public connection address, for example `play.example.com:25565` or an IP. */
  address?: string | null;
  price?: number | null;
  currency?: string | null;
  interval?: BillingInterval | null;
  createdAt?: string | null;
  renewsAt?: string | null;
  resources?: ServiceResources | null;
  game?: {
    software?: string | null;
    version?: string | null;
    players?: { online: number; max: number } | null;
  } | null;
  vps?: {
    os?: string | null;
    cores?: number | null;
    ipv4?: string | null;
    ipv6?: string | null;
    location?: string | null;
  } | null;
  web?: {
    sslStatus?: 'active' | 'pending' | 'none' | 'expired' | null;
    phpVersion?: string | null;
    panelUrl?: string | null;
    bandwidthUsed?: number | null;
    bandwidthLimit?: number | null;
  } | null;
}

export type PowerAction = 'start' | 'stop' | 'restart' | 'kill';

export interface ServiceActionRequest {
  /** `start | stop | restart | kill | console.tail | console.send | files.list` */
  action: string;
  command?: string;
  path?: string;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number | null;
  modifiedAt?: string | null;
}

export interface ServiceActionResult {
  message?: string | null;
  status?: ServiceStatus | null;
  lines?: string[];
  path?: string;
  entries?: FileEntry[];
}

/* Catalog and orders --------------------------------------------------- */

export interface Product {
  id: string;
  name: string;
  kind: ServiceKind;
  description?: string | null;
  price: number;
  currency: string;
  interval: BillingInterval;
  features?: string[];
  specs?: { label: string; value: string }[];
  featured?: boolean;
  available?: boolean;
  requiresDomain?: boolean;
}

export interface OrderResult {
  id: string;
  status: string;
  total?: number | null;
  currency?: string | null;
  invoiceId?: string | null;
  serviceId?: string | null;
  /** When present, the customer must continue to this URL to pay. */
  checkoutUrl?: string | null;
}

/* Invoices ------------------------------------------------------------- */

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'overdue' | 'void' | 'refunded';

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  total: number;
  currency: string;
  description?: string | null;
  customer?: CustomerRef | null;
  issuedAt: string;
  dueAt?: string | null;
  paidAt?: string | null;
  payUrl?: string | null;
  pdfUrl?: string | null;
  order?: { id: string; productName?: string | null } | null;
}

/* Infrastructure ------------------------------------------------------- */

export type NodeKind = 'wings' | 'proxmox' | 'plesk' | 'native-web';
export type NodeStatus = 'online' | 'degraded' | 'offline' | 'maintenance' | 'pending';

export interface InfraNode {
  id: string;
  name: string;
  kind: NodeKind;
  status: NodeStatus;
  host?: string | null;
  location?: string | null;
  version?: string | null;
  /** `local` marks the Wings daemon installed on the same machine as Harbor. */
  mode?: NodeMode | null;
  serviceCount?: number | null;
  lastSeenAt?: string | null;
  cpu?: number | null;
  memoryUsed?: number | null;
  memoryTotal?: number | null;
  diskUsed?: number | null;
  diskTotal?: number | null;
}

export interface NodeInput {
  kind: NodeKind;
  name: string;
  host: string;
  port?: number;
  tokenId?: string;
  secret: string;
}

/* Extensions and themes ------------------------------------------------ */

export type ExtensionKind = 'integration' | 'gateway' | 'module' | 'theme';
export type ThemeArea = 'admin' | 'customer' | 'storefront';

export interface ExtensionAccess {
  scope: string;
  level: 'read' | 'write' | 'admin';
  reason?: string | null;
}

export interface ThemeDefinition {
  areas: ThemeArea[];
  swatches?: string[];
  tokens?: {
    light?: Record<string, string>;
    dark?: Record<string, string>;
  };
}

export interface Extension {
  id: string;
  name: string;
  version: string;
  author?: string | null;
  description?: string | null;
  kind: ExtensionKind;
  enabled: boolean;
  access: ExtensionAccess[];
  compatibility: {
    compatible: boolean;
    /** Harbor version range the extension supports, for example `>=1.2 <2`. */
    requires?: string | null;
    /** Harbor version currently running. */
    current?: string | null;
    message?: string | null;
  };
  notices?: {
    install?: string | null;
    disable?: string | null;
  } | null;
  theme?: ThemeDefinition | null;
}

/* Settings ------------------------------------------------------------- */

export interface ThemeSelection {
  id: string;
  name?: string | null;
  tokens?: ThemeDefinition['tokens'];
}

export interface Settings {
  companyName: string;
  supportEmail?: string | null;
  currency: string;
  invoicePrefix?: string | null;
  taxRate?: number | null;
  maintenanceMode?: boolean;
  harborVersion?: string | null;
  /** Resolved active theme per area. */
  themes?: Partial<Record<ThemeArea, ThemeSelection | null>>;
}

export type SettingsPatch = Partial<
  Pick<
    Settings,
    'companyName' | 'supportEmail' | 'currency' | 'invoicePrefix' | 'taxRate' | 'maintenanceMode'
  >
> & {
  /** Theme id per area, or `null` to restore the Harbor default. */
  themes?: Partial<Record<ThemeArea, string | null>>;
};
