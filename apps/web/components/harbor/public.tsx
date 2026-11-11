'use client';
import {
  PurchaseOptions,
  defaultOptionValues,
  optionsReady,
  type OptionValues,
} from './purchase-options';
import { categoryPath } from './categories';
import { Announcement } from './experience';
import { CartLink } from './cart';
import { motion } from 'motion/react';
import { AuthShell } from '@/components/design/auth-shell';
import { SetupProgress } from '@/components/design/setup-progress';
import { Stagger, Reveal } from '@/components/design/motion';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  useEffect,
  useRef,
  useState,
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type FormEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import {
  Anchor,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Activity,
  Bell,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  Code2,
  Copy,
  CreditCard,
  Database,
  ExternalLink,
  File,
  Folder,
  Gamepad2,
  Globe2,
  HardDrive,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MoreHorizontal,
  Package,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Square,
  Terminal,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { VpsConsole } from '@/components/vps-console';
import {
  ExtensionLayout,
  ExtensionSlot,
  ExtensionPage,
  extensionPages,
} from '@/components/extension-runtime';
import { signIn } from '@/lib/client';
import { api, apiFetch, ApiError, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { requestId } from '@/lib/request-id';
import { BillingAddressFields, formGroup } from './billing';
import { ThemeToggle } from '@/components/theme-toggle';
import { StatusBadge } from '@/components/data/status-badge';
import { Button } from '@/components/ui/button';
import {
  useData,
  money,
  date,
  kindIcon,
  Loading,
  ErrorBox,
  Empty,
  Header,
  Panel,
  Field,
  inputClass,
  Input,
  Select,
  Modal,
  Form,
  DataTable,
  mutateAction,
  Brand,
  type Row,
} from './shared';
export function Store({ settings, user }: { settings: Row; user?: Row }) {
  const q = useData<Row[]>(settings.storefrontEnabled ? '/catalog/products' : null);
  const categories = useData<Row[]>(settings.storefrontEnabled ? '/catalog/categories' : null);
  const cart = useData<Row>(user ? '/cart' : null);
  const [catalogFilter, setCatalogFilter] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<Row | null>(null);
  const [coupon, setCoupon] = useState(''),
    [couponQuote, setCouponQuote] = useState<Row | null>(null),
    [couponBusy, setCouponBusy] = useState(false);
  const [baseQuote, setBaseQuote] = useState<Row | null>(null);
  const [planId, setPlanId] = useState('');
  const [optionValues, setOptionValues] = useState<OptionValues>({});
  const [quoteError, setQuoteError] = useState('');
  const readyOptions = optionsReady(selected, optionValues);
  const optionSignature = JSON.stringify(optionValues);
  const quoteRequest = useRef(0);
  const activeQuote = couponQuote || baseQuote;
  useEffect(() => {
    const request = ++quoteRequest.current;
    setBaseQuote(null);
    setCouponQuote(null);
    setQuoteError('');
    if (!selected || !readyOptions) {
      setCouponBusy(false);
      return;
    }
    setCouponBusy(true);
    const timer = setTimeout(() => {
      api
        .post<Row>('/orders/quote', {
          productId: selected.id,
          planId: planId || null,
          options: optionValues,
        })
        .then((quote) => {
          if (quoteRequest.current === request) setBaseQuote(quote);
        })
        .catch((e) => {
          if (quoteRequest.current === request) setQuoteError(getErrorMessage(e));
        })
        .finally(() => {
          if (quoteRequest.current === request) setCouponBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      quoteRequest.current++;
    };
  }, [selected?.id, planId, optionSignature, readyOptions]);
  const orderKey = useRef('');
  const router = useRouter();
  const categoryIds = new Set(catalogFilter ? [catalogFilter] : []);
  for (let level = 0; level < 5; level++)
    categories.data?.forEach((c) => {
      if (categoryIds.has(c.parentId)) categoryIds.add(c.id);
    });
  const products =
    q.data?.filter(
      (p) =>
        (filter === 'all' || p.kind === filter) &&
        (!catalogFilter || categoryIds.has(p.catalogCategoryId)),
    ) || [];
  return (
    <ExtensionLayout area="storefront" settings={settings} user={user}>
      <div className="relative min-h-dvh overflow-x-clip bg-background">
        <header className="relative z-10 mx-auto flex h-[76px] max-w-6xl items-center justify-between gap-4 px-5 md:px-8">
          <Link href="/store" aria-label="Storefront home">
            <Brand name={settings.companyName} />
          </Link>
          <nav className="flex items-center gap-2">
            {user && <CartLink />}
            <ThemeToggle />
            {user?.role === 'admin' && (
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <Link href="/admin">Admin panel</Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href={user ? '/dashboard' : '/login'}>
                {user ? 'Dashboard' : 'Sign in'}
                <ArrowUpRight className="ml-1 size-3.5" />
              </Link>
            </Button>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-5 pb-12 md:px-8">
          <Announcement settings={settings} area="storefront" />
          <section className="relative isolate flex flex-col items-center pb-20 pt-16 text-center md:pb-24 md:pt-24">
            <div
              aria-hidden
              className="harbor-store-grid pointer-events-none absolute -inset-x-16 inset-y-0 -z-10"
            />
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/80 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d39940]" />
                {settings.experience?.storefront?.badge || 'Games. Compute. Websites.'}
                <ChevronRight className="size-3" />
              </span>
            </Reveal>
            <Reveal>
              <h1 className="mt-7 text-balance text-5xl font-semibold leading-[1.08] tracking-[-.055em] sm:text-6xl md:text-7xl">
                {settings.experience?.storefront?.title || 'Built for what you’re building.'}
              </h1>
            </Reveal>
            <Reveal>
              <p className="mx-auto mt-6 max-w-md text-pretty text-sm leading-7 text-muted-foreground md:text-[15px]">
                {settings.experience?.storefront?.description ||
                  'Game servers, virtual machines, and web hosting. Your next project starts with the right foundation.'}
              </p>
            </Reveal>
            <Reveal>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button asChild size="lg" className="shadow-[0_0_20px_#ffffff08]">
                  <a href="#plans">
                    {settings.experience?.storefront?.ctaLabel || 'Explore hosting'}
                    <ArrowRight className="size-4" />
                  </a>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link
                    href={
                      user
                        ? '/dashboard'
                        : settings.access?.registrationEnabled === false
                          ? '/login'
                          : '/register'
                    }
                  >
                    {user
                      ? 'Open dashboard'
                      : settings.access?.registrationEnabled === false
                        ? 'Sign in'
                        : 'Create an account'}
                  </Link>
                </Button>
              </div>
            </Reveal>
            <Reveal>
              <div className="mt-12 flex items-center justify-center gap-7 text-[11px] text-muted-foreground sm:gap-10">
                {[
                  [Gamepad2, 'Game hosting'],
                  [Boxes, 'Virtual servers'],
                  [Globe2, 'Web hosting'],
                ].map(([I, label]) => {
                  const Icon = I as LucideIcon;
                  return (
                    <span key={label as string} className="flex items-center gap-2">
                      <Icon className="size-3.5" />
                      {label as string}
                    </span>
                  );
                })}
              </div>
            </Reveal>
          </section>
          {!settings.storefrontEnabled ? (
            <Empty
              icon={Globe2}
              title="The storefront is currently unavailable"
              description="Existing customers can still sign in to manage services and invoices."
              action={
                <Button asChild>
                  <Link href="/login">
                    Customer sign in
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              }
            />
          ) : (
            <section id="plans" className="scroll-mt-8 border-t border-border/60 pt-9">
              <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {settings.experience?.storefront?.plansTitle || 'Find your next home.'}
                  </h2>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    {settings.experience?.storefront?.plansDescription ||
                      'Choose a plan. Make something great.'}
                  </p>
                </div>
                <Tabs value={filter} onValueChange={setFilter}>
                  <TabsList className="h-9 border border-border/60 bg-muted/30">
                    {[
                      ['all', 'All plans'],
                      ['game', 'Games'],
                      ['vps', 'VPS'],
                      ['web', 'Web'],
                    ].map(([value, label]) => (
                      <TabsTrigger key={value} value={value} className="px-3 text-xs">
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
              {!!categories.data?.length && (
                <div className="mb-6 max-w-sm">
                  <Field label="Browse category">
                    <Select
                      value={catalogFilter}
                      onChange={(e) => setCatalogFilter(e.target.value)}
                    >
                      <option value="">All categories</option>
                      {categories.data.map((c) => (
                        <option key={c.id} value={c.id}>
                          {categoryPath(c, categories.data!)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}
              {q.error ? (
                <ErrorBox error={q.error} retry={q.mutate} />
              ) : !q.data ? (
                <Loading />
              ) : !products.length ? (
                <Empty
                  icon={Package}
                  title="New plans are on the way"
                  description="Check back soon, or sign in to manage an existing service."
                />
              ) : (
                <Stagger className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {products.map((p) => {
                    const Icon = kindIcon(p.kind);
                    return (
                      <Reveal key={p.id} className="h-full">
                        <motion.article
                          whileHover={{ y: -3 }}
                          transition={{ duration: 0.18 }}
                          className="group flex h-full flex-col rounded-xl border border-border/80 bg-card p-6 transition-colors hover:border-foreground/25"
                        >
                          <div className="flex items-start justify-between">
                            <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted/30">
                              <Icon className="size-5 text-foreground/80" />
                            </span>
                            <Badge
                              variant="outline"
                              className="rounded-md text-[10px] font-normal text-muted-foreground"
                            >
                              {p.isDemo
                                ? 'Demo · no charge'
                                : p.kind === 'game'
                                  ? 'Game hosting'
                                  : p.kind === 'vps'
                                    ? 'VPS'
                                    : 'Web hosting'}
                            </Badge>
                          </div>
                          <h3 className="mt-5 text-base font-semibold tracking-tight">{p.name}</h3>
                          <p className="mt-2 min-h-11 text-[13px] leading-6 text-muted-foreground">
                            {p.description}
                          </p>
                          <div className="mb-6 mt-7 flex items-baseline gap-1.5">
                            <span className="text-4xl font-semibold tracking-[-.045em] tabular-nums">
                              {p.billingType === 'FREE' ? 'Free' : money(p.price, p.currency)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {p.billingType === 'RECURRING'
                                ? `/${p.interval}`
                                : p.billingType === 'ONE_TIME'
                                  ? 'once'
                                  : ''}
                            </span>
                          </div>
                          {!!p.setupFee && (
                            <p className="-mt-3 mb-5 text-xs text-muted-foreground">
                              + {money(p.setupFee, p.currency)} setup fee
                            </p>
                          )}
                          <div className="space-y-3 border-t border-border/70 pt-5">
                            {p.specs?.map((spec: Row) => (
                              <div key={spec.label} className="flex items-center gap-2 text-xs">
                                <Check className="size-3.5 text-muted-foreground" />
                                <span className="text-muted-foreground">{spec.label}</span>
                                <span className="ml-auto font-mono text-[11px] text-foreground/85">
                                  {spec.value}
                                </span>
                              </div>
                            ))}
                          </div>
                          <Button
                            className="mt-7 w-full"
                            disabled={!p.available}
                            onClick={() => {
                              if (!user) router.push('/login?next=/store');
                              else {
                                orderKey.current = requestId();
                                setCoupon('');
                                setCouponQuote(null);
                                setPlanId('');
                                setOptionValues(defaultOptionValues(p));
                                setSelected(p);
                              }
                            }}
                          >
                            {p.available ? 'Get started' : p.unavailableReason || 'Coming soon'}
                            <ArrowRight className="ml-auto size-4 transition-transform group-hover:translate-x-0.5" />
                          </Button>
                        </motion.article>
                      </Reveal>
                    );
                  })}
                </Stagger>
              )}
            </section>
          )}
          <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-6">
            <Brand name={settings.companyName} />
            <p className="text-[11px] text-muted-foreground/70">
              {settings.experience?.footerText ||
                `© ${new Date().getFullYear()} ${settings.companyName}`}
            </p>
            <nav
              className="flex flex-wrap gap-4 text-[11px] text-muted-foreground"
              aria-label="Storefront links"
            >
              {[
                ['supportUrl', 'Support'],
                ['statusUrl', 'Status'],
                ['termsUrl', 'Terms'],
                ['privacyUrl', 'Privacy'],
              ].map(([key, label]) =>
                settings.experience?.links?.[key] ? (
                  <a
                    key={key}
                    href={settings.experience.links[key]}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground"
                  >
                    {label}
                  </a>
                ) : null,
              )}
            </nav>
          </footer>
        </main>
        {selected && (
          <Modal
            title={`Deploy ${selected.name}`}
            description={
              selected.isDemo
                ? 'Test checkout only. No money will be charged and no real game server is provisioned.'
                : 'Review your plan. Provisioning begins after invoice payment.'
            }
            close={() => setSelected(null)}
          >
            <Form
              submit="Create order"
              disabled={couponBusy || !activeQuote || !readyOptions || (!!coupon && !couponQuote)}
              close={() => setSelected(null)}
              secondaryAction={
                !selected.isDemo && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      couponBusy ||
                      !activeQuote ||
                      !readyOptions ||
                      (!!coupon && !couponQuote) ||
                      !cart.data
                    }
                    onClick={async (e) => {
                      const form = e.currentTarget.closest('form');
                      if (!form?.reportValidity()) return;
                      const f = new FormData(form);
                      try {
                        const result = await api.post<Row>('/cart/items', {
                          expectedVersion: cart.data?.version || 0,
                          item: {
                            productId: selected.id,
                            planId: planId || null,
                            options: optionValues,
                            couponCode: couponQuote?.couponCode || undefined,
                            domain: String(f.get('domain') || '') || undefined,
                            sshKey: String(f.get('sshKey') || '') || undefined,
                          },
                        });
                        await cart.mutate(result, false);
                        setSelected(null);
                        toast.success('Added to cart');
                        router.push('/dashboard/cart');
                      } catch (error) {
                        toast.error(getErrorMessage(error));
                        void cart.mutate();
                      }
                    }}
                  >
                    Add to cart <ShoppingBag className="size-4" />
                  </Button>
                )
              }
              onSubmit={async (f) => {
                if (couponBusy) throw new Error('Wait for the price quote to finish');
                if (!baseQuote || !readyOptions)
                  throw new Error('Complete the options and wait for a current quote');
                if (coupon && !couponQuote)
                  throw new Error('Apply the coupon before creating your order');
                const result = await api.post<Row>('/orders', {
                  productId: selected.id,
                  planId: planId || null,
                  options: optionValues,
                  expectedQuoteId: activeQuote!.quoteId,
                  domain: String(f.get('domain') || '') || undefined,
                  sshKey: String(f.get('sshKey') || '') || undefined,
                  idempotencyKey: orderKey.current,
                  couponCode: couponQuote?.couponCode || undefined,
                  expectedTotal: activeQuote!.total,
                  expectedCurrency: activeQuote!.currency,
                });
                router.push(`/dashboard/invoices/${result.invoiceId}`);
              }}
            >
              {selected.purchasePlans?.length > 1 && (
                <Field label="Billing plan">
                  <Select
                    value={planId}
                    onChange={(e) => {
                      setPlanId(e.target.value);
                      setOptionValues(defaultOptionValues(selected, e.target.value, optionValues));
                    }}
                  >
                    {selected.purchasePlans.map((plan: Row) => (
                      <option key={plan.id || 'standard'} value={plan.id || ''}>
                        {plan.name} · {money(plan.amount, plan.currency)}
                        {plan.type === 'RECURRING'
                          ? ` / ${plan.label}`
                          : plan.type === 'FREE'
                            ? ' · free'
                            : ' · once'}
                        {plan.setupFee ? ` + ${money(plan.setupFee, plan.currency)} setup` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <PurchaseOptions
                product={selected}
                planId={planId}
                values={optionValues}
                change={setOptionValues}
              />
              {!readyOptions && (
                <p className="text-xs text-muted-foreground">
                  Complete required options to calculate your total.
                </p>
              )}
              {quoteError && (
                <p role="alert" className="text-xs text-destructive">
                  {quoteError}
                </p>
              )}
              <div className="flex justify-between rounded-lg border bg-muted/30 p-4 text-sm">
                <span>Due today</span>
                <strong className="font-mono text-xs">
                  {activeQuote
                    ? money(activeQuote.total, activeQuote.currency)
                    : couponBusy
                      ? 'Calculating…'
                      : 'Choose options'}
                </strong>
              </div>
              {activeQuote && activeQuote.lineItems?.length > 1 && (
                <div className="space-y-2 rounded-md border p-3">
                  {activeQuote.lineItems.map((line: Row, index: number) => (
                    <div key={index} className="flex justify-between gap-3 text-xs">
                      <span>
                        {line.name}
                        {line.quantity !== 1 ? ` × ${line.quantity}` : ''}
                      </span>
                      <span className="font-mono">{money(line.amount, activeQuote.currency)}</span>
                    </div>
                  ))}
                </div>
              )}
              {activeQuote?.billingContract && (
                <p className="text-xs text-muted-foreground">
                  {activeQuote.billingContract.type === 'RECURRING'
                    ? `Renews at ${money(activeQuote.recurringAmount, activeQuote.currency)} / ${activeQuote.billingContract.label}. Setup fees are charged once.`
                    : 'No automatic renewal invoices.'}
                </p>
              )}
              {activeQuote?.spec &&
                selected.configuration?.options?.some((o: Row) => o.binding) && (
                  <p className="text-xs text-muted-foreground">
                    Configured resources: {activeQuote.spec.memoryMb} MB memory ·{' '}
                    {activeQuote.spec.diskMb / 1024} GB storage · {activeQuote.spec.cpu} CPU cores.
                  </p>
                )}
              {couponBusy && (
                <p className="text-xs text-muted-foreground" role="status">
                  Calculating your total…
                </p>
              )}
              {activeQuote && activeQuote.tax?.amount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {activeQuote.tax.name} ({activeQuote.tax.basisPoints / 100}%):{' '}
                  {money(activeQuote.tax.amount, activeQuote.currency)}{' '}
                  {activeQuote.tax.inclusive ? 'included in total' : 'added to discounted price'}.
                </p>
              )}
              {!selected.isDemo && (
                <>
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Field label="Coupon code">
                        <Input
                          value={coupon}
                          disabled={couponBusy}
                          onChange={(e) => {
                            setCoupon(e.target.value);
                            setCouponQuote(null);
                          }}
                          placeholder="Optional discount code"
                        />
                      </Field>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!coupon || couponBusy || !baseQuote || !readyOptions}
                      onClick={async () => {
                        const request = ++quoteRequest.current;
                        setCouponBusy(true);
                        try {
                          const quote = await api.post<Row>('/orders/quote', {
                            productId: selected.id,
                            planId: planId || null,
                            options: optionValues,
                            couponCode: coupon,
                          });
                          if (quoteRequest.current === request) setCouponQuote(quote);
                        } catch (e) {
                          if (quoteRequest.current === request) toast.error(getErrorMessage(e));
                        } finally {
                          if (quoteRequest.current === request) setCouponBusy(false);
                        }
                      }}
                    >
                      Apply coupon
                    </Button>
                  </div>
                  {couponQuote && (
                    <p className="text-xs leading-6 text-muted-foreground">
                      Coupon {couponQuote.couponCode}:{' '}
                      {money(couponQuote.discount, couponQuote.currency)} off. Renewal:{' '}
                      {money(couponQuote.recurringAmount, couponQuote.currency)} /{' '}
                      {couponQuote.billingContract?.label || selected.interval}.
                    </p>
                  )}
                </>
              )}
              {selected.requiresDomain && (
                <Field
                  label="Your domain name"
                  hint="Configure your domain’s DNS to point to the hosting server."
                >
                  <Input name="domain" placeholder="example.com" required />
                </Field>
              )}
              {selected.kind === 'vps' && (
                <Field
                  label="SSH public key"
                  hint="Use a public key for access. Never paste a private key."
                >
                  <textarea
                    name="sshKey"
                    className={cn(inputClass, 'h-28 py-3 font-mono text-xs')}
                    placeholder="ssh-ed25519 AAAA…"
                    required
                  />
                </Field>
              )}
              {selected.kind === 'game' && !selected.isDemo && (
                <p className="text-xs leading-6 text-muted-foreground">
                  By ordering Minecraft hosting, you agree to the Minecraft EULA and applicable game
                  terms.
                </p>
              )}
            </Form>
          </Modal>
        )}
      </div>
    </ExtensionLayout>
  );
}

export function Account({ user }: { user: Row }) {
  const [totp, setTotp] = useState<Row | null>(null);
  const profile = useData<Row>('/profile');
  const settings = useData<Row>('/settings');
  const [resending, setResending] = useState(false);
  const { mutate } = useSWRConfig();
  return (
    <>
      <Header
        eyebrow="Account"
        title="Your account, protected."
        description="Manage access to your hosting workspace."
      />
      <div className="grid max-w-4xl gap-6 md:grid-cols-2">
        <Panel title="Profile">
          {profile.error ? (
            <ErrorBox error={profile.error} />
          ) : !profile.data ? (
            <Loading />
          ) : (
            <Form
              submit="Save billing profile"
              onSubmit={async (f) => {
                await api.patch('/profile', {
                  name: f.get('name'),
                  billingAddress: formGroup(f, 'billingAddress'),
                });
                await profile.mutate();
                await mutate('/auth/me');
                await mutate('/products');
                await mutate('/wallet');
                toast.success('Billing profile saved');
              }}
            >
              <Field label="Full name">
                <Input name="name" defaultValue={profile.data.name} required autoComplete="name" />
              </Field>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <p className="text-xs leading-6 text-muted-foreground">
                Add your billing address before ordering hosting. New invoices keep a copy of these
                details.
              </p>
              <BillingAddressFields value={profile.data.billingAddress} />
            </Form>
          )}
        </Panel>
        <Panel title="Two-factor authentication">
          {user.totpEnabled ? (
            <p className="flex items-center gap-2 text-sm text-primary">
              <ShieldCheck className="size-4" />
              Authenticator protection is enabled.
            </p>
          ) : totp ? (
            <Form
              submit="Enable two-factor authentication"
              onSubmit={async (f) => {
                await api.post('/auth/totp/confirm', { code: f.get('code') });
                window.location.reload();
              }}
            >
              <p className="text-xs leading-6 text-muted-foreground">
                Add this secret to your authenticator, then enter its six-digit code. Store your
                secret securely.
              </p>
              <code className="break-all rounded bg-muted p-3 text-xs">{totp.secret}</code>
              <Field label="Authenticator code">
                <Input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required />
              </Field>
            </Form>
          ) : (
            <Form
              submit="Set up authenticator"
              onSubmit={async (f) => {
                setTotp(await api.post<Row>('/auth/totp/setup', { password: f.get('password') }));
              }}
            >
              <p className="text-xs leading-6 text-muted-foreground">
                Add a second layer of protection to your account.
              </p>
              <Field label="Confirm your password">
                <Input name="password" type="password" autoComplete="current-password" required />
              </Field>
            </Form>
          )}
        </Panel>
        <Panel title="Email verification">
          <div className="space-y-4">
            <p className="text-sm">{user.email}</p>
            {profile.data?.emailVerifiedAt ? (
              <p className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-4" />
                Email address verified.
              </p>
            ) : (
              <>
                <p className="text-xs leading-6 text-muted-foreground">
                  Verify this address to confirm account ownership. Verification links expire after
                  24 hours.
                </p>
                <Button
                  variant="outline"
                  disabled={resending}
                  onClick={async () => {
                    setResending(true);
                    try {
                      const result = await api.post<Row>('/auth/verification/resend');
                      if (result.verified) await profile.mutate();
                      result.accepted || result.verified
                        ? toast.success(result.message || 'Email already verified')
                        : toast.error(result.message);
                    } catch (error) {
                      toast.error(getErrorMessage(error));
                    } finally {
                      setResending(false);
                    }
                  }}
                >
                  Send verification email
                </Button>
              </>
            )}
          </div>
        </Panel>
        <Panel title="Renewals & notifications">
          {profile.data && (
            <Form
              submit="Save account preferences"
              onSubmit={async (f) => {
                await api.patch('/profile', {
                  autoPayWallet: f.get('autoPayWallet') === 'on',
                  notificationPreferences: {
                    ticketReplies: f.get('ticketReplies') === 'on',
                    loginAlerts: f.get('loginAlerts') === 'on',
                  },
                });
                await profile.mutate();
                toast.success('Account preferences saved');
              }}
            >
              <label className="flex items-start gap-3 text-xs leading-6">
                <input
                  name="autoPayWallet"
                  type="checkbox"
                  className="mt-1.5"
                  defaultChecked={profile.data.autoPayWallet}
                />
                <span>
                  Use my matching-currency wallet to pay renewal invoices automatically when they
                  are issued.
                  {settings.data?.automation?.automaticRenewalCredit
                    ? ''
                    : ' Your hosting company must enable automatic wallet collection for this preference to take effect.'}
                </span>
              </label>
              <label className="flex items-center gap-3 text-xs">
                <input
                  name="ticketReplies"
                  type="checkbox"
                  defaultChecked={profile.data.notificationPreferences?.ticketReplies !== false}
                />
                Email me about support replies
              </label>
              <label className="flex items-center gap-3 text-xs">
                <input
                  name="loginAlerts"
                  type="checkbox"
                  defaultChecked={profile.data.notificationPreferences?.loginAlerts !== false}
                />
                Email me sign-in alerts when available
              </label>
            </Form>
          )}
        </Panel>
      </div>
    </>
  );
}

export function AuthScreen({ mode, settings }: { mode: string; settings: Row }) {
  const router = useRouter(),
    search = useSearchParams();
  const register = mode === 'register',
    forgot = mode === 'forgot-password',
    reset = mode === 'reset-password';
  const [complete, setComplete] = useState(false);
  if (register && (!settings.storefrontEnabled || settings.access?.registrationEnabled === false))
    return (
      <AuthShell
        companyName={settings.companyName}
        title="Registration unavailable"
        description="New accounts are currently disabled. Existing customers can still sign in."
        themeToggle={<ThemeToggle />}
      >
        <Button asChild>
          <Link href="/login">
            Sign in <ArrowRight className="size-4" />
          </Link>
        </Button>
      </AuthShell>
    );
  return (
    <AuthShell
      companyName={settings.companyName}
      title={
        register
          ? 'Create an account'
          : forgot
            ? 'Reset your password'
            : reset
              ? 'Choose a new password'
              : 'Welcome back.'
      }
      description={
        register
          ? 'Start building with your own hosting workspace.'
          : forgot
            ? 'We’ll send you a link to reset your password.'
            : reset
              ? 'Choose a strong password for your account.'
              : 'Sign in to your hosting workspace.'
      }
      themeToggle={<ThemeToggle />}
    >
      <div className="harbor-auth-form">
        {' '}
        {complete ? (
          <div className="rounded-xl border bg-primary/5 p-5 text-sm leading-6">
            {reset
              ? 'Password updated. You can now sign in.'
              : 'If your account exists, reset instructions have been sent.'}
            <Link href="/login" className="mt-4 block font-medium text-primary">
              Back to sign in
              <ArrowRight className="ml-1 inline size-4" />
            </Link>
          </div>
        ) : (
          <Form
            submit={
              register
                ? 'Create account'
                : forgot
                  ? 'Send reset link'
                  : reset
                    ? 'Update password'
                    : 'Sign in'
            }
            onSubmit={async (f) => {
              if (forgot) {
                await api.post('/auth/forgot-password', { email: f.get('email') });
                setComplete(true);
                return;
              }
              if (reset) {
                await api.post('/auth/reset-password', {
                  token: search.get('token'),
                  password: f.get('password'),
                });
                setComplete(true);
                return;
              }
              const user = register
                ? await api.post<Row>('/auth/register', {
                    email: f.get('email'),
                    password: f.get('password'),
                    name: f.get('name'),
                  })
                : await signIn({
                    email: String(f.get('email')),
                    password: String(f.get('password')),
                    totp: String(f.get('totp') || '') || undefined,
                  });
              const next = search.get('next');
              window.location.assign(
                next?.startsWith('/') && !next.startsWith('//')
                  ? next
                  : user.role === 'admin'
                    ? '/admin'
                    : '/dashboard',
              );
            }}
          >
            {register && (
              <Field label="Your name">
                <Input name="name" autoComplete="name" required />
              </Field>
            )}
            {!reset && (
              <Field label="Email address">
                <Input
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                />
              </Field>
            )}
            {!forgot && (
              <Field
                label="Password"
                hint={register || reset ? 'At least 12 characters.' : undefined}
              >
                <Input
                  name="password"
                  type="password"
                  minLength={register || reset ? 12 : 1}
                  maxLength={200}
                  autoComplete={register || reset ? 'new-password' : 'current-password'}
                  required
                />
              </Field>
            )}
            {!register && !forgot && !reset && (
              <>
                <div className="-mt-2 text-right">
                  <Link href="/forgot-password" className="text-xs text-primary">
                    Forgot password?
                  </Link>
                </div>
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Using an authenticator?
                  </summary>
                  <Input
                    name="totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="Six-digit code"
                    aria-label="Authenticator code"
                    className="mt-3"
                  />
                </details>
              </>
            )}
          </Form>
        )}
        {!forgot &&
          !reset &&
          settings.storefrontEnabled &&
          settings.access?.registrationEnabled !== false && (
            <p className="mt-7 text-center text-xs text-muted-foreground">
              {register ? 'Already have an account?' : 'New here?'}{' '}
              <Link className="font-medium text-primary" href={register ? '/login' : '/register'}>
                {register ? 'Sign in' : 'Create an account'}
              </Link>
            </p>
          )}
      </div>
    </AuthShell>
  );
}

export function Setup() {
  const [step, setStep] = useState(0),
    [mode, setMode] = useState('remote');
  const router = useRouter();
  return (
    <AuthShell
      companyName="Harbor"
      title={
        step === 0
          ? 'Create your workspace'
          : step === 1
            ? 'Secure your workspace'
            : 'Connect game hosting'
      }
      description={
        step === 0
          ? 'Set up your company and make Harbor your own.'
          : step === 1
            ? 'Create your administrator account to get started.'
            : 'Choose where your Wings node will run.'
      }
      themeToggle={<ThemeToggle />}
    >
      <div className="harbor-setup-form">
        <SetupProgress step={step} steps={['Company', 'Account', 'Hosting']} />
        <motion.div
          layout
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="mt-8"
        >
          {' '}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (step < 2) {
                if (e.currentTarget.reportValidity()) setStep(step + 1);
                return;
              }
              const f = new FormData(e.currentTarget);
              try {
                await api.post('/setup', {
                  companyName: f.get('companyName'),
                  currency: f.get('currency'),
                  email: f.get('email'),
                  password: f.get('password'),
                  setupToken: f.get('setupToken'),
                  nodeMode: mode,
                });
                window.location.assign('/admin');
              } catch (error) {
                toast.error(getErrorMessage(error));
              }
            }}
          >
            <motion.div
              initial={false}
              animate={{ opacity: step === 0 ? 1 : 0, y: step === 0 ? 0 : 6 }}
              hidden={step !== 0}
              className="space-y-5"
            >
              <Field label="Company name">
                <Input
                  name="companyName"
                  placeholder="Your hosting company"
                  required={step === 0}
                />
              </Field>
              <Field label="Billing currency">
                <Select name="currency" defaultValue="USD">
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
            </motion.div>
            <motion.div
              initial={false}
              animate={{ opacity: step === 1 ? 1 : 0, y: step === 1 ? 0 : 6 }}
              hidden={step !== 1}
              className="space-y-5"
            >
              <Field label="Administrator email">
                <Input name="email" type="email" autoComplete="email" required={step === 1} />
              </Field>
              <Field label="Password" hint="Use at least 12 characters.">
                <Input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required={step === 1}
                />
              </Field>
              <Field
                label="Installation setup token"
                hint="Read SETUP_TOKEN from the installation’s .env file. It prevents someone else claiming your panel."
              >
                <Input
                  name="setupToken"
                  type="password"
                  autoComplete="off"
                  minLength={1}
                  required={step === 1}
                />
              </Field>
            </motion.div>
            <motion.div
              initial={false}
              animate={{ opacity: step === 2 ? 1 : 0, y: step === 2 ? 0 : 6 }}
              hidden={step !== 2}
              className="space-y-4"
            >
              {[
                [
                  'local',
                  'Alongside this panel',
                  'Run Wings and Harbor on the same machine. A simple starting point for a small installation.',
                  Server,
                ],
                [
                  'remote',
                  'On a separate machine',
                  'Keep the panel and game workloads separate. Connect one or more dedicated game nodes.',
                  Boxes,
                ],
              ].map(([value, title, desc, I]) => {
                const Icon = I as LucideIcon;
                return (
                  <button
                    key={value as string}
                    type="button"
                    onClick={() => setMode(value as string)}
                    className={cn(
                      'flex w-full items-start gap-4 rounded-xl border p-5 text-left transition',
                      mode === value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/10'
                        : 'hover:border-primary/40',
                    )}
                  >
                    <Icon className="mt-1 size-5 shrink-0 text-primary" />
                    <div className="flex-1">
                      <h3 className="text-sm font-medium">{title as string}</h3>
                      <p className="mt-2 text-xs leading-6 text-muted-foreground">
                        {desc as string}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border',
                        mode === value ? 'border-primary bg-primary' : '',
                      )}
                    >
                      {mode === value && <Check className="size-3 text-primary-foreground" />}
                    </span>
                  </button>
                );
              })}
              <p className="text-xs leading-6 text-muted-foreground">
                This saves your preferred layout. After setup, connect your Wings node under
                Infrastructure. The installer will automate machine preparation once release
                validation is complete.
              </p>
            </motion.div>
            <div className="mt-7 flex justify-between border-t pt-5">
              <Button
                variant="ghost"
                type="button"
                disabled={step === 0}
                onClick={() => setStep(step - 1)}
              >
                Back
              </Button>
              <Button type="submit">
                {step === 2 ? 'Create workspace' : 'Continue'}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </form>
        </motion.div>
      </div>
    </AuthShell>
  );
}
