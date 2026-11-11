import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL!;
  if (!new URL(url).pathname.endsWith('_test'))
    throw new Error('Refusing to reset a non-test database');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await db.gameEgg.deleteMany({ where: { id: { not: 'a2339869-9e45-4e7a-b72f-4d1038abca01' } } });
    await db.$executeRawUnsafe(
      'TRUNCATE "HttpLog", "SystemRun", "MailLog", "NotificationTemplate", "InvoiceSequence", "TaxRate", "CatalogCategory", "Coupon", "PricingRegion", "Location", "SupportDepartment", "User", "Setting", "Connection", "Resource", "Product", "Order", "Service", "Invoice", "Payment", "PaymentEvent", "Checkout", "Operation", "AuditLog" CASCADE',
    );
  } finally {
    await db.$disconnect();
  }
}
