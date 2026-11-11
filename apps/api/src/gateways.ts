import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import type { PaymentGateway } from '@harbor/sdk';
import { requestJson } from './providers/http';
export function stripeConfig(c: Record<string, string>) {
  return {
    secretKey: c.secretKey || process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: c.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET || '',
  };
}
export class StripeGateway implements PaymentGateway {
  id = 'stripe';
  async checkout(
    i: { id: string; amount: number; currency: string; returnUrl: string; description?: string },
    config: Record<string, string>,
  ) {
    const c = stripeConfig(config);
    if (!c.secretKey) throw new Error('Stripe has not been configured');
    const client = new Stripe(c.secretKey);
    const session = await client.checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: i.id,
        metadata: { invoiceId: i.id },
        success_url: `${i.returnUrl}?payment=returned`,
        cancel_url: i.returnUrl,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: i.currency.toLowerCase(),
              unit_amount: i.amount,
              product_data: {
                name: (i.description || `Invoice ${i.id.slice(0, 8)}`).slice(0, 120),
              },
            },
          },
        ],
      },
      {
        idempotencyKey: `harbor-invoice-${i.id}-${i.currency}-${i.amount}-${Math.floor(Date.now() / 3600000)}`,
      },
    );
    if (!session.url) throw new Error('Stripe returned no checkout URL');
    return { url: session.url, externalId: session.id };
  }
}
export function paypalConfig(c: Record<string, string>) {
  return {
    clientId: c.clientId || process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: c.clientSecret || process.env.PAYPAL_CLIENT_SECRET || '',
    webhookId: c.webhookId || process.env.PAYPAL_WEBHOOK_ID || '',
    environment: c.environment || process.env.PAYPAL_ENV || 'sandbox',
  };
}
export function paypalOrigin(c: ReturnType<typeof paypalConfig>) {
  return c.environment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}
export async function paypalToken(c: ReturnType<typeof paypalConfig>) {
  if (!c.clientId || !c.clientSecret) throw new Error('PayPal has not been configured');
  const result = await requestJson(`${paypalOrigin(c)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  return result.access_token as string;
}
export class PayPalGateway implements PaymentGateway {
  id = 'paypal';
  async checkout(
    i: { id: string; amount: number; currency: string; returnUrl: string; description?: string },
    config: Record<string, string>,
  ) {
    const c = paypalConfig(config);
    const token = await paypalToken(c);
    const zeroDecimal = ['JPY', 'KRW', 'VND'].includes(i.currency);
    const order = await requestJson(`${paypalOrigin(c)}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': createHash('sha256')
          .update(`checkout:${i.id}:${i.currency}:${i.amount}:${Math.floor(Date.now() / 3600000)}`)
          .digest('hex')
          .slice(0, 32),
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            description: (i.description || `Invoice ${i.id.slice(0, 8)}`).slice(0, 120),
            reference_id: i.id,
            custom_id: i.id,
            amount: {
              currency_code: i.currency,
              value: (i.amount / (zeroDecimal ? 1 : 100)).toFixed(zeroDecimal ? 0 : 2),
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: `${i.returnUrl}?gateway=paypal`,
              cancel_url: i.returnUrl,
              user_action: 'PAY_NOW',
            },
          },
        },
      }),
    });
    const url = order.links?.find(
      (l: any) => l.rel === 'payer-action' || l.rel === 'approve',
    )?.href;
    if (!url) throw new Error('PayPal returned no approval URL');
    return { url, externalId: order.id };
  }
}
