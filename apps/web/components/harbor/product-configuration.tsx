'use client';
import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { requestId } from '@/lib/request-id';
import { parseCurrencyAmount, currencyScale } from '@/lib/currency';
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
type PriceDraft = {
  id: string;
  planId: string | null;
  currency: string;
  amount: string;
  setupFee: string;
};
const draftPrices = (prices: Row[] = []): PriceDraft[] =>
  prices.map((p) => ({
    id: requestId(),
    planId: p.planId || null,
    currency: p.currency,
    amount: String(p.amount / currencyScale(p.currency)),
    setupFee: String((p.setupFee || 0) / currencyScale(p.currency)),
  }));
const readPrices = (prices: PriceDraft[]) =>
  prices.map(({ planId, currency, amount, setupFee }) => ({
    planId,
    currency,
    amount: parseCurrencyAmount(amount || '0', currency),
    setupFee: parseCurrencyAmount(setupFee || '0', currency),
  }));
function PriceEditor({
  value,
  change,
  plans,
  currency,
  label,
}: {
  value: PriceDraft[];
  change: (rows: PriceDraft[]) => void;
  plans: Row[];
  currency: string;
  label: string;
}) {
  const patch = (id: string, data: Partial<PriceDraft>) =>
    change(value.map((p) => (p.id === id ? { ...p, ...data } : p)));
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs leading-5 text-muted-foreground">
        Set an exact price for each billing plan and currency customers can select. Recurring
        amounts apply per selected term; setup fees are charged once.
      </p>
      {value.map((p, i) => (
        <div key={p.id} className="grid gap-3 rounded-md bg-muted/20 p-3 sm:grid-cols-2">
          <Field label={`${label} ${i + 1} billing plan`}>
            <Select
              value={p.planId || ''}
              onChange={(e) => patch(p.id, { planId: e.target.value || null })}
            >
              <option value="">Standard product term</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`${label} ${i + 1} currency`}>
            <Select
              value={p.currency}
              onChange={(e) =>
                patch(p.id, { currency: e.target.value, amount: '0', setupFee: '0' })
              }
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label={`${label} ${i + 1} recurring price`}>
            <Input
              value={p.amount}
              type="number"
              min={0}
              step={1 / currencyScale(p.currency)}
              required
              onChange={(e) => patch(p.id, { amount: e.target.value })}
            />
          </Field>
          <Field label={`${label} ${i + 1} setup fee`}>
            <Input
              value={p.setupFee}
              type="number"
              min={0}
              step={1 / currencyScale(p.currency)}
              required
              onChange={(e) => patch(p.id, { setupFee: e.target.value })}
            />
          </Field>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => change(value.filter((row) => row.id !== p.id))}
          >
            Remove price {i + 1}
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          change([
            ...value,
            { id: requestId(), planId: null, currency, amount: '0', setupFee: '0' },
          ])
        }
      >
        Add {label.toLowerCase()} price
      </Button>
    </div>
  );
}
export function ProductConfiguration({ id }: { id: string }) {
  const q = useData<Row>(`/products/${id}/configuration`, 10000),
    products = useData<Row[]>('/products'),
    regions = useData<Row[]>('/pricing/regions');
  const product = products.data?.find((p) => p.id === id),
    currency = product?.currency || 'USD';
  const [editorVersion, setEditorVersion] = useState(0);
  const [editPlan, setEditPlan] = useState<Row | null>(null),
    [planType, setPlanType] = useState('RECURRING'),
    [regional, setRegional] = useState<Row[]>([]);
  const [editOption, setEditOption] = useState<Row | null>(null),
    [kind, setKind] = useState('SELECT'),
    [binding, setBinding] = useState(''),
    [optionPrices, setOptionPrices] = useState<PriceDraft[]>([]),
    [choices, setChoices] = useState<Row[]>([]);
  const save = async (next: Row) => {
    await api.patch(`/products/${id}/configuration`, { ...next, expectedVersion: editorVersion });
    await q.mutate();
    await products.mutate();
    toast.success('Product configuration saved');
  };
  const openPlan = (plan: Row = {}) => {
    setEditorVersion(q.data?.version || 0);
    setEditPlan(plan);
    setPlanType(plan.type || 'RECURRING');
    setRegional(
      (plan.regionalPrices || []).map((p: Row) => {
        const region = regions.data?.find((r) => r.id === p.regionId);
        return {
          ...p,
          key: requestId(),
          amountText: String(p.amount / currencyScale(region?.currency || currency)),
          feeText: String((p.setupFee || 0) / currencyScale(region?.currency || currency)),
        };
      }),
    );
  };
  const openOption = (option: Row = {}) => {
    setEditorVersion(q.data?.version || 0);
    setEditOption(option);
    setKind(option.kind || 'SELECT');
    setBinding(option.binding || '');
    setOptionPrices(draftPrices(option.prices));
    setChoices((option.choices || []).map((c: Row) => ({ ...c, prices: draftPrices(c.prices) })));
  };
  const allowedBindings =
    product?.provider === 'wings'
      ? ['memoryMb', 'diskMb', 'cpu', 'swapMb', 'javaVersion']
      : product?.provider === 'proxmox'
        ? ['memoryMb', 'diskMb', 'cpu', ...(product.spec?.vmType === 'lxc' ? ['swapMb'] : [])]
        : product?.provider === 'native-web'
          ? ['diskMb']
          : [];
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data || !product) return <Loading />;
  const plans: Row[] = q.data.plans,
    options: Row[] = q.data.options;
  return (
    <>
      <Header
        eyebrow="Catalog"
        title={`${product.name} · Configuration`}
        description="Offer billing terms and configurable resources. Existing services retain their purchased configuration."
        action={
          <Button variant="outline" asChild>
            <Link href="/admin/products">Back to products</Link>
          </Button>
        }
      />
      <Panel
        title="Billing plans"
        action={
          <Button size="sm" onClick={() => openPlan()}>
            Add billing plan
          </Button>
        }
      >
        <p className="mb-4 text-xs leading-6 text-muted-foreground">
          The standard term and setup fee are managed in Edit plan. Additional plans share this
          product's stock and provider. Each plan can have exact regional prices.
        </p>
        <DataTable
          rows={plans}
          empty="Only the standard product term is available."
          columns={[
            {
              label: 'Plan',
              render: (p) => (
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.type === 'RECURRING'
                      ? `Every ${p.period} ${p.unit.toLowerCase()}`
                      : p.type === 'ONE_TIME'
                        ? 'One-time payment'
                        : 'Free, no renewal invoices'}
                  </p>
                </div>
              ),
            },
            {
              label: 'Base price',
              render: (p) => (
                <div>
                  {money(p.amount, currency)}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Setup: {money(p.setupFee, currency)}
                  </p>
                </div>
              ),
            },
            { label: 'Status', render: (p) => (p.active ? 'Available' : 'Disabled') },
            {
              label: 'Actions',
              render: (p) => (
                <Button size="sm" variant="outline" onClick={() => openPlan(p)}>
                  Edit billing plan
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      <div className="mt-6">
        <Panel
          title="Configurable options"
          action={
            <Button size="sm" onClick={() => openOption()}>
              Add option
            </Button>
          }
        >
          <DataTable
            rows={options}
            empty="Customers purchase the base resources without additional options."
            columns={[
              {
                label: 'Option',
                render: (o) => (
                  <div>
                    <p className="font-medium">{o.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{o.description}</p>
                  </div>
                ),
              },
              {
                label: 'Type',
                render: (o) => (
                  <div>
                    {o.kind}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {o.binding ? `Adds to ${o.binding}` : `Property: ${o.key}`}
                    </p>
                  </div>
                ),
              },
              {
                label: 'Availability',
                render: (o) => (o.active ? (o.required ? 'Required' : 'Optional') : 'Disabled'),
              },
              {
                label: 'Actions',
                render: (o) => (
                  <Button size="sm" variant="outline" onClick={() => openOption(o)}>
                    Edit option
                  </Button>
                ),
              },
            ]}
          />
        </Panel>
      </div>
      {editPlan && (
        <Modal
          title={editPlan.id ? 'Edit billing plan' : 'Add billing plan'}
          close={() => setEditPlan(null)}
        >
          <Form
            submit="Save billing plan"
            onSubmit={async (f) => {
              const plan = {
                id: editPlan.id || requestId(),
                name: f.get('name'),
                active: f.get('active') === 'on',
                type: planType,
                unit: f.get('unit') || 'MONTH',
                period: Number(f.get('period') || 1),
                amount:
                  planType === 'FREE' ? 0 : parseCurrencyAmount(String(f.get('amount')), currency),
                setupFee: parseCurrencyAmount(String(f.get('setupFee')), currency),
                regionalPrices: regional.map((row) => {
                  const r = regions.data?.find((r) => r.id === row.regionId);
                  if (!r) throw new Error('Choose a pricing region');
                  return {
                    regionId: r.id,
                    amount:
                      planType === 'FREE'
                        ? 0
                        : parseCurrencyAmount(row.amountText || '0', r.currency),
                    setupFee: parseCurrencyAmount(row.feeText || '0', r.currency),
                  };
                }),
              };
              await save({
                plans: editPlan.id
                  ? plans.map((p) => (p.id === editPlan.id ? plan : p))
                  : [...plans, plan],
                options,
              });
              setEditPlan(null);
            }}
          >
            <Field label="Billing plan name">
              <Input name="name" defaultValue={editPlan.name} required maxLength={100} />
            </Field>
            <Field label="Billing type">
              <Select value={planType} onChange={(e) => setPlanType(e.target.value)}>
                <option value="RECURRING">Recurring</option>
                <option value="ONE_TIME">One-time</option>
                <option value="FREE">Free</option>
              </Select>
            </Field>
            {planType === 'RECURRING' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Billing period">
                  <Input
                    type="number"
                    name="period"
                    min={1}
                    max={120}
                    defaultValue={editPlan.period || 1}
                    required
                  />
                </Field>
                <Field label="Billing unit">
                  <Select name="unit" defaultValue={editPlan.unit || 'MONTH'}>
                    {['DAY', 'WEEK', 'MONTH', 'YEAR'].map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
            {planType !== 'FREE' && (
              <Field label={`Plan amount (${currency})`}>
                <Input
                  name="amount"
                  type="number"
                  min={0}
                  step={1 / currencyScale(currency)}
                  defaultValue={(editPlan.amount || 0) / currencyScale(currency)}
                  required
                />
              </Field>
            )}
            <Field label={`Plan setup fee (${currency})`}>
              <Input
                name="setupFee"
                type="number"
                min={0}
                step={1 / currencyScale(currency)}
                defaultValue={(editPlan.setupFee || 0) / currencyScale(currency)}
                required
              />
            </Field>
            <label className="flex gap-2 text-sm">
              <input name="active" type="checkbox" defaultChecked={editPlan.active ?? true} />
              Enable billing plan
            </label>
            <div className="space-y-3 rounded-lg border p-4">
              <p className="text-sm font-medium">Regional plan prices</p>
              {regional.map((row, i) => {
                const r = regions.data?.find((r) => r.id === row.regionId),
                  update = (data: Row) =>
                    setRegional(regional.map((p) => (p.key === row.key ? { ...p, ...data } : p)));
                return (
                  <div
                    key={row.key}
                    className="grid gap-3 rounded-md bg-muted/20 p-3 sm:grid-cols-2"
                  >
                    <Field label={`Plan region ${i + 1}`}>
                      <Select
                        value={row.regionId}
                        onChange={(e) =>
                          update({ regionId: e.target.value, amountText: '0', feeText: '0' })
                        }
                      >
                        <option value="">Choose region</option>
                        {regions.data?.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} · {r.currency}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {planType !== 'FREE' && (
                      <Field label={`Regional plan amount ${i + 1}`}>
                        <Input
                          type="number"
                          min={0}
                          step={1 / currencyScale(r?.currency || currency)}
                          value={row.amountText}
                          onChange={(e) => update({ amountText: e.target.value })}
                          required
                        />
                      </Field>
                    )}
                    <Field label={`Regional plan setup fee ${i + 1}`}>
                      <Input
                        type="number"
                        min={0}
                        step={1 / currencyScale(r?.currency || currency)}
                        value={row.feeText}
                        onChange={(e) => update({ feeText: e.target.value })}
                        required
                      />
                    </Field>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setRegional(regional.filter((p) => p.key !== row.key))}
                    >
                      Remove region {i + 1}
                    </Button>
                  </div>
                );
              })}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setRegional([
                    ...regional,
                    { key: requestId(), regionId: '', amountText: '0', feeText: '0' },
                  ])
                }
              >
                Add regional plan price
              </Button>
            </div>
          </Form>
        </Modal>
      )}
      {editOption && (
        <Modal
          title={editOption.id ? 'Edit configurable option' : 'Add configurable option'}
          close={() => setEditOption(null)}
        >
          <Form
            submit="Save option"
            onSubmit={async (f) => {
              const option = {
                id: editOption.id || requestId(),
                key: f.get('key'),
                name: f.get('name'),
                description: f.get('description'),
                active: f.get('active') === 'on',
                required: f.get('required') === 'on',
                kind,
                binding: ['SELECT', 'QUANTITY'].includes(kind) ? binding || null : null,
                min: Number(f.get('min') || 0),
                max: Number(f.get('max') || 100),
                step: Number(f.get('step') || 1),
                validation: f.get('validation') || 'text',
                maxLength: Number(f.get('maxLength') || 255),
                prices: ['QUANTITY', 'TOGGLE'].includes(kind) ? readPrices(optionPrices) : [],
                choices:
                  kind === 'SELECT'
                    ? choices.map((c) => ({
                        id: c.id,
                        name: c.name,
                        value: c.value,
                        active: c.active,
                        prices: readPrices(c.prices),
                      }))
                    : [],
              };
              await save({
                plans,
                options: editOption.id
                  ? options.map((o) => (o.id === editOption.id ? option : o))
                  : [...options, option],
              });
              setEditOption(null);
            }}
          >
            <Field label="Option name">
              <Input name="name" defaultValue={editOption.name} required maxLength={100} />
            </Field>
            <Field
              label="Property key"
              hint="A stable key available to hosting integrations and plugins."
            >
              <Input
                name="key"
                defaultValue={editOption.key}
                pattern="[a-z][a-z0-9_]{1,39}"
                required
                maxLength={40}
              />
            </Field>
            <Field label="Option description">
              <Input
                name="description"
                defaultValue={editOption.description || ''}
                maxLength={1000}
              />
            </Field>
            <Field label="Option type">
              <Select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setBinding('');
                }}
              >
                <option value="SELECT">Choice list</option>
                <option value="QUANTITY">Quantity</option>
                <option value="TOGGLE">Checkbox</option>
                <option value="TEXT">Text property</option>
              </Select>
            </Field>
            {['SELECT', 'QUANTITY'].includes(kind) && (
              <Field
                label="Resource binding"
                hint="Numeric values are added to the base plan resource. Java choices select a version."
              >
                <Select value={binding} onChange={(e) => setBinding(e.target.value)}>
                  <option value="">Property only</option>
                  {allowedBindings
                    .filter((b) => kind === 'SELECT' || b !== 'javaVersion')
                    .map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                </Select>
              </Field>
            )}
            <div className="flex flex-wrap gap-5 text-sm">
              <label className="flex gap-2">
                <input name="active" type="checkbox" defaultChecked={editOption.active ?? true} />
                Enable option
              </label>
              <label className="flex gap-2">
                <input
                  name="required"
                  type="checkbox"
                  defaultChecked={editOption.required ?? false}
                />
                Required
              </label>
            </div>
            {kind === 'QUANTITY' && (
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ['min', 'Minimum quantity', editOption.min ?? 0],
                  ['max', 'Maximum quantity', editOption.max || 100],
                  ['step', 'Quantity step', editOption.step || 1],
                ].map(([name, label, value]) => (
                  <Field key={String(name)} label={String(label)}>
                    <Input
                      name={String(name)}
                      type="number"
                      min={name === 'min' ? 0 : 1}
                      max={1000000}
                      defaultValue={Number(value)}
                      required
                    />
                  </Field>
                ))}
              </div>
            )}
            {kind === 'TEXT' && (
              <>
                <Field label="Property validation">
                  <Select name="validation" defaultValue={editOption.validation || 'text'}>
                    <option value="text">Text</option>
                    <option value="hostname">Hostname</option>
                    <option value="email">Email address</option>
                    <option value="slug">Letters, numbers, dash and underscore</option>
                  </Select>
                </Field>
                <Field label="Maximum characters">
                  <Input
                    name="maxLength"
                    type="number"
                    min={1}
                    max={2000}
                    defaultValue={editOption.maxLength || 255}
                    required
                  />
                </Field>
              </>
            )}
            {['QUANTITY', 'TOGGLE'].includes(kind) && (
              <PriceEditor
                value={optionPrices}
                change={setOptionPrices}
                plans={plans}
                currency={currency}
                label="Option"
              />
            )}
            {kind === 'SELECT' && (
              <div className="space-y-4">
                {choices.map((c, i) => {
                  const patch = (data: Row) =>
                    setChoices(choices.map((row) => (row.id === c.id ? { ...row, ...data } : row)));
                  return (
                    <div key={c.id} className="space-y-3 rounded-lg border p-4">
                      <Field label={`Choice ${i + 1} name`}>
                        <Input
                          value={c.name}
                          onChange={(e) => patch({ name: e.target.value })}
                          required
                          maxLength={100}
                        />
                      </Field>
                      <Field label={`Choice ${i + 1} value`}>
                        <Input
                          value={c.value}
                          onChange={(e) => patch({ value: e.target.value })}
                          required
                          maxLength={255}
                        />
                      </Field>
                      <label className="flex gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={c.active}
                          onChange={(e) => patch({ active: e.target.checked })}
                        />
                        Enable choice {i + 1}
                      </label>
                      <PriceEditor
                        value={c.prices}
                        change={(prices) => patch({ prices })}
                        plans={plans}
                        currency={currency}
                        label={`Choice ${i + 1}`}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setChoices(choices.filter((row) => row.id !== c.id))}
                      >
                        Remove choice {i + 1}
                      </Button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setChoices([
                      ...choices,
                      {
                        id: `choice-${requestId().slice(0, 8)}`,
                        name: '',
                        value: '',
                        active: true,
                        prices: [],
                      },
                    ])
                  }
                >
                  Add choice
                </Button>
              </div>
            )}
          </Form>
        </Modal>
      )}
    </>
  );
}
