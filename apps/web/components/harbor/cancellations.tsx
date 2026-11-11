'use client';
import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/data/status-badge';
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

const cutoffTime = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value)) + ' UTC';
function CancellationRecords({
  rows,
  admin,
  refresh,
}: {
  rows: Row[];
  admin: boolean;
  refresh: () => Promise<unknown>;
}) {
  const [review, setReview] = useState<Row | null>(null),
    [decision, setDecision] = useState('APPROVE');
  return (
    <>
      <DataTable
        rows={rows}
        empty="No cancellation requests."
        columns={[
          {
            label: 'Service',
            render: (r) => (
              <div>
                <Link
                  className="font-medium hover:underline"
                  href={`${admin ? '/admin' : '/dashboard'}/services/${r.serviceId}`}
                >
                  {r.service.name}
                </Link>
                {admin && (
                  <p className="mt-1 text-xs text-muted-foreground">{r.service.user.email}</p>
                )}
              </div>
            ),
          },
          {
            label: 'Request',
            render: (r) => (
              <div>
                <p>{r.mode === 'END_OF_TERM' ? 'End of paid term' : 'Immediate'}</p>
                <p className="mt-1 max-w-xs whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {r.reason}
                </p>
              </div>
            ),
          },
          {
            label: 'Status',
            render: (r) => (
              <div>
                <StatusBadge
                  status={r.status === 'FAILED' ? 'error' : r.status.toLowerCase()}
                  label={r.status.replaceAll('_', ' ')}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.effectiveAt
                    ? cutoffTime(r.effectiveAt)
                    : r.completedAt
                      ? `Completed ${date(r.completedAt)}`
                      : r.reviewedAt
                        ? `Reviewed ${date(r.reviewedAt)}`
                        : r.status === 'WITHDRAWN'
                          ? 'Withdrawn before review'
                          : 'Awaiting review'}
                </p>
                {r.reviewNote && (
                  <p className="mt-1 max-w-xs whitespace-pre-wrap break-words text-xs text-muted-foreground">
                    {r.reviewNote}
                  </p>
                )}
                {r.operation?.error && (
                  <p className="mt-1 max-w-xs text-xs text-destructive">{r.operation.error}</p>
                )}
              </div>
            ),
          },
          {
            label: 'Actions',
            render: (r) => (
              <div className="flex flex-wrap gap-2">
                {admin && r.status === 'PENDING' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDecision('APPROVE');
                      setReview(r);
                    }}
                  >
                    Review request
                  </Button>
                )}
                {['PENDING', 'APPROVED'].includes(r.status) &&
                  (!r.effectiveAt || new Date(r.effectiveAt) > new Date()) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void api
                          .post(`/cancellations/${r.id}/withdraw`)
                          .then(async () => {
                            await refresh();
                            toast.success('Cancellation withdrawn');
                          })
                          .catch((e) => toast.error(getErrorMessage(e)))
                      }
                    >
                      Withdraw request
                    </Button>
                  )}
                {admin && r.status === 'FAILED' && r.operationId && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void api
                        .post(`/operations/${r.operationId}/retry`)
                        .then(async () => {
                          await refresh();
                          toast.success('Termination retry queued');
                        })
                        .catch((e) => toast.error(getErrorMessage(e)))
                    }
                  >
                    Retry termination
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      {review && (
        <Modal
          title="Review cancellation"
          description="Approval schedules permanent service deletion. Existing paid invoices and payment history are retained. Refunds require separate handling."
          close={() => setReview(null)}
        >
          <Form
            submit={decision === 'APPROVE' ? 'Approve cancellation' : 'Reject cancellation'}
            onSubmit={async (f) => {
              await api.post(`/cancellations/${review.id}/review`, {
                decision,
                note: f.get('note'),
                ...(decision === 'APPROVE' ? { confirmation: f.get('confirmation') } : {}),
              });
              await refresh();
              setReview(null);
              toast.success(
                decision === 'APPROVE' ? 'Cancellation approved' : 'Cancellation rejected',
              );
            }}
          >
            <p className="text-sm font-medium">{review.service.name}</p>
            <p className="text-xs leading-6 text-muted-foreground">
              {review.mode === 'END_OF_TERM'
                ? `The cutoff uses the current paid term, ending ${cutoffTime(review.service.nextDueAt)}.`
                : 'Deletion begins after approval.'}
            </p>
            <Field label="Review decision">
              <Select value={decision} onChange={(e) => setDecision(e.target.value)}>
                <option value="APPROVE">Approve</option>
                <option value="REJECT">Reject</option>
              </Select>
            </Field>
            <Field label="Response to customer">
              <textarea
                name="note"
                minLength={5}
                maxLength={3000}
                required
                className="min-h-24 w-full rounded-md border bg-background p-3 text-sm"
              />
            </Field>
            {decision === 'APPROVE' && (
              <Field
                label="Confirm service name"
                hint={`Type ${review.service.name} to approve deletion.`}
              >
                <Input name="confirmation" required autoComplete="off" />
              </Field>
            )}
          </Form>
        </Modal>
      )}
    </>
  );
}
export function CancellationPage() {
  const q = useData<Row[]>('/cancellations', 10000);
  return (
    <>
      <Header
        eyebrow="Hosting"
        title="Cancellations"
        description="Review customer requests, scheduled cutoffs, and provider deletion results."
      />
      {q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <CancellationRecords rows={q.data} admin refresh={q.mutate} />
      )}
    </>
  );
}
export function ServiceCancellationPanel({
  service,
  admin,
  refreshService,
}: {
  service: Row;
  admin: boolean;
  refreshService: () => Promise<unknown>;
}) {
  const q = useData<Row[]>(`/services/${service.id}/cancellations`, 10000);
  const [open, setOpen] = useState(false);
  const hasOpen = q.data?.some((r) =>
    ['PENDING', 'APPROVED', 'PROCESSING', 'FAILED'].includes(r.status),
  );
  const futureTerm = service.renewsAt && new Date(service.renewsAt) > new Date();
  const refresh = async () => {
    await Promise.all([q.mutate(), refreshService()]);
  };
  if (service.unpaidCheckoutInvoiceId)
    return (
      <Panel title="Checkout reservation">
        <p className="mb-4 text-xs leading-6 text-muted-foreground">
          This service belongs to an unpaid checkout. Cancelling the checkout releases every service
          in that invoice. Part-paid checkouts require staff reconciliation.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link
            href={`${admin ? '/admin' : '/dashboard'}/invoices/${service.unpaidCheckoutInvoiceId}`}
          >
            View checkout invoice
          </Link>
        </Button>
      </Panel>
    );
  return (
    <div className="mb-6">
      <Panel
        title="Cancellation"
        action={
          service.lifecycleStatus !== 'TERMINATED' && q.data && !hasOpen ? (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Request cancellation
            </Button>
          ) : undefined
        }
      >
        <p className="mb-4 text-xs leading-6 text-muted-foreground">
          Requests require staff review. Approved end-of-term cancellations stop renewal at the
          cutoff. Deletion can permanently remove service data; refunds are handled separately.
        </p>
        {service.cancelsAt && service.lifecycleStatus !== 'TERMINATED' && (
          <p
            role="status"
            className="mb-4 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-sm"
          >
            Cancellation approved for {cutoffTime(service.cancelsAt)}.
          </p>
        )}
        {q.error ? (
          <ErrorBox error={q.error} />
        ) : !q.data ? (
          <Loading />
        ) : q.data.length ? (
          <CancellationRecords rows={q.data} admin={admin} refresh={refresh} />
        ) : (
          <p className="text-xs text-muted-foreground">No cancellation requested.</p>
        )}
      </Panel>
      {open && (
        <Modal
          title="Request cancellation"
          description="Staff will review this request before scheduling service deletion."
          close={() => setOpen(false)}
        >
          <Form
            submit="Submit cancellation request"
            onSubmit={async (f) => {
              await api.post(`/services/${service.id}/cancellations`, {
                mode: f.get('mode'),
                reason: f.get('reason'),
                confirmation: f.get('confirmation'),
              });
              await refresh();
              setOpen(false);
              toast.success('Cancellation requested');
            }}
          >
            <Field label="Cancellation timing">
              <Select name="mode" defaultValue={futureTerm ? 'END_OF_TERM' : 'IMMEDIATE'}>
                <option value="END_OF_TERM" disabled={!futureTerm}>
                  End of paid term
                  {futureTerm ? ` · ${cutoffTime(service.renewsAt)}` : ' · no future paid term'}
                </option>
                <option value="IMMEDIATE">As soon as approved</option>
              </Select>
            </Field>
            <Field label="Cancellation reason">
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={3000}
                className="min-h-24 w-full rounded-md border bg-background p-3 text-sm"
              />
            </Field>
            <Field
              label="Confirm service name"
              hint={`Type ${service.name} to confirm your request.`}
            >
              <Input name="confirmation" required autoComplete="off" />
            </Field>
          </Form>
        </Modal>
      )}
    </div>
  );
}
