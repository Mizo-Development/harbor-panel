'use client';
import { InvoiceComposer } from './invoice-composer';
import { InvoiceDelivery } from './invoice-delivery';
import { NodeInstaller } from './node-installer';
import { requestId } from '@/lib/request-id';
import { parseCurrencyAmount, currencyScale } from '@/lib/currency';
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
} from './shared';
import { ProxmoxPlanFields } from './proxmox';
import {
  CompanyBillingFields,
  InvoiceBilling,
  formGroup,
  WalletSettingsFields,
  walletSettingsFromForm,
} from './billing';
export function Nodes() {
  const q = useData<Row[]>('/nodes', 30000);
  const [modal, setModal] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    [config, setConfig] = useState<Row | null>(null),
    [installNode, setInstallNode] = useState<Row | null>(null);
  const [provider, setProvider] = useState('wings');
  const { mutate } = useSWRConfig();
  const check = async (id: string) => {
    try {
      const r = await mutateAction(
        () => api.post<Row>(`/nodes/${id}/check`),
        'Connection verified',
      );
      if (r.plans) setConfig({ title: 'Available Plesk service plans', content: r.plans });
      void q.mutate();
    } catch {
      void q.mutate();
    }
  };
  return (
    <>
      <Header
        eyebrow="Infrastructure"
        title="Infrastructure"
        description="Connect the machines and platforms that power your hosting."
        action={
          <Button onClick={() => setModal(true)}>
            <Plus className="size-4" />
            Connect provider
          </Button>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['wings', 'Pterodactyl Wings', 'Game hosting', Gamepad2],
          ['proxmox', 'Proxmox VE', 'Virtual servers', Boxes],
          ['plesk', 'Plesk Obsidian', 'Managed web hosting', Globe2],
          ['native-web', 'Harbor Web', 'Native web hosting', Cloud],
        ].map(([id, name, desc, I]) => {
          const Icon = I as LucideIcon;
          return (
            <button
              key={id as string}
              onClick={() => {
                setProvider(id as string);
                setModal(true);
              }}
              className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary/40"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/8 text-primary">
                <Icon className="size-5" />
              </span>
              <div>
                <p className="text-xs font-semibold">{name as string}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{desc as string}</p>
              </div>
              <Plus className="ml-auto size-4 text-muted-foreground" />
            </button>
          );
        })}
      </div>
      {q.error ? (
        <ErrorBox error={q.error} retry={q.mutate} />
      ) : !q.data ? (
        <Loading />
      ) : !q.data.length ? (
        <Empty
          icon={Boxes}
          title="Connect your first provider"
          description="Use Wings on this machine or a remote node, connect a Proxmox cluster, or add a Plesk or Harbor Web server."
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {q.data.map((n) => (
            <Panel key={n.id}>
              <div className="flex items-start gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl border bg-muted/40">
                  <Server className="size-5 text-primary" />
                </span>
                <div className="flex-1">
                  <h2 className="font-semibold">{n.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{n.provider}</p>
                </div>
                <StatusBadge status={n.status} />
              </div>
              <p className="mt-5 truncate rounded-md bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                {n.url}
              </p>
              <div className="mt-4 flex justify-between text-xs text-muted-foreground">
                <span>{n.products} products</span>
                <span>{n.allocations} allocations</span>
              </div>
              <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
                <Button size="sm" variant="outline" onClick={() => void check(n.id)}>
                  <RefreshCw className="size-3.5" />
                  Check connection
                </Button>
                {['wings', 'proxmox'].includes(n.provider) && (
                  <Button size="sm" variant="outline" onClick={() => setSelected(n)}>
                    Allocations
                  </Button>
                )}
                {n.provider === 'proxmox' && (
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/admin/proxmox">Manage Proxmox</Link>
                  </Button>
                )}
                {n.provider === 'wings' && (
                  <Button size="sm" variant="outline" onClick={() => setInstallNode(n)}>
                    <Terminal className="size-3.5" />
                    Install node
                  </Button>
                )}
                {n.provider === 'wings' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void api
                        .get<Row>(`/nodes/${n.id}/configuration`)
                        .then((r) => setConfig({ title: 'Wings configuration', content: r }))
                        .catch((e) => toast.error(getErrorMessage(e)))
                    }
                  >
                    Configuration
                  </Button>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
      {installNode && (
        <NodeInstaller
          node={installNode}
          close={() => setInstallNode(null)}
          onComplete={() => void q.mutate()}
        />
      )}
      {modal && (
        <Modal
          title="Connect a hosting provider"
          description="Credentials are encrypted and only used by the backend."
          close={() => setModal(false)}
        >
          <Form
            close={() => setModal(false)}
            submit="Save connection"
            onSubmit={async (f) => {
              const secret: Row = {},
                config: Row = {};
              for (const [k, v] of f.entries()) {
                if (k.startsWith('secret.')) secret[k.slice(7)] = v;
                if (k.startsWith('config.')) config[k.slice(7)] = v;
              }
              const created = await api.post<Row>('/nodes', {
                name: f.get('name'),
                provider,
                url: f.get('url'),
                secret,
                config,
              });
              setModal(false);
              await q.mutate();
              toast.success('Connection saved. Check connectivity before publishing plans.');
              if (provider === 'wings')
                setInstallNode({ ...created, url: String(f.get('url')), config });
            }}
          >
            <Field label="Provider">
              <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                {[
                  ['wings', 'Pterodactyl Wings'],
                  ['proxmox', 'Proxmox VE'],
                  ['plesk', 'Plesk Obsidian'],
                  ['native-web', 'Harbor Web'],
                ].map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Connection name">
              <Input name="name" placeholder="e.g. Frankfurt game node" required />
            </Field>
            <Field
              label="Endpoint URL"
              hint="Use HTTPS in production. Include the provider’s port if required."
            >
              <Input
                name="url"
                type="url"
                placeholder={
                  provider === 'proxmox'
                    ? 'https://pve.example.com:8006'
                    : provider === 'plesk'
                      ? 'https://plesk.example.com:8443'
                      : 'https://node.example.com:8081'
                }
                required
              />
            </Field>
            {provider === 'wings' ? (
              <>
                <div className="rounded-lg bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
                  Leave both credentials empty to generate a new node identity. After saving,
                  generate an install command to set up Docker, Wings and the connection on your
                  VPS.
                </div>
                <Field label="Token ID">
                  <Input name="secret.tokenId" autoComplete="off" />
                </Field>
                <Field label="Daemon token">
                  <Input name="secret.token" type="password" autoComplete="new-password" />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="TLS termination">
                    <Select name="config.behindProxy" defaultValue="false">
                      <option value="false">Wings TLS certificate</option>
                      <option value="true">Local reverse proxy</option>
                    </Select>
                  </Field>
                  <Field label="Daemon listen port">
                    <Input
                      name="config.listenPort"
                      type="number"
                      min={1024}
                      max={65535}
                      defaultValue={8081}
                    />
                  </Field>
                </div>
                <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  Game software is configured through each plan’s egg. Paper automatically fetches
                  its latest stable release and verifies the official checksum. No download URL is
                  required.
                </p>
              </>
            ) : provider === 'proxmox' ? (
              <>
                <Field label="API token ID">
                  <Input name="secret.tokenId" placeholder="harbor@pve!panel" required />
                </Field>
                <Field label="API token secret">
                  <Input name="secret.tokenSecret" type="password" required />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Node name">
                    <Input name="config.node" placeholder="pve01" required />
                  </Field>
                  <Field label="Storage">
                    <Input name="config.storage" placeholder="local-lvm" required />
                  </Field>
                  <Field label="Network bridge">
                    <Input name="config.bridge" defaultValue="vmbr0" required />
                  </Field>
                  <Field label="Backup storage">
                    <Input name="config.backupStorage" placeholder="backup" />
                  </Field>
                </div>
              </>
            ) : provider === 'plesk' ? (
              <>
                <Field label="XML API access key">
                  <Input name="secret.apiKey" type="password" required />
                </Field>
                <Field label="Hosting IPv4 address">
                  <Input name="config.ip" placeholder="203.0.113.10" required />
                </Field>
                <p className="text-xs leading-5 text-muted-foreground">
                  Use a licensed Plesk Obsidian Linux server. Existing service plans should have
                  email hosting disabled. Check the connection to list plans.
                </p>
              </>
            ) : (
              <Field label="Agent token">
                <Input name="secret.token" type="password" minLength={64} required />
              </Field>
            )}
          </Form>
        </Modal>
      )}
      {selected && <AllocationModal node={selected} close={() => setSelected(null)} />}
      {config && (
        <Modal title={config.title} close={() => setConfig(null)}>
          <p className="mb-3 text-xs text-muted-foreground">
            Configuration contains credentials. Keep it private.
          </p>
          <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs">
            {JSON.stringify(config.content, null, 2)}
          </pre>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() =>
              void navigator.clipboard
                .writeText(JSON.stringify(config.content?.config || config.content, null, 2))
                .then(() => toast.success('Copied'))
            }
          >
            <Copy className="size-4" />
            Copy configuration
          </Button>
        </Modal>
      )}
    </>
  );
}

export function AllocationModal({ node, close }: { node: Row; close: () => void }) {
  const q = useData<Row[]>(`/nodes/${node.id}/resources`);
  return (
    <Modal
      title={`${node.name} allocations`}
      description="Reserve IPs or game ports before accepting orders."
      close={close}
    >
      {q.data && (
        <div className="mb-5 max-h-40 overflow-auto rounded-lg border">
          {q.data.length ? (
            q.data.map((r) => (
              <div key={r.id} className="flex justify-between border-b p-3 text-xs last:border-0">
                <span className="font-mono">{r.value}</span>
                <span className="text-muted-foreground">
                  {r.serviceId ? 'Reserved' : 'Available'}
                </span>
              </div>
            ))
          ) : (
            <p className="p-4 text-xs text-muted-foreground">No allocations added.</p>
          )}
        </div>
      )}
      <Form
        submit="Add allocation"
        onSubmit={async (f) => {
          const config =
            node.provider === 'wings'
              ? { ip: f.get('ip'), port: Number(f.get('port')) }
              : { gateway: f.get('gateway') };
          await api.post(`/nodes/${node.id}/resources`, {
            kind: node.provider === 'wings' ? 'allocation' : 'ip',
            value: node.provider === 'wings' ? `${f.get('ip')}:${f.get('port')}` : f.get('ip'),
            config,
          });
          await q.mutate();
          toast.success('Allocation added');
        }}
      >
        <Field label={node.provider === 'wings' ? 'IP address' : 'IP address with CIDR prefix'}>
          <Input
            name="ip"
            placeholder={node.provider === 'wings' ? '203.0.113.10' : '203.0.113.10/24'}
            required
          />
        </Field>
        {node.provider === 'wings' ? (
          <Field label="Port">
            <Input name="port" type="number" min={1024} max={65535} defaultValue={25565} required />
          </Field>
        ) : (
          <Field label="Gateway">
            <Input name="gateway" placeholder="203.0.113.1" required />
          </Field>
        )}
      </Form>
    </Modal>
  );
}

export { CatalogProducts as Products } from './products';

export function ExtensionsPage({ themes = false }: { themes?: boolean }) {
  const q = useData<Row[]>('/extensions'),
    settings = useData<Row>('/settings');
  const [configure, setConfigure] = useState<Row | null>(null),
    [upload, setUpload] = useState(false);
  return (
    <>
      <Header
        eyebrow="Make it yours"
        title={themes ? 'Themes' : 'Extensions'}
        description={
          themes
            ? 'Customize your storefront, customer area, and admin workspace.'
            : 'Add integrations, gateways, and functionality through the Harbor SDK.'
        }
        action={
          <Button onClick={() => setUpload(true)}>
            <Plus className="size-4" />
            Install {themes ? 'theme' : 'plugin'}
          </Button>
        }
      />
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-xs leading-6 text-muted-foreground">
          {themes
            ? 'Themes can target all three areas. The default Harbor theme remains available as a fallback.'
            : 'Plugins run trusted server code. Review the developer, compatibility, and declared access before installation. Custom plugins require an API and worker restart after activation.'}
        </p>
      </div>
      {q.error ? (
        <ErrorBox error={q.error} retry={q.mutate} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {q.data
            .filter((e) => (themes ? e.type === 'theme' : e.type !== 'theme'))
            .map((e) => (
              <Panel key={e.id}>
                <div className="flex items-start gap-3">
                  <span className="flex size-11 items-center justify-center rounded-xl border bg-muted/40">
                    {themes ? (
                      <Palette className="size-5 text-primary" />
                    ) : (
                      <Code2 className="size-5 text-primary" />
                    )}
                  </span>
                  <div className="flex-1">
                    <h2 className="text-sm font-semibold">{e.name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      v{e.version} · {e.builtin ? 'Included' : 'Custom package'}
                    </p>
                  </div>
                  <StatusBadge
                    status={e.enabled ? 'active' : 'draft'}
                    label={e.enabled ? 'Enabled' : 'Disabled'}
                  />
                </div>
                {themes && (
                  <div className="mt-5 flex h-28 overflow-hidden rounded-lg border">
                    <div className="w-1/4 bg-[#ecf1f2] dark:bg-[#09090b]" />
                    <div className="flex-1 bg-[#f8fafa] p-3 dark:bg-[#101012]">
                      <div className="h-2 w-1/3 rounded bg-zinc-400" />
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {[1, 2, 3].map((x) => (
                          <div key={x} className="h-10 rounded border bg-white dark:bg-[#18181b]" />
                        ))}
                      </div>
                      <div className="mt-2 h-5 rounded border bg-white dark:bg-[#18181b]" />
                    </div>
                  </div>
                )}
                <p className="mt-4 min-h-10 text-xs leading-6 text-muted-foreground">
                  {e.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {e.permissions?.map((p: string) => (
                    <span
                      key={p}
                      className="rounded border bg-muted/30 px-2 py-1 font-mono text-[9px] text-muted-foreground"
                    >
                      {p}
                    </span>
                  ))}
                </div>
                <p className="mt-4 flex items-center gap-1.5 text-[11px] text-primary">
                  <CheckCircle2 className="size-3" />
                  Compatible with SDK {e.sdkVersion}
                </p>
                {e.lastError && (
                  <p role="alert" className="mt-3 text-xs text-destructive">
                    {e.lastError}
                  </p>
                )}
                {e.restartRequired && (
                  <p className="mt-3 text-xs text-warning">
                    Restart required to activate this package.
                  </p>
                )}
                <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={e.id === 'harbor-default'}
                    onClick={() =>
                      void mutateAction(() =>
                        api.patch(`/extensions/${e.id}`, { enabled: !e.enabled }),
                      )
                        .then(() => q.mutate())
                        .catch(() => {})
                    }
                  >
                    {e.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  {['stripe', 'paypal'].includes(e.id) && (
                    <Button size="sm" variant="ghost" onClick={() => setConfigure(e)}>
                      <Settings2 className="size-3.5" />
                      {e.configured ? 'Update credentials' : 'Configure'}
                    </Button>
                  )}
                  {themes && e.enabled && (
                    <Button size="sm" variant="ghost" onClick={() => setConfigure(e)}>
                      Apply theme
                    </Button>
                  )}
                </div>
              </Panel>
            ))}
        </div>
      )}
      {configure && (
        <Modal
          title={themes ? 'Apply theme' : `Configure ${configure.name}`}
          close={() => setConfigure(null)}
        >
          <Form
            submit={themes ? 'Apply theme' : 'Save credentials'}
            close={() => setConfigure(null)}
            onSubmit={async (f) => {
              if (themes) {
                const ids: Row = {};
                for (const area of ['admin', 'customer', 'storefront'])
                  ids[area] =
                    f.get(area) === 'on'
                      ? configure.id
                      : settings.data?.themes?.[area]?.id || 'harbor-default';
                await api.patch('/settings', { themes: ids });
                await settings.mutate();
              } else {
                const secret: Row = {};
                for (const [k, v] of f.entries()) secret[k] = v;
                await api.patch(`/extensions/${configure.id}/config`, { secret });
              }
              setConfigure(null);
              await q.mutate();
              toast.success('Configuration saved');
            }}
          >
            {themes ? (
              ['admin', 'customer', 'storefront'].map((area) => (
                <label key={area} className="flex items-center gap-3 text-sm capitalize">
                  <input
                    type="checkbox"
                    name={area}
                    defaultChecked={configure.areas?.includes(area)}
                    disabled={!configure.areas?.includes(area)}
                  />{' '}
                  {area}
                </label>
              ))
            ) : configure.id === 'stripe' ? (
              <>
                <Field label="Stripe secret key">
                  <Input name="secretKey" type="password" required />
                </Field>
                <Field label="Webhook signing secret">
                  <Input name="webhookSecret" type="password" required />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Webhook URL: {typeof window !== 'undefined' ? window.location.origin : ''}
                  /api/v1/webhooks/stripe
                </p>
              </>
            ) : (
              <>
                <Field label="Client ID">
                  <Input name="clientId" required />
                </Field>
                <Field label="Client secret">
                  <Input name="clientSecret" type="password" required />
                </Field>
                <Field label="Webhook ID">
                  <Input name="webhookId" required />
                </Field>
                <Field label="Environment">
                  <Select name="environment">
                    <option value="sandbox">Sandbox</option>
                    <option value="live">Live</option>
                  </Select>
                </Field>
                <p className="text-xs text-muted-foreground">
                  Webhook URL: {typeof window !== 'undefined' ? window.location.origin : ''}
                  /api/v1/webhooks/paypal
                </p>
              </>
            )}
          </Form>
        </Modal>
      )}
      {upload && (
        <Modal
          title={`Install a ${themes ? 'theme' : 'plugin'}`}
          description="Upload a .tgz package containing harbor.json. Packages install disabled for review."
          close={() => setUpload(false)}
        >
          <Form
            submit="Validate and install"
            close={() => setUpload(false)}
            onSubmit={async (f) => {
              const response = await fetch('/api/v1/extensions/install', {
                method: 'POST',
                body: f,
              });
              const body = await response.json();
              if (!response.ok) throw new Error(body.error?.message || 'Installation failed');
              setUpload(false);
              await q.mutate();
              toast.success(body.data.message);
            }}
          >
            <Field
              label="Extension package"
              hint="Maximum upload: 10 MiB. Only install code from developers you trust."
            >
              <Input type="file" name="file" accept=".tgz,.gz" required className="h-auto py-3" />
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}

export { SettingsPage } from './settings';

export function Records({ kind }: { kind: 'customers' | 'orders' | 'operations' }) {
  const q = useData<Row[]>(`/${kind}`, kind === 'operations' ? 5000 : 0);
  const cols =
    kind === 'customers'
      ? [
          {
            label: 'Customer',
            render: (r: Row) => (
              <div>
                <p className="font-medium">{r.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{r.email}</p>
              </div>
            ),
          },
          { label: 'Services', render: (r: Row) => r._count?.services || 0 },
          { label: 'Invoices', render: (r: Row) => r._count?.invoices || 0 },
          { label: 'Joined', render: (r: Row) => date(r.createdAt) },
        ]
      : kind === 'orders'
        ? [
            {
              label: 'Order',
              render: (r: Row) => <span className="font-mono text-xs">#{r.id.slice(0, 8)}</span>,
            },
            { label: 'Customer', render: (r: Row) => r.user?.email },
            { label: 'Product', render: (r: Row) => r.product?.name },
            {
              label: 'Service',
              render: (r: Row) => (
                <StatusBadge status={r.service?.status?.toLowerCase() || 'pending'} />
              ),
            },
            { label: 'Created', render: (r: Row) => date(r.createdAt) },
          ]
        : [
            {
              label: 'Operation',
              render: (r: Row) => <span className="capitalize">{r.action}</span>,
            },
            { label: 'Service', render: (r: Row) => r.service?.name },
            {
              label: 'Status',
              render: (r: Row) => <StatusBadge status={r.status.toLowerCase()} />,
            },
            {
              label: 'Details',
              render: (r: Row) => (
                <span
                  className="inline-block max-w-sm truncate text-xs text-muted-foreground"
                  title={r.error}
                >
                  {r.error || '—'}
                </span>
              ),
            },
            {
              label: '',
              render: (r: Row) =>
                r.status === 'FAILED' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (
                        window.confirm(
                          'Check the provider for existing resources first. Retry this failed operation?',
                        )
                      )
                        void mutateAction(
                          () => api.post(`/operations/${r.id}/retry`),
                          'Operation queued',
                        )
                          .then(() => q.mutate())
                          .catch(() => {});
                    }}
                  >
                    Retry
                  </Button>
                ) : null,
            },
          ];
  return (
    <>
      <Header
        eyebrow="Workspace"
        title={kind[0].toUpperCase() + kind.slice(1)}
        description={
          kind === 'operations'
            ? 'Track provisioning work and investigate failures before retrying.'
            : kind === 'customers'
              ? 'The people and projects behind your business.'
              : 'Every new project begins with an order.'
        }
      />
      {q.error ? (
        <ErrorBox error={q.error} retry={q.mutate} />
      ) : q.data ? (
        <DataTable rows={q.data} columns={cols} empty={`No ${kind} yet`} />
      ) : (
        <Loading />
      )}
    </>
  );
}

export function Invoices({ admin, id }: { admin: boolean; id?: string }) {
  const q = useData<Row[]>(`/invoices`, 10000),
    gateways = useData<Row[]>('/gateways');
  const invoiceCurrency = q.data?.find((i) => i.id === id)?.currency;
  const wallet = useData<Row>(
    !admin && invoiceCurrency ? `/wallet?currency=${invoiceCurrency}` : null,
    10000,
  );
  const search = useSearchParams();
  const router = useRouter();
  const [walletPart, setWalletPart] = useState<Row | null>(null),
    [voidTarget, setVoidTarget] = useState<Row | null>(null);
  const [confirm, setConfirm] = useState<Row | null>(null);
  useEffect(() => {
    if (id && search.get('gateway') === 'paypal')
      void api
        .post(`/invoices/${id}/paypal/capture`, { orderId: search.get('token') || undefined })
        .then(() => {
          toast.success('Payment confirmed');
          void q.mutate();
        })
        .catch((e) => toast.error(getErrorMessage(e)));
  }, [id, search]);
  const invoice = id ? q.data?.find((i) => i.id === id) : null;
  return (
    <>
      <Header
        eyebrow="Billing"
        title={id ? 'Invoice details' : 'Invoices'}
        description="Clear records for every payment and renewal."
        action={
          admin && !id ? (
            <InvoiceComposer
              created={async (newId) => {
                await q.mutate();
                router.push(`/admin/invoices/${newId}`);
              }}
            />
          ) : undefined
        }
      />
      {q.error ? (
        <ErrorBox error={q.error} retry={q.mutate} />
      ) : !q.data ? (
        <Loading />
      ) : id && !invoice ? (
        <Empty
          icon={CreditCard}
          title="Invoice not found"
          description="This invoice is unavailable or belongs to another account."
        />
      ) : invoice ? (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-primary">Invoice</p>
              <h2 className="mt-2 text-2xl font-semibold">{invoice.number}</h2>
              <p className="mt-3 text-sm text-muted-foreground">{invoice.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">Due {date(invoice.dueAt)}</p>
            </div>
            <StatusBadge
              status={invoice.status}
              label={
                invoice.paidAmount > 0 && invoice.status !== 'paid' && invoice.status !== 'void'
                  ? 'Part paid'
                  : undefined
              }
            />
          </div>
          <div className="my-8 flex items-center justify-between border-y py-6">
            <span className="text-sm text-muted-foreground">
              {invoice.isDemo ? 'Demo plan amount' : 'Invoice total'}
            </span>
            <span className="text-3xl font-semibold">{money(invoice.total, invoice.currency)}</span>
          </div>
          {!invoice.isDemo && (
            <div className="mb-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Applied payments</p>
                <p className="mt-2 text-lg font-semibold">
                  {money(invoice.paidAmount, invoice.currency)}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Balance due</p>
                <p className="mt-2 text-lg font-semibold">
                  {money(invoice.balanceDue, invoice.currency)}
                </p>
              </div>
            </div>
          )}
          {invoice.voidReason && (
            <p className="mb-4 rounded-lg border p-3 text-sm text-muted-foreground">
              Voided: {invoice.voidReason}
            </p>
          )}
          {invoice.kind === 'WALLET_FUNDING' && (
            <div className="mb-5 rounded-lg border bg-muted/20 p-4 text-sm">
              <p>
                Wallet funding invoice. No service tax is charged. Funds are credited once full
                payment is verified.
              </p>
              {invoice.status === 'paid' && (
                <p className="mt-2">
                  {invoice.walletCreditedAt
                    ? 'Funds credited to your wallet.'
                    : 'Payment received; no wallet credit has been applied. Contact staff for reconciliation.'}
                </p>
              )}
              {admin && invoice.status === 'paid' && !invoice.walletCreditedAt && (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void api
                      .post(`/invoices/${invoice.id}/funding-credit`)
                      .then(() => q.mutate())
                      .catch((e) => toast.error(getErrorMessage(e)))
                  }
                >
                  Retry wallet credit
                </Button>
              )}
            </div>
          )}
          {!!invoice.linkedServices?.length && (
            <div className="my-5 space-y-3 rounded-lg border p-4">
              <h3 className="text-sm font-medium">Services in this checkout</h3>
              {invoice.linkedServices.map((link: Row) => (
                <div
                  key={link.serviceId}
                  className="flex items-center justify-between gap-3 border-t pt-3 text-xs"
                >
                  <Link
                    className="hover:underline"
                    href={`${admin ? '/admin' : '/dashboard'}/services/${link.serviceId}`}
                  >
                    {link.service.name}
                  </Link>
                  <span className="font-mono">{money(link.amount, invoice.currency)}</span>
                </div>
              ))}
              <p className="text-[11px] leading-6 text-muted-foreground">
                All services provision after full payment. Cancelling an unpaid checkout releases
                every service in this invoice.
              </p>
            </div>
          )}
          <InvoiceBilling invoice={invoice} />
          {admin && <InvoiceDelivery id={invoice.id} />}
          {['open', 'overdue'].includes(invoice.status) && invoice.isDemo && (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-muted-foreground">
                This is a demo order. The amount above is a pricing preview. No payment details are
                required and no money will be collected.
              </p>
              <Button
                onClick={() =>
                  void api
                    .post(`/invoices/${invoice.id}/demo-payment`)
                    .then(() => {
                      toast.success('Demo checkout completed. No charge was made.');
                      void q.mutate();
                    })
                    .catch((e) => toast.error(getErrorMessage(e)))
                }
              >
                Complete demo order
                <ArrowRight className="size-4" />
              </Button>
              <Button asChild variant="outline" className="ml-2">
                <Link href={`${admin ? '/admin' : '/dashboard'}/services/${invoice.serviceId}`}>
                  View demo service
                </Link>
              </Button>
            </div>
          )}
          {['open', 'overdue'].includes(invoice.status) &&
            invoice.canPay !== false &&
            !invoice.isDemo && (
              <>
                <p className="mb-4 text-sm text-muted-foreground">
                  Pay the outstanding balance using an available payment method. Hosting provisions
                  after the invoice is fully paid.
                </p>
                <div className="flex flex-wrap gap-3">
                  {!admin && invoice.kind !== 'WALLET_FUNDING' && (
                    <Button
                      variant="outline"
                      disabled={!wallet.data || wallet.data.balance < invoice.remaining}
                      onClick={() =>
                        void api
                          .post(`/invoices/${invoice.id}/wallet-payment`)
                          .then(() => {
                            toast.success('Wallet payment recorded');
                            void q.mutate();
                            void wallet.mutate();
                          })
                          .catch((e) => toast.error(getErrorMessage(e)))
                      }
                    >
                      Pay with wallet
                      {wallet.data ? ` · ${money(wallet.data.balance, wallet.data.currency)}` : ''}
                    </Button>
                  )}
                  {!admin && invoice.kind !== 'WALLET_FUNDING' && (
                    <Button
                      variant="outline"
                      disabled={!wallet.data?.balance}
                      onClick={() => setWalletPart({ ...invoice, idempotencyKey: requestId() })}
                    >
                      Pay part with wallet
                    </Button>
                  )}
                  {gateways.data?.map((g) => (
                    <Button
                      key={g.id}
                      variant={g.id === 'manual' ? 'outline' : 'default'}
                      onClick={() =>
                        void api
                          .post<Row>(`/invoices/${invoice.id}/checkout`, { gateway: g.id })
                          .then((r) => {
                            if (r.url) window.location.assign(r.url);
                            else toast.info(r.message);
                          })
                          .catch((e) => toast.error(getErrorMessage(e)))
                      }
                    >
                      <CreditCard className="size-4" />
                      {g.name}
                    </Button>
                  ))}
                  {admin && (
                    <Button variant="outline" onClick={() => setConfirm(invoice)}>
                      Record offline payment
                    </Button>
                  )}
                </div>
                {gateways.data?.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No payment gateways are configured. Contact your hosting company.
                  </p>
                )}
              </>
            )}
          {invoice.payments?.some((p: Row) => p.reviewRequired && !p.reviewedAt) && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm"
            >
              A receipt on this invoice requires staff reconciliation. Applied amounts and any
              excess are shown in the payment history.
            </p>
          )}
          {invoice.isDemo && invoice.status === 'paid' && (
            <Button asChild variant="outline" className="mb-4">
              <Link href={`${admin ? '/admin' : '/dashboard'}/services/${invoice.serviceId}`}>
                Manage demo service
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          )}
          {['open', 'overdue'].includes(invoice.status) &&
            invoice.kind === 'CART' &&
            (admin || invoice.paidAmount === 0) && (
              <Button variant="ghost" className="my-4" onClick={() => setVoidTarget(invoice)}>
                Cancel checkout
              </Button>
            )}
          {invoice.status === 'open' || invoice.status === 'overdue' ? (
            (invoice.kind === 'ADHOC' && admin) ||
            (invoice.kind === 'WALLET_FUNDING' && (admin || invoice.paidAmount === 0)) ? (
              <Button variant="ghost" className="my-4" onClick={() => setVoidTarget(invoice)}>
                Void invoice
              </Button>
            ) : null
          ) : null}
          {invoice.status === 'paid' && (
            <p className="flex items-center gap-2 text-sm text-primary">
              <CheckCircle2 className="size-4" />
              {invoice.isDemo
                ? 'Demo order completed — no payment collected'
                : invoice.total === 0
                  ? 'Covered by promotion — no payment collected'
                  : `Payment received ${date(invoice.paidAt)}`}
            </p>
          )}
        </Panel>
      ) : (
        <DataTable
          rows={q.data}
          empty="Invoices appear when orders are placed."
          columns={[
            {
              label: 'Invoice',
              render: (i) => (
                <Link
                  href={`${admin ? '/admin' : '/dashboard'}/invoices/${i.id}`}
                  className="font-mono text-xs font-medium text-primary"
                >
                  {i.number}
                </Link>
              ),
            },
            { label: 'Service', render: (i) => i.description },
            {
              label: 'Status',
              render: (i) => (
                <StatusBadge
                  status={i.status}
                  label={
                    i.paidAmount > 0 && ['open', 'overdue'].includes(i.status)
                      ? i.status === 'overdue'
                        ? 'Part paid · overdue'
                        : 'Part paid'
                      : undefined
                  }
                />
              ),
            },
            { label: 'Balance due', render: (i) => money(i.balanceDue, i.currency) },
            {
              label: 'Amount',
              render: (i) => (
                <span className="font-mono text-xs">{money(i.total, i.currency)}</span>
              ),
            },
            {
              label: 'Due',
              render: (i) => <span className="text-xs text-muted-foreground">{date(i.dueAt)}</span>,
            },
            {
              label: '',
              render: (i) => (
                <Link
                  href={`${admin ? '/admin' : '/dashboard'}/invoices/${i.id}`}
                  className="text-xs font-medium text-primary"
                >
                  View invoice
                  <ChevronRight className="ml-1 inline size-3" />
                </Link>
              ),
            },
          ]}
        />
      )}
      {walletPart && (
        <Modal title="Part payment from wallet" close={() => setWalletPart(null)}>
          <Form
            submit="Apply wallet payment"
            onSubmit={async (f) => {
              await api.post(`/invoices/${walletPart.id}/wallet-payment`, {
                amount: parseCurrencyAmount(String(f.get('amount')), walletPart.currency),
                idempotencyKey: walletPart.idempotencyKey,
              });
              await q.mutate();
              await wallet.mutate();
              setWalletPart(null);
              toast.success('Wallet payment applied');
            }}
          >
            <Field label={`Wallet payment amount (${walletPart.currency})`}>
              <Input
                name="amount"
                type="number"
                min={1 / currencyScale(walletPart.currency)}
                max={
                  Math.min(wallet.data?.balance || 0, walletPart.remaining) /
                  currencyScale(walletPart.currency)
                }
                step={1 / currencyScale(walletPart.currency)}
                defaultValue={
                  Math.min(wallet.data?.balance || 0, walletPart.remaining) /
                  currencyScale(walletPart.currency)
                }
                required
              />
            </Field>
          </Form>
        </Modal>
      )}
      {voidTarget && (
        <Modal
          title={voidTarget.kind === 'CART' ? 'Cancel unpaid checkout' : 'Void invoice'}
          description="Issued totals and receipts are retained. Applied funds require reconciliation; this action does not refund them."
          close={() => setVoidTarget(null)}
        >
          <Form
            submit={
              voidTarget.kind === 'CART' ? 'Confirm checkout cancellation' : 'Confirm invoice void'
            }
            onSubmit={async (f) => {
              await api.post(
                `/invoices/${voidTarget.id}/${voidTarget.kind === 'CART' ? 'cancel-checkout' : 'void'}`,
                { reason: f.get('reason') },
              );
              await q.mutate();
              setVoidTarget(null);
              toast.success('Invoice voided');
            }}
          >
            <Field label={voidTarget.kind === 'CART' ? 'Cancellation reason' : 'Void reason'}>
              <Input name="reason" minLength={5} maxLength={1000} required />
            </Field>
          </Form>
        </Modal>
      )}
      {confirm && (
        <Modal
          title="Record offline payment"
          description="Record only funds actually received. Partial payments reduce the balance; fulfillment waits until the invoice is fully paid."
          close={() => setConfirm(null)}
        >
          <Form
            submit="Confirm payment received"
            close={() => setConfirm(null)}
            onSubmit={async (f) => {
              await api.post(`/invoices/${confirm.id}/manual-payment`, {
                reference: f.get('reference'),
                amount: parseCurrencyAmount(String(f.get('amount')), confirm.currency),
              });
              setConfirm(null);
              await q.mutate();
              toast.success('Payment recorded');
            }}
          >
            <Field
              label="Bank or payment reference"
              hint="Use a unique reference for this payment."
            >
              <Input name="reference" minLength={3} required />
            </Field>
            <Field label={`Received amount (${confirm.currency})`}>
              <Input
                name="amount"
                type="number"
                min={1 / currencyScale(confirm.currency)}
                step={1 / currencyScale(confirm.currency)}
                defaultValue={confirm.remaining / currencyScale(confirm.currency)}
                required
              />
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}
