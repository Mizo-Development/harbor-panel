'use client';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Building2,
  Palette,
  Globe2,
  CreditCard,
  Wallet,
  ShieldCheck,
  Mail,
  LifeBuoy,
  Activity,
  Search,
  ChevronRight,
  ArrowUpRight,
  Check,
  Save,
  RotateCcw,
  Upload,
  Loader2,
  AlertCircle,
  ExternalLink,
  Server,
} from 'lucide-react';
import { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SaveBar } from '@/components/design/settings-save-bar';
import { SystemWorkspace } from './system';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { currencyScale, parseCurrencyAmount } from '@/lib/currency';
import {
  Header,
  Panel,
  Field,
  Input,
  Select,
  Modal,
  ErrorBox,
  Loading,
  useData,
  inputClass,
  date,
  type Row,
} from './shared';

const sections = [
  {
    id: 'general',
    label: 'General',
    description: 'Company identity and invoice details',
    icon: Building2,
    keywords: 'company address contact tax registration legal phone website',
    paths: ['companyName', 'companyBilling'],
  },
  {
    id: 'branding',
    label: 'Branding',
    description: 'Make the workspace yours',
    icon: Palette,
    keywords:
      'logo upload color accent theme dark light radius density language locale motion title',
    paths: [
      'logoUrl',
      'accentColor',
      'experience.siteTitle',
      'experience.defaultLocale',
      'experience.appearance',
    ],
  },
  {
    id: 'storefront',
    label: 'Storefront',
    description: 'Shape the customer experience',
    icon: Globe2,
    keywords:
      'public hosting shop hero headline footer links terms privacy announcement banner status support',
    paths: [
      'storefrontEnabled',
      'experience.storefront',
      'experience.links',
      'experience.footerText',
      'experience.announcement',
    ],
  },
  {
    id: 'billing',
    label: 'Billing & automation',
    description: 'Invoices, renewals and overdue services',
    icon: CreditCard,
    keywords:
      'currency invoice number prefix due grace days suspension expire payment autopay renewals credit',
    paths: ['currency', 'invoicePrefix', 'graceDays', 'automation'],
  },
  {
    id: 'wallet',
    label: 'Wallet',
    description: 'Deposits and balance limits',
    icon: Wallet,
    keywords: 'deposit minimum maximum funding wallet balance money',
    paths: ['walletSettings'],
  },
  {
    id: 'security',
    label: 'Security & access',
    description: 'Registration and account policies',
    icon: ShieldCheck,
    keywords:
      'login register maintenance session email verification domain two factor access orders pause',
    paths: ['access'],
  },
  {
    id: 'email',
    label: 'Email & notifications',
    description: 'Delivery, templates and preferences',
    icon: Mail,
    keywords: 'SMTP password mail sender invoice email template logs alerts notification',
    paths: ['invoiceEmailsEnabled', 'notifications'],
  },
  {
    id: 'support',
    label: 'Support',
    description: 'Tickets and customer communication',
    icon: LifeBuoy,
    keywords: 'tickets attachments welcome hours support email limit close department',
    paths: ['supportPolicy'],
  },
  {
    id: 'system',
    label: 'System',
    description: 'Installation and connected services',
    icon: Activity,
    keywords: 'health worker database infrastructure integration extensions version status',
    paths: [],
  },
] as const;
type Section = (typeof sections)[number]['id'];
const get = (o: Row, path: string): any => path.split('.').reduce((v, k) => v?.[k], o);
const clone = (v: Row) => JSON.parse(JSON.stringify(v));
function put(o: Row, path: string, value: unknown) {
  const result = clone(o),
    keys = path.split('.');
  let target = result;
  for (const key of keys.slice(0, -1)) target = target[key] ?? (target[key] = {});
  target[keys.at(-1)!] = value;
  return result;
}
function patchFor(section: Section, draft: Row, base: Row) {
  let result = clone(base);
  const paths = sections.find((s) => s.id === section)!.paths;
  for (const path of paths) result = put(result, path, get(draft, path));
  return Object.fromEntries(
    [...new Set(paths.map((p) => p.split('.')[0]))].map((k) => [k, result[k]]),
  );
}
const SettingsContext = createContext<{
  draft: Row;
  set: (path: string, value: unknown) => void;
} | null>(null);
function useDraft() {
  return useContext(SettingsContext)!;
}
function TextSetting({
  path,
  label,
  hint,
  type = 'text',
  area = false,
  required = false,
  maxLength = 2000,
}: {
  path: string;
  label: string;
  hint?: string;
  type?: string;
  area?: boolean;
  required?: boolean;
  maxLength?: number;
}) {
  const { draft, set } = useDraft(),
    value = get(draft, path) ?? '';
  return (
    <Field label={label} hint={hint}>
      {area ? (
        <textarea
          className={cn(inputClass, 'min-h-24 resize-y py-3 leading-6')}
          value={value}
          onChange={(e) => set(path, e.target.value)}
          required={required}
          maxLength={maxLength}
        />
      ) : (
        <Input
          value={value}
          type={type}
          onChange={(e) => set(path, e.target.value)}
          required={required}
          maxLength={maxLength}
        />
      )}
    </Field>
  );
}
function NumberSetting({
  path,
  label,
  hint,
  min = 0,
  max = 90,
}: {
  path: string;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
}) {
  const { draft, set } = useDraft();
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={min}
        max={max}
        required
        value={get(draft, path) ?? ''}
        onChange={(e) => set(path, e.target.value === '' ? '' : Number(e.target.value))}
      />
    </Field>
  );
}
function SelectSetting({
  path,
  label,
  hint,
  options,
}: {
  path: string;
  label: string;
  hint?: string;
  options: readonly (readonly [string, string])[];
}) {
  const { draft, set } = useDraft();
  return (
    <Field label={label} hint={hint}>
      <Select value={get(draft, path)} onChange={(e) => set(path, e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </Field>
  );
}
function ToggleSetting({
  path,
  label,
  description,
}: {
  path: string;
  label: string;
  description: string;
}) {
  const { draft, set } = useDraft(),
    id = useId();
  return (
    <div className="flex items-start justify-between gap-6 rounded-xl border bg-background/30 p-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">{description}</span>
      </label>
      <Switch
        id={id}
        aria-label={label}
        checked={!!get(draft, path)}
        onCheckedChange={(v) => set(path, v)}
        className="mt-1 shrink-0"
      />
    </div>
  );
}
function Grid({ children }: { children: ReactNode }) {
  return (
    <div className="@container/settings-fields">
      <div className="grid min-w-0 gap-5 @min-[30rem]/settings-fields:grid-cols-2">{children}</div>
    </div>
  );
}
function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Panel title={title} description={description}>
      <div className="space-y-5">{children}</div>
    </Panel>
  );
}

