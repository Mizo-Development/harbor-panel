import type { PrismaClient } from '@prisma/client';
import { encrypt } from './security';
export async function seedDemoPlans(db: PrismaClient) {
  const connectionId = '6e531da2-9813-4dfa-9423-30121ee16184';
  const existing = await db.connection.findUnique({ where: { id: connectionId } });
  if (existing && existing.provider !== 'demo-game')
    throw new Error('Demo connection ID is already in use');
  await db.connection.upsert({
    where: { id: connectionId },
    create: {
      id: connectionId,
      name: 'Demo simulator — no game node',
      provider: 'demo-game',
      url: 'https://demo.invalid',
      secret: encrypt({}),
      config: { isDemo: true },
      health: 'ONLINE',
    },
    update: { health: 'ONLINE' },
  });
  const plans = [
    {
      id: 'a7000000-0000-4000-8000-000000000001',
      name: 'Minecraft Starter (Demo)',
      description: 'Starter test configuration. Demo checkout and simulated controls only.',
      price: 499,
      memoryMb: 2048,
      diskMb: 20480,
      cpu: 1,
    },
    {
      id: 'a7000000-0000-4000-8000-000000000002',
      name: 'Minecraft Plus (Demo)',
      description:
        'A larger test configuration. No game server is created and no money is charged.',
      price: 899,
      memoryMb: 4096,
      diskMb: 40960,
      cpu: 2,
    },
    {
      id: 'a7000000-0000-4000-8000-000000000003',
      name: 'Minecraft Pro (Demo)',
      description: 'Try the full checkout flow with a high-resource demo configuration.',
      price: 1599,
      memoryMb: 8192,
      diskMb: 81920,
      cpu: 4,
    },
  ];
  for (const { memoryMb, diskMb, cpu, ...p } of plans) {
    const data = {
      ...p,
      category: 'game',
      provider: 'demo-game',
      cycle: 'monthly',
      active: true,
      connectionId,
      spec: { memoryMb, diskMb, cpu, javaVersion: '21' },
    };
    await db.product.upsert({ where: { id: p.id }, create: data, update: data });
  }
  await db.setting.updateMany({ where: { id: 'installation' }, data: { storefrontEnabled: true } });
  await db.auditLog.create({
    data: {
      action: 'demo.plans.seeded',
      details: {
        count: plans.length,
        message: 'Demo simulator only. No real hosting or payment provider.',
      },
    },
  });
  return plans.map((p) => ({ id: p.id, name: p.name, price: p.price }));
}
