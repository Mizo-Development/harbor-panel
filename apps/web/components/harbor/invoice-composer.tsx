'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { requestId } from '@/lib/request-id';
import { currencyScale, parseCurrencyAmount } from '@/lib/currency';
import { Field, Input, Select, Form, Modal, useData, money, type Row } from './shared';
const currencies = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'JPY',
  'BRL',
  'INR',
];
export function InvoiceComposer({ created }: { created: (id: string) => Promise<void> }) {
  const customers = useData<Row[]>('/customers'),
    settings = useData<Row>('/settings');
  const [open, setOpen] = useState(false),
    [currency, setCurrency] = useState('USD'),
    [userId, setUserId] = useState(''),
    [description, setDescription] = useState(''),
    [dueAt, setDueAt] = useState(''),
    [items, setItems] = useState<Row[]>([]),
    [review, setReview] = useState<Row | null>(null),
    [key, setKey] = useState('');
  const start = () => {
    setCurrency(settings.data?.currency || 'USD');
    setUserId('');
    setDescription('');
    setDueAt(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
    setItems([{ id: requestId(), description: '', quantity: '1', unitAmount: '0', taxable: true }]);
    setKey(requestId());
    setReview(null);
    setOpen(true);
  };
  const patch = (id: string, data: Row) =>
    setItems(items.map((i) => (i.id === id ? { ...i, ...data } : i)));
  return (
    <>
      <Button onClick={start}>Create invoice</Button>
      {open && (
        <Modal
          title={review ? 'Review invoice' : 'Create invoice'}
          description="Issue an invoice for services or other charges. Issued amounts and billing details are retained as a permanent record."
          close={() => setOpen(false)}
        >
          {review ? (
            <Form
              submit="Issue invoice"
              onSubmit={async () => {
                const result = await api.post<Row>('/invoices', {
                  ...review.input,
                  idempotencyKey: key,
                  expectedQuoteId: review.quoteId,
                });
                await created(result.id);
                setOpen(false);
              }}
            >
              <p className="font-medium">{review.input.description}</p>
              <p className="text-xs text-muted-foreground">
                Bill to {review.billingSnapshot.buyer.name} · {review.billingSnapshot.buyer.email}
              </p>
              <div className="space-y-3 rounded-lg border p-4">
                {review.billingSnapshot.pricing.lines.map((line: Row, i: number) => (
                  <div className="flex justify-between gap-3 text-sm" key={i}>
                    <span>
                      {line.name} × {line.quantity}
                    </span>
                    <span>{money(line.amount, currency)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm">
                <span>Tax{review.billingSnapshot.pricing.tax.inclusive ? ' (included)' : ''}</span>
                <strong>{money(review.billingSnapshot.pricing.tax.amount, currency)}</strong>
              </div>
              <div className="flex justify-between border-t pt-4 text-base">
                <span>Total invoice</span>
                <strong>{money(review.total, currency)}</strong>
              </div>
              <Button type="button" variant="outline" onClick={() => setReview(null)}>
                Edit invoice details
              </Button>
            </Form>
          ) : (
            <Form
              submit="Review invoice"
              onSubmit={async () => {
                const input = {
                  userId,
                  description,
                  currency,
                  dueAt: `${dueAt}T23:59:59.000Z`,
                  items: items.map((i) => ({
                    description: i.description,
                    quantity: Number(i.quantity),
                    unitAmount: parseCurrencyAmount(i.unitAmount, currency),
                    taxable: i.taxable,
                  })),
                };
                setReview({ ...(await api.post<Row>('/invoices/quote', input)), input });
              }}
            >
              <Field label="Invoice customer">
                <Select required value={userId} onChange={(e) => setUserId(e.target.value)}>
                  <option value="">Choose customer</option>
                  {customers.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.email}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Invoice description">
                <Input
                  value={description}
                  required
                  minLength={3}
                  maxLength={2000}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Invoice currency">
                  <Select
                    value={currency}
                    onChange={(e) => {
                      setCurrency(e.target.value);
                      setItems(items.map((i) => ({ ...i, unitAmount: '0' })));
                    }}
                  >
                    {currencies.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Payment due date">
                  <Input
                    type="date"
                    required
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                  />
                </Field>
              </div>
              {items.map((i, index) => (
                <div key={i.id} className="space-y-3 rounded-lg border p-4">
                  <Field label={`Item ${index + 1} description`}>
                    <Input
                      required
                      maxLength={255}
                      value={i.description}
                      onChange={(e) => patch(i.id, { description: e.target.value })}
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={`Item ${index + 1} quantity`}>
                      <Input
                        type="number"
                        min={1}
                        max={10000}
                        required
                        value={i.quantity}
                        onChange={(e) => patch(i.id, { quantity: e.target.value })}
                      />
                    </Field>
                    <Field label={`Item ${index + 1} unit price (${currency})`}>
                      <Input
                        type="number"
                        min={0}
                        step={1 / currencyScale(currency)}
                        required
                        value={i.unitAmount}
                        onChange={(e) => patch(i.id, { unitAmount: e.target.value })}
                      />
                    </Field>
                  </div>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={i.taxable}
                      onChange={(e) => patch(i.id, { taxable: e.target.checked })}
                    />
                    Taxable item {index + 1}
                  </label>
                  {items.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setItems(items.filter((item) => item.id !== i.id))}
                    >
                      Remove item {index + 1}
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={items.length >= 50}
                onClick={() =>
                  setItems([
                    ...items,
                    {
                      id: requestId(),
                      description: '',
                      quantity: '1',
                      unitAmount: '0',
                      taxable: true,
                    },
                  ])
                }
              >
                Add invoice item
              </Button>
            </Form>
          )}
        </Modal>
      )}
    </>
  );
}
