'use client';
import { useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { requestId } from '@/lib/request-id';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorBox, Loading, Modal, Form, useData, date, type Row } from './shared';

export function InvoiceDelivery({ id }: { id: string }) {
  const q = useData<Row>(`/invoices/${id}/deliveries`, 10000);
  const [action, setAction] = useState<Row | null>(null);
  if (q.error) return <ErrorBox error={q.error} retry={q.mutate} />;
  if (!q.data) return <Loading />;
  return (
    <section
      className="mt-8 space-y-4 border-t pt-6 print:hidden"
      aria-label="Invoice email delivery"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Email delivery</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Invoice PDFs are sent to the customer's account email.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={q.data.isDemo}
          onClick={() => setAction({ kind: 'SEND', requestKey: requestId() })}
        >
          <Mail className="size-4" /> Email invoice
        </Button>
      </div>
      {!q.data.smtpConfigured && (
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400">
          SMTP is not configured. Queued emails will wait until mail delivery is configured.
        </p>
      )}
      {!q.data.deliveries.length && (
        <p className="py-3 text-sm text-muted-foreground">No invoice emails queued yet.</p>
      )}
      {q.data.deliveries.map((delivery: Row) => (
        <div key={delivery.id} className="space-y-2 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              <span className="break-all">{delivery.recipient}</span>
              <p className="mt-1 text-xs text-muted-foreground">
                {delivery.kind === 'PAID'
                  ? 'Payment receipt'
                  : delivery.kind === 'ISSUED'
                    ? 'Invoice issued'
                    : 'Staff request'}{' '}
                · {date(delivery.createdAt)} · {delivery.attempts} attempt
                {delivery.attempts === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {delivery.status === 'UNKNOWN' ? 'Needs review' : delivery.status.toLowerCase()}
              </Badge>
              {['FAILED', 'UNKNOWN'].includes(delivery.status) && (
                <Button variant="outline" size="sm" onClick={() => setAction(delivery)}>
                  <RefreshCw className="size-3" /> Retry email
                </Button>
              )}
            </div>
          </div>
          {delivery.lastError && (
            <p className="text-xs leading-5 text-muted-foreground">{delivery.lastError}</p>
          )}
          {delivery.sentAt && (
            <p className="text-xs text-muted-foreground">
              Accepted by SMTP on {date(delivery.sentAt)}. Inbox delivery is determined by the
              receiving mail server.
            </p>
          )}
        </div>
      ))}
      {action && (
        <Modal
          title={action?.kind === 'SEND' ? 'Email invoice PDF' : 'Retry invoice email'}
          close={() => setAction(null)}
        >
          {action && (
            <Form
              submit={action.kind === 'SEND' ? 'Queue invoice email' : 'Confirm email retry'}
              onSubmit={async (f) => {
                try {
                  if (action.kind === 'SEND')
                    await api.post(`/invoices/${id}/deliveries`, {
                      idempotencyKey: action.requestKey,
                    });
                  else
                    await api.post(`/invoices/${id}/deliveries/${action.id}/retry`, {
                      acknowledgePossibleDuplicate: f.get('acknowledge') === 'on',
                    });
                  await q.mutate();
                  setAction(null);
                  toast.success('Invoice email queued');
                } catch (error) {
                  toast.error(getErrorMessage(error));
                }
              }}
            >
              <p className="text-sm leading-6 text-muted-foreground">
                A PDF with the saved invoice details and current payment status will be sent to{' '}
                <span className="break-all font-medium text-foreground">
                  {action.recipient || q.data.recipient}
                </span>
                .
              </p>
              {action.status === 'UNKNOWN' && (
                <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
                  <input type="checkbox" name="acknowledge" required className="mt-1" />
                  <span>
                    I checked the mail delivery records and understand this retry may send a
                    duplicate email.
                  </span>
                </label>
              )}
            </Form>
          )}
        </Modal>
      )}
    </section>
  );
}
