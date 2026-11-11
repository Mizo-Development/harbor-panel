'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { api, getErrorMessage } from '@/lib/api';
import { parseCurrencyAmount, currencyScale } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/data/status-badge';
import {
  Header,
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
import { categoryPath } from './categories';
import { GamePlanFields } from './eggs';
import { ProxmoxPlanFields } from './proxmox';
export function CatalogProducts() {
  const q = useData<Row[]>('/products'),
    nodes = useData<Row[]>('/nodes'),
    categories = useData<Row[]>('/catalog/categories'),
    settings = useData<Row>('/settings');
  const [edit, setEdit] = useState<Row | null>(null),
    [nodeId, setNodeId] = useState(''),
    [provider, setProvider] = useState('wings');
  const selected = nodes.data?.find((n) => n.id === nodeId),
    currency = settings.data?.currency || 'USD';
  const open = (product: Row = {}) => {
    setEdit(product);
    setNodeId(product.connectionId || '');
    setProvider(product.provider || 'wings');
  };
  return (
    <>
      <Header
        eyebrow="Catalog"
        title="Products"
        description="Create and edit real hosting plans. Drafts can be prepared before connecting a node."
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/admin/categories">Categories</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin/pricing">Regional pricing</Link>
            </Button>
            <Button onClick={() => open()}>Create product</Button>
          </div>
        }
      />
      {q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <DataTable
          rows={q.data.filter((p) => p.provider !== 'demo-game')}
          empty="No hosting plans yet."
          columns={[
            {
              label: 'Product',
              render: (p) => (
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">{p.description}</p>
                </div>
              ),
            },
            {
              label: 'Provider',
              render: (p) => (
                <div>
                  {p.provider}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {nodes.data?.find((n) => n.id === p.connectionId)?.name || 'Node not assigned'}
                  </p>
                </div>
              ),
            },
            {
              label: 'Capacity',
              render: (p) => (
                <div>
                  {p.stock === null
                    ? 'Unlimited stock'
                    : `${p.stockRemaining} / ${p.stock} available`}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.perCustomerLimit
                      ? `${p.perCustomerLimit} per customer`
                      : 'No customer limit'}
                  </p>
                </div>
              ),
            },
            {
              label: 'Price',
              render: (p) => (
                <div>
                  {p.billingType === 'FREE'
                    ? 'Free'
                    : `${money(p.price, p.currency)}${p.billingType === 'ONE_TIME' ? ' once' : ` / ${p.interval}`}`}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Setup: {money(p.setupFee || 0, p.currency)}
                  </p>
                </div>
              ),
            },
            {
              label: 'Visibility',
              render: (p) => (
                <StatusBadge
                  status={p.active ? 'active' : 'draft'}
                  label={p.active ? 'Orders enabled' : p.listed ? 'Preview' : 'Draft'}
                />
              ),
            },
            {
              label: 'Actions',
              render: (p) => (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => open(p)}>
                    Edit plan
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/admin/products/${p.id}`}>Configure options</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void api
                        .patch(`/products/${p.id}`, {
                          name: p.name,
                          description: p.description,
                          provider: p.provider,
                          category: p.category,
                          price: p.price,
                          cycle: p.cycle,
                          connectionId: p.connectionId,
                          spec: p.spec,
                          active: !p.active,
                          listed: p.listed,
                        })
                        .then(() => q.mutate())
                        .catch((e) => toast.error(getErrorMessage(e)))
                    }
                  >
                    {p.active ? 'Disable orders' : 'Enable orders'}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
      {edit && (
        <Modal
          title={edit.id ? 'Edit hosting plan' : 'Create hosting plan'}
          description="A healthy matching node is required to publish. Existing services keep their contracted price and currency."
          close={() => setEdit(null)}
        >
          <Form
            submit={edit.id ? 'Save plan' : 'Create draft'}
            close={() => setEdit(null)}
            onSubmit={async (f) => {
              const actualProvider = selected?.provider || provider;
              const data = {
                name: f.get('name'),
                description: f.get('description'),
                provider: actualProvider,
                category:
                  actualProvider === 'wings'
                    ? 'game'
                    : actualProvider === 'proxmox'
                      ? 'vps'
                      : 'web',
                price: parseCurrencyAmount(String(f.get('price')), currency),
                cycle: f.get('cycle'),
                setupFee: parseCurrencyAmount(String(f.get('setupFee')), currency),
                catalogCategoryId: f.get('catalogCategoryId') || null,
                stock: f.get('stock') === '' ? null : Number(f.get('stock')),
                perCustomerLimit:
                  f.get('perCustomerLimit') === '' ? null : Number(f.get('perCustomerLimit')),
                connectionId: nodeId || null,
                active: edit.active || false,
                listed: f.get('listed') === 'on',
                taxable: f.get('taxable') === 'on',
                ...(actualProvider === 'wings'
                  ? {
                      gameConfig: {
                        eggId: f.get('eggId'),
                        image: f.get('eggImage') || undefined,
                        variables: Object.fromEntries(
                          Array.from(f.entries())
                            .filter(([key]) => key.startsWith('eggvar.'))
                            .map(([key, value]) => [key.slice(7), String(value)]),
                        ),
                      },
                    }
                  : {}),
                spec: {
                  ...edit.spec,
                  memoryMb: Number(f.get('memory')),
                  diskMb: Number(f.get('disk')),
                  cpu: Number(f.get('cpu')),
                  templateId: String(f.get('template') || '') || undefined,
                  servicePlan: String(f.get('plan') || '') || undefined,
                  vmType: String(f.get('vmType') || edit.spec?.vmType || 'qemu'),
                  swapMb: Number(f.get('swapMb') || edit.spec?.swapMb || 512),
                  ipPool: String(f.get('ipPool') || edit.spec?.ipPool || '') || undefined,
                },
              };
              if (edit.id) await api.patch(`/products/${edit.id}`, data);
              else await api.post('/products', data);
              await q.mutate();
              setEdit(null);
              toast.success('Hosting plan saved');
            }}
          >
            <label className="flex items-center gap-2 text-sm">
              <input name="listed" type="checkbox" defaultChecked={edit.listed ?? false} />
              Show this plan in the storefront
            </label>
            <Field label="Product name">
              <Input name="name" defaultValue={edit.name} required />
            </Field>
            <Field label="Description">
              <textarea
                name="description"
                defaultValue={edit.description}
                required
                className="min-h-20 w-full rounded-md border bg-background p-3 text-sm"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="taxable" defaultChecked={edit.taxable ?? true} />
              Apply tax to this plan
            </label>
            <Field label="Catalog category">
              <Select name="catalogCategoryId" defaultValue={edit.catalogCategoryId || ''}>
                <option value="">Uncategorized</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryPath(c, categories.data!)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Total stock">
                <Input
                  name="stock"
                  type="number"
                  min={0}
                  max={1000000}
                  defaultValue={edit.stock ?? ''}
                  placeholder="Unlimited"
                />
              </Field>
              <Field label="Limit per customer">
                <Input
                  name="perCustomerLimit"
                  type="number"
                  min={1}
                  max={100000}
                  defaultValue={edit.perCustomerLimit ?? ''}
                  placeholder="Unlimited"
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Pending orders reserve stock. Suspended services count until terminated. Leave limits
              blank for unlimited availability.
            </p>
            <Field label="Hosting provider">
              <Select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setNodeId('');
                }}
              >
                {[
                  ['wings', 'Minecraft / Wings'],
                  ['proxmox', 'VPS / Proxmox'],
                  ['plesk', 'Web / Plesk'],
                  ['native-web', 'Web / Harbor'],
                ].map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Hosting connection">
              <Select value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
                <option value="">No node yet (draft only)</option>
                {nodes.data
                  ?.filter((n) => n.provider === provider)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Base price (${currency})`}>
                <Input
                  name="price"
                  type="number"
                  min={0}
                  step={1 / currencyScale(currency)}
                  defaultValue={(edit.price ?? 1000) / currencyScale(currency)}
                  required
                />
              </Field>
              <Field label={`Setup fee (${currency})`}>
                <Input
                  name="setupFee"
                  type="number"
                  min={0}
                  step={1 / currencyScale(currency)}
                  defaultValue={(edit.setupFee || 0) / currencyScale(currency)}
                  required
                />
              </Field>
              <Field label="Billing cycle">
                <Select name="cycle" defaultValue={edit.cycle || 'monthly'}>
                  {Object.entries({
                    daily: 'Daily',
                    weekly: 'Weekly',
                    monthly: 'Monthly',
                    quarterly: 'Quarterly',
                    semiannual: 'Every six months',
                    annual: 'Annual',
                    biennial: 'Every two years',
                    one_time: 'One-time',
                    free: 'Free, no recurring invoices',
                  }).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              {[
                ['memory', 'Memory (MB)', edit.spec?.memoryMb || 2048, 128],
                ['disk', 'Disk (MB)', edit.spec?.diskMb || 20480, 256],
                ['cpu', 'CPU cores', edit.spec?.cpu || 1, 1],
              ].map(([key, label, value, min]) => (
                <Field key={String(key)} label={String(label)}>
                  <Input
                    name={String(key)}
                    type="number"
                    min={Number(min)}
                    defaultValue={Number(value)}
                    required
                  />
                </Field>
              ))}
            </div>
            {(selected?.provider || provider) === 'wings' && (
              <GamePlanFields defaults={edit.gameConfig || {}} />
            )}
            {provider === 'proxmox' &&
              (selected ? (
                <ProxmoxPlanFields connection={selected} defaults={edit.spec} />
              ) : (
                <>
                  <Field label="Virtualization type">
                    <Select name="vmType" defaultValue={edit.spec?.vmType || 'qemu'}>
                      <option value="qemu">QEMU / KVM</option>
                      <option value="lxc">LXC</option>
                    </Select>
                  </Field>
                  <Field label="Template ID or OS template volume">
                    <Input name="template" defaultValue={edit.spec?.templateId} required />
                  </Field>
                </>
              ))}
            {provider === 'plesk' && (
              <Field label="Plesk service plan name">
                <Input name="plan" defaultValue={edit.spec?.servicePlan} required />
              </Field>
            )}
          </Form>
        </Modal>
      )}
    </>
  );
}
