'use client';
import { GameFileManager } from './game-files';
import { GameStartup } from './eggs';
import { ServiceCancellationPanel } from './cancellations';
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
import { requestId } from '@/lib/request-id';
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
export function ServiceTable({ rows, admin }: { rows: Row[]; admin: boolean }) {
  return (
    <DataTable
      rows={rows}
      columns={[
        {
          label: 'Service',
          render: (s) => {
            const Icon = kindIcon(s.kind);
            return (
              <Link
                href={`${admin ? '/admin' : '/dashboard'}/services/${s.id}`}
                className="flex items-center gap-3"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/8 text-primary">
                  <Icon className="size-4" />
                </span>
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{s.plan}</p>
                </div>
              </Link>
            );
          },
        },
        { label: 'Status', render: (s) => <StatusBadge status={s.status} /> },
        {
          label: admin ? 'Customer' : 'Connection',
          render: (s) => (
            <span className="text-xs text-muted-foreground">
              {admin ? s.customer?.email : s.address || 'Provisioning pending'}
            </span>
          ),
        },
        {
          label: 'Provider',
          render: (s) => <span className="text-xs text-muted-foreground">{s.nodeName}</span>,
        },
        {
          label: 'Price',
          render: (s) => (
            <span className="font-mono text-xs">
              {money(s.price, s.currency)}
              <span className="ml-1 text-muted-foreground">
                {s.billingType === 'ONE_TIME'
                  ? ' once'
                  : s.billingType === 'FREE'
                    ? ' · free'
                    : `/${s.interval}`}
              </span>
            </span>
          ),
        },
        {
          label: '',
          render: (s) => (
            <Link
              aria-label={`Manage ${s.name}`}
              href={`${admin ? '/admin' : '/dashboard'}/services/${s.id}`}
              className="text-muted-foreground hover:text-primary"
            >
              <ChevronRight className="size-4" />
            </Link>
          ),
        },
      ]}
      empty="No services yet"
    />
  );
}

export function Services({ admin }: { admin: boolean }) {
  const q = useData<Row[]>('/services', 10000);
  return (
    <>
      <Header
        eyebrow="Hosting"
        title={admin ? 'Services' : 'My services'}
        description="A home for every game, server, and website."
        action={
          <Button asChild>
            <Link href={admin ? '/admin/products' : '/store'}>
              <Plus className="size-4" />
              {admin ? 'Manage plans' : 'New service'}
            </Link>
          </Button>
        }
      />
      {q.error ? (
        <ErrorBox error={q.error} retry={q.mutate} />
      ) : q.data ? (
        <ServiceTable rows={q.data} admin={admin} />
      ) : (
        <Loading />
      )}
    </>
  );
}

