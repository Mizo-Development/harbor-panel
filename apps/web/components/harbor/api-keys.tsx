'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  KeyRound,
  Plus,
  Copy,
  RotateCcw,
  Ban,
  ShieldCheck,
  BookOpen,
  Code2,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Header,
  Panel,
  Field,
  Input,
  Select,
  Form,
  Modal,
  Empty,
  ErrorBox,
  Loading,
  useData,
  type Row,
} from './shared';
const stamp = (value: any) => (value ? new Date(value).toLocaleString() : 'Never');
async function copy(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {}
  }
  const el = document.createElement('textarea');
  el.value = value;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand('copy');
  el.remove();
  if (!ok) throw new Error('Select the text and copy it manually.');
}
export function ApiKeysPage({ user, admin = false }: { user: Row; admin?: boolean }) {
  const keys = useData<Row[]>('/api-keys', 30000),
    options = useData<Row>('/api-keys/options');
  const [tab, setTab] = useState('mine'),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1);
  const all = useData<Row>(
    admin && tab === 'all'
      ? `/admin/api-keys?search=${encodeURIComponent(search)}&status=${status}&page=${page}`
      : null,
    30000,
  );
  const [creating, setCreating] = useState(false),
    [kind, setKind] = useState(admin ? 'ADMIN' : 'CLIENT'),
    [scopes, setScopes] = useState<string[]>(admin ? ['admin:services:read'] : ['services:read']),
    [revealed, setRevealed] = useState<Row | null>(null),
    [rotate, setRotate] = useState<Row | null>(null),
    [revoke, setRevoke] = useState<Row | null>(null);
  const activeScopes: Row[] = options.data
    ? kind === 'ADMIN'
      ? options.data.adminScopes
      : options.data.clientScopes
    : [];
  const refresh = async () => {
    await keys.mutate();
    if (admin && tab === 'all') await all.mutate();
  };
  const listing = tab === 'all' && admin ? all : keys,
    rows: Row[] = tab === 'all' && admin ? all.data?.items || [] : keys.data || [];
  const expiry = (
    <Field label="Key lifetime">
      <Select name="expiresInDays" defaultValue="90">
        {[7, 30, 90, 365].map((d) => (
          <option key={d} value={d}>
            {d} days
          </option>
        ))}
      </Select>
    </Field>
  );
  const confirmation = (
    <>
      <Field label="Confirm your password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      {user.totpEnabled && (
        <Field label="Authenticator code">
          <Input
            name="totp"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoComplete="one-time-code"
          />
        </Field>
      )}
    </>
  );
  return (
    <>
      <Header
        eyebrow="Developer access"
        title={admin ? 'API access' : 'Your API keys'}
        description={
          admin
            ? 'Scoped automation for your hosting company and customer accounts.'
            : 'Connect your scripts and applications to your hosting account.'
        }
        action={
          <Button
            onClick={() => {
              setKind(admin ? 'ADMIN' : 'CLIENT');
              setScopes(admin ? ['admin:services:read'] : ['services:read']);
              setCreating(true);
            }}
          >
            <Plus className="size-4" />
            Create API key
          </Button>
        }
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="One API, explicit permissions">
          <div className="space-y-4">
            <p className="text-xs leading-6 text-muted-foreground">
              Use a bearer key with the versioned API. Customer keys can access their owner's
              resources. Admin keys use the permissions selected by their administrator.
            </p>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/20 p-3">
              <code className="min-w-0 flex-1 break-all text-xs">
                {options.data?.baseUrl || '/api/v1'}
              </code>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Copy API base URL"
                onClick={() =>
                  void copy(options.data?.baseUrl || `${location.origin}/api/v1`)
                    .then(() => toast.success('API URL copied'))
                    .catch((e) => toast.error(getErrorMessage(e)))
                }
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/api/docs" target="_blank" rel="noreferrer">
                <BookOpen className="size-3.5" />
                API documentation
              </Link>
            </Button>
          </div>
        </Panel>
        <Panel title="Built for automation">
          <div className="space-y-3 text-xs leading-6 text-muted-foreground">
            <p className="flex items-start gap-2">
              <ShieldCheck className="mt-1 size-3.5 shrink-0" />
              Secrets are shown once and stored as hashes. Rotation and revocation stop the old key.
            </p>
            <p>
              Up to 20 active keys per account · 120 requests/minute per key · Optional IPv4/IPv6
              restrictions
            </p>
            <p>
              Dashboard sessions manage keys and login security. Account suspension and credential
              changes invalidate API access.
            </p>
          </div>
        </Panel>
      </div>
      {admin && (
        <div className="mb-5 flex gap-2" role="tablist" aria-label="API key ownership">
          {[
            ['mine', 'My keys'],
            ['all', 'All account keys'],
          ].map(([id, label]) => (
            <Button
              key={id}
              role="tab"
              aria-selected={tab === id}
              variant={tab === id ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
      {admin && tab === 'all' && (
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              aria-label="Search API keys"
              placeholder="Search owner or key name"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            aria-label="API key status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-auto"
          >
            {['all', 'active', 'revoked', 'expired'].map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </div>
      )}
      {listing.error ? (
        <ErrorBox error={listing.error} retry={listing.mutate} />
      ) : !listing.data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty
          icon={KeyRound}
          title="No API keys yet"
          description="Create a scoped key for your application or automation."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {rows.map((k) => (
            <Panel key={k.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border">
                    <KeyRound className="size-4 text-primary" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="break-words text-sm font-semibold">{k.name}</h2>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {k.prefix}••••••
                    </p>
                    {k.owner && (
                      <p className="mt-2 break-all text-xs text-muted-foreground">
                        {k.owner.email}
                      </p>
                    )}
                  </div>
                </div>
                <Badge variant={k.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                  {k.status.toLowerCase().replaceAll('_', ' ')}
                </Badge>
              </div>
              <div className="my-4 flex flex-wrap gap-1.5">
                <Badge variant="outline">{k.kind === 'ADMIN' ? 'Admin API' : 'Customer API'}</Badge>
                {k.scopes.map((s: string) => (
                  <Badge key={s} variant="outline" className="break-all font-mono text-[10px]">
                    {s}
                  </Badge>
                ))}
              </div>
              <dl className="grid gap-2 text-[11px] text-muted-foreground">
                <div className="flex justify-between gap-3">
                  <dt>Expires</dt>
                  <dd>{stamp(k.expiresAt)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Last used</dt>
                  <dd>{stamp(k.lastUsedAt)}</dd>
                </div>
                {k.lastUsedIp && (
                  <div className="flex justify-between gap-3">
                    <dt>Last IP</dt>
                    <dd className="font-mono">{k.lastUsedIp}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt>Allowed IPs</dt>
                  <dd className="max-w-[70%] break-all text-right font-mono">
                    {k.allowedIps.length ? k.allowedIps.join(', ') : 'Any address'}
                  </dd>
                </div>
              </dl>
              {!k.revokedAt && (
                <div className="mt-4 flex gap-2 border-t pt-4">
                  {tab === 'mine' && (
                    <Button size="sm" variant="outline" onClick={() => setRotate(k)}>
                      <RotateCcw className="size-3.5" />
                      Rotate
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setRevoke(k)}>
                    <Ban className="size-3.5" />
                    Revoke
                  </Button>
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
      {admin && tab === 'all' && all.data && (
        <div className="mt-5 flex items-center justify-between text-xs">
          <span>
            {all.data.total} keys · Page {page}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page * 50 >= all.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
      <Panel className="mt-6" title="Quick start">
        <p className="mb-3 text-xs text-muted-foreground">
          Keep keys in server environment variables. Choose the permission used by your request.
        </p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/20 p-4 font-mono text-[11px] leading-6">{`curl --fail --silent --show-error \\\n  -H "Authorization: Bearer $HARBOR_API_KEY" \\\n  ${options.data?.baseUrl || '/api/v1'}/services`}</pre>
        <p className="mt-3 text-[11px] leading-6 text-muted-foreground">
          Requires services:read for a customer key or admin:services:read for an admin key.
          Requests return {'{data: ...}'} or {'{error: {message, code}}'}. Use idempotency keys when
          creating orders or service actions.
        </p>
      </Panel>
      {creating && (
        <Modal
          title="Create API key"
          description="Choose exactly what this integration needs. Save the secret when it is revealed."
          close={() => setCreating(false)}
        >
          <Form
            submit="Create key"
            disabled={!scopes.length}
            onSubmit={async (f) => {
              const created = await api.post<Row>('/api-keys', {
                name: f.get('name'),
                kind,
                scopes,
                allowedIps: String(f.get('allowedIps') || '')
                  .split(/[\n,]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
                expiresInDays: Number(f.get('expiresInDays')),
                password: f.get('password'),
                totp: String(f.get('totp') || '') || undefined,
              });
              setCreating(false);
              setRevealed(created);
              await refresh();
            }}
          >
            <Field label="Key name">
              <Input name="name" placeholder="e.g. Monitoring service" maxLength={100} required />
            </Field>
            <Field label="API key type">
              <Select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setScopes(
                    e.target.value === 'ADMIN' ? ['admin:services:read'] : ['services:read'],
                  );
                }}
              >
                {(options.data?.kinds || ['CLIENT']).map((k: string) => (
                  <option key={k} value={k}>
                    {k === 'ADMIN'
                      ? 'Admin API — selected company resources'
                      : 'Customer API — my resources only'}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-medium">Permissions · {scopes.length} selected</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setScopes(
                      activeScopes
                        .filter((s) => s.id.endsWith(':read') && !s.id.includes(':files:'))
                        .map((s) => s.id),
                    )
                  }
                >
                  Read-only preset
                </Button>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">
                {activeScopes.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/30"
                  >
                    <input
                      aria-label={`Permission ${s.id}`}
                      type="checkbox"
                      className="mt-1"
                      checked={scopes.includes(s.id)}
                      onChange={(e) =>
                        setScopes((a) =>
                          e.target.checked ? [...a, s.id] : a.filter((v) => v !== s.id),
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block break-all font-mono text-[11px]">{s.id}</span>
                      <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">
                        {s.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {expiry}
            <Field
              label="Allowed IPs or CIDRs"
              hint="Optional. One IPv4/IPv6 address or CIDR range per line. Leave empty to allow any source address."
            >
              <textarea
                className="min-h-20 w-full rounded-md border bg-background p-3 font-mono text-xs"
                name="allowedIps"
                placeholder={'203.0.113.10\n2001:db8::/32'}
              />
            </Field>
            {confirmation}
          </Form>
        </Modal>
      )}
      {rotate && (
        <Modal
          title={`Rotate ${rotate.name}`}
          description="A new secret replaces the old key immediately. Permissions and IP restrictions are retained."
          close={() => setRotate(null)}
        >
          <Form
            submit="Rotate key"
            onSubmit={async (f) => {
              const next = await api.post<Row>(`/api-keys/${rotate.id}/rotate`, {
                password: f.get('password'),
                totp: String(f.get('totp') || '') || undefined,
                expiresInDays: Number(f.get('expiresInDays')),
              });
              setRotate(null);
              setRevealed(next);
              await refresh();
            }}
          >
            {expiry}
            {confirmation}
          </Form>
        </Modal>
      )}
      {revealed && (
        <Modal
          title="Save your API key"
          description="This secret is shown only once. Store it securely before closing."
          close={() => setRevealed(null)}
        >
          <div className="space-y-4">
            <Badge variant="outline">
              {revealed.kind === 'ADMIN' ? 'Admin API' : 'Customer API'}
            </Badge>
            <Field label="API key secret">
              <Input
                readOnly
                value={revealed.token}
                className="font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
            </Field>
            <Button
              variant="outline"
              onClick={() =>
                void copy(revealed.token)
                  .then(() => toast.success('API key copied'))
                  .catch((e) => toast.error(getErrorMessage(e)))
              }
            >
              <Copy className="size-4" />
              Copy secret
            </Button>
            <p className="text-xs leading-6 text-muted-foreground">
              Send this value in the Authorization: Bearer header. It will not appear in the key
              list or logs. If you lose it, rotate the key to create a replacement.
            </p>
            <Button onClick={() => setRevealed(null)}>I've saved my key</Button>
          </div>
        </Modal>
      )}
      {revoke && (
        <Modal
          title={`Revoke ${revoke.name}`}
          description="Applications using this key will lose API access immediately."
          close={() => setRevoke(null)}
        >
          <Form
            submit="Revoke key"
            onSubmit={async (f) => {
              if (admin && tab === 'all')
                await api.post(`/admin/api-keys/${revoke.id}/revoke`, { reason: f.get('reason') });
              else await api.delete(`/api-keys/${revoke.id}`);
              setRevoke(null);
              await refresh();
              toast.success('API key revoked');
            }}
          >
            {admin && tab === 'all' && (
              <Field label="Revocation reason">
                <Input name="reason" minLength={3} maxLength={1000} required />
              </Field>
            )}
            <p className="text-xs text-muted-foreground">
              {revoke.prefix}•••••• · {revoke.scopes.length} permissions
            </p>
          </Form>
        </Modal>
      )}
    </>
  );
}
