import PDFDocument from 'pdfkit';
import { resolve } from 'node:path';

export function invoiceReference(invoice: any) {
  return (
    invoice.number ||
    `${invoice.service?.provider === 'demo-game' ? 'DEMO' : 'INV'}-${invoice.id.slice(0, 8).toUpperCase()}`
  );
}
export function invoiceFilename(invoice: any) {
  return `${invoiceReference(invoice)
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 100)}.pdf`;
}
export function invoiceMoney(amount: number, currency: string) {
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(amount / 10 ** digits);
}
const plain = (value: unknown) => String(value ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
const date = (value: Date | string) => new Date(value).toISOString().slice(0, 10);
// The font files ship with the API; neither rendering nor attachment delivery fetches URLs.
const fonts = resolve(__dirname, '../assets/fonts');
export async function renderInvoicePdf(invoice: any): Promise<Buffer> {
  const snapshot = invoice.billingSnapshot || {},
    pricing = snapshot.pricing || {};
  const ref = invoiceReference(invoice),
    seller = snapshot.seller || {},
    buyer = snapshot.buyer || {};
  const doc = new PDFDocument({
    size: 'A4',
    margin: 46,
    bufferPages: true,
    font: resolve(fonts, 'DejaVuSans.ttf'),
    info: {
      Title: `Invoice ${ref}`,
      Author: plain(seller.legalName || seller.companyName),
      CreationDate: new Date(invoice.createdAt),
    },
  });
  doc.registerFont('Regular', resolve(fonts, 'DejaVuSans.ttf'));
  doc.registerFont('Bold', resolve(fonts, 'DejaVuSans-Bold.ttf'));
  const parts: Buffer[] = [];
  const result = new Promise<Buffer>((ok, fail) => {
    doc.on('data', (part) => parts.push(part));
    doc.on('end', () => ok(Buffer.concat(parts)));
    doc.on('error', fail);
  });
  const left = 46,
    width = 503;
  const paragraph = (text: unknown, size = 10, bold = false) => {
    doc
      .font(bold ? 'Bold' : 'Regular')
      .fontSize(size)
      .fillColor('#20232a')
      .text(plain(text), left, doc.y, { width, lineGap: 3 });
    doc.moveDown(0.5);
  };
  const space = (height: number) => {
    if (doc.y + height > doc.page.height - 65) doc.addPage();
  };
  const rule = () => {
    space(20);
    doc
      .moveTo(left, doc.y)
      .lineTo(left + width, doc.y)
      .strokeColor('#d8dde3')
      .stroke();
    doc.y += 12;
  };
  paragraph('INVOICE', 11, true);
  paragraph(ref, 23, true);
  paragraph(
    `${invoice.status === 'UNPAID' && invoice.paidAmount > 0 ? 'PART PAID' : invoice.status}  ·  Issued ${date(invoice.createdAt)}  ·  Due ${date(invoice.dueAt)} (UTC)`,
    9,
  );
  if (invoice.paidAt) paragraph(`Paid ${date(invoice.paidAt)} (UTC)`, 9);
  if (invoice.service?.provider === 'demo-game')
    paragraph('DEMO — pricing preview. No charge was collected.', 10, true);
  if (invoice.description) paragraph(invoice.description);
  rule();
  const party = (label: string, p: any, isSeller: boolean) => {
    paragraph(label, 9, true);
    const lines = [
      isSeller ? p.legalName || p.companyName : p.name,
      p.company,
      p.line1,
      p.line2,
      [p.city, p.state, p.postalCode].filter(Boolean).join(', '),
      p.country,
      p.email,
      p.phone,
      p.taxId && `Tax ID: ${p.taxId}`,
      p.registrationNumber && `Registration: ${p.registrationNumber}`,
    ];
    paragraph(lines.filter(Boolean).join('\n'), 9);
  };
  // Stacked parties keep long names and addresses readable across page breaks.
  party('FROM', seller, true);
  party('BILL TO', buyer, false);
  rule();
  const heading = () => {
    space(30);
    const y = doc.y;
    doc.font('Bold').fontSize(9).text('DESCRIPTION', left, y, { width: 330 });
    doc.text('QTY', 380, y, { width: 40, align: 'right' });
    doc.text('AMOUNT', 425, y, { width: 124, align: 'right' });
    doc.y = y + 24;
  };
  heading();
  const lines = pricing.lines?.length
    ? pricing.lines
    : invoice.lineItems?.length
      ? invoice.lineItems.map((i: any) => ({
          name: i.description,
          amount: i.total,
          quantity: i.quantity,
        }))
      : [
          {
            name: invoice.description || 'Hosting service',
            amount: pricing.subtotal ?? invoice.amount,
            quantity: 1,
          },
        ];
  for (const line of lines) {
    doc.font('Regular').fontSize(10);
    const text = plain(line.name);
    const height = Math.max(18, doc.heightOfString(text, { width: 325, lineGap: 3 })) + 13;
    if (doc.y + height > doc.page.height - 65) {
      doc.addPage();
      heading();
    }
    const y = doc.y;
    doc.text(text, left, y, { width: 325, lineGap: 3 });
    doc.text(String(line.quantity ?? 1), 380, y, { width: 40, align: 'right' });
    doc.text(invoiceMoney(line.amount, invoice.currency), 425, y, { width: 124, align: 'right' });
    doc.y = y + height;
  }
  rule();
  const total = (label: string, amount: number, bold = false) => {
    doc.font(bold ? 'Bold' : 'Regular').fontSize(bold ? 12 : 10);
    const height = Math.max(26, doc.heightOfString(label, { width: 330 }) + 12);
    space(height);
    const y = doc.y;
    doc.text(label, left, y, { width: 330 });
    doc.text(invoiceMoney(amount, invoice.currency), 380, y, { width: 169, align: 'right' });
    doc.y = y + height;
  };
  total('Subtotal', pricing.subtotal ?? invoice.amount);
  if (pricing.discount) total(`Coupon ${pricing.couponCode || ''}`, -pricing.discount);
  if (pricing.tax?.amount)
    total(
      `${plain(pricing.tax.name || 'Tax')} (${pricing.tax.basisPoints / 100}%)${pricing.tax.inclusive ? ' — included in price' : ''}`,
      pricing.tax.amount,
    );
  total('Invoice total', invoice.amount, true);
  total('Applied payments', invoice.paidAmount);
  total(
    'Balance due',
    invoice.status === 'UNPAID' ? Math.max(0, invoice.amount - invoice.paidAmount) : 0,
    true,
  );
  if (invoice.status === 'VOID')
    paragraph(`Void reason: ${invoice.voidReason || 'Invoice withdrawn'}`, 9);
  if (invoice.kind === 'WALLET_FUNDING')
    paragraph(
      invoice.walletCreditedAt
        ? 'Funds credited to your wallet.'
        : 'Wallet funding invoice. Funds are credited after full payment and balance-limit checks.',
      9,
    );
  if (invoice.payments?.length) {
    space(55);
    rule();
    paragraph('PAYMENT HISTORY', 10, true);
    for (const payment of invoice.payments) {
      space(60);
      paragraph(
        `${date(payment.createdAt)} (UTC) · ${payment.gateway} · ${invoiceMoney(payment.amount, payment.currency)}\nApplied ${invoiceMoney(payment.appliedAmount ?? payment.amount, payment.currency)}${payment.reviewRequired ? (payment.reviewedAt ? ' · Reviewed separately' : ' · Staff review required') : ''}`,
        9,
      );
    }
  }
  if (invoice.status === 'UNPAID' && seller.paymentInstructions) {
    space(50);
    rule();
    paragraph(seller.paymentInstructions, 9);
  }
  if (seller.invoiceFooter) {
    space(50);
    rule();
    paragraph(seller.invoiceFooter, 9);
  }
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Regular')
      .fontSize(8)
      .fillColor('#68707d')
      .text(`${ref}  ·  Page ${i + 1} of ${pages.count}`, left, doc.page.height - 42, {
        width,
        lineBreak: false,
        align: 'center',
      });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return result;
}
