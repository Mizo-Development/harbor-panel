import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCurrencyAmount } from '../apps/web/lib/currency';
test('wallet amounts preserve exact cents and reject unsupported fractional precision', () => {
  assert.equal(parseCurrencyAmount('25.01', 'USD'), 2501);
  assert.equal(parseCurrencyAmount('0.29', 'INR'), 29);
  assert.equal(parseCurrencyAmount('25', 'JPY'), 25);
  assert.throws(() => parseCurrencyAmount('25.001', 'USD'));
  assert.throws(() => parseCurrencyAmount('25.01', 'JPY'));
  assert.throws(() => parseCurrencyAmount('-1', 'USD'));
});
