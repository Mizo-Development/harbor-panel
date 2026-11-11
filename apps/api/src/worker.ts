import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import { AppModule } from './module';
import { Jobs } from './jobs';
import { Db } from './db';
import { InvoiceDocuments } from './invoice-documents';
import { SystemMonitor } from './system-monitor';
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const jobs = app.get(Jobs);
  const db = app.get(Db);
  const documents = app.get(InvoiceDocuments);
  const monitor = app.get(SystemMonitor);
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
  const queue = new Queue('hosting', { connection });
  const worker = new Worker('hosting', (job) => jobs.execute(job.data.operationId), {
    connection,
    concurrency: 4,
    lockDuration: 900000,
  });
  let scanning = false,
    lastMaintenance = 0;
  const scan = async () => {
    if (scanning) return;
    scanning = true;
    try {
      if (Date.now() - lastMaintenance > 60000) {
        await monitor.maintenance(() => jobs.maintenance());
        lastMaintenance = Date.now();
      }
      for (const op of await db.operation.findMany({
        where: { status: 'PENDING' },
        take: 100,
        orderBy: { createdAt: 'asc' },
      }))
        await queue.add(
          'operation',
          { operationId: op.id },
          { jobId: op.id, removeOnComplete: true, removeOnFail: 100 },
        );
    } catch (error) {
      console.error('Worker scan failed', error instanceof Error ? error.message : error);
    } finally {
      scanning = false;
    }
  };
  const timer = setInterval(() => void scan(), 3000);
  let mailing: Promise<void> | undefined;
  const mailScan = () => {
    if (!mailing)
      mailing = documents
        .scan()
        .catch(() => console.error('Invoice delivery scan failed'))
        .finally(() => {
          mailing = undefined;
        });
  };
  const mailTimer = setInterval(mailScan, 5000);
  mailScan();
  await scan();
  worker.on('error', (error) => console.error('Worker connection error', error.message));
  const stop = async () => {
    clearInterval(timer);
    clearInterval(mailTimer);
    await mailing;
    await worker.close();
    await queue.close();
    await app.close();
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
