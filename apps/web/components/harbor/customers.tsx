'use client';
import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  KeyRound,
  Pencil,
  LogOut,
  Users,
  Wallet,
  ShieldCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BillingAddressFields, formGroup } from './billing';
import {
  Header,
  Panel,
  Field,
  Input,
  Select,
  Modal,
  Form,
  DataTable,
  Loading,
  ErrorBox,
  useData,
  money,
  date,
  type Row,
} from './shared';
const timestamp = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : 'Not recorded';
const activityName = (action: string) =>
  ({
    'auth.login': 'Signed in',
    'customer.updated': 'Customer profile edited',
    'profile.updated': 'Billing profile updated',
    'customer.password.changed': 'Password changed by staff',
    'customer.sessions.revoked': 'Signed out by staff',
  })[action] || action.replaceAll('.', ' ');
export function Customers({ id }: { id?: string }) {
  return id ? <CustomerDetails id={id} /> : <CustomerList />;
}
function CustomerList() {
  const q = useData<Row[]>('/customers', 15000),
    settings = useData<Row>('/settings');
  const [search, setSearch] = useState('');
  return (
    <>
      <Header
        eyebrow="Workspace"
        title="Customers"
        description="View customer details, billing profiles, wallets, and account security."
      />
      <div className="mb-6 max-w-md">
        <Field label="Search customers">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or email address"
          />
        </Field>
      </div>
      {q.error ? (
        <ErrorBox error={q.error} retry={q.mutate} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <DataTable
          rows={q.data.filter((c) =>
            `${c.name} ${c.email}`.toLowerCase().includes(search.toLowerCase()),
          )}
          empty="No customers found."
          columns={[
            {
              label: 'Customer',
              render: (c) => (
                <Link href={`/admin/customers/${c.id}`} className="group block">
                  <span className="font-medium group-hover:underline">{c.name}</span>
                  <p className="mt-1 text-xs text-muted-foreground">{c.email}</p>
                </Link>
              ),
            },
            {
              label: 'Wallet',
              render: (c) =>
                c.wallets?.length
                  ? c.wallets.map((w: Row) => (
                      <p key={w.currency}>{money(w.balance, w.currency)}</p>
                    ))
                  : money(0, settings.data?.currency || 'USD'),
            },
            { label: 'Services', render: (c) => c._count.services },
            {
              label: 'Status',
              render: (c) => (
                <Badge variant="outline">{c.suspendedAt ? 'Suspended' : 'Active'}</Badge>
              ),
            },
            { label: 'Invoices', render: (c) => c._count.invoices },
            {
              label: 'Last login',
              render: (c) => (
                <span className="text-xs text-muted-foreground">{timestamp(c.lastLoginAt)}</span>
              ),
            },
            {
              label: '',
              render: (c) => (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/admin/customers/${c.id}`}>
                    View customer
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
function CustomerDetails({ id }: { id: string }) {
  const q = useData<Row>(`/customers/${id}`, 15000);
  const [tab, setTab] = useState('overview'),
    [modal, setModal] = useState<'profile' | 'password' | 'sessions' | 'suspension' | null>(null);
  const [walletCurrency, setWalletCurrency] = useState('');
  if (q.error) return <ErrorBox error={q.error} retry={q.mutate} />;
  if (!q.data) return <Loading />;
  const c = q.data,
    address = c.billingAddress || {};
  const selectedWallet = c.wallets?.find((w: Row) => w.currency === walletCurrency) || c.wallet;
  const selectedCurrency = selectedWallet?.currency || c.currency;
  return (
    <>
      <Link
        href="/admin/customers"
        className="mb-5 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All customers
      </Link>
      <Header
        eyebrow="Customer account"
        title={c.name}
        description={c.email}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setModal('profile')}>
              <Pencil className="size-4" />
              Edit customer
            </Button>
            <Button variant="outline" onClick={() => setModal('password')}>
              <KeyRound className="size-4" />
              Change password
            </Button>
            <Button
              variant={c.suspendedAt ? 'outline' : 'destructive'}
              onClick={() => setModal('suspension')}
            >
              {c.suspendedAt ? 'Restore account access' : 'Suspend customer'}
            </Button>
          </div>
        }
      />
      {c.suspendedAt && (
        <div
          role="status"
          className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          Account suspended since {timestamp(c.suspendedAt)}. {c.suspensionReason}
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Wallet balance', money(selectedWallet?.balance || 0, selectedCurrency)],
          ['Services', String(c._count.services)],
          ['Invoices', String(c._count.invoices)],
          ['Last login', timestamp(c.lastLoginAt)],
        ].map(([label, value]) => (
          <Panel key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-3 text-lg font-semibold tracking-tight">{value}</p>
          </Panel>
        ))}
      </div>
      <Tabs value={tab} onValueChange={setTab} className="mb-6">
        <TabsList className="h-auto max-w-full justify-start overflow-x-auto">
          {['overview', 'wallet', 'services', 'invoices', 'security', 'activity'].map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Contact details">
            <dl className="space-y-4 text-sm">
              {[
                ['Full name', c.name],
                ['Email address', c.email],
                ['Customer ID', c.id],
                ['Account created', timestamp(c.createdAt)],
                ['Two-factor authentication', c.totpEnabled ? 'Enabled' : 'Not enabled'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-all">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Billing address">
            {address.line1 ? (
              <>
                <p className="font-medium">{address.company || c.name}</p>
                <address className="mt-3 space-y-1 text-sm not-italic text-muted-foreground">
                  {[
                    address.line1,
                    address.line2,
                    [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
                    address.country,
                  ]
                    .filter(Boolean)
                    .map((line: string, i: number) => (
                      <p key={i}>{line}</p>
                    ))}
                </address>
                {address.phone && <p className="mt-4 text-sm">Phone: {address.phone}</p>}
                {address.taxId && <p className="mt-2 text-sm">Tax ID: {address.taxId}</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No billing address added yet.</p>
            )}
            <p className="mt-5 text-xs leading-6 text-muted-foreground">
              Changes apply to new invoices. Existing invoices keep their original billing details.
            </p>
          </Panel>
          <div className="lg:col-span-2">
            <Panel title="Internal staff notes">
              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
                {c.adminNotes ||
                  'No internal notes. Use Edit customer to add information for your team.'}
              </p>
            </Panel>
          </div>
        </div>
      )}
      {tab === 'wallet' && (
        <Panel
          title="Wallet transactions"
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/wallets">
                Review deposits
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
        >
          <p className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="size-4" />
            Available:{' '}
            <strong className="text-foreground">
              {money(selectedWallet?.balance || 0, selectedCurrency)}
            </strong>
          </p>
          <DataTable
            rows={selectedWallet?.entries || []}
            empty="No wallet transactions."
            columns={[
              {
                label: 'Details',
                render: (r) => (
                  <div>
                    {r.description}
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{r.reference}</p>
                  </div>
                ),
              },
              { label: 'Amount', render: (r) => money(r.amount, selectedCurrency) },
              { label: 'Balance after', render: (r) => money(r.balanceAfter, selectedCurrency) },
              { label: 'Date', render: (r) => timestamp(r.createdAt) },
            ]}
          />
          <p className="mt-4 text-xs text-muted-foreground">
            Latest 100 entries. Balance changes are recorded through the wallet workflow.
          </p>
        </Panel>
      )}
      {tab === 'services' && (
        <Panel title="Customer services">
          <DataTable
            rows={c.services}
            empty="No services ordered."
            columns={[
              {
                label: 'Service',
                render: (r) => (
                  <Link className="font-medium hover:underline" href={`/admin/services/${r.id}`}>
                    {r.name}
                  </Link>
                ),
              },
              { label: 'Provider', render: (r) => r.provider },
              { label: 'Status', render: (r) => <Badge variant="outline">{r.status}</Badge> },
              { label: 'Created', render: (r) => date(r.createdAt) },
            ]}
          />
        </Panel>
      )}
      {tab === 'invoices' && (
        <Panel title="Customer invoices">
          <DataTable
            rows={c.invoices}
            empty="No invoices issued."
            columns={[
              {
                label: 'Invoice',
                render: (r) => (
                  <Link
                    className="font-mono text-xs hover:underline"
                    href={`/admin/invoices/${r.id}`}
                  >
                    {r.number ||
                      `${r.service?.provider === 'demo-game' ? 'DEMO' : 'INV'}-${r.id.slice(0, 8).toUpperCase()}`}
                  </Link>
                ),
              },
              { label: 'Service', render: (r) => r.service?.name || r.description || 'Invoice' },
              { label: 'Amount', render: (r) => money(r.amount, r.currency) },
              { label: 'Status', render: (r) => <Badge variant="outline">{r.status}</Badge> },
              { label: 'Due', render: (r) => date(r.dueAt) },
            ]}
          />
        </Panel>
      )}
      {tab === 'security' && (
        <div className="space-y-5">
          <Panel
            title="Account security"
            action={
              <Button size="sm" variant="outline" onClick={() => setModal('sessions')}>
                <LogOut className="size-4" />
                Sign out all sessions
              </Button>
            }
          >
            <dl className="grid gap-5 text-sm sm:grid-cols-2">
              {[
                ['Active sessions', String(c.activeSessions)],
                ['Last password change', timestamp(c.passwordChangedAt)],
                ['Last successful login', timestamp(c.lastLoginAt)],
                ['Observed login IP', c.lastLoginIp || 'Not recorded'],
                ['Two-factor authentication', c.totpEnabled ? 'Enabled' : 'Not enabled'],
                ['Last login browser', c.lastLoginUserAgent || 'Not recorded'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-2 break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Recent successful logins">
            <DataTable
              rows={c.logins}
              empty="No recorded logins yet."
              columns={[
                { label: 'When', render: (r) => timestamp(r.createdAt) },
                { label: 'Observed IP', render: (r) => r.details.ip || 'Not recorded' },
                {
                  label: 'Browser',
                  render: (r) => (
                    <p className="max-w-lg break-words text-xs text-muted-foreground">
                      {r.details.userAgent || 'Not recorded'}
                    </p>
                  ),
                },
              ]}
            />
          </Panel>
        </div>
      )}
      {tab === 'activity' && (
        <Panel title="Recent account activity">
          <DataTable
            rows={c.activity}
            empty="No activity recorded."
            columns={[
              { label: 'Action', render: (r) => activityName(r.action) },
              { label: 'When', render: (r) => timestamp(r.createdAt) },
              {
                label: 'Details',
                render: (r) => (
                  <span className="text-xs text-muted-foreground">
                    {r.details.fields?.join(', ') ||
                      (r.details.sessionsRevoked !== undefined
                        ? `${r.details.sessionsRevoked} sessions revoked`
                        : r.details.ip || '—')}
                  </span>
                ),
              },
            ]}
          />
        </Panel>
      )}
      {tab === 'wallet' && c.wallets?.length > 1 && (
        <div className="mt-4 max-w-xs">
          <Field label="Customer wallet currency">
            <Select value={selectedCurrency} onChange={(e) => setWalletCurrency(e.target.value)}>
              {c.wallets.map((w: Row) => (
                <option key={w.currency}>{w.currency}</option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      {modal === 'suspension' && (
        <Modal
          title={c.suspendedAt ? 'Restore customer access' : 'Suspend customer account'}
          description="This controls account access and revokes sessions and reset links. Running hosting services and billing records are managed separately."
          close={() => setModal(null)}
        >
          <Form
            submit={c.suspendedAt ? 'Restore access' : 'Suspend account'}
            close={() => setModal(null)}
            onSubmit={async (f) => {
              await api.post(`/customers/${id}/suspension`, {
                suspended: !c.suspendedAt,
                reason: f.get('reason'),
              });
              await q.mutate();
              setModal(null);
              toast.success(
                c.suspendedAt ? 'Account access restored' : 'Customer account suspended',
              );
            }}
          >
            <Field label="Account status reason">
              <textarea
                name="reason"
                minLength={3}
                maxLength={1000}
                required
                className="min-h-24 w-full rounded-md border bg-background p-3 text-sm"
              />
            </Field>
          </Form>
        </Modal>
      )}
      {modal === 'profile' && (
        <Modal
          title="Edit customer"
          description="Edit contact details, billing address, and internal notes. An email change signs the customer out and invalidates old password reset links."
          close={() => setModal(null)}
        >
          <Form
            submit="Save customer"
            close={() => setModal(null)}
            onSubmit={async (f) => {
              const address = formGroup(f, 'billingAddress');
              const r = await api.patch<Row>(`/customers/${id}`, {
                name: f.get('name'),
                email: f.get('email'),
                billingAddress: Object.values(address).some((v) => String(v).trim()) ? address : {},
                adminNotes: f.get('adminNotes'),
                taxExempt: f.get('taxExempt') === 'on',
              });
              await q.mutate();
              setModal(null);
              toast.success(r.sessionsRevoked ? 'Customer saved and signed out' : 'Customer saved');
            }}
          >
            <Field label="Customer name">
              <Input name="name" defaultValue={c.name} required />
            </Field>
            <Field label="Customer email">
              <Input name="email" type="email" defaultValue={c.email} required />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input name="taxExempt" type="checkbox" defaultChecked={c.taxExempt} />
              Exempt from tax on future invoices
            </label>
            <BillingAddressFields value={address} required={false} />
            <Field label="Internal staff notes">
              <textarea
                name="adminNotes"
                defaultValue={c.adminNotes}
                maxLength={10000}
                className="min-h-28 w-full rounded-md border bg-background p-3 text-sm"
              />
            </Field>
          </Form>
        </Modal>
      )}
      {modal === 'password' && (
        <Modal
          title="Change customer password"
          description="The new password signs the customer out of all sessions and invalidates old reset links. Two-factor authentication stays enabled if configured."
          close={() => setModal(null)}
        >
          <Form
            submit="Set new password"
            close={() => setModal(null)}
            onSubmit={async (f) => {
              await api.post(`/customers/${id}/password`, {
                password: f.get('password'),
                confirmPassword: f.get('confirmPassword'),
              });
              await q.mutate();
              setModal(null);
              toast.success('Password changed. Customer sessions revoked.');
            }}
          >
            <Field label="New customer password" hint="At least 12 characters.">
              <Input
                name="password"
                type="password"
                minLength={12}
                maxLength={200}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="Confirm new customer password">
              <Input
                name="confirmPassword"
                type="password"
                minLength={12}
                maxLength={200}
                autoComplete="new-password"
                required
              />
            </Field>
          </Form>
        </Modal>
      )}
      {modal === 'sessions' && (
        <Modal
          title="Sign customer out"
          description="End all current sessions. The customer can sign in again with their password and authenticator if enabled."
          close={() => setModal(null)}
        >
          <Form
            submit="Sign out customer"
            close={() => setModal(null)}
            onSubmit={async () => {
              const r = await api.post<Row>(`/customers/${id}/revoke-sessions`);
              await q.mutate();
              setModal(null);
              toast.success(`${r.revoked} sessions revoked`);
            }}
          >
            <p className="text-sm text-muted-foreground">
              Sign {c.name} out of {c.activeSessions} active sessions?
            </p>
          </Form>
        </Modal>
      )}
    </>
  );
}