function GeneralSettings() {
  return (
    <div className="space-y-5">
      <Group title="Company identity" description="These details appear on newly issued invoices.">
        <TextSetting path="companyName" label="Company name" required maxLength={100} />
        <Grid>
          {[
            ['legalName', 'Legal company name'],
            ['registrationNumber', 'Registration number'],
            ['email', 'Billing email'],
            ['website', 'Company website'],
            ['taxId', 'Tax ID (optional)'],
            ['phone', 'Phone (optional)'],
          ].map(([key, label]) => (
            <TextSetting
              key={key}
              path={`companyBilling.${key}`}
              label={label}
              type={key === 'email' ? 'email' : key === 'website' ? 'url' : 'text'}
              maxLength={200}
            />
          ))}
        </Grid>
      </Group>
      <Group
        title="Billing address"
        description="Existing invoices keep the details saved when they were issued."
      >
        <Grid>
          {[
            ['line1', 'Address line 1'],
            ['line2', 'Address line 2 (optional)'],
            ['city', 'City'],
            ['state', 'State / region (optional)'],
            ['postalCode', 'Postal code'],
            ['country', 'Country code'],
          ].map(([key, label]) => (
            <TextSetting
              key={key}
              path={`companyBilling.${key}`}
              label={label}
              maxLength={key === 'country' ? 2 : 200}
            />
          ))}
        </Grid>
        <TextSetting
          path="companyBilling.paymentInstructions"
          label="Wallet and offline payment instructions"
          area
        />
        <TextSetting
          path="companyBilling.invoiceFooter"
          label="Invoice footer"
          area
          maxLength={1000}
        />
      </Group>
    </div>
  );
}

