'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MessageSquare, Paperclip, ArrowLeft, Plus } from 'lucide-react';
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
  DataTable,
  Loading,
  ErrorBox,
  useData,
  date,
  type Row,
} from './shared';
const states = ['OPEN', 'ANSWERED', 'CUSTOMER_REPLY', 'ON_HOLD', 'CLOSED'];
const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
export function SupportTickets({ admin, id }: { admin: boolean; id?: string }) {
  return id ? <TicketDetail admin={admin} id={id} /> : <TicketList admin={admin} />;
}
function TicketList({ admin }: { admin: boolean }) {
  const policy = useData<Row>('/settings').data?.supportPolicy;
  const q = useData<Row[]>('/tickets', 15000),
    departments = useData<Row[]>('/support/departments'),
    services = useData<Row[]>('/services');
  const [ownerId, setOwnerId] = useState('');
  const customers = useData<Row[]>(admin ? '/customers' : null),
    owner = useData<Row>(admin && ownerId ? `/customers/${ownerId}` : null);
  const [create, setCreate] = useState(false),
    [manage, setManage] = useState(false),
    [department, setDepartment] = useState<Row | null>(null),
    [filter, setFilter] = useState('ALL');
  const router = useRouter();
  return (
    <>
      <Header
        eyebrow="Support"
        title="Support tickets"
        description={
          admin
            ? 'Manage support conversations, assignments, and private staff notes.'
            : 'Talk to your hosting team and follow your support requests.'
        }
        action={
          <div className="flex gap-2">
            {admin && (
              <Button variant="outline" onClick={() => setManage(true)}>
                Departments
              </Button>
            )}
            <Button
              disabled={!admin && policy?.ticketsEnabled === false}
              onClick={() => setCreate(true)}
            >
              <Plus className="size-4" />
              New ticket
            </Button>
          </div>
        }
      />
      {!admin && (policy?.welcomeMessage || policy?.hoursNote || policy?.supportEmail) && (
        <div className="mb-5 space-y-2 rounded-lg border p-4 text-xs leading-6 text-muted-foreground">
          {policy.welcomeMessage && <p className="whitespace-pre-wrap">{policy.welcomeMessage}</p>}
          {policy.hoursNote && <p>{policy.hoursNote}</p>}
          {policy.supportEmail && (
            <a
              href={`mailto:${policy.supportEmail}`}
              className="block text-foreground hover:underline"
            >
              {policy.supportEmail}
            </a>
          )}
        </div>
      )}
      <div className="mb-5 max-w-xs">
        <Field label="Filter ticket status">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="ALL">All statuses</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {q.error ? (
        <ErrorBox error={q.error} retry={q.mutate} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <DataTable
          rows={q.data.filter((t) => filter === 'ALL' || t.status === filter)}
          empty="No support tickets yet."
          columns={[
            {
              label: 'Ticket',
              render: (t) => (
                <Link
                  className="font-medium hover:underline"
                  href={`${admin ? '/admin' : '/dashboard'}/tickets/${t.id}`}
                >
                  {t.subject}
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    #{t.id.slice(0, 8)}
                  </p>
                </Link>
              ),
            },
            ...(admin ? [{ label: 'Customer', render: (t: Row) => t.customer.email }] : []),
            {
              label: 'Status',
              render: (t) => <Badge variant="outline">{t.status.replaceAll('_', ' ')}</Badge>,
            },
            { label: 'Priority', render: (t) => t.priority },
            { label: 'Department', render: (t) => t.department?.name || 'General' },
            { label: 'Assigned', render: (t) => t.assignedTo?.name || 'Unassigned' },
            { label: 'Updated', render: (t) => date(t.updatedAt) },
          ]}
        />
      )}
      <p className="mt-4 text-xs text-muted-foreground">Showing the latest 100 tickets.</p>
      {create && (
        <Modal title="Open a support ticket" close={() => setCreate(false)}>
          <Form
            submit="Create ticket"
            close={() => setCreate(false)}
            onSubmit={async (f) => {
              const t = await api.post<Row>('/tickets', {
                customerId: admin ? f.get('customerId') : undefined,
                subject: f.get('subject'),
                body: f.get('body'),
                priority: f.get('priority'),
                departmentId: f.get('departmentId') || null,
                serviceId: f.get('serviceId') || null,
              });
              setCreate(false);
              router.push(`${admin ? '/admin' : '/dashboard'}/tickets/${t.id}`);
            }}
          >
            <>
              {admin && (
                <Field label="Customer account">
                  <Select
                    name="customerId"
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    required
                  >
                    <option value="">Choose a customer</option>
                    {customers.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.email}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </>
            <Field label="Ticket subject">
              <Input name="subject" minLength={3} maxLength={150} required />
            </Field>
            <Field label="Support department">
              <Select name="departmentId">
                <option value="">General</option>
                {departments.data
                  ?.filter((d) => d.active)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Related service">
              <Select name="serviceId">
                <option value="">No specific service</option>
                {(admin ? owner.data?.services : services.data)?.map((s: Row) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ticket priority">
              <Select name="priority" defaultValue="NORMAL">
                {priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <Field label="Describe the issue">
              <textarea
                name="body"
                required
                maxLength={20000}
                className="min-h-36 w-full rounded-md border bg-background p-3 text-sm"
              />
            </Field>
          </Form>
        </Modal>
      )}
      {manage && (
        <Modal title="Support departments" close={() => setManage(false)}>
          <Button
            className="mb-4"
            variant="outline"
            onClick={() => {
              setManage(false);
              setDepartment({});
            }}
          >
            Add department
          </Button>
          <div className="space-y-3">
            {departments.data?.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-lg border p-3 text-sm"
              >
                <div>
                  {d.name}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {d.active ? 'Enabled' : 'Archived'} ·{' '}
                    {d.notificationEmail || 'No notification email'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setManage(false);
                    setDepartment(d);
                  }}
                >
                  Edit
                </Button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {department && (
        <Modal
          title={department.id ? 'Edit support department' : 'Add support department'}
          close={() => setDepartment(null)}
        >
          <Form
            submit="Save department"
            close={() => setDepartment(null)}
            onSubmit={async (f) => {
              const body = {
                name: f.get('name'),
                notificationEmail: f.get('notificationEmail'),
                active: f.get('active') === 'on',
              };
              if (department.id) await api.patch(`/support/departments/${department.id}`, body);
              else await api.post('/support/departments', body);
              await departments.mutate();
              setDepartment(null);
              toast.success('Department saved');
            }}
          >
            <Field label="Department name">
              <Input name="name" defaultValue={department.name} required />
            </Field>
            <Field label="Notification email">
              <Input
                name="notificationEmail"
                type="email"
                defaultValue={department.notificationEmail}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input name="active" type="checkbox" defaultChecked={department.active ?? true} />
              Accept new tickets in this department
            </label>
          </Form>
        </Modal>
      )}
    </>
  );
}
function TicketDetail({ admin, id }: { admin: boolean; id: string }) {
  const policy = useData<Row>('/settings').data?.supportPolicy;
  const q = useData<Row>(`/tickets/${id}`, 10000),
    agents = useData<Row[]>(admin ? '/support/agents' : null),
    departments = useData<Row[]>(admin ? '/support/departments' : null);
  const [settings, setSettings] = useState(false),
    [formKey, setFormKey] = useState(0);
  if (q.error) return <ErrorBox error={q.error} retry={q.mutate} />;
  if (!q.data) return <Loading />;
  const t = q.data;
  const status = async () => {
    try {
      await api.patch(`/tickets/${id}`, { status: t.status === 'CLOSED' ? 'OPEN' : 'CLOSED' });
      await q.mutate();
      toast.success(t.status === 'CLOSED' ? 'Ticket reopened' : 'Ticket closed');
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };
  return (
    <>
      <Link
        href={`${admin ? '/admin' : '/dashboard'}/tickets`}
        className="mb-5 inline-flex items-center gap-2 text-xs text-muted-foreground"
      >
        <ArrowLeft className="size-3" />
        All tickets
      </Link>
      <Header
        eyebrow={`Support · #${id.slice(0, 8)}`}
        title={t.subject}
        description={`${t.department?.name || 'General'} · ${t.priority} priority · ${t.assignedTo?.name || 'Awaiting assignment'}`}
        action={
          <div className="flex gap-2">
            {admin && (
              <Button variant="outline" onClick={() => setSettings(true)}>
                Ticket settings
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!admin && policy?.customerCloseEnabled === false}
              onClick={() => void status()}
            >
              {t.status === 'CLOSED' ? 'Reopen ticket' : 'Close ticket'}
            </Button>
          </div>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3 text-xs">
        <Badge variant="outline">{t.status.replaceAll('_', ' ')}</Badge>
        {admin && (
          <Link
            href={`/admin/customers/${t.customerId}`}
            className="text-muted-foreground hover:underline"
          >
            {t.customer.email}
          </Link>
        )}
        {t.service && (
          <Link
            href={`${admin ? '/admin' : '/dashboard'}/services/${t.service.id}`}
            className="text-muted-foreground hover:underline"
          >
            {t.service.name}
          </Link>
        )}
      </div>
      <div className="space-y-4">
        {t.messages.map((m: Row) => (
          <div
            key={m.id}
            className={`rounded-xl border p-5 ${m.internal ? 'border-amber-500/30 bg-amber-500/5' : 'bg-card'}`}
          >
            <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
              <span className="font-medium">{m.author.name}</span>
              <Badge variant="outline">
                {m.internal
                  ? 'Private staff note'
                  : m.author.role === 'ADMIN'
                    ? 'Staff'
                    : 'Customer'}
              </Badge>
              <span className="ml-auto text-muted-foreground">
                {new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
                  new Date(m.createdAt),
                )}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-7">{m.body}</p>
            {m.attachment && (
              <Button className="mt-4" asChild size="sm" variant="outline">
                <a href={`/api/v1/support/attachments/${m.attachment.id}`} download>
                  <Paperclip className="size-3" />
                  {m.attachment.filename} · {Math.ceil(m.attachment.size / 1024)} KB
                </a>
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-6">
        <Panel title={t.status === 'CLOSED' ? 'Reply to reopen this ticket' : 'Write a reply'}>
          <Form
            key={formKey}
            submit="Send reply"
            onSubmit={async (f) => {
              const file = f.get('attachment');
              if (file instanceof File && !file.name) f.delete('attachment');
              const response = await fetch(`/api/v1/tickets/${id}/messages`, {
                method: 'POST',
                body: f,
              });
              const body = await response.json();
              if (!response.ok) throw new Error(body.error?.message || 'Reply could not be sent');
              await q.mutate();
              setFormKey((v) => v + 1);
              toast.success('Reply saved');
            }}
          >
            <Field label="Your reply">
              <textarea
                name="body"
                maxLength={20000}
                required
                className="min-h-32 w-full rounded-md border bg-background p-3 text-sm"
              />
            </Field>
            <Field
              label="Attach a file"
              hint="PNG, JPEG, WebP, PDF, ZIP, or text/log files. Maximum 5 MiB."
            >
              <Input
                name="attachment"
                type="file"
                disabled={policy?.allowAttachments === false}
                accept=".png,.jpg,.jpeg,.webp,.pdf,.zip,.txt,.log"
                className="h-auto py-2"
              />
            </Field>
            {admin && (
              <label className="flex items-center gap-2 text-sm">
                <input name="internal" value="true" type="checkbox" />
                Private staff note (hidden from customer)
              </label>
            )}
          </Form>
        </Panel>
      </div>
      {settings && (
        <Modal title="Ticket settings" close={() => setSettings(false)}>
          <Form
            submit="Save ticket settings"
            close={() => setSettings(false)}
            onSubmit={async (f) => {
              await api.patch(`/tickets/${id}`, {
                status: f.get('status'),
                priority: f.get('priority'),
                assignedToId: f.get('assignedToId') || null,
                departmentId: f.get('departmentId') || null,
              });
              await q.mutate();
              setSettings(false);
              toast.success('Ticket updated');
            }}
          >
            <Field label="Ticket status">
              <Select name="status" defaultValue={t.status}>
                {states.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Ticket priority">
              <Select name="priority" defaultValue={t.priority}>
                {priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <Field label="Assigned support agent">
              <Select name="assignedToId" defaultValue={t.assignedToId || ''}>
                <option value="">Unassigned</option>
                {agents.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Support department">
              <Select name="departmentId" defaultValue={t.departmentId || ''}>
                <option value="">General</option>
                {departments.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {!d.active ? ' (Archived)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}
