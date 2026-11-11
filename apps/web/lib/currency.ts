export const currencyScale = (currency: string) => (currency === 'JPY' ? 1 : 100);
export function parseCurrencyAmount(value: string, currency: string): number {
  const decimals = currency === 'JPY' ? 0 : 2;
  if (!(decimals === 0 ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(value))
    throw new Error('Enter a valid amount in your wallet currency');
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * currencyScale(currency) + Number(fraction.padEnd(decimals, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('Amount is too large');
  return amount;
}
