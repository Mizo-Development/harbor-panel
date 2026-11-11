'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ShoppingCart,
  ArrowRight,
  Trash2,
  Settings2,
  Server,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';
import { api, getErrorMessage } from '@/lib/api';
import { requestId } from '@/lib/request-id';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PurchaseOptions, defaultOptionValues, type OptionValues } from './purchase-options';
import {
  Header,
  Panel,
  Empty,
  Field,
  Input,
  Select,
  Modal,
  Form,
  Loading,
  ErrorBox,
  useData,
  money,
  type Row,
} from './shared';
export function CartLink() {
  const q = useData<Row>('/cart');
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href="/dashboard/cart">
        <ShoppingCart className="size-4" />
        <span className="hidden sm:inline">Cart</span>
        {q.data?.items?.length > 0 && (
          <Badge variant="secondary" className="px-1.5 text-[10px]">
            {q.data!.items.length}
          </Badge>
        )}
      </Link>
    </Button>
  );
}
export function CartPage() {
  const q = useData<Row>('/cart'),
    products = useData<Row[]>('/catalog/products'),
    router = useRouter(),
    { mutate } = useSWRConfig(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [editing, setEditing] = useState<Row | null>(null),
    [plan, setPlan] = useState(''),
    [options, setOptions] = useState<OptionValues>({});
  const request = useRef({ signature: '', key: '' });
  if (q.error) return <ErrorBox error={q.error} retry={q.mutate} />;
  if (!q.data) return <Loading />;
  const cart = q.data;
  const product = editing ? products.data?.find((p) => p.id === editing.productId) : null;
  return (
    <>
      <Header
        eyebrow="Your next project"
        title="Shopping cart"
        description="Configure your services and review one combined invoice."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/store">
              Continue shopping <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
      />
      {!cart.items.length ? (
        <Empty
          icon={ShoppingCart}
          title="Your cart is empty"
          description="Choose hosting plans from the storefront to get started."
          action={
            <Button asChild>
              <Link href="/store">
                Explore hosting <ArrowRight className="size-4" />
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {cart.items.map((item: Row) => (
              <Panel key={item.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/30">
                      <Server className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold">{item.name}</h2>
                      {item.domain && (
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                          {item.domain}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.quote?.billingContract?.label || 'Configuration required'}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-medium">
                    {item.quote ? money(item.cartAmount, item.quote.currency) : '—'}
                  </span>
                </div>
                {item.error ? (
                  <p className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
                    {item.error}
                  </p>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
                    <span>{item.quote.spec.memoryMb} MB memory</span>
                    <span>{item.quote.spec.cpu} CPU</span>
                    <span>{Math.round(item.quote.spec.diskMb / 1024)} GB storage</span>
                    {item.quote.setupFee > 0 && (
                      <span>
                        Includes {money(item.quote.setupFee, item.quote.currency)} setup before tax
                      </span>
                    )}
                  </div>
                )}
                {item.quote?.billingContract?.type === 'RECURRING' && (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Renewal: {money(item.quote.recurringAmount, item.quote.currency)} /{' '}
                    {item.quote.billingContract.label}
                  </p>
                )}
                <div className="mt-5 flex items-center justify-between border-t pt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || !products.data?.some((p) => p.id === item.productId)}
                    onClick={() => {
                      setEditing(item);
                      setPlan(item.planId || '');
                      setOptions(item.options || {});
                    }}
                  >
                    <Settings2 className="size-3.5" />
                    Configure
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Remove ${item.name}`}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        const next = await api.delete<Row>(`/cart/items/${item.id}`, {
                          cartId: cart.id,
                          expectedVersion: cart.version,
                        });
                        await q.mutate(next, false);
                      } catch (e) {
                        setError(e);
                        void q.mutate();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    Remove
                  </Button>
                </div>
              </Panel>
            ))}
          </div>
          <aside className="space-y-4 xl:sticky xl:top-20">
            <Panel title="Order summary">
              <div className="space-y-5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Hosting services</span>
                  <span>{cart.items.length}</span>
                </div>
                {cart.ready && cart.tax?.amount > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {cart.tax.name} ({cart.tax.basisPoints / 100}%)
                      {cart.tax.inclusive ? ' · included' : ''}
                    </span>
                    <span className="font-mono">{money(cart.tax.amount, cart.currency)}</span>
                  </div>
                )}
                <div className="flex items-end justify-between border-t pt-4">
                  <span className="text-sm">Total due</span>
                  <span className="text-2xl font-semibold tracking-tight">
                    {cart.ready ? money(cart.total, cart.currency) : '—'}
                  </span>
                </div>
                {cart.errors?.map((message: string) => (
                  <p key={message} className="text-xs leading-6 text-destructive">
                    {message}
                  </p>
                ))}
                {!!error && <ErrorBox error={error} />}
                <Button
                  className="w-full"
                  disabled={busy || !cart.ready}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    const signature = `${cart.id}:${cart.version}:${cart.quoteId}`;
                    if (request.current.signature !== signature)
                      request.current = { signature, key: requestId() };
                    try {
                      const result = await api.post<Row>('/cart/checkout', {
                        cartId: cart.id,
                        expectedVersion: cart.version,
                        expectedQuoteId: cart.quoteId,
                        idempotencyKey: request.current.key,
                      });
                      await mutate('/cart');
                      await mutate('/services');
                      await mutate('/invoices');
                      router.push(`/dashboard/invoices/${result.invoiceId}`);
                    } catch (e) {
                      setError(e);
                      void q.mutate();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                  Create combined invoice
                </Button>
                <p className="text-[11px] leading-6 text-muted-foreground">
                  Stock and allocations are reserved together at checkout. Services provision after
                  the complete invoice is paid. Each service retains its own renewal term.
                </p>
                <p className="flex items-start gap-2 border-t pt-4 text-[11px] leading-5 text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                  If an item cannot be reserved, the entire checkout is rolled back.
                </p>
              </div>
            </Panel>
          </aside>
        </div>
      )}
      {editing && product && (
        <Modal title={`Configure ${editing.name}`} close={() => setEditing(null)}>
          <Form
            submit="Save configuration"
            onSubmit={async (f) => {
              const updated = await api.patch<Row>(`/cart/items/${editing.id}`, {
                cartId: cart.id,
                expectedVersion: cart.version,
                item: {
                  productId: editing.productId,
                  planId: plan || null,
                  options,
                  domain: String(f.get('domain') || '') || undefined,
                  sshKey: String(f.get('sshKey') || '') || undefined,
                  couponCode: String(f.get('couponCode') || '') || undefined,
                },
              });
              await q.mutate(updated, false);
              setEditing(null);
              toast.success('Cart configuration updated');
            }}
          >
            {product.purchasePlans?.length > 1 && (
              <Field label="Billing plan">
                <Select
                  value={plan}
                  onChange={(e) => {
                    setPlan(e.target.value);
                    setOptions(defaultOptionValues(product, e.target.value, options));
                  }}
                >
                  {product.purchasePlans.map((p: Row) => (
                    <option key={p.id || 'standard'} value={p.id || ''}>
                      {p.name} · {money(p.amount, p.currency)} / {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <PurchaseOptions product={product} planId={plan} values={options} change={setOptions} />
            {product.requiresDomain && (
              <Field label="Your domain name">
                <Input name="domain" defaultValue={editing.domain || ''} required />
              </Field>
            )}
            {product.kind === 'vps' && (
              <Field label="SSH public key">
                <textarea
                  className="min-h-24 w-full rounded-md border bg-background p-3 font-mono text-xs"
                  name="sshKey"
                  defaultValue={editing.sshKey || ''}
                  required
                />
              </Field>
            )}
            <Field label="Coupon code">
              <Input name="couponCode" defaultValue={editing.couponCode || ''} maxLength={40} />
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}