export function ServiceDetail({ id, admin }: { id: string; admin: boolean }) {
  const q = useData<Row>(`/services/${id}`, 10000),
    ops = useData<Row[]>(`/services/${id}/operations`, 5000);
  const backupList = useData<Row[]>(
    q.data?.capabilities?.includes('backup') ? `/services/${id}/backups` : null,
    10000,
  );
  const [tab, setTab] = useState('overview'),
    [consoleLines, setConsoleLines] = useState<string[]>([]),
    [command, setCommand] = useState(''),
    [directory, setDirectory] = useState('/'),
    [files, setFiles] = useState<Row[] | null>(null),
    [file, setFile] = useState<Row | null>(null),
    [destructive, setDestructive] = useState<string | null>(null),
    [backupId, setBackupId] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [usage, setUsage] = useState<Row | null>(null);
  useEffect(() => () => socket.current?.close(), []);
  const run = async (action: string, extra: Row = {}) => {
    try {
      await mutateAction(
        () =>
          api.post(`/services/${id}/actions`, {
            action,
            idempotencyKey: requestId(),
            ...extra,
          }),
        'Operation queued',
      );
      await q.mutate();
      await ops.mutate();
    } catch {}
  };
  const connect = async () => {
    try {
      const r = await api.post<Row>(`/services/${id}/console`);
      socket.current?.close();
      setConnected(false);
      const ws = new WebSocket(r.url);
      socket.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ event: 'auth', args: [r.token] }));
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event === 'auth success') {
            setConnected(true);
            ws.send(JSON.stringify({ event: 'send logs', args: [] }));
          }
          if (msg.event === 'console output' || msg.event === 'install output')
            setConsoleLines((old) => [...old, ...msg.args].slice(-1000));
          if (msg.event === 'token expiring' || msg.event === 'token expired') {
            ws.close();
            setConnected(false);
            toast.info('Console session expired. Reconnect to continue.');
          }
          if (msg.event === 'jwt error') {
            toast.error(msg.args?.[0] || 'Console authorization failed');
            ws.close();
          }
        } catch {}
      };
      ws.onclose = () => {
        if (socket.current === ws) setConnected(false);
      };
      ws.onerror = () => toast.error('Unable to connect to the Wings console');
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };
  const loadFiles = async (path: string) => {
    try {
      const r = await api.post<Row>(`/services/${id}/actions`, { action: 'files.list', path });
      setFiles(r.entries);
      setDirectory(path);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };
  if (q.error) return <ErrorBox error={q.error} retry={q.mutate} />;
  if (!q.data) return <Loading />;
  const s = q.data;
  const capabilities: string[] = s.capabilities || [];
  const ready =
    s.lifecycleStatus === 'ACTIVE' && (!s.cancelsAt || new Date(s.cancelsAt) > new Date());
  const Icon = kindIcon(s.kind);
  return (
    <>
      <Link
        href={`${admin ? '/admin' : '/dashboard'}/services`}
        className="mb-5 inline-flex items-center gap-1 text-xs text-muted-foreground"
      >
        <ChevronRight className="size-3 rotate-180" />
        All services
      </Link>
      <Header
        eyebrow={s.provider}
        title={s.name}
        description={`${s.plan} · ${s.nodeName}`}
        action={
          <>
            <StatusBadge status={s.status} />
            {capabilities.includes('start') && (
              <>
                <Button
                  variant="outline"
                  disabled={!ready}
                  onClick={() => void run('restart')}
                  aria-label="Restart service"
                >
                  <RefreshCw className="size-4" />
                </Button>
                <Button variant="outline" disabled={!ready} onClick={() => void run('stop')}>
                  <Square className="size-3" />
                  Stop
                </Button>
                <Button disabled={!ready} onClick={() => void run('start')}>
                  <Play className="size-3" />
                  Start
                </Button>
              </>
            )}
          </>
        }
      />
      {s.isDemo && (
        <div
          role="status"
          className="mb-5 flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-6 text-muted-foreground"
        >
          <ShieldCheck className="mt-1 size-4 shrink-0 text-amber-400" />
          <span>
            <strong className="font-medium text-foreground">Demo service.</strong> These controls
            simulate power state. No real Minecraft server is running and no money was charged.
          </span>
        </div>
      )}
      {s.error && (
        <div className="mb-5">
          <ErrorBox error={new Error(s.error)} />
        </div>
      )}
      <div className="harbor-service-tabs mb-6 flex min-w-0 gap-4 overflow-x-auto border-b sm:gap-6">
        {[
          'overview',
          ...(['wings', 'proxmox'].includes(s.provider) ? ['console'] : []),
          ...(capabilities.includes('files') ? ['files'] : []),
          ...(s.provider === 'wings' ? ['startup'] : []),
          'activity',
        ].map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === 'files') void loadFiles(directory);
            }}
            className={cn(
              'shrink-0 border-b-2 px-1 py-3 text-sm font-medium capitalize',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'startup' && s.provider === 'wings' && <GameStartup serviceId={id} />}
      {tab === 'overview' && (
        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <Panel title="Service overview">
            <div className="mb-6 flex min-w-0 items-center gap-3 sm:gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Icon className="size-6" />
              </span>
              <div>
                <h2 className="font-semibold [overflow-wrap:anywhere]">{s.name}</h2>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {s.lifecycleStatus === 'TERMINATED'
                    ? 'Service terminated'
                    : s.address || 'Waiting for provisioning'}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-5 text-xs">
              {[
                ['Memory', `${s.resources.memoryLimit / 1048576} MB`],
                ['Storage', `${s.resources.diskLimit / 1073741824} GB`],
                [
                  'Billing',
                  s.billingType === 'ONE_TIME'
                    ? `${money(s.price, s.currency)} once`
                    : s.billingType === 'FREE'
                      ? 'Free'
                      : `${money(s.price, s.currency)} / ${s.interval}`,
                ],
                ['Next renewal', date(s.renewsAt)],
                ['Provider', s.provider],
                ['Created', date(s.createdAt)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1.5 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {s.configuration?.length > 0 && (
              <div className="mt-6 space-y-3 border-t pt-5">
                <h3 className="text-sm font-medium">Purchased configuration</h3>
                {s.configuration.map((option: Row) => (
                  <div key={option.id} className="flex justify-between gap-4 text-xs">
                    <span className="text-muted-foreground">{option.name}</span>
                    <span className="break-all text-right">
                      {option.choiceName || String(option.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {ready && (
              <Button
                variant="outline"
                size="sm"
                className="mt-6"
                onClick={() =>
                  void api
                    .get<Row>(`/services/${id}/usage`)
                    .then(setUsage)
                    .catch((e) => toast.error(getErrorMessage(e)))
                }
              >
                <Activity className="size-4" />
                Refresh live status
              </Button>
            )}
            {usage && (
              <pre className="mt-4 max-h-52 overflow-auto rounded-lg bg-muted p-4 text-xs">
                {JSON.stringify(usage, null, 2)}
              </pre>
            )}
          </Panel>
          <div className="space-y-5">
            {capabilities.includes('backup') && (
              <Panel
                title="Backups"
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void backupList.mutate()}
                    aria-label="Refresh backups"
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                }
              >
                {backupList.error ? (
                  <ErrorBox error={backupList.error} />
                ) : !backupList.data ? (
                  <Loading />
                ) : !backupList.data.length ? (
                  <p className="text-xs leading-6 text-muted-foreground">
                    Completed backups will appear here after creation.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {backupList.data.map((b) => (
                      <div key={b.id} className="flex items-center gap-2 rounded-lg border p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[10px]" title={b.id}>
                            {b.id}
                          </p>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {date(b.createdAt)} · {b.completed ? 'Ready' : 'Failed'}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!ready || !b.completed}
                          onClick={() => {
                            setBackupId(b.id);
                            setDestructive('restore');
                          }}
                        >
                          Restore
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}
            <Panel title="Service tools">
              <div className="flex flex-col gap-3">
                {s.provider === 'plesk' && (
                  <Button
                    disabled={!ready}
                    onClick={() =>
                      void api
                        .post<Row>(`/services/${id}/panel-login`)
                        .then((r) => window.location.assign(r.url))
                        .catch((e) => toast.error(getErrorMessage(e)))
                    }
                  >
                    Open Plesk
                    <ExternalLink className="size-4" />
                  </Button>
                )}
                {capabilities.includes('backup') && (
                  <Button variant="outline" disabled={!ready} onClick={() => void run('backup')}>
                    <HardDrive className="size-4" />
                    Create backup
                  </Button>
                )}
                {capabilities.includes('rebuild') && (
                  <Button
                    variant="outline"
                    disabled={!ready}
                    onClick={() => setDestructive('rebuild')}
                  >
                    Rebuild server
                  </Button>
                )}
                {capabilities.includes('restore') && (
                  <Button
                    variant="outline"
                    disabled={!ready}
                    onClick={() => setDestructive('restore')}
                  >
                    Restore a backup
                  </Button>
                )}
                {admin && s.lifecycleStatus === 'FAILED' && (
                  <Button
                    onClick={() =>
                      void mutateAction(
                        () => api.post(`/services/${id}/retry-provision`),
                        'Retry queued',
                      )
                        .then(() => ops.mutate())
                        .catch(() => {})
                    }
                  >
                    Retry provisioning
                  </Button>
                )}
                {admin && (
                  <>
                    <Button
                      variant="outline"
                      disabled={!['ACTIVE', 'SUSPENDED'].includes(s.lifecycleStatus)}
                      onClick={() =>
                        void run(s.lifecycleStatus === 'SUSPENDED' ? 'unsuspend' : 'suspend')
                      }
                    >
                      {s.lifecycleStatus === 'SUSPENDED' ? 'Unsuspend' : 'Suspend'} service
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={s.lifecycleStatus === 'TERMINATED'}
                      onClick={() => setDestructive('terminate')}
                    >
                      Terminate service
                    </Button>
                  </>
                )}
                {s.provider === 'native-web' && (
                  <>
                    <Button
                      variant="outline"
                      disabled={!ready}
                      onClick={() =>
                        void api
                          .post<Row>(`/services/${id}/database`)
                          .then((r) =>
                            setFile({
                              path: 'Database credentials — store securely',
                              content: JSON.stringify(r, null, 2),
                              readonly: true,
                            }),
                          )
                          .catch((e) => toast.error(getErrorMessage(e)))
                      }
                    >
                      <Database className="size-4" />
                      Create / reset database
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!ready}
                      onClick={() =>
                        void mutateAction(
                          () => api.post(`/services/${id}/certificate`),
                          'Certificate issued',
                        ).catch(() => {})
                      }
                    >
                      <ShieldCheck className="size-4" />
                      Issue HTTPS certificate
                    </Button>
                  </>
                )}
                {s.provider === 'proxmox' && (
                  <p className="text-xs leading-6 text-muted-foreground">
                    Use your SSH public key or open the browser console tab to connect to your VPS.
                  </p>
                )}
              </div>
            </Panel>
            {s.provider === 'wings' && ready && (
              <Panel title="SFTP access">
                <p className="text-xs leading-6 text-muted-foreground">
                  Use your account password and the username below. TOTP-enabled accounts use the
                  panel file manager.
                </p>
                <code className="mt-3 block break-all rounded bg-muted p-2 text-[10px]">
                  {s.customer.email}.{s.id}
                </code>
                {s.sftp && (
                  <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
                    Host: {s.sftp.host} · Port: {s.sftp.port}
                  </p>
                )}
              </Panel>
            )}
          </div>
        </div>
      )}
      {tab === 'console' && s.provider === 'proxmox' && <VpsConsole serviceId={id} ready={ready} />}
      {tab === 'console' && s.provider === 'wings' && (
        <Panel
          title="Live console"
          description="Connect directly to the Wings node with a short-lived service token."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => void connect()}
              disabled={!ready || connected}
            >
              {connected ? 'Connected' : 'Connect console'}
            </Button>
          }
        >
          <pre
            aria-label="Console output"
            aria-live="off"
            className="h-[min(55dvh,28rem)] min-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#101b23] p-4 font-mono text-xs leading-6 text-[#b3d9ca]"
          >
            {consoleLines.length ? consoleLines.join('\n') : 'Connect to view your server output.'}
          </pre>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (connected && command.trim()) {
                socket.current?.send(JSON.stringify({ event: 'send command', args: [command] }));
                setCommand('');
              }
            }}
          >
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Enter a server command…"
              aria-label="Server command"
              disabled={!connected}
            />
            <Button type="submit" disabled={!connected || !command.trim()}>
              Send
              <ArrowRight className="size-4" />
            </Button>
          </form>
        </Panel>
      )}
      {tab === 'files' && s.provider === 'wings' && (
        <GameFileManager serviceId={id} onEdit={setFile} />
      )}
      {tab === 'files' && s.provider !== 'wings' && (
        <Panel
          title="File manager"
          action={
            <Button size="sm" variant="outline" onClick={() => void loadFiles(directory)}>
              <RefreshCw className="size-3" />
              Refresh
            </Button>
          }
        >
          <div className="mb-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadFiles(directory.split('/').slice(0, -1).join('/') || '/')}
            >
              Up
            </Button>
            <code className="text-xs text-muted-foreground">{directory}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const name = prompt('New file name');
                if (name && !name.includes('/') && !name.includes('..'))
                  setFile({ path: `${directory === '/' ? '' : directory}/${name}`, content: '' });
              }}
            >
              New file
            </Button>
          </div>
          {files ? (
            <DataTable
              rows={files}
              empty="This directory is empty"
              columns={[
                {
                  label: 'Name',
                  render: (f) => (
                    <button
                      className="flex items-center gap-2 text-xs hover:text-primary"
                      onClick={() => {
                        const path = `${directory === '/' ? '' : directory}/${f.name}`;
                        if (f.type === 'directory') void loadFiles(path);
                        else
                          void api
                            .get<Row>(
                              `/services/${id}/files/content?path=${encodeURIComponent(path)}`,
                            )
                            .then((r) => setFile({ path, content: r.content }))
                            .catch((e) => toast.error(getErrorMessage(e)));
                      }}
                    >
                      {f.type === 'directory' ? (
                        <Folder className="size-4 text-primary" />
                      ) : (
                        <File className="size-4 text-muted-foreground" />
                      )}
                      {f.name}
                    </button>
                  ),
                },
                {
                  label: 'Size',
                  render: (f) => (
                    <span className="text-xs text-muted-foreground">
                      {f.size ? `${(f.size / 1024).toFixed(1)} KB` : '—'}
                    </span>
                  ),
                },
              ]}
            />
          ) : (
            <Loading />
          )}
        </Panel>
      )}
      {tab === 'activity' &&
        (ops.error ? (
          <ErrorBox error={ops.error} />
        ) : ops.data ? (
          <DataTable
            rows={ops.data}
            columns={[
              { label: 'Operation', render: (o) => <span className="capitalize">{o.action}</span> },
              { label: 'Status', render: (o) => <StatusBadge status={o.status.toLowerCase()} /> },
              {
                label: 'Details',
                render: (o) => (
                  <span className="text-xs text-muted-foreground">
                    {o.error || JSON.stringify(o.result || {})}
                  </span>
                ),
              },
              { label: 'Created', render: (o) => date(o.createdAt) },
            ]}
          />
        ) : (
          <Loading />
        ))}
      <div className="mt-6">
        <ServiceCancellationPanel service={s} admin={admin} refreshService={q.mutate} />
      </div>
      {file && (
        <Modal title={file.path} close={() => setFile(null)}>
          <Form
            submit={file.readonly ? 'Close' : 'Save file'}
            close={() => setFile(null)}
            onSubmit={async (f) => {
              if (!file.readonly)
                await api.post(`/services/${id}/files/content`, {
                  path: file.path,
                  content: f.get('content'),
                });
              setFile(null);
              toast.success(file.readonly ? 'Closed' : 'File saved');
            }}
          >
            <textarea
              name="content"
              aria-label="File content"
              defaultValue={file.content}
              readOnly={file.readonly}
              className="min-h-80 w-full rounded-lg border bg-background p-3 font-mono text-xs leading-6 outline-primary"
            />
          </Form>
        </Modal>
      )}
      {destructive && (
        <Modal
          title={`${destructive[0].toUpperCase() + destructive.slice(1)} service`}
          description="This operation may overwrite or remove customer data."
          close={() => setDestructive(null)}
        >
          <Form
            submit={`Confirm ${destructive}`}
            close={() => setDestructive(null)}
            onSubmit={async (f) => {
              await api.post(`/services/${id}/actions`, {
                action: destructive,
                confirmation: f.get('confirmation'),
                idempotencyKey: requestId(),
                ...(s.provider === 'proxmox'
                  ? { archive: f.get('backup') }
                  : { backupId: f.get('backup') }),
              });
              setDestructive(null);
              await ops.mutate();
              toast.success('Operation queued');
            }}
          >
            {destructive === 'restore' && (
              <Field label={s.provider === 'proxmox' ? 'Backup volume ID' : 'Backup UUID'}>
                <Input name="backup" defaultValue={backupId} required />
              </Field>
            )}
            <Field label={`Type “${s.name}” to confirm`}>
              <Input name="confirmation" required autoComplete="off" />
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}
