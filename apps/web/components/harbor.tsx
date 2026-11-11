'use client';
import { ApiKeysPage } from './harbor/api-keys';
import { WorkspaceShell } from '@/components/design/workspace-shell';
import { Stagger, Reveal } from '@/components/design/motion';
import { motion } from 'motion/react';
import {
  useEffect,
  useRef,
  useState,
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type FormEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import {
  Anchor,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Activity,
  Bell,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  Code2,
  Copy,
  CreditCard,
  Database,
  ExternalLink,
  File,
  Folder,
  Gamepad2,
  Globe2,
  HardDrive,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MoreHorizontal,
  Package,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Square,
  Terminal,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { VpsConsole } from '@/components/vps-console';
import {
  ExtensionLayout,
  ExtensionSlot,
  ExtensionPage,
  extensionPages,
} from '@/components/extension-runtime';
import { api, apiFetch, ApiError, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { StatusBadge } from '@/components/data/status-badge';
import { Button } from '@/components/ui/button';
import {
  useData,
  money,
  date,
  kindIcon,
  Loading,
  ErrorBox,
  Empty,
  Header,
  Panel,
  Field,
  inputClass,
  Input,
  Select,
  Modal,
  Form,
  DataTable,
  mutateAction,
  Brand,
  type Row,
} from './harbor/shared';
import {
  Nodes,
  AllocationModal,
  Products,
  ExtensionsPage,
  Records,
  Invoices,
} from './harbor/admin';
import { SettingsPage } from './harbor/settings';
import { Announcement, Maintenance, VerifyEmail } from './harbor/experience';
import { SystemWorkspace } from './harbor/system';
import { CartPage } from './harbor/cart';
import { ServiceTable, Services, ServiceDetail } from './harbor/services';
import { Store, Account, AuthScreen, Setup } from './harbor/public';
import { ProxmoxWorkspace } from './harbor/proxmox';
import { WalletPage } from './harbor/billing';
import { Customers } from './harbor/customers';
import { RegionalPricing } from './harbor/pricing';
import { SupportTickets } from './harbor/tickets';
import { ProductConfiguration } from './harbor/product-configuration';
import { CancellationPage } from './harbor/cancellations';
import { PaymentReviews } from './harbor/payment-reviews';
import { TaxSettings } from './harbor/taxes';
import { CatalogCategories } from './harbor/categories';
import { GameEggLibrary } from './harbor/eggs';
import { CouponManager } from './harbor/coupons';
const adminNav = [
  ['Overview', '/admin', LayoutDashboard],
  ['Services', '/admin/services', Server],
  ['Cancellations', '/admin/cancellations', Square],
  ['Customers', '/admin/customers', Users],
  ['Support', '/admin/tickets', CircleHelp],
  ['Products', '/admin/products', Package],
  ['Game eggs', '/admin/eggs', Gamepad2],
  ['Pricing', '/admin/pricing', CreditCard],
  ['Coupons', '/admin/coupons', CreditCard],
  ['Taxes', '/admin/taxes', CreditCard],
  ['Orders', '/admin/orders', ShoppingBag],
  ['Invoices', '/admin/invoices', CreditCard],
  ['Payment reviews', '/admin/payment-reviews', CreditCard],
  ['Wallets', '/admin/wallets', CreditCard],
  ['Infrastructure', '/admin/nodes', Boxes],
  ['Proxmox', '/admin/proxmox', Boxes],
  ['Operations', '/admin/operations', Activity],
  ['Extensions', '/admin/extensions', Code2],
  ['Themes', '/admin/themes', Palette],
  ['Settings', '/admin/settings', Settings2],
  ['System', '/admin/system', Activity],
  ['API access', '/admin/api-keys', Code2],
] as const;

const customerNav = [
  ['Overview', '/dashboard', LayoutDashboard],
  ['My services', '/dashboard/services', Server],
  ['Cart', '/dashboard/cart', ShoppingBag],
  ['Invoices', '/dashboard/invoices', CreditCard],
  ['Wallet', '/dashboard/wallet', CreditCard],
  ['Account', '/dashboard/account', ShieldCheck],
  ['API keys', '/dashboard/api-keys', Code2],
  ['Support', '/dashboard/tickets', CircleHelp],
] as const;

function Shell({ user, settings, children }: { user: Row; settings: Row; children: ReactNode }) {
  const pathname = usePathname();
  const admin =
    pathname.startsWith('/admin') ||
    extensionPages(settings).find((p) => p.href === pathname)?.area === 'admin';
  const nav = admin ? adminNav : customerNav;
  const extraPages = extensionPages(settings).filter(
    (p) => p.area === (admin ? 'admin' : 'customer'),
  );
  const items = [
    ...nav.map(([label, href]) => ({ label, href, icon: label })),
    ...extraPages.map((p) => ({ label: p.label, href: p.href, icon: 'Extensions' })),
  ];
  return (
    <ExtensionLayout area={admin ? 'admin' : 'customer'} settings={settings} user={user}>
      <WorkspaceShell
        companyName={settings.companyName}
        user={{ name: user.name, email: user.email, role: user.role }}
        admin={admin}
        pathname={pathname}
        storefrontEnabled={settings.storefrontEnabled}
        items={items}
        themeToggle={<ThemeToggle />}
        sidebarExtra={
          <ExtensionSlot
            name="sidebar.navigation"
            area={admin ? 'admin' : 'customer'}
            settings={settings}
            user={user}
          />
        }
        onSignOut={async () => {
          try {
            await api.post('/auth/logout');
            window.location.assign('/login');
          } catch (error) {
            toast.error(getErrorMessage(error));
          }
        }}
      >
        {!admin && <Announcement settings={settings} area="customer" />}
        {!admin && settings.access?.requireVerifiedEmail && !user.emailVerifiedAt && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs">
            <span>Verify your email address before placing a new hosting order.</span>
            <Link className="font-medium underline underline-offset-4" href="/dashboard/account">
              Verify email
            </Link>
          </div>
        )}
        {children}
      </WorkspaceShell>
    </ExtensionLayout>
  );
}

function Overview({ admin, user }: { admin: boolean; user: Row }) {
  const d = useData<Row>('/dashboard', 15000),
    services = useData<Row[]>('/services', 15000),
    nodes = useData<Row[]>(admin ? '/nodes' : null, 30000),
    activity = useData<Row[]>(admin ? '/audit' : null);
  if (d.error) return <ErrorBox error={d.error} retry={d.mutate} />;
  if (!d.data) return <Loading />;
  const icons = [CreditCard, Server, CreditCard, Users];
  return (
    <>
      <Header
        eyebrow={admin ? 'Company overview' : 'Your workspace'}
        title={
          admin ? 'Overview' : `Welcome back${user.name ? ', ' + user.name.split(' ')[0] : ''}.`
        }
        description={
          admin
            ? 'Monitor your business, services, and infrastructure.'
            : 'Everything you host, right where you need it.'
        }
        action={
          <Button asChild>
            <Link href={admin ? '/admin/products' : '/store'}>
              <Plus className="size-4" />
              {admin ? 'Manage products' : 'Deploy a service'}
            </Link>
          </Button>
        }
      />
      <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {d.data.metrics.map((m: Row, i: number) => {
          const Icon = icons[i] || Activity;
          return (
            <Panel key={m.key}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{m.label}</span>
                <Icon className="size-4 text-muted-foreground" />
              </div>
              <p className="mt-4 text-[28px] font-semibold tracking-[-.04em] tabular-nums">
                {m.format === 'currency'
                  ? money(m.value, d.data!.currency)
                  : m.value.toLocaleString()}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {m.description || 'Across your workspace'}
              </p>
            </Panel>
          );
        })}
      </Stagger>
      {d.data.currencyTotals?.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-4 rounded-lg border p-4 text-xs text-muted-foreground">
          {d.data.currencyTotals.map((t: Row) => (
            <span key={t.currency}>
              {t.currency}:{' '}
              <strong className="text-foreground">{money(t.amount, t.currency)}</strong>
            </span>
          ))}
        </div>
      )}
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.8fr_1fr]">
        <Panel
          title={admin ? 'Collections overview' : 'Payment overview'}
          description="Recorded payments over the last 30 days"
          action={
            <span className="rounded-md border px-2 py-1 text-[10px] text-muted-foreground">
              Last 30 days
            </span>
          }
        >
          <RevenueChart points={d.data.revenueSeries || []} currency={d.data.currency} />
        </Panel>
        <Panel
          title={admin ? 'Infrastructure' : 'Your services'}
          description={admin ? 'Connected hosting providers' : 'Service availability at a glance'}
        >
          {admin ? (
            nodes.error ? (
              <ErrorBox error={nodes.error} />
            ) : !nodes.data ? (
              <Loading />
            ) : !nodes.data.length ? (
              <div className="flex h-52 flex-col items-center justify-center text-center">
                <span className="flex size-11 items-center justify-center rounded-xl bg-muted">
                  <Boxes className="size-5 text-muted-foreground" />
                </span>
                <p className="mt-3 text-sm font-medium">Ready for your first node</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Connect Wings, Proxmox, Plesk, or Harbor Web.
                </p>
                <Link
                  href="/admin/nodes"
                  className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-primary"
                >
                  Connect infrastructure
                  <ArrowRight className="size-3" />
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {nodes.data.slice(0, 5).map((n) => (
                  <div key={n.id} className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/40">
                      <Server className="size-4 text-muted-foreground" />
                    </span>
                    <div className="flex-1">
                      <p className="text-xs font-medium">{n.name}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{n.provider}</p>
                    </div>
                    <StatusBadge status={n.status} />
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-4">
              {['game', 'vps', 'web'].map((kind) => {
                const Icon = kindIcon(kind);
                return (
                  <div key={kind} className="flex items-center gap-3 rounded-lg bg-muted/30 p-3">
                    <Icon className="size-5 text-primary" />
                    <div className="flex-1 text-sm capitalize">
                      {kind === 'game'
                        ? 'Game servers'
                        : kind === 'vps'
                          ? 'Virtual servers'
                          : 'Web hosting'}
                    </div>
                    <span className="text-lg font-semibold">
                      {services.data?.filter((s) => s.kind === kind && s.status !== 'terminated')
                        .length || 0}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
      <div className="mt-7">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{admin ? 'Recent services' : 'Your services'}</h2>
          <Link
            href={admin ? '/admin/services' : '/dashboard/services'}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            View all
            <ArrowRight className="size-3" />
          </Link>
        </div>
        {services.error ? (
          <ErrorBox error={services.error} />
        ) : !services.data ? (
          <Loading />
        ) : !services.data.length ? (
          <Empty
            icon={Server}
            title="Your next service starts here"
            description={
              admin
                ? 'Connect a provider and publish a hosting plan. Customer orders will appear here.'
                : 'Choose a hosting plan to bring your next project online.'
            }
            action={
              <Button asChild variant="outline">
                <Link href={admin ? '/admin/nodes' : '/store'}>
                  {admin ? 'Connect a provider' : 'Explore hosting'}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            }
          />
        ) : (
          <ServiceTable rows={services.data.slice(0, 5)} admin={admin} />
        )}
      </div>
      {admin && !!activity.data?.length && (
        <Panel title="Recent activity" className="mt-6">
          <div className="space-y-4">
            {activity.data.slice(0, 4).map((a) => (
              <div key={a.id} className="flex items-center gap-3 text-xs">
                <span className="size-1.5 rounded-full bg-primary" />
                <span className="flex-1">{a.action.replaceAll('.', ' ')}</span>
                <span className="text-muted-foreground">{date(a.createdAt)}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

function RevenueChart({ points, currency }: { points: Row[]; currency: string }) {
  const max = Math.max(100, ...points.map((p) => p.revenue));
  const has = points.some((p) => p.revenue > 0);
  const line = points
    .map(
      (p, i) =>
        `${45 + (i / Math.max(1, points.length - 1)) * 660},${185 - (p.revenue / max) * 145}`,
    )
    .join(' ');
  return (
    <div className="relative">
      <svg
        viewBox="0 0 740 230"
        className="h-[230px] w-full"
        role="img"
        aria-label="Recorded payments over the last 30 days"
      >
        <defs>
          <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity=".18" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <line
              x1="45"
              y1={40 + i * 48}
              x2="705"
              y2={40 + i * 48}
              stroke="var(--border)"
              strokeDasharray="3 4"
            />
            <text x="0" y={44 + i * 48} fill="var(--muted-foreground)" fontSize="10">
              {money(Math.round(max * (1 - i / 3)), currency)}
            </text>
          </g>
        ))}
        {has && (
          <>
            <polygon points={`45,185 ${line} 705,185`} fill="url(#revenue-fill)" />
            <polyline
              points={line}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          </>
        )}
        {[0, 7, 14, 21, 29]
          .filter((i) => points[i])
          .map((i) => (
            <text
              key={i}
              x={45 + (i / 29) * 660}
              y="215"
              textAnchor={i === 0 ? 'start' : i === 29 ? 'end' : 'middle'}
              fill="var(--muted-foreground)"
              fontSize="10"
            >
              {new Date(points[i].date).toLocaleDateString('en', {
                month: 'short',
                day: 'numeric',
              })}
            </text>
          ))}
      </svg>
      {!has && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-md border border-border/70 bg-card/95 px-3 py-2 text-xs text-muted-foreground">
            Payments will appear here as your business grows
          </span>
        </div>
      )}
    </div>
  );
}

export function Harbor() {
  const path = usePathname(),
    router = useRouter();
  const setup = useData<Row>('/setup');
  const settings = useData<Row>('/settings', 30000);
  const publicRoute = [
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/store',
    '/setup',
    '/',
  ].includes(path);
  const auth = useData<Row>(!publicRoute ? '/auth/me' : path === '/store' ? '/auth/me' : null);
  useEffect(() => {
    if (setup.data && !setup.data.completed && path !== '/setup') router.replace('/setup');
    else if (setup.data?.completed && path === '/setup') router.replace('/login');
    if (path === '/' && setup.data?.completed && settings.data)
      router.replace(settings.data.storefrontEnabled ? '/store' : '/login');
    if (!publicRoute && auth.error?.status === 401) router.replace('/login');
  }, [setup.data, settings.data, auth.error, path, router, publicRoute]);
  if (setup.error || settings.error)
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <Brand />
        <div className="mt-10">
          <ErrorBox
            error={setup.error || settings.error}
            retry={() => {
              void setup.mutate();
              void settings.mutate();
            }}
          />
        </div>
      </main>
    );
  if (!setup.data || !settings.data) return <Loading />;
  if (!setup.data.completed) return path === '/setup' ? <Setup /> : <Loading />;
  if (path === '/setup' || path === '/') return <Loading />;
  if (path === '/verify-email') return <VerifyEmail settings={settings.data} />;
  if (
    settings.data.access?.maintenanceEnabled &&
    auth.data?.role !== 'admin' &&
    !['/login', '/forgot-password', '/reset-password'].includes(path)
  )
    return <Maintenance settings={settings.data} />;
  if (path === '/store') return <Store settings={settings.data} user={auth.data} />;
  if (publicRoute) return <AuthScreen mode={path.slice(1)} settings={settings.data} />;
  if (!auth.data) return <Loading />;
  const user = auth.data;
  if (user.role === 'admin' && settings.data.access?.requireStaffTwoFactor && !user.totpEnabled)
    return (
      <Shell user={user} settings={settings.data}>
        <div className="mb-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
          Set up two-factor authentication to access staff tools.
        </div>
        <Account user={user} />
      </Shell>
    );
  const pluginPage = extensionPages(settings.data).find((p) => p.href === path);
  const admin = path.startsWith('/admin') || pluginPage?.area === 'admin';
  if (admin && user.role !== 'admin')
    return (
      <div className="m-10">
        <ErrorBox error={new Error('Administrator access is required.')} />
        <Link href="/dashboard" className="mt-5 block text-primary">
          Return to your dashboard
        </Link>
      </div>
    );
  const section = path.split('/')[2] || 'overview';
  const id = path.split('/')[3];
  let content: ReactNode;
  if (section === 'overview') content = <Overview admin={admin} user={user} />;
  else if (section === 'services')
    content = id ? <ServiceDetail id={id} admin={admin} /> : <Services admin={admin} />;
  else if (section === 'invoices') content = <Invoices id={id} admin={admin} />;
  else if (section === 'cart') content = <CartPage />;
  else if (section === 'tickets') content = <SupportTickets id={id} admin={admin} />;
  else if (section === 'wallet' || (admin && section === 'wallets'))
    content = <WalletPage admin={admin} />;
  else if (admin && section === 'nodes') content = <Nodes />;
  else if (admin && section === 'proxmox') content = <ProxmoxWorkspace />;
  else if (admin && section === 'cancellations') content = <CancellationPage />;
  else if (admin && section === 'payment-reviews') content = <PaymentReviews />;
  else if (admin && section === 'taxes') content = <TaxSettings />;
  else if (admin && section === 'categories') content = <CatalogCategories />;
  else if (admin && section === 'eggs') content = <GameEggLibrary />;
  else if (admin && section === 'products')
    content = id ? <ProductConfiguration key={id} id={id} /> : <Products />;
  else if (admin && section === 'pricing') content = <RegionalPricing />;
  else if (admin && section === 'coupons') content = <CouponManager />;
  else if (admin && section === 'customers') content = <Customers key={id || 'list'} id={id} />;
  else if (admin && ['orders', 'operations'].includes(section))
    content = <Records kind={section as 'orders' | 'operations'} />;
  else if (admin && section === 'extensions') content = <ExtensionsPage />;
  else if (admin && section === 'themes') content = <ExtensionsPage themes />;
  else if (admin && section === 'settings') content = <SettingsPage />;
  else if (admin && section === 'system') content = <SystemWorkspace />;
  else if (section === 'api-keys') content = <ApiKeysPage user={user} admin={admin} />;
  else if (section === 'account') content = <Account user={user} />;
  else if (path.startsWith('/extensions/'))
    content = (
      <ExtensionPage area={admin ? 'admin' : 'customer'} settings={settings.data} user={user} />
    );
  else
    content = (
      <Empty title="Page not found" description="Choose an area from the navigation to continue." />
    );
  return (
    <Shell user={user} settings={settings.data}>
      {content}
    </Shell>
  );
}
