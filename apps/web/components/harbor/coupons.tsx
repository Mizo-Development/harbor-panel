'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { parseCurrencyAmount, currencyScale } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  type Row,
} from './shared';
export function CouponManager() {
  const q = useData<Row[]>('/coupons'),
    products = useData<Row[]>('/products'),
    settings = useData<Row>('/settings');
  const [edit, setEdit] = useState<Row | null>(null),
    [type, setType] = useState('PERCENT'),
    [currency, setCurrency] = useState('USD');
  const open = (c: Row = {}) => {
    setEdit(c);
    setType(c.type || 'PERCENT');
    setCurrency(c.currency || settings.data?.currency || 'USD');
  };
  return (
    <>
      <Header
        eyebrow="Catalog"
        title="Coupons"
        description="Control eligibility and usage limits. Discount amounts are validated on the server at checkout."
        action={<Button onClick={() => open()}>Create coupon</Button>}
      />
      {q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <DataTable
          rows={q.data}
          empty="No coupons configured."
          columns={[
            {
              label: 'Code',
              render: (c) => (
                <div className="font-mono">
                  {c.code}
                  <p className="mt-1 font-sans text-xs text-muted-foreground">{c.description}</p>
                </div>
              ),
            },
            {
              label: 'Discount',
              render: (c) =>
                c.type === 'PERCENT' ? `${c.value / 100}%` : money(c.value, c.currency),
            },
            {
              label: 'Duration',
              render: (c) => (c.recurring ? 'Recurring' : 'First invoice only'),
            },
            {
              label: 'Uses',
              render: (c) => `${c._count.redemptions}${c.maxUses ? ` / ${c.maxUses}` : ''}`,
            },
            {
              label: 'Status',
              render: (c) => <Badge variant="outline">{c.active ? 'Enabled' : 'Disabled'}</Badge>,
            },
            {
              label: '',
              render: (c) => (
                <Button size="sm" variant="outline" onClick={() => open(c)}>
                  Edit coupon
                </Button>
              ),
            },
          ]}
        />
      )}
      <p className="mt-4 text-xs leading-6 text-muted-foreground">
        Unpaid orders reserve a use until they expire. Existing recurring discounts keep their
        contracted amount when a coupon is changed or disabled.
      </p>
      {edit && (
        <Modal title={edit.id ? 'Edit coupon' : 'Create coupon'} close={() => setEdit(null)}>
          <Form
            submit="Save coupon"
            close={() => setEdit(null)}
            onSubmit={async (f) => {
              const d = {
                code: f.get('code'),
                description: f.get('description'),
                type,
                value: parseCurrencyAmount(
                  String(f.get('value')),
                  type === 'PERCENT' ? 'USD' : currency,
                ),
                currency: type === 'FIXED' ? currency : null,
                active: f.get('active') === 'on',
                recurring: f.get('recurring') === 'on',
                firstPurchaseOnly: f.get('firstPurchaseOnly') === 'on',
                startsAt: f.get('startsAt')
                  ? new Date(String(f.get('startsAt'))).toISOString()
                  : null,
                endsAt: f.get('endsAt') ? new Date(String(f.get('endsAt'))).toISOString() : null,
                maxUses: f.get('maxUses') ? Number(f.get('maxUses')) : null,
                perCustomerLimit: Number(f.get('perCustomerLimit')),
                countries: String(f.get('countries') || '')
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
                productIds: f.getAll('productIds'),
              };
              if (edit.id) await api.patch(`/coupons/${edit.id}`, d);
              else await api.post('/coupons', d);
              await q.mutate();
              setEdit(null);
              toast.success('Coupon saved');
            }}
          >
            <Field label="Coupon code">
              <Input
                name="code"
                defaultValue={edit.code}
                minLength={3}
                maxLength={40}
                pattern="[A-Za-z0-9_-]+"
                required
              />
            </Field>
            <Field label="Coupon description">
              <Input name="description" defaultValue={edit.description} />
            </Field>
            <Field label="Discount type">
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="PERCENT">Percentage</option>
                <option value="FIXED">Fixed amount</option>
              </Select>
            </Field>
            {type === 'FIXED' && (
              <Field label="Discount currency">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {[
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
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field
              label={type === 'PERCENT' ? 'Discount percentage' : `Discount amount (${currency})`}
            >
              <Input
                key={type + currency}
                name="value"
                type="number"
                min={type === 'PERCENT' ? 0.01 : 1 / currencyScale(currency)}
                max={type === 'PERCENT' ? 100 : undefined}
                step={type === 'PERCENT' ? 0.01 : 1 / currencyScale(currency)}
                defaultValue={
                  edit.value
                    ? edit.value / (type === 'PERCENT' ? 100 : currencyScale(currency))
                    : undefined
                }
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts at">
                <Input
                  name="startsAt"
                  type="datetime-local"
                  defaultValue={
                    edit.startsAt
                      ? new Date(
                          new Date(edit.startsAt).getTime() -
                            new Date(edit.startsAt).getTimezoneOffset() * 60000,
                        )
                          .toISOString()
                          .slice(0, 16)
                      : ''
                  }
                />
              </Field>
              <Field label="Expires at">
                <Input
                  name="endsAt"
                  type="datetime-local"
                  defaultValue={
                    edit.endsAt
                      ? new Date(
                          new Date(edit.endsAt).getTime() -
                            new Date(edit.endsAt).getTimezoneOffset() * 60000,
                        )
                          .toISOString()
                          .slice(0, 16)
                      : ''
                  }
                />
              </Field>
              <Field label="Total usage limit">
                <Input
                  name="maxUses"
                  type="number"
                  min={1}
                  defaultValue={edit.maxUses}
                  placeholder="Unlimited"
                />
              </Field>
              <Field label="Uses per customer">
                <Input
                  name="perCustomerLimit"
                  type="number"
                  min={1}
                  defaultValue={edit.perCustomerLimit || 1}
                  required
                />
              </Field>
            </div>
            <Field
              label="Eligible billing countries"
              hint="Comma-separated two-letter codes. Leave blank for all countries."
            >
              <Input
                name="countries"
                defaultValue={edit.countries?.join(', ')}
                placeholder="US, GB, IN"
              />
            </Field>
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-2 text-xs font-medium">
                Eligible products (none selected means all)
              </legend>
              {products.data
                ?.filter((p) => p.provider !== 'demo-game')
                .map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      name="productIds"
                      value={p.id}
                      defaultChecked={edit.products?.some((r: Row) => r.productId === p.id)}
                    />
                    {p.name}
                  </label>
                ))}
            </fieldset>
            {[
              ['active', 'Enable coupon', edit.active ?? true],
              ['recurring', 'Apply on recurring invoices', edit.recurring ?? false],
              ['firstPurchaseOnly', 'First order only', edit.firstPurchaseOnly ?? false],
            ].map(([key, label, checked]) => (
              <label key={String(key)} className="flex items-center gap-2 text-sm">
                <input name={String(key)} type="checkbox" defaultChecked={Boolean(checked)} />
                {String(label)}
              </label>
            ))}
          </Form>
        </Modal>
      )}
    </>
  );
}
