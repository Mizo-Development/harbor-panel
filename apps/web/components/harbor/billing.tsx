'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { requestId } from '@/lib/request-id';
import { useState } from 'react';
import { toast } from 'sonner';
import { Wallet, Plus, Printer, Download, Check, X } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { currencyScale, parseCurrencyAmount } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Header,
  Panel,
  Field,
  Input,
  Select,
  Form,
  Modal,
  DataTable,
  ErrorBox,
  Loading,
  useData,
  money,
  date,
  type Row,
} from './shared';
export const addressFields = [
  ['company', 'Company (optional)'],
  ['taxId', 'Tax ID (optional)'],
  ['phone', 'Phone (optional)'],
  ['line1', 'Address line 1'],
  ['line2', 'Address line 2 (optional)'],
  ['city', 'City'],
  ['state', 'State / region (optional)'],
  ['postalCode', 'Postal code'],
  ['country', 'Country code'],
];
export function BillingAddressFields({
  value = {},
  prefix = 'billingAddress',
  required = true,
}: {
  value?: Row;
  prefix?: string;
  required?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {addressFields.map(([key, label]) => (
        <Field key={key} label={label}>
          <Input
            name={`${prefix}.${key}`}
            defaultValue={value[key]}
            required={required && ['line1', 'city', 'postalCode', 'country'].includes(key)}
            maxLength={key === 'country' ? 2 : undefined}
            placeholder={key === 'country' ? 'US' : undefined}
            autoComplete={
              {
                line1: 'address-line1',
                line2: 'address-line2',
                city: 'address-level2',
                state: 'address-level1',
                postalCode: 'postal-code',
                country: 'country',
                phone: 'tel',
                company: 'organization',
              }[key]
            }
          />
        </Field>
      ))}
    </div>
  );
}
export function CompanyBillingFields({ value = {} }: { value?: Row }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          ['legalName', 'Legal company name'],
          ['registrationNumber', 'Registration number'],
          ['email', 'Billing email'],
          ['website', 'Company website'],
          ...addressFields.filter(([k]) => k !== 'company'),
        ].map(([key, label]) => (
          <Field key={key} label={label}>
            <Input
              name={`companyBilling.${key}`}
              defaultValue={value[key]}
              type={key === 'email' ? 'email' : key === 'website' ? 'url' : 'text'}
              maxLength={key === 'country' ? 2 : undefined}
            />
          </Field>
        ))}
      </div>
      <Field label="Wallet and offline payment instructions">
        <textarea
          name="companyBilling.paymentInstructions"
          className="min-h-24 w-full rounded-md border bg-background p-3 text-sm"
          defaultValue={value.paymentInstructions}
          placeholder="Transfer instructions and details customers should include with their payment."
        />
      </Field>
      <Field label="Invoice footer">
        <textarea
          name="companyBilling.invoiceFooter"
          className="min-h-20 w-full rounded-md border bg-background p-3 text-sm"
          defaultValue={value.invoiceFooter}
        />
      </Field>
    </>
  );
}
export function WalletSettingsFields({ value = {}, currency }: { value?: Row; currency: string }) {
  return (
    <fieldset className="space-y-4 rounded-lg border p-4">
      <legend className="px-2 text-sm font-medium">Wallet deposits</legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          name="walletEnabled"
          type="checkbox"
          defaultChecked={value.depositsEnabled ?? true}
        />
        Allow customers to request deposits
      </label>
      <p className="text-xs leading-6 text-muted-foreground">
        Disabling deposits preserves existing balances and invoice payments.
      </p>
      {[
        ['minDeposit', 'Minimum deposit', 100],
        ['maxDeposit', 'Maximum deposit', 100000],
        ['maxBalance', 'Maximum wallet balance', 1000000],
      ].map(([key, label, fallback]) => (
        <Field key={String(key)} label={`${label} (${currency})`}>
          <Input
            name={`wallet.${key}`}
            type="number"
            min={1 / currencyScale(currency)}
            step={1 / currencyScale(currency)}
            defaultValue={(value[key] ?? fallback) / currencyScale(currency)}
            required
          />
        </Field>
      ))}
    </fieldset>
  );
}
export function walletSettingsFromForm(f: FormData, currency: string) {
  return {
    depositsEnabled: f.get('walletEnabled') === 'on',
    ...Object.fromEntries(
      ['minDeposit', 'maxDeposit', 'maxBalance'].map((key) => [
        key,
        parseCurrencyAmount(String(f.get(`wallet.${key}`)), currency),
      ]),
    ),
  };
}
export function formGroup(f: FormData, prefix: string) {
  return Object.fromEntries(
    Array.from(f.entries())
      .filter(([k]) => k.startsWith(`${prefix}.`))
      .map(([k, v]) => [k.slice(prefix.length + 1), v]),
  );
}
function InvoiceParty({ party, label }: { party: Row; label: string }) {
  return (
    <div>
      <h3 className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">{label}</h3>
      <p className="font-medium">
        {party.legalName ||
          party.companyName ||
          party.company ||
          party.name ||
          'Details not recorded'}
      </p>
      {party.company && party.name && <p className="mt-1 text-sm">{party.name}</p>}
      <address className="mt-2 space-y-1 text-sm not-italic text-muted-foreground">
        {[
          party.line1,
          party.line2,
          [party.city, party.state, party.postalCode].filter(Boolean).join(', '),
          party.country,
          party.email,
          party.phone,
        ]
          .filter(Boolean)
          .map((line: string, i: number) => (
            <p key={i}>{line}</p>
          ))}
      </address>
      {party.taxId && <p className="mt-2 text-xs text-muted-foreground">Tax ID: {party.taxId}</p>}
      {party.registrationNumber && (
        <p className="mt-1 text-xs text-muted-foreground">
          Registration: {party.registrationNumber}
        </p>
      )}
    </div>
  );
}
export function InvoiceBilling({ invoice }: { invoice: Row }) {
  const snapshot = invoice.billingSnapshot || {};
  const pricing = snapshot.pricing;
  return (
    <div className="my-7 space-y-6">
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/v1/invoices/${encodeURIComponent(invoice.id)}/pdf`} download>
            <Download className="size-4" /> Download PDF
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="size-4" />
          Print / Save PDF
        </Button>
      </div>
      <div className="grid gap-6 border-y py-6 sm:grid-cols-2">
        <InvoiceParty label="From" party={snapshot.seller || {}} />
        <InvoiceParty label="Bill to" party={snapshot.buyer || {}} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-3 font-normal">Description</th>
              <th className="pb-3 text-right font-normal">Qty</th>
              <th className="pb-3 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(pricing?.lines?.length
              ? pricing.lines
              : [
                  {
                    name: invoice.description,
                    amount: pricing?.subtotal ?? invoice.total,
                    quantity: 1,
                  },
                ]
            ).map((line: Row, index: number) => (
              <tr key={index} className="border-t">
                <td className="py-4">{line.name}</td>
                <td className="py-4 text-right">{line.quantity}</td>
                <td className="py-4 text-right font-mono">
                  {money(line.amount, invoice.currency)}
                </td>
              </tr>
            ))}
            {pricing?.discount > 0 && (
              <tr className="border-t">
                <td className="py-4">Coupon {pricing.couponCode}</td>
                <td />
                <td className="py-4 text-right font-mono">
                  −{money(pricing.discount, invoice.currency)}
                </td>
              </tr>
            )}
            {pricing?.tax?.amount > 0 && (
              <tr className="border-t">
                <td className="py-4">
                  {pricing.tax.name} ({pricing.tax.basisPoints / 100}%)
                  {pricing.tax.inclusive ? ' · included in price' : ''}
                </td>
                <td />
                <td className="py-4 text-right font-mono">
                  {money(pricing.tax.amount, invoice.currency)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {snapshot.seller?.paymentInstructions && invoice.status !== 'paid' && !invoice.isDemo && (
        <p className="whitespace-pre-wrap rounded-lg border p-4 text-sm text-muted-foreground">
          {snapshot.seller.paymentInstructions}
        </p>
      )}
      {invoice.payments?.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">Payment history</h3>
          {invoice.payments.map((p: Row) => (
            <div key={p.id} className="flex flex-wrap justify-between gap-2 border-t py-3 text-xs">
              <span className="capitalize">
                {p.gateway === 'demo' ? 'Demo completion' : p.gateway} · {date(p.createdAt)}
                {p.reviewRequired
                  ? p.reviewedAt
                    ? ' · Reviewed separately'
                    : ' · Staff review required'
                  : ''}
              </span>
              <span className="text-right font-mono">
                {money(p.amount, p.currency)}
                {p.appliedAmount !== undefined && p.appliedAmount !== p.amount && (
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    Applied {money(p.appliedAmount, p.currency)} · unallocated{' '}
                    {money(p.amount - p.appliedAmount, p.currency)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {snapshot.seller?.invoiceFooter && (
        <p className="whitespace-pre-wrap border-t pt-4 text-xs leading-6 text-muted-foreground">
          {snapshot.seller.invoiceFooter}
        </p>
      )}
    </div>
  );
}
export function WalletPage({ admin }: { admin: boolean }) {
  const [currency, setCurrency] = useState('');
  const q = useData<Row>(
    admin ? '/admin/wallets' : `/wallet${currency ? `?currency=${currency}` : ''}`,
    10000,
  );
  const router = useRouter();
  const [funding, setFunding] = useState<Row | null>(null);
  const [request, setRequest] = useState(false),
    [review, setReview] = useState<Row | null>(null),
    [approve, setApprove] = useState(true);
  const [statementUser, setStatementUser] = useState<Row | null>(null);
  const statement = useData<Row>(
    statementUser ? `/admin/wallets/${statementUser.id}?currency=${statementUser.currency}` : null,
  );
  if (q.error) return <ErrorBox error={q.error} retry={q.mutate} />;
  if (!q.data) return <Loading />;
  const data = q.data;
  return (
    <>
      <Header
        eyebrow="Billing"
        title={admin ? 'Customer wallets' : 'Wallet'}
        description={
          admin
            ? 'Review deposits and inspect customer balances.'
            : 'Add funds and use your balance to pay hosting invoices.'
        }
        action={
          !admin ? (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={data.policy?.depositsEnabled === false}
                onClick={() => setFunding({ key: requestId() })}
              >
                Add funds
              </Button>
              <Button
                variant="outline"
                disabled={data.policy?.depositsEnabled === false}
                onClick={() => setRequest(true)}
              >
                <Plus className="size-4" />
                Request top-up
              </Button>
            </div>
          ) : undefined
        }
      />
      {!admin && (
        <div className="mb-6 grid gap-5 lg:grid-cols-2">
          <Panel title="Available balance">
            <div className="flex items-center justify-between">
              <p className="text-4xl font-semibold tracking-tight">
                {money(data.balance, data.currency)}
              </p>
              <Wallet className="size-8 text-muted-foreground" />
            </div>
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              Pay any eligible invoice with your wallet. Deposits become available after payment
              verification.
            </p>
          </Panel>
          <Panel title="Add funds">
            <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
              {data.instructions}
            </p>
          </Panel>
        </div>
      )}
      {admin && (
        <div className="mb-6">
          <DataTable
            rows={data.wallets}
            empty="Customer wallets appear when opened."
            columns={[
              {
                label: 'Customer',
                render: (r) => (
                  <div>
                    {r.user.name}
                    <p className="mt-1 text-xs text-muted-foreground">{r.user.email}</p>
                  </div>
                ),
              },
              { label: 'Balance', render: (r) => money(r.balance, r.currency) },
              {
                label: 'History',
                render: (r) => (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setStatementUser({ ...r.user, currency: r.currency })}
                  >
                    View transactions
                  </Button>
                ),
              },
            ]}
          />
        </div>
      )}
      <Panel title={admin ? 'Deposit requests' : 'Your deposit requests'}>
        <DataTable
          rows={data.topups}
          empty="No deposit requests yet."
          columns={[
            ...(admin ? [{ label: 'Customer', render: (r: Row) => r.user.email }] : []),
            { label: 'Reference', render: (r) => r.reference },
            { label: 'Amount', render: (r) => money(r.amount, r.currency) },
            {
              label: 'Status',
              render: (r) => (
                <div>
                  <Badge variant="outline">{r.status}</Badge>
                  {r.reviewNote && (
                    <p className="mt-2 text-xs text-muted-foreground">{r.reviewNote}</p>
                  )}
                </div>
              ),
            },
            { label: 'Created', render: (r) => date(r.createdAt) },
            ...(admin
              ? [
                  {
                    label: 'Review',
                    render: (r: Row) =>
                      r.status === 'PENDING' ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setReview(r);
                              setApprove(true);
                            }}
                          >
                            <Check className="size-3" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReview(r);
                              setApprove(false);
                            }}
                          >
                            <X className="size-3" />
                            Reject
                          </Button>
                        </div>
                      ) : null,
                  },
                ]
              : []),
          ]}
        />
      </Panel>
      {!admin && (
        <div className="mb-5 max-w-xs">
          <Field label="Wallet currency">
            <Select value={data.currency} onChange={(e) => setCurrency(e.target.value)}>
              {data.currencies.map((c: string) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <p className="mt-2 text-xs text-muted-foreground">
            Balances are separate. Funds are never converted automatically.
          </p>
        </div>
      )}
      {!admin && (
        <div className="mt-6">
          <Panel title="Transaction history">
            <DataTable
              rows={data.entries}
              empty="No wallet transactions yet."
              columns={[
                { label: 'Details', render: (r) => r.description },
                {
                  label: 'Amount',
                  render: (r) => (
                    <span className={r.amount > 0 ? 'text-emerald-400' : ''}>
                      {r.amount > 0 ? '+' : ''}
                      {money(r.amount, data.currency)}
                    </span>
                  ),
                },
                { label: 'Balance after', render: (r) => money(r.balanceAfter, data.currency) },
                { label: 'Date', render: (r) => date(r.createdAt) },
              ]}
            />
          </Panel>
        </div>
      )}
      {funding && (
        <Modal
          title="Add wallet funds"
          description="Create a funding invoice, then choose an available payment method. Your wallet is credited only after full payment is verified."
          close={() => setFunding(null)}
        >
          <Form
            submit="Create funding invoice"
            onSubmit={async (f) => {
              const invoice = await api.post<Row>('/wallet/funding-invoices', {
                amount: parseCurrencyAmount(String(f.get('amount')), data.currency),
                currency: data.currency,
                idempotencyKey: funding.key,
              });
              setFunding(null);
              router.push(`/dashboard/invoices/${invoice.id}`);
            }}
          >
            <Field label={`Funding amount (${data.currency})`}>
              <Input
                name="amount"
                type="number"
                min={(data.policy?.minDeposit || 100) / currencyScale(data.currency)}
                max={(data.policy?.maxDeposit || 100000) / currencyScale(data.currency)}
                step={1 / currencyScale(data.currency)}
                defaultValue={(data.policy?.minDeposit || 100) / currencyScale(data.currency)}
                required
              />
            </Field>
          </Form>
        </Modal>
      )}
      {!admin && data.fundingInvoices?.length > 0 && (
        <div className="my-6">
          <Panel title="Funding invoices">
            <DataTable
              rows={data.fundingInvoices}
              columns={[
                {
                  label: 'Invoice',
                  render: (i) => (
                    <Link
                      className="font-mono text-xs hover:underline"
                      href={`/dashboard/invoices/${i.id}`}
                    >
                      {i.number || i.id.slice(0, 8)}
                    </Link>
                  ),
                },
                { label: 'Amount', render: (i) => money(i.amount, i.currency) },
                {
                  label: 'Status',
                  render: (i) =>
                    i.walletCreditedAt
                      ? 'Credited'
                      : i.status === 'PAID'
                        ? 'Paid · credit held'
                        : i.status === 'VOID'
                          ? 'Voided'
                          : i.paidAmount > 0
                            ? 'Part paid'
                            : 'Awaiting payment',
                },
              ]}
            />
          </Panel>
        </div>
      )}
      {request && (
        <Modal
          title="Request a wallet top-up"
          description="Transfer funds using the instructions on your wallet page. Staff will verify the payment before crediting your balance."
          close={() => setRequest(false)}
        >
          <Form
            submit="Submit deposit for review"
            close={() => setRequest(false)}
            onSubmit={async (f) => {
              await api.post('/wallet/topups', {
                amount: parseCurrencyAmount(String(f.get('amount')), data.currency),
                currency: data.currency,
                reference: f.get('reference'),
              });
              await q.mutate();
              setRequest(false);
              toast.success('Deposit submitted for review');
            }}
          >
            <Field
              label={`Top-up amount (${data.currency})`}
              hint={`${money(data.policy.minDeposit, data.currency)} minimum · ${money(data.policy.maxDeposit, data.currency)} maximum`}
            >
              <Input
                name="amount"
                type="number"
                min={data.policy.minDeposit / currencyScale(data.currency)}
                max={data.policy.maxDeposit / currencyScale(data.currency)}
                step={1 / currencyScale(data.currency)}
                required
              />
            </Field>
            <Field label="Transfer reference">
              <Input name="reference" minLength={3} maxLength={200} required />
            </Field>
          </Form>
        </Modal>
      )}
      {review && (
        <Modal
          title={approve ? 'Approve verified deposit' : 'Reject deposit request'}
          description={`${review.user.email} · ${money(review.amount, review.currency)} · ${review.reference}`}
          close={() => setReview(null)}
        >
          <Form
            submit={approve ? 'Confirm funds received' : 'Reject request'}
            close={() => setReview(null)}
            onSubmit={async (f) => {
              await api.post(`/admin/wallets/topups/${review.id}/review`, {
                approve,
                note: f.get('note'),
                ...(approve ? { paymentReference: f.get('paymentReference') } : {}),
              });
              await q.mutate();
              setReview(null);
              toast.success(approve ? 'Wallet credited' : 'Request rejected');
            }}
          >
            <p className="text-sm leading-6 text-muted-foreground">
              {approve
                ? 'Confirm that the transfer has arrived in your company account. Approval immediately credits the customer wallet.'
                : 'Provide a reason the customer can use to resolve the deposit.'}
            </p>
            <Field label="Review note">
              <Input name="note" minLength={3} maxLength={500} required />
            </Field>
            {approve && (
              <Field
                label="Verified bank transaction ID"
                hint="Use the unique transaction ID from your bank statement, not only the customer’s description."
              >
                <Input name="paymentReference" minLength={3} maxLength={200} required />
              </Field>
            )}
          </Form>
        </Modal>
      )}
      {statementUser && (
        <Modal
          title={`${statementUser.name} · Wallet transactions`}
          description={statementUser.email}
          close={() => setStatementUser(null)}
        >
          {statement.error ? (
            <ErrorBox error={statement.error} />
          ) : !statement.data ? (
            <Loading />
          ) : (
            <>
              <p className="mb-5 text-2xl font-semibold">
                {money(statement.data.balance, statement.data.currency)}
              </p>
              <DataTable
                rows={statement.data.entries}
                empty="No transactions recorded."
                columns={[
                  {
                    label: 'Details',
                    render: (r) => (
                      <div>
                        {r.description}
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {r.reference}
                        </p>
                      </div>
                    ),
                  },
                  { label: 'Amount', render: (r) => money(r.amount, statement.data!.currency) },
                  {
                    label: 'Balance after',
                    render: (r) => money(r.balanceAfter, statement.data!.currency),
                  },
                  { label: 'Date', render: (r) => date(r.createdAt) },
                ]}
              />
            </>
          )}
        </Modal>
      )}
    </>
  );
}