function BrandPreview() {
  const { draft } = useDraft(),
    s = draft.experience?.storefront || {};
  return (
    <div className="overflow-hidden rounded-xl border bg-[#09090b] text-zinc-100 shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
        <span className="size-1.5 rounded-full bg-zinc-600" />
        <span className="size-1.5 rounded-full bg-zinc-600" />
        <span className="size-1.5 rounded-full bg-zinc-600" />
        <span className="ml-2 font-mono text-[10px] text-zinc-500">Your storefront</span>
      </div>
      <div className="p-5">
        <div className="flex items-center gap-2 text-xs font-semibold">
          {draft.logoUrl ? (
            <img
              src={draft.logoUrl}
              alt="Logo preview"
              className="size-7 rounded-md object-contain"
            />
          ) : (
            <span
              className="flex size-7 items-center justify-center rounded-md"
              style={{ background: draft.accentColor }}
            >
              <Server className="size-4 text-black" />
            </span>
          )}
          {draft.companyName}
        </div>
        <div className="py-9 text-center">
          <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] text-zinc-400">
            {s.badge}
          </span>
          <h3 className="mt-5 text-balance text-2xl font-semibold leading-tight tracking-tight">
            {s.title}
          </h3>
          <p className="mt-3 text-xs leading-6 text-zinc-500">{s.description}</p>
          <span
            className="mt-5 inline-flex items-center gap-2 rounded-md px-3 py-2 text-[10px] font-semibold text-black"
            style={{ background: draft.accentColor }}
          >
            {s.ctaLabel}
            <ChevronRight className="size-3" />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {['Game hosting', 'Virtual servers'].map((t) => (
            <div key={t} className="rounded-lg border border-white/10 p-3">
              <Server className="mb-3 size-4 text-zinc-400" />
              <span className="text-[10px]">{t}</span>
              <div className="mt-2 h-1 w-12 rounded bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function BrandingSettings() {
  const { draft, set } = useDraft(),
    [uploading, setUploading] = useState(false);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-5">
        <Group title="Brand identity" description="Your company logo and color across the portal.">
          <div className="flex items-center gap-4 rounded-xl border border-dashed p-4">
            {draft.logoUrl ? (
              <img
                src={draft.logoUrl}
                alt="Current company logo"
                className="size-14 rounded-xl object-contain"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-xl bg-muted">
                <Building2 className="size-6 text-muted-foreground" />
              </div>
            )}
            <div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium">
                {uploading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                Upload logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  aria-label="Upload company logo"
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    try {
                      const body = new FormData();
                      body.append('file', file);
                      const r = await fetch('/api/v1/admin/settings/logo', {
                        method: 'POST',
                        credentials: 'same-origin',
                        body,
                      });
                      const result = await r.json();
                      if (!r.ok) throw new Error(result.error?.message || 'Upload failed');
                      set('logoUrl', result.data.url);
                      toast.success('Logo uploaded. Save branding to apply it.');
                    } catch (error) {
                      toast.error(getErrorMessage(error));
                    } finally {
                      setUploading(false);
                      e.target.value = '';
                    }
                  }}
                />
              </label>
              <p className="mt-2 text-[11px] text-muted-foreground">
                PNG, JPEG or WebP · up to 1 MiB
              </p>
            </div>
          </div>
          <TextSetting
            path="logoUrl"
            label="Logo URL"
            hint="Upload an image or enter a direct HTTP/HTTPS image URL. Leave blank for the built-in mark."
            maxLength={1000}
          />
          <Grid>
            <TextSetting path="accentColor" label="Brand accent" type="color" maxLength={7} />
            <TextSetting
              path="experience.siteTitle"
              label="Browser title"
              hint="Defaults to your company name."
              maxLength={100}
            />
          </Grid>
        </Group>
        <Group title="Workspace appearance">
          <Grid>
            <SelectSetting
              path="experience.appearance.defaultTheme"
              label="Default color mode"
              hint="For visitors who have not chosen their own color mode."
              options={[
                ['dark', 'Dark'],
                ['light', 'Light'],
                ['system', 'Follow device'],
              ]}
            />
            <SelectSetting
              path="experience.appearance.radius"
              label="Corner style"
              options={[
                ['none', 'Square'],
                ['sm', 'Subtle'],
                ['md', 'Rounded'],
                ['lg', 'Soft'],
              ]}
            />
            <SelectSetting
              path="experience.appearance.density"
              label="Interface density"
              options={[
                ['comfortable', 'Comfortable'],
                ['compact', 'Compact'],
              ]}
            />
            <SelectSetting
              path="experience.appearance.motion"
              label="Animation preference"
              options={[
                ['system', 'Respect device preference'],
                ['reduced', 'Reduce motion for everyone'],
              ]}
            />
          </Grid>
          <SelectSetting
            path="experience.defaultLocale"
            label="Number and date format"
            hint="Sets currency and date formatting. Interface copy currently remains in English."
            options={[
              ['en-US', 'English (United States)'],
              ['en-GB', 'English (United Kingdom)'],
              ['de-DE', 'German'],
              ['fr-FR', 'French'],
              ['es-ES', 'Spanish'],
              ['pt-BR', 'Portuguese (Brazil)'],
              ['hi-IN', 'Hindi (India)'],
              ['ja-JP', 'Japanese'],
            ]}
          />
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/themes">
              Manage installed themes <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </Group>
      </div>
      <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
        <div className="flex items-center justify-between px-1">
          <p className="text-xs font-medium">Live preview</p>
          <Badge variant="outline" className="text-[10px]">
            Unsaved preview
          </Badge>
        </div>
        <BrandPreview />
        <p className="px-1 text-[11px] leading-5 text-muted-foreground">
          Preview updates as you edit. Save changes to publish your branding.
        </p>
      </aside>
    </div>
  );
}
function StorefrontSettings() {
  return (
    <div className="space-y-5">
      <Group title="Public storefront">
        <ToggleSetting
          path="storefrontEnabled"
          label="Enable public storefront"
          description="Let visitors browse plans and place orders. Existing customers can still use the dashboard when this is off."
        />
        <TextSetting path="experience.storefront.badge" label="Hero badge" maxLength={100} />
        <TextSetting path="experience.storefront.title" label="Hero headline" maxLength={150} />
        <TextSetting
          path="experience.storefront.description"
          label="Hero description"
          area
          maxLength={500}
        />
        <Grid>
          <TextSetting
            path="experience.storefront.ctaLabel"
            label="Explore button label"
            required
            maxLength={40}
          />
          <TextSetting
            path="experience.storefront.plansTitle"
            label="Plans heading"
            maxLength={100}
          />
        </Grid>
        <TextSetting
          path="experience.storefront.plansDescription"
          label="Plans introduction"
          maxLength={300}
        />
      </Group>
      <Group title="Links & footer">
        <Grid>
          {[
            ['supportUrl', 'Support URL'],
            ['statusUrl', 'Status page URL'],
            ['termsUrl', 'Terms of service URL'],
            ['privacyUrl', 'Privacy policy URL'],
          ].map(([key, label]) => (
            <TextSetting
              key={key}
              path={`experience.links.${key}`}
              label={label}
              type="url"
              maxLength={1000}
            />
          ))}
        </Grid>
        <TextSetting path="experience.footerText" label="Footer text" maxLength={300} />
      </Group>
      <Group title="Announcement">
        <ToggleSetting
          path="experience.announcement.enabled"
          label="Show announcement"
          description="Publish a dismissible notice to your storefront, customer dashboard, or both."
        />
        <TextSetting
          path="experience.announcement.text"
          label="Announcement message"
          area
          maxLength={500}
        />
        <Grid>
          <SelectSetting
            path="experience.announcement.tone"
            label="Announcement style"
            options={[
              ['info', 'Information'],
              ['success', 'Good news'],
              ['warning', 'Attention'],
            ]}
          />
          <SelectSetting
            path="experience.announcement.scope"
            label="Announcement audience"
            options={[
              ['all', 'Storefront and customers'],
              ['storefront', 'Storefront only'],
              ['customer', 'Customer dashboard only'],
            ]}
          />
        </Grid>
      </Group>
    </div>
  );
}
function BillingSettings() {
  return (
    <div className="space-y-5">
      <Group
        title="Invoice defaults"
        description="Changes apply to new invoices. Existing prices and invoice references stay intact."
      >
        <Grid>
          <SelectSetting
            path="currency"
            label="Currency"
            hint="Fixed after the first invoice or wallet is created."
            options={[
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
            ].map((v) => [v, v] as const)}
          />
          <TextSetting path="invoicePrefix" label="Invoice number prefix" required maxLength={16} />
          <NumberSetting
            path="automation.invoiceDueDays"
            label="New order invoice due (days)"
            min={1}
            max={90}
          />
          <NumberSetting
            path="automation.renewalLeadDays"
            label="Create renewal invoices before due (days)"
            max={60}
          />
        </Grid>
      </Group>
      <Group title="Service automation">
        <Grid>
          <NumberSetting path="graceDays" label="Overdue grace period (days)" max={90} />
          <NumberSetting
            path="automation.unpaidOrderExpiryHours"
            label="Unpaid order reservation limit (hours)"
            min={1}
            max={2160}
            hint="Unused allocations expire at this limit or the invoice due date, whichever comes first."
          />
        </Grid>
        <ToggleSetting
          path="automation.autoSuspendEnabled"
          label="Suspend overdue services automatically"
          description="Suspend after the grace period. This does not delete customer data."
        />
        <ToggleSetting
          path="automation.automaticRenewalCredit"
          label="Allow automatic wallet renewal payments"
          description="Only customers who opt in are charged. The full renewal balance is collected when its invoice becomes available, using the matching currency wallet."
        />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/taxes">
              Tax rules <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/pricing">
              Regional pricing <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </Group>
    </div>
  );
}
function MoneySetting({ path, label }: { path: string; label: string }) {
  const { draft, set } = useDraft(),
    currency = draft.currency || 'USD',
    value = get(draft, path),
    last = useRef(value),
    [display, setDisplay] = useState(
      typeof value === 'number'
        ? (value / currencyScale(currency)).toFixed(currency === 'JPY' ? 0 : 2)
        : '',
    );
  useEffect(() => {
    if (value !== last.current) {
      setDisplay(
        typeof value === 'number'
          ? (value / currencyScale(currency)).toFixed(currency === 'JPY' ? 0 : 2)
          : '',
      );
      last.current = value;
    }
  }, [value, currency]);
  return (
    <Field label={`${label} (${currency})`}>
      <Input
        type="text"
        inputMode="decimal"
        required
        value={display}
        onChange={(e) => {
          setDisplay(e.target.value);
          let minor: number | null = null;
          try {
            minor = parseCurrencyAmount(e.target.value, currency);
          } catch {}
          last.current = minor;
          set(path, minor);
        }}
      />
    </Field>
  );
}
function WalletSettings() {
  return (
    <Group title="Wallet funding" description="Limits apply independently to each wallet currency.">
      <ToggleSetting
        path="walletSettings.depositsEnabled"
        label="Allow wallet deposits"
        description="Customers can create funding invoices and request verified offline deposits."
      />
      <Grid>
        <MoneySetting path="walletSettings.minDeposit" label="Minimum deposit" />
        <MoneySetting path="walletSettings.maxDeposit" label="Maximum deposit" />
        <MoneySetting path="walletSettings.maxBalance" label="Maximum wallet balance" />
      </Grid>
      <p className="text-xs leading-6 text-muted-foreground">
        The minimum deposit must not exceed the maximum deposit, and deposits must fit within the
        balance limit. Paid receipts that exceed a balance limit remain available for
        reconciliation.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/admin/wallets">
          Manage customer wallets <ArrowUpRight className="size-3.5" />
        </Link>
      </Button>
    </Group>
  );
}
function SecuritySettings() {
  const { draft, set } = useDraft();
  return (
    <div className="space-y-5">
      <Group title="Registration & access">
        <ToggleSetting
          path="access.registrationEnabled"
          label="Allow public registration"
          description="New accounts also require the public storefront to be enabled. Existing accounts keep access."
        />
        <RegistrationDomains />
        <NumberSetting
          path="access.sessionHours"
          label="Session lifetime (hours)"
          hint="Applies to new sign-ins. Existing sessions keep their original expiry."
          min={1}
          max={720}
        />
        <ToggleSetting
          path="access.requireVerifiedEmail"
          label="Require verified email for new orders"
          description="Customers can still sign in, verify their email, and pay existing invoices. Configure SMTP before enabling this."
        />
        <ToggleSetting
          path="access.requireStaffTwoFactor"
          label="Require staff two-factor authentication"
          description="Enable an authenticator on your own account first. Staff without one must set it up before using admin tools."
        />
      </Group>
      <Group title="Availability">
        <ToggleSetting
          path="access.ordersEnabled"
          label="Accept new hosting orders"
          description="Pause new purchases while keeping existing services and invoice payments available."
        />
        <ToggleSetting
          path="access.maintenanceEnabled"
          label="Enable maintenance mode"
          description="Pause customer access and new registration. Administrators can still sign in to manage the panel."
        />
        <TextSetting
          path="access.maintenanceMessage"
          label="Maintenance message"
          area
          maxLength={1000}
        />
      </Group>
    </div>
  );
}
function RegistrationDomains() {
  const { draft, set } = useDraft(),
    signature = JSON.stringify(draft.access.registrationDomains || []),
    last = useRef(signature),
    [text, setText] = useState((draft.access.registrationDomains || []).join(', '));
  useEffect(() => {
    if (signature !== last.current) {
      last.current = signature;
      setText((draft.access.registrationDomains || []).join(', '));
    }
  }, [signature]);
  return (
    <Field
      label="Allowed registration domains"
      hint="Optional. Enter comma-separated domains, such as example.com. Empty allows all email domains."
    >
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const domains = e.target.value
            .split(',')
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean);
          last.current = JSON.stringify(domains);
          set('access.registrationDomains', domains);
        }}
      />
    </Field>
  );
}
function SupportSettings() {
  return (
    <div className="space-y-5">
      <Group title="Support experience">
        <ToggleSetting
          path="supportPolicy.ticketsEnabled"
          label="Allow new customer tickets"
          description="Existing conversations remain readable and staff can still open tickets."
        />
        <ToggleSetting
          path="supportPolicy.allowAttachments"
          label="Allow ticket attachments"
          description="Accept supported files up to 5 MiB. Existing authorized downloads remain available."
        />
        <ToggleSetting
          path="supportPolicy.customerCloseEnabled"
          label="Let customers close and reopen tickets"
          description="Turn off to let staff manage ticket status."
        />
        <NumberSetting
          path="supportPolicy.maxOpenTickets"
          label="Maximum open tickets per customer"
          min={1}
          max={100}
        />
        <TextSetting
          path="supportPolicy.welcomeMessage"
          label="Support welcome message"
          area
          maxLength={1000}
        />
        <Grid>
          <TextSetting
            path="supportPolicy.supportEmail"
            label="Public support email"
            type="email"
            maxLength={254}
          />
          <TextSetting path="supportPolicy.hoursNote" label="Support hours" maxLength={200} />
        </Grid>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/tickets">
            Manage departments & tickets <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
      </Group>
    </div>
  );
}

