'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, apiFetch, getErrorMessage } from '@/lib/api';
import { parseCurrencyAmount, currencyScale } from '@/lib/currency';
import { Button } from '@/components/ui/button';
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
  money,
  type Row,
} from './shared';
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
export function RegionalPricing() {
  const regions = useData<Row[]>('/pricing/regions'),
    products = useData<Row[]>('/products'),
    settings = useData<Row>('/settings');
  const [edit, setEdit] = useState<Row | null>(null),
    [price, setPrice] = useState<Row | null>(null);
  const [regionId, setRegionId] = useState('');
  const region = regions.data?.find((r) => r.id === regionId);
  return (
    <>
      <Header
        eyebrow="Billing"
        title="Regional pricing"
        description="Set exact country and currency prices. Customers receive prices from their saved billing country."
        action={<Button onClick={() => setEdit({})}>Add pricing region</Button>}
      />
      <Panel title="Pricing policy">
        <Form
          submit="Save pricing policy"
          onSubmit={async (f) => {
            await api.patch('/settings', { regionalPricingEnabled: f.get('enabled') === 'on' });
            await settings.mutate();
            await products.mutate();
            toast.success('Pricing policy saved');
          }}
        >
          <label className="flex items-center gap-3 text-sm">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={settings.data?.regionalPricingEnabled}
              key={String(settings.data?.regionalPricingEnabled)}
            />
            Enable regional pricing
          </label>
          <p className="text-xs leading-6 text-muted-foreground">
            An enabled country rule and a product price are both required. Otherwise the base price
            and currency apply. Guests see base prices. Existing services retain their contracted
            amount and currency for renewal.
          </p>
        </Form>
      </Panel>
      <div className="my-6">
        {regions.error ? (
          <ErrorBox error={regions.error} />
        ) : !regions.data ? (
          <Loading />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {regions.data.map((r) => (
              <Panel key={r.id}>
                <div className="flex justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{r.name}</h2>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {r.country} · {r.currency} · {r.active ? 'Enabled' : 'Disabled'} ·{' '}
                      {r.prices.length} prices
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setEdit(r)}>
                    Edit region
                  </Button>
                </div>
                <Button
                  className="mt-4"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setRegionId(r.id);
                    setPrice({});
                  }}
                >
                  Add product price
                </Button>
              </Panel>
            ))}
          </div>
        )}
      </div>
      <Panel title="Product prices">
        <DataTable
          rows={regions.data?.flatMap((r) => r.prices.map((p: Row) => ({ ...p, region: r }))) || []}
          empty="Add a region and product price to customize the storefront."
          columns={[
            {
              label: 'Product',
              render: (p) =>
                products.data?.find((product) => product.id === p.productId)?.name || p.productId,
            },
            { label: 'Region', render: (p) => `${p.region.name} (${p.region.country})` },
            { label: 'Price', render: (p) => money(p.amount, p.region.currency) },
            {
              label: '',
              render: (p) => (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRegionId(p.regionId);
                      setPrice(p);
                    }}
                  >
                    Edit price
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void apiFetch(`/pricing/prices/${p.id}`, { method: 'DELETE' })
                        .then(() => regions.mutate())
                        .catch((e) => toast.error(getErrorMessage(e)))
                    }
                  >
                    Remove override
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Panel>
      {edit && (
        <Modal
          title={edit.id ? 'Edit pricing region' : 'Add pricing region'}
          close={() => setEdit(null)}
        >
          <Form
            submit="Save region"
            close={() => setEdit(null)}
            onSubmit={async (f) => {
              const data = {
                name: f.get('name'),
                country: f.get('country'),
                currency: f.get('currency'),
                active: f.get('active') === 'on',
              };
              if (edit.id) await api.patch(`/pricing/regions/${edit.id}`, data);
              else await api.post('/pricing/regions', data);
              await regions.mutate();
              setEdit(null);
              toast.success('Pricing region saved');
            }}
          >
            <Field label="Region name">
              <Input name="name" defaultValue={edit.name} placeholder="India" required />
            </Field>
            <Field label="Billing country code">
              <Input
                name="country"
                defaultValue={edit.country}
                maxLength={2}
                minLength={2}
                pattern="[A-Za-z]{2}"
                placeholder="IN"
                required
              />
            </Field>
            <Field label="Region currency">
              <Select name="currency" defaultValue={edit.currency || 'USD'}>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <label className="flex gap-2 text-sm">
              <input name="active" type="checkbox" defaultChecked={edit.active ?? true} />
              Enable this region
            </label>
          </Form>
        </Modal>
      )}
      {price && region && (
        <Modal title={`Product price · ${region.name}`} close={() => setPrice(null)}>
          <Form
            submit="Save regional price"
            close={() => setPrice(null)}
            onSubmit={async (f) => {
              await api.post('/pricing/prices', {
                productId: f.get('productId'),
                regionId,
                amount: parseCurrencyAmount(String(f.get('amount')), region.currency),
                setupFee: parseCurrencyAmount(String(f.get('setupFee')), region.currency),
              });
              await regions.mutate();
              setPrice(null);
              toast.success('Regional price saved');
            }}
          >
            <Field label="Product">
              <Select name="productId" defaultValue={price.productId || ''} required>
                <option value="">Choose a product</option>
                {products.data
                  ?.filter((p) => p.provider !== 'demo-game')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={`Regional setup fee (${region.currency})`}>
              <Input
                name="setupFee"
                type="number"
                min={0}
                step={1 / currencyScale(region.currency)}
                defaultValue={(price.setupFee || 0) / currencyScale(region.currency)}
                required
              />
            </Field>
            <Field label={`Regional amount (${region.currency})`}>
              <Input
                name="amount"
                type="number"
                min={0}
                step={1 / currencyScale(region.currency)}
                defaultValue={
                  price.amount !== undefined
                    ? price.amount / currencyScale(region.currency)
                    : undefined
                }
                required
              />
            </Field>
            <p className="text-xs leading-6 text-muted-foreground">
              Uses the product’s existing billing cycle. This is an exact regional price, with no
              exchange-rate conversion.
            </p>
          </Form>
        </Modal>
      )}
    </>
  );
}
