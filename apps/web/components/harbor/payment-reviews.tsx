'use client';
import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Header,
  Field,
  Form,
  Modal,
  DataTable,
  Loading,
  ErrorBox,
  useData,
  money,
  date,
  type Row,
} from './shared';
export function PaymentReviews() {
  const q = useData<Row[]>('/payments/review', 10000);
  const [edit, setEdit] = useState<Row | null>(null);
  return (
    <>
      <Header
        eyebrow="Billing"
        title="Payment reviews"
        description="Reconcile late or additional charges. These records do not reactivate a service or automatically refund a payment."
      />
      {q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <DataTable
          rows={q.data}
          empty="No payments need review."
          columns={[
            {
              label: 'Payment',
              render: (p) => (
                <div>
                  <p className="font-medium">
                    {money(p.amount, p.currency)} · {p.gateway}
                  </p>
                  <p className="mt-1 max-w-xs break-all text-xs text-muted-foreground">
                    {p.externalId}
                  </p>
                </div>
              ),
            },
            {
              label: 'Invoice',
              render: (p) => (
                <div>
                  <Link className="hover:underline" href={`/admin/invoices/${p.invoiceId}`}>
                    {p.invoice.number || `INV-${p.invoiceId.slice(0, 8).toUpperCase()}`}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">{p.invoice.user.email}</p>
                </div>
              ),
            },
            {
              label: 'Reason',
              render: (p) => (
                <div className="max-w-xs text-xs leading-6">
                  <p>{p.reviewReason}</p>
                  <p className="mt-1 text-muted-foreground">
                    Applied {money(p.appliedAmount || 0, p.currency)} · unallocated{' '}
                    {money(p.amount - (p.appliedAmount || 0), p.currency)}
                  </p>
                </div>
              ),
            },
            {
              label: 'Review',
              render: (p) =>
                p.reviewedAt ? (
                  <div>
                    <p>Reviewed {date(p.reviewedAt)}</p>
                    <p className="mt-1 max-w-xs whitespace-pre-wrap break-words text-xs text-muted-foreground">
                      {p.reviewResolution}
                    </p>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setEdit(p)}>
                    Record resolution
                  </Button>
                ),
            },
          ]}
        />
      )}
      {edit && (
        <Modal
          title="Record payment resolution"
          description="Record the action already taken, including any external refund reference. Saving this note does not move funds or change the invoice."
          close={() => setEdit(null)}
        >
          <Form
            submit="Mark reviewed"
            onSubmit={async (f) => {
              await api.post(`/payments/${edit.id}/review`, { resolution: f.get('resolution') });
              await q.mutate();
              setEdit(null);
              toast.success('Payment review recorded');
            }}
          >
            <Field label="Resolution notes">
              <textarea
                name="resolution"
                minLength={10}
                maxLength={3000}
                required
                className="min-h-28 w-full rounded-md border bg-background p-3 text-sm"
              />
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}