function EmailSettings({ base, onSaved }: { base: Row; onSaved: () => Promise<void> }) {
  const [mail, setMail] = useState<Row>({ ...base.mail, password: '' }),
    [smtpDirty, setSmtpDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState('delivery'),
    [selected, setSelected] = useState<Row | null>(null),
    [error, setError] = useState<unknown>(null),
    [logSearch, setLogSearch] = useState(''),
    [logPage, setLogPage] = useState(1);
  const templates = useData<Row[]>(tab === 'templates' ? '/admin/settings/templates' : null),
    logs = useData<Row>(
      tab === 'logs'
        ? `/admin/settings/mail/logs?page=${logPage}&search=${encodeURIComponent(logSearch)}`
        : null,
    );
  const edit = (key: string, value: unknown) => {
    setSmtpDirty(true);
    setMail((s) => ({ ...s, [key]: value }));
  };
  useEffect(() => {
    if (!smtpDirty) setMail({ ...base.mail, password: '' });
  }, [base.mail, smtpDirty]);
  return (
    <div className="space-y-5">
      <div
        className="flex flex-wrap gap-1 rounded-lg border bg-muted/20 p-1"
        role="tablist"
        aria-label="Email settings areas"
      >
        {[
          ['delivery', 'Delivery'],
          ['templates', 'Templates'],
          ['logs', 'Delivery logs'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'rounded-md px-4 py-2 text-xs transition-colors',
              tab === id
                ? 'bg-background font-medium shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'delivery' && (
        <>
          <Group title="Notification preferences">
            <ToggleSetting
              path="invoiceEmailsEnabled"
              label="Automatically email invoice PDFs"
              description="Queue a PDF when a new invoice is issued or fully paid. Existing invoices are not backfilled; already queued emails stay queued."
            />
            <ToggleSetting
              path="notifications.renewalEmails"
              label="Send renewal notices"
              description="Send a renewal notice when its invoice is created. A configured automatic PDF email takes its place to avoid duplicate notices."
            />
            <ToggleSetting
              path="notifications.ticketReplyEmails"
              label="Send support update emails"
              description="Notify customers and staff about public ticket updates. Customer preferences are respected."
            />
            <ToggleSetting
              path="notifications.loginEmails"
              label="Send account sign-in alerts"
              description="Notify account owners after a successful login, unless they opt out."
            />
          </Group>
          <Group
            title="SMTP connection"
            description="Credentials are encrypted at rest and are never returned by the API."
          >
            <div className="flex items-center justify-between rounded-lg border p-3 text-xs">
              <span>Mail connection</span>
              <Badge variant="outline">
                {base.mail?.configured ? 'Configured' : 'Not configured'}
              </Badge>
            </div>
            <Field label="SMTP configuration source">
              <Select value={mail.source} onChange={(e) => edit('source', e.target.value)}>
                <option value="environment">Installation environment</option>
                <option value="custom">Custom SMTP connection</option>
              </Select>
            </Field>
            {mail.source === 'custom' ? (
              <div className="space-y-5">
                <Grid>
                  <Field label="SMTP host">
                    <Input
                      value={mail.host || ''}
                      onChange={(e) => edit('host', e.target.value)}
                      placeholder="smtp.example.com"
                    />
                  </Field>
                  <Field label="SMTP port">
                    <Input
                      type="number"
                      min={1}
                      max={65535}
                      value={mail.port || 587}
                      onChange={(e) => edit('port', Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Connection security">
                    <Select
                      value={mail.security || 'STARTTLS'}
                      onChange={(e) => edit('security', e.target.value)}
                    >
                      <option value="STARTTLS">STARTTLS</option>
                      <option value="TLS">TLS / SSL</option>
                      <option value="PLAIN">Plain connection</option>
                    </Select>
                  </Field>
                  <Field label="SMTP username">
                    <Input
                      autoComplete="off"
                      value={mail.username || ''}
                      onChange={(e) => edit('username', e.target.value)}
                    />
                  </Field>
                </Grid>
                <Field
                  label="SMTP password"
                  hint={
                    mail.passwordSet
                      ? 'A password is stored. Leave blank to keep it for the same host and username.'
                      : 'Required when using an SMTP username.'
                  }
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={mail.password || ''}
                    onChange={(e) => edit('password', e.target.value)}
                  />
                </Field>
                <Grid>
                  <Field label="Sender name">
                    <Input
                      value={mail.fromName || ''}
                      onChange={(e) => edit('fromName', e.target.value)}
                    />
                  </Field>
                  <Field label="Sender email">
                    <Input
                      type="email"
                      value={mail.fromAddress || ''}
                      onChange={(e) => edit('fromAddress', e.target.value)}
                    />
                  </Field>
                </Grid>
              </div>
            ) : (
              <p className="text-xs leading-6 text-muted-foreground">
                Uses SMTP_URL and SMTP_FROM from the installation. Choose a custom connection to
                manage delivery here.
              </p>
            )}
            {!!error && <ErrorBox error={error} />}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.patch('/admin/settings/mail', {
                      source: mail.source,
                      expectedVersion: base.settingsVersion,
                      expectedMailRevision: mail.revision,
                      ...(mail.source === 'custom'
                        ? {
                            host: mail.host,
                            port: mail.port || 587,
                            security: mail.security || 'STARTTLS',
                            username: mail.username || '',
                            password: mail.password || undefined,
                            fromName: mail.fromName || '',
                            fromAddress: mail.fromAddress,
                          }
                        : {}),
                    });
                    await onSaved();
                    setSmtpDirty(false);
                    toast.success('SMTP settings saved');
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save SMTP connection
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || !base.mail?.configured}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const r = await api.post<Row>('/admin/settings/mail/test');
                    toast.success(`Test email accepted for ${r.recipient}`);
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Send test email <ArrowUpRight className="size-3.5" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Test uses the saved connection and sends to your administrator account.
            </p>
          </Group>
        </>
      )}
      {tab === 'templates' && (
        <Group
          title="Notification templates"
          description="Plain-text messages with validated placeholders."
        >
          {templates.error ? (
            <ErrorBox error={templates.error} />
          ) : !templates.data ? (
            <Loading />
          ) : (
            <div className="divide-y">
              {templates.data.map((t) => (
                <div
                  key={t.key}
                  className="flex items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium">{t.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.isCustomized ? 'Customized' : 'Default template'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setSelected({ ...t })}
                  >
                    Edit template
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Group>
      )}
      {tab === 'logs' && (
        <Group
          title="Mail delivery log"
          description="Submission records without message bodies or credentials."
        >
          <Input
            placeholder="Search recipients or subjects…"
            aria-label="Search mail logs"
            value={logSearch}
            onChange={(e) => {
              setLogSearch(e.target.value);
              setLogPage(1);
            }}
          />
          {logs.error ? (
            <ErrorBox error={logs.error} />
          ) : !logs.data ? (
            <Loading />
          ) : (
            <>
              <div className="divide-y">
                {logs.data.items.map((log: Row) => (
                  <div
                    key={log.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{log.subject}</p>
                      <p className="mt-1 break-all text-[11px] text-muted-foreground">
                        {log.recipient} · {date(log.createdAt)}
                        {log.errorCode ? ` · ${log.errorCode}` : ''}
                      </p>
                    </div>
                    <Badge variant="outline">{log.status.toLowerCase().replace('_', ' ')}</Badge>
                  </div>
                ))}
                {!logs.data.items.length && (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No matching mail submissions.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{logs.data.total} records</span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={logPage <= 1}
                    onClick={() => setLogPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={logPage * 25 >= logs.data.total}
                    onClick={() => setLogPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </Group>
      )}
      {selected && (
        <Modal title={`Edit ${selected.label.toLowerCase()}`} close={() => setSelected(null)}>
          <div className="space-y-5">
            <p className="text-xs leading-6 text-muted-foreground">
              Available variables: {selected.variables.map((v: string) => `{{${v}}}`).join(', ')}
            </p>
            <Field label="Email subject">
              <Input
                value={selected.subject}
                maxLength={200}
                onChange={(e) => setSelected((s) => ({ ...s, subject: e.target.value }))}
              />
            </Field>
            <Field label="Email message">
              <textarea
                className={cn(inputClass, 'min-h-52 py-3 font-mono text-xs')}
                value={selected.body}
                maxLength={10000}
                onChange={(e) => setSelected((s) => ({ ...s, body: e.target.value }))}
              />
            </Field>
            <Button
              type="button"
              onClick={async () => {
                try {
                  await api.patch(`/admin/settings/templates/${selected.key}`, {
                    subject: selected.subject,
                    body: selected.body,
                    expectedUpdatedAt: selected.updatedAt || null,
                  });
                  await templates.mutate();
                  setSelected(null);
                  toast.success('Template saved');
                } catch (e) {
                  toast.error(getErrorMessage(e));
                }
              }}
            >
              Save template
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function SystemSettings({ base }: { base: Row }) {
  const health = useData<Row>('/health', 30000);
  return (
    <div className="space-y-5">
      <Group title="Installation">
        <dl className="divide-y text-xs">
          {[
            ['Platform', 'Harbor 0.1.0'],
            ['Deployment', 'Self-hosted'],
            ['API', health.data?.status === 'ok' ? 'Connected' : 'Checking…'],
            ['Game node mode', base.nodeMode === 'local' ? 'Alongside panel' : 'Separate machine'],
            ['Settings revision', String(base.settingsVersion)],
            ['Plugin SDK', '1.0.0'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Group>
      <Group title="Manage your platform">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['Infrastructure', '/admin/nodes'],
            ['Proxmox placement', '/admin/proxmox'],
            ['Operations & retries', '/admin/operations'],
            ['Extensions & gateways', '/admin/extensions'],
            ['Installed themes', '/admin/themes'],
            ['Support departments', '/admin/tickets'],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="flex items-center justify-between rounded-lg border p-4 text-xs transition hover:bg-muted/30"
            >
              {label}
              <ArrowUpRight className="size-3.5 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </Group>
    </div>
  );
}

export function SettingsPage() {
  const q = useData<Row>('/admin/settings', 30000),
    { mutate } = useSWRConfig(),
    router = useRouter(),
    searchParams = useSearchParams();
  const selectedParam = searchParams.get('section');
  const active: Section = sections.some((s) => s.id === selectedParam)
    ? (selectedParam as Section)
    : 'general';
  const [base, setBase] = useState<Row | null>(null),
    [draft, setDraft] = useState<Row | null>(null),
    [query, setQuery] = useState(''),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<unknown>(null),
    [reloadPrompt, setReloadPrompt] = useState(false);
  const reduce = useReducedMotion();
  const saveShortcut = useRef<() => void>(() => {});
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!document.querySelector('[role="dialog"]')) saveShortcut.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const dirty =
    base && draft
      ? sections
          .filter((s) =>
            s.paths.some((p) => JSON.stringify(get(base, p)) !== JSON.stringify(get(draft, p))),
          )
          .map((s) => s.id)
      : [];
  useEffect(() => {
    if (q.data && (!base || !dirty.length)) {
      setBase(q.data);
      setDraft(q.data);
    }
  }, [q.data]);
  useEffect(() => {
    if (!dirty.length) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty.length]);
  if (q.error && !base) return <ErrorBox error={q.error} retry={q.mutate} />;
  if (!base || !draft) return <Loading />;
  const section = sections.find((s) => s.id === active)!;
  const conflict = q.data && q.data.settingsVersion !== base.settingsVersion;
  const choose = (id: string) => {
    setQuery('');
    setError(null);
    router.replace(`/admin/settings?section=${id}`, { scroll: false });
  };
  const reload = async () => {
    const fresh = await api.get<Row>('/admin/settings');
    setBase(fresh);
    setDraft(fresh);
    await q.mutate(fresh, false);
    await mutate('/settings');
    setReloadPrompt(false);
    setError(null);
  };
  const syncMail = async () => {
    const fresh = await api.get<Row>('/admin/settings');
    setBase(fresh);
    setDraft((prev) => ({ ...prev!, settingsVersion: fresh.settingsVersion, mail: fresh.mail }));
    await q.mutate(fresh, false);
    await mutate('/settings');
  };
  const save = async () => {
    if (saving) return;
    const invalid = [
      ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        '#settings-section input,#settings-section textarea,#settings-section select',
      ),
    ].find((input) => !input.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const patch = patchFor(active, draft, base);
      const visible = await api.patch<Row>('/settings', {
        expectedVersion: base.settingsVersion,
        ...patch,
      });
      const fresh = await api.get<Row>('/admin/settings');
      let next = clone(draft);
      for (const path of section.paths) next = put(next, path, get(fresh, path));
      next.settingsVersion = fresh.settingsVersion;
      next.mail = fresh.mail;
      setBase(fresh);
      setDraft(next);
      await q.mutate(fresh, false);
      await mutate('/settings', visible, false);
      toast.success('Settings saved', { id: 'harbor-settings-saved' });
    } catch (e) {
      setError(e);
      void q.mutate();
    } finally {
      setSaving(false);
    }
  };
  const matches = query.trim()
    ? sections.filter((s) =>
        `${s.label} ${s.description} ${s.keywords}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : [];
  saveShortcut.current = () => {
    if (dirty.includes(active) && !conflict && !saving) void save();
  };
  return (
    <SettingsContext.Provider
      value={{ draft, set: (path, value) => setDraft((s) => put(s!, path, value)) }}
    >
      <Header
        eyebrow="Your platform"
        title="Settings"
        description="Make this workspace feel like your company."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/store" target="_blank">
              View storefront <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        }
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card/50 p-3">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search settings"
            placeholder="Find a setting…"
            className="border-0 bg-transparent pl-9 shadow-none"
          />
        </div>
        <span className="flex items-center gap-2 px-2 text-[11px] text-muted-foreground">
          {dirty.length ? (
            <>
              <span className="size-1.5 rounded-full bg-amber-400" />
              {dirty.length} unsaved section{dirty.length === 1 ? '' : 's'}
            </>
          ) : (
            <>
              <Check className="size-3.5" />
              All changes saved
            </>
          )}
        </span>
      </div>
      {query.trim() && (
        <div className="mb-6 grid gap-2 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
          {matches.length ? (
            matches.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => choose(s.id)}
                className="flex items-center gap-3 rounded-lg p-3 text-left text-xs hover:bg-muted/40"
              >
                <s.icon className="size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block font-medium">{s.label}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {s.description}
                  </span>
                </span>
                <ChevronRight className="ml-auto size-3.5" />
              </button>
            ))
          ) : (
            <p className="p-3 text-xs text-muted-foreground">
              No settings match “{query}”. Try billing, logo, SMTP or registration.
            </p>
          )}
        </div>
      )}
      <div className="grid min-w-0 items-start gap-6 2xl:grid-cols-[192px_minmax(0,1fr)]">
        <nav
          aria-label="Settings sections"
          onKeyDown={(event) => {
            const vertical = window.matchMedia('(min-width:1536px)').matches,
              next = vertical ? 'ArrowDown' : 'ArrowRight',
              previous = vertical ? 'ArrowUp' : 'ArrowLeft';
            if (![next, previous, 'Home', 'End'].includes(event.key)) return;
            const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
              ),
              index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault();
            const target =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (index + (event.key === next ? 1 : -1) + buttons.length) % buttons.length;
            buttons[target]?.focus();
          }}
          className="flex gap-1 overflow-x-auto rounded-xl border bg-card/40 p-2 2xl:sticky 2xl:top-20 2xl:flex-col 2xl:overflow-visible"
        >
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={active === s.id ? 'page' : undefined}
              aria-label={s.label}
              aria-description={dirty.includes(s.id) ? 'Unsaved changes' : undefined}
              onClick={() => choose(s.id)}
              className={cn(
                'relative flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-3 text-left text-xs transition-colors',
                active === s.id
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
              )}
            >
              {active === s.id && (
                <motion.span
                  layoutId="harbor-settings-active"
                  transition={{ type: 'spring', stiffness: 520, damping: 42 }}
                  className="absolute inset-0 rounded-lg border bg-muted"
                />
              )}
              <s.icon className="relative size-4 shrink-0" />
              <span className="relative whitespace-nowrap">{s.label}</span>
              {dirty.includes(s.id) && (
                <span
                  className="ml-auto size-1.5 rounded-full bg-amber-400"
                  aria-label="Unsaved changes"
                />
              )}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl border bg-card">
              <section.icon className="size-4" />
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{section.label}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
            </div>
          </div>
          {conflict && (
            <div
              role="alert"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-xs"
            >
              <span>Settings changed in another session. Your draft is preserved.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReloadPrompt(true)}
              >
                Reload latest
              </Button>
            </div>
          )}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={active}
              id="settings-section"
              initial={reduce ? false : { opacity: 0.6, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 1 } : { opacity: 0.6 }}
              transition={{ duration: 0.15 }}
            >
              {active === 'general' ? (
                <GeneralSettings />
              ) : active === 'branding' ? (
                <BrandingSettings />
              ) : active === 'storefront' ? (
                <StorefrontSettings />
              ) : active === 'billing' ? (
                <BillingSettings />
              ) : active === 'wallet' ? (
                <WalletSettings />
              ) : active === 'security' ? (
                <SecuritySettings />
              ) : active === 'email' ? (
                <EmailSettings base={base} onSaved={syncMail} />
              ) : active === 'support' ? (
                <SupportSettings />
              ) : (
                <SystemWorkspace embedded />
              )}
            </motion.div>
          </AnimatePresence>
          {!!error && (
            <div className="mt-5">
              <ErrorBox error={error} />
            </div>
          )}
          {active !== 'system' && (
            <SaveBar
              sectionLabel={section.label}
              count={
                section.paths.filter(
                  (p) => JSON.stringify(get(base, p)) !== JSON.stringify(get(draft, p)),
                ).length
              }
              errorCount={conflict ? 1 : 0}
              otherSections={dirty.filter((s) => s !== active).length}
              saving={saving}
              onSave={() => void save()}
              onDiscard={() => {
                let next = clone(draft);
                for (const path of section.paths) next = put(next, path, get(base, path));
                setDraft(next);
                setError(null);
              }}
            />
          )}
        </div>
      </div>
      {reloadPrompt && (
        <Modal title="Reload latest settings?" close={() => setReloadPrompt(false)}>
          <p className="text-sm leading-6 text-muted-foreground">
            This replaces your unsaved drafts with the latest saved settings.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReloadPrompt(false)}>
              Keep editing
            </Button>
            <Button onClick={() => void reload()}>Discard drafts and reload</Button>
          </div>
        </Modal>
      )}
    </SettingsContext.Provider>
  );
}
