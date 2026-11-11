'use client';
import { Field, Input, Select, money, type Row } from './shared';
export type OptionValues = Record<string, string | number | boolean>;
const priceFor = (option: Row, plan: Row) =>
  (option.prices || []).find(
    (p: Row) => (p.planId || null) === (plan.id || null) && p.currency === plan.currency,
  );
export function defaultOptionValues(
  product: Row,
  planId = '',
  previous: OptionValues = {},
): OptionValues {
  const plan = product.purchasePlans?.find((p: Row) => (p.id || '') === planId),
    values: OptionValues = {};
  if (!plan) return values;
  for (const option of product.configuration?.options || []) {
    if (option.kind === 'SELECT') {
      const choices = option.choices.filter(
        (c: Row) =>
          c.active && priceFor(c, plan) && (plan.type !== 'FREE' || priceFor(c, plan).amount === 0),
      );
      values[option.id] = choices.some((c: Row) => c.id === previous[option.id])
        ? previous[option.id]
        : option.required
          ? choices[0]?.id || ''
          : '';
    } else if (option.kind === 'TEXT') values[option.id] = previous[option.id] || '';
    else if (option.kind === 'QUANTITY' && option.required)
      values[option.id] =
        typeof previous[option.id] === 'number' ? previous[option.id] : option.min;
    else if (option.kind === 'TOGGLE')
      values[option.id] = previous[option.id] === true && !!priceFor(option, plan);
  }
  return values;
}
export function optionsReady(product: Row | null, values: OptionValues) {
  return (
    !!product &&
    (product.configuration?.options || []).every((option: Row) => {
      const value = values[option.id];
      if (option.required && (value === undefined || value === '' || value === false)) return false;
      if (value === undefined || value === '' || value === false) return true;
      if (option.kind === 'QUANTITY')
        return (
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= option.min &&
          value <= option.max &&
          (value - option.min) % option.step === 0
        );
      return true;
    })
  );
}
export function PurchaseOptions({
  product,
  planId,
  values,
  change,
}: {
  product: Row;
  planId: string;
  values: OptionValues;
  change: (value: OptionValues) => void;
}) {
  const plan = product.purchasePlans?.find((p: Row) => (p.id || '') === planId);
  if (!plan) return null;
  return (
    <div className="space-y-4">
      {product.configuration?.options?.map((option: Row) => {
        const value = values[option.id];
        const set = (v: string | number | boolean) => change({ ...values, [option.id]: v });
        const label = `${option.name}${option.required ? ' *' : ''}`;
        if (option.kind === 'TOGGLE') {
          const price = priceFor(option, plan),
            available = price && (plan.type !== 'FREE' || price.amount === 0);
          return (
            <div key={option.id}>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={value === true}
                  disabled={!available}
                  required={option.required}
                  onChange={(e) => set(e.target.checked)}
                />
                {label}
                {available
                  ? ` · ${money(price.amount, plan.currency)} / ${plan.label}`
                  : ' · unavailable for this term/currency'}
              </label>
              {option.description && (
                <p className="mt-2 text-xs text-muted-foreground">{option.description}</p>
              )}
            </div>
          );
        }
        return (
          <Field key={option.id} label={label} hint={option.description || undefined}>
            {option.kind === 'SELECT' ? (
              <Select
                value={typeof value === 'string' ? value : ''}
                required={option.required}
                onChange={(e) => set(e.target.value)}
              >
                <option value="">Choose {option.name.toLowerCase()}</option>
                {option.choices
                  .filter((c: Row) => c.active)
                  .map((c: Row) => {
                    const price = priceFor(c, plan),
                      available = price && (plan.type !== 'FREE' || price.amount === 0);
                    return (
                      <option key={c.id} value={c.id} disabled={!available}>
                        {c.name}
                        {available
                          ? ` · ${money(price.amount, plan.currency)} / ${plan.label}${price.setupFee ? ` + ${money(price.setupFee, plan.currency)} setup` : ''}`
                          : ' · unavailable'}
                      </option>
                    );
                  })}
              </Select>
            ) : option.kind === 'QUANTITY' ? (
              <Input
                type="number"
                min={option.min}
                max={option.max}
                step={option.step}
                value={value === undefined ? '' : String(value)}
                required={option.required}
                placeholder={option.required ? '' : 'Optional'}
                onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))}
              />
            ) : (
              <Input
                type={option.validation === 'email' ? 'email' : 'text'}
                value={typeof value === 'string' ? value : ''}
                maxLength={option.maxLength}
                required={option.required}
                onChange={(e) => set(e.target.value)}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}
