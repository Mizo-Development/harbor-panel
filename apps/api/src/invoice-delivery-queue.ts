import { z } from 'zod';
export async function queueInvoiceDelivery(tx: any, invoiceId: string, kind: 'ISSUED' | 'PAID') {
  const settings = await tx.setting.findUnique({ where: { id: 'installation' } });
  if (!settings?.invoiceEmailsEnabled) return;
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { user: true, service: true },
  });
  if (invoice.service?.provider === 'demo-game') return;
  // Freeze the destination when the event is recorded; no arbitrary recipients or backfill.
  if (!z.email().safeParse(invoice.user.email).success) return;
  return tx.invoiceDelivery.upsert({
    where: { requestKey: `invoice-${invoiceId}-${kind}` },
    create: {
      invoiceId,
      kind,
      recipient: invoice.user.email,
      requestKey: `invoice-${invoiceId}-${kind}`,
    },
    update: {},
  });
}
