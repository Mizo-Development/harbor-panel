import { json } from './db';
import { queueInvoiceDelivery } from './invoice-delivery-queue';
export async function issueInvoice(tx: any, data: any, demo = false) {
  let number: string | undefined;
  if (!demo) {
    const settings = await tx.setting.findUniqueOrThrow({ where: { id: 'installation' } });
    const seq = await tx.invoiceSequence.upsert({
      where: { id: 'installation' },
      create: { id: 'installation', lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    number = `${settings.invoicePrefix}-${new Date().getUTCFullYear()}-${String(seq.lastNumber).padStart(6, '0')}`;
  }
  const lines = data.billingSnapshot?.pricing?.lines || [
    {
      name: data.description || 'Hosting service',
      kind: 'PLAN',
      quantity: 1,
      amount: data.billingSnapshot?.pricing?.subtotal ?? data.amount,
    },
  ];
  const invoice = await tx.invoice.create({
    data: {
      ...data,
      number,
      billingSnapshot: json(data.billingSnapshot || {}),
      lineItems: {
        create: lines.map((line: any) => ({
          description: line.name,
          kind: line.kind || 'CUSTOM',
          quantity: line.quantity ?? 1,
          unitAmount:
            line.unitAmount ?? ((line.quantity ?? 1) ? line.amount / (line.quantity ?? 1) : 0),
          total: line.amount,
          taxable: line.taxable ?? data.billingSnapshot?.pricing?.tax?.taxable ?? true,
        })),
      },
    },
  });
  if (!demo) await queueInvoiceDelivery(tx, invoice.id, 'ISSUED');
  return invoice;
}
export const remainingBalance = (invoice: { amount: number; paidAmount: number }) =>
  Math.max(0, invoice.amount - invoice.paidAmount);
export function invoicePaymentBlocked(invoice: any) {
  return (
    invoice.status === 'VOID' ||
    invoice.linkedServices?.some(
      (link: any) =>
        link.service &&
        (link.service.status === 'TERMINATED' ||
          (link.service.cancelAt &&
            (link.service.cancelAt <= new Date() || invoice.periodStart >= link.service.cancelAt))),
    ) ||
    !!(
      invoice.service &&
      (invoice.service.status === 'TERMINATED' ||
        (invoice.service.cancelAt &&
          (invoice.service.cancelAt <= new Date() ||
            invoice.periodStart >= invoice.service.cancelAt)))
    )
  );
}
export const serviceInvoiceWhere = (serviceId: string) => ({
  OR: [{ serviceId }, { linkedServices: { some: { serviceId } } }],
});
export async function voidInvoices(tx: any, where: any, reason: string, cancellationId?: string) {
  const invoices = await tx.invoice.findMany({
    where: { ...where, status: 'UNPAID' },
    select: { id: true, paidAmount: true },
  });
  const ids = invoices.map((i: any) => i.id);
  if (!ids.length) return;
  await tx.invoice.updateMany({
    where: { id: { in: ids }, status: 'UNPAID' },
    data: { status: 'VOID', voidReason: reason, ...(cancellationId ? { cancellationId } : {}) },
  });
  await tx.payment.updateMany({
    where: {
      invoiceId: { in: invoices.filter((i: any) => i.paidAmount > 0).map((i: any) => i.id) },
      appliedAmount: { gt: 0 },
      reviewRequired: false,
    },
    data: {
      reviewRequired: true,
      reviewReason: 'Part-paid invoice voided; allocation requires reconciliation',
    },
  });
}

export async function creditFunding(tx: any, invoiceId: string, actorId?: string) {
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (
    invoice.kind !== 'WALLET_FUNDING' ||
    invoice.status !== 'PAID' ||
    invoice.paidAmount !== invoice.amount
  )
    return { credited: false, reason: 'Funding invoice is not fully paid' };
  if (invoice.walletCreditedAt) return { credited: true, duplicate: true };
  if (
    await tx.payment.count({
      where: {
        invoiceId,
        appliedAmount: { gt: 0 },
        reviewRequired: true,
        reviewedAt: { not: null },
      },
    })
  )
    return {
      credited: false,
      reason:
        'These funding receipts were already reconciled. Review their accounting resolution before crediting funds.',
    };
  const { walletPolicy } = await import('./billing');
  const settings = await tx.setting.findUniqueOrThrow({ where: { id: 'installation' } }),
    policy = walletPolicy(settings);
  const wallet = await tx.wallet.upsert({
    where: { userId_currency: { userId: invoice.userId, currency: invoice.currency } },
    create: { userId: invoice.userId, currency: invoice.currency },
    update: {},
  });
  if (wallet.balance + invoice.amount > policy.maxBalance) {
    await tx.payment.updateMany({
      where: { invoiceId, appliedAmount: { gt: 0 }, reviewRequired: false },
      data: {
        reviewRequired: true,
        reviewReason: 'Paid wallet funding held because the wallet balance limit would be exceeded',
      },
    });
    return { credited: false, reason: 'Wallet balance limit exceeded; staff review required' };
  }
  const updated = await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: { increment: invoice.amount } },
  });
  await tx.walletEntry.create({
    data: {
      walletId: wallet.id,
      amount: invoice.amount,
      balanceAfter: updated.balance,
      kind: 'FUNDING',
      reference: `invoice-funding-${invoice.id}`,
      description: `Wallet funding ${invoice.number || invoice.id}`,
    },
  });
  await tx.invoice.update({ where: { id: invoiceId }, data: { walletCreditedAt: new Date() } });
  await tx.payment.updateMany({
    where: {
      invoiceId,
      reviewReason: 'Paid wallet funding held because the wallet balance limit would be exceeded',
      reviewedAt: null,
    },
    data: {
      reviewedAt: new Date(),
      reviewedById: actorId || null,
      reviewResolution: 'Wallet funding successfully credited',
    },
  });
  await tx.auditLog.create({
    data: {
      actorId: actorId || null,
      action: 'wallet.funding.credited',
      targetId: invoice.id,
      details: { amount: invoice.amount, currency: invoice.currency },
    },
  });
  return { credited: true, balance: updated.balance };
}
