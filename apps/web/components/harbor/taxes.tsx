'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import {
  Header,
  Panel,
  Field,
  Input,
  Form,
  Modal,
  DataTable,
  Loading,
  ErrorBox,
  useData,
  type Row,
} from './shared';
export function TaxSettings() {
  const rates = useData<Row[]>('/tax-rates'),
    settings = useData<Row>('/settings');
  const [edit, setEdit] = useState<Row | null>(null);
  return (
    <>
      <Header
        eyebrow="Billing"
        title="Tax settings"
        description="Apply country rates from the customer's billing address. Issued invoices retain their original tax breakdown."
        action={<Button onClick={() => setEdit({})}>Add tax rate</Button>}
      />
      <Panel title="Tax policy">
        {settings.data && (
          <Form
            key={`${settings.data.taxEnabled}-${settings.data.taxInclusive}`}
            submit="Save tax policy"
            onSubmit={async (f) => {
              await api.patch('/settings', {
                taxEnabled: f.get('taxEnabled') === 'on',
                taxInclusive: f.get('taxInclusive') === 'on',
              });
              await settings.mutate();
              toast.success('Tax policy saved');
            }}
          >
            <label className="flex gap-3 text-sm">
              <input type="checkbox" name="taxEnabled" defaultChecked={settings.data.taxEnabled} />
              Enable tax calculation
            </label>
            <label className="flex gap-3 text-sm">
              <input
                type="checkbox"
                name="taxInclusive"
                defaultChecked={settings.data.taxInclusive}
              />
              New plan prices include tax
            </label>
            <p className="text-xs leading-6 text-muted-foreground">
              A country rate takes priority over the fallback (*). Tax applies after discounts.
              Inclusive prices keep the advertised total; exemptions keep that total with zero tax.
              Exclusive prices add tax to the discounted price. Each service keeps its original
              pricing mode; future invoices use current rates, billing country and exemption status.
            </p>
          </Form>
        )}
      </Panel>
      <div className="mt-6">
        {rates.error ? (
          <ErrorBox error={rates.error} />
        ) : !rates.data ? (
          <Loading />
        ) : (
          <DataTable
            rows={rates.data}
            empty="No tax rates configured."
            columns={[
              { label: 'Name', render: (r) => r.name },
              { label: 'Country', render: (r) => (r.country === '*' ? 'Fallback' : r.country) },
              { label: 'Rate', render: (r) => `${(r.basisPoints / 100).toFixed(2)}%` },
              { label: 'Status', render: (r) => (r.active ? 'Enabled' : 'Disabled') },
              {
                label: 'Actions',
                render: (r) => (
                  <Button variant="outline" size="sm" onClick={() => setEdit(r)}>
                    Edit rate
                  </Button>
                ),
              },
            ]}
          />
        )}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit tax rate' : 'Add tax rate'} close={() => setEdit(null)}>
          <Form
            submit="Save tax rate"
            onSubmit={async (f) => {
              const percentage = String(f.get('percentage'));
              if (!/^\d{1,3}(\.\d{1,2})?$/.test(percentage))
                throw new Error('Use a percentage with up to two decimal places');
              const [whole, fraction = ''] = percentage.split('.');
              const data = {
                name: f.get('name'),
                country: String(f.get('country')).toUpperCase(),
                basisPoints: Number(whole) * 100 + Number(fraction.padEnd(2, '0')),
                active: f.get('active') === 'on',
              };
              if (edit.id) await api.patch(`/tax-rates/${edit.id}`, data);
              else await api.post('/tax-rates', data);
              await rates.mutate();
              setEdit(null);
              toast.success('Tax rate saved');
            }}
          >
            <Field label="Tax name">
              <Input
                name="name"
                defaultValue={edit.name}
                required
                maxLength={100}
                placeholder="VAT"
              />
            </Field>
            <Field label="Country code" hint="Two-letter country code, or * for the fallback rate.">
              <Input
                name="country"
                defaultValue={edit.country}
                required
                maxLength={2}
                placeholder="GB"
              />
            </Field>
            <Field label="Tax percentage">
              <Input
                name="percentage"
                type="number"
                min={0}
                max={100}
                step={0.01}
                defaultValue={edit.basisPoints === undefined ? '' : edit.basisPoints / 100}
                required
              />
            </Field>
            <label className="flex gap-3 text-sm">
              <input name="active" type="checkbox" defaultChecked={edit.active ?? true} />
              Enable rate
            </label>
          </Form>
        </Modal>
      )}
    </>
  );
}
