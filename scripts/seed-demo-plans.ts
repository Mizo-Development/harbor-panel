import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedDemoPlans } from '../apps/api/dist/demo.js';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
try {
  console.log(JSON.stringify(await seedDemoPlans(db), null, 2));
} finally {
  await db.$disconnect();
}
