import test from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import Stripe from 'stripe';
import { SMTPServer } from 'smtp-server';
const database = process.env.TEST_DATABASE_URL;
test(
  'API commerce, isolation, callbacks, extensions, and worker recovery',
  { skip: !database, timeout: 240000 },
  async (t) => {
    assert(
      new URL(database!).pathname.endsWith('_test'),
      'Integration tests require a database name ending in _test',
    );
    process.env.DATABASE_URL = database!;
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    process.env.SETUP_TOKEN = 'test-setup-token-for-isolated-database';
    process.env.APP_URL = 'http://localhost:3000';
    process.env.NODE_ENV = 'test';
    const extensionDir = await mkdtemp(join(tmpdir(), 'harbor-ext-'));
    process.env.EXTENSIONS_DIR = extensionDir;
    process.env.ATTACHMENTS_DIR = join(extensionDir, 'ticket-files');
    process.env.BRANDING_DIR = join(extensionDir, 'branding');
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: process.env,
      stdio: 'pipe',
    });
    const { Logger } = createRequire(new URL('../apps/api/package.json', import.meta.url))(
      '@nestjs/common',
    );
    Logger.overrideLogger(false);
    const { createApp } = await import('../apps/api/dist/main.js');
    const { Db } = await import('../apps/api/dist/db.js');
    const { Payments } = await import('../apps/api/dist/payments.js');
    const { Jobs } = await import('../apps/api/dist/jobs.js');
    const { Extensions } = await import('../apps/api/dist/extensions.js');
    const app = await createApp();
    const db = app.get(Db);
    await db.gameEgg.deleteMany({ where: { id: { not: 'a2339869-9e45-4e7a-b72f-4d1038abca01' } } });
    await db.extension.deleteMany({ where: { builtin: false } });
    await db.$executeRawUnsafe(
      'TRUNCATE "HttpLog", "SystemRun", "MailLog", "NotificationTemplate", "InvoiceSequence", "TaxRate", "CatalogCategory", "Coupon", "PricingRegion", "Location", "SupportDepartment", "User", "Setting", "Connection", "Resource", "Product", "Order", "Service", "Invoice", "Payment", "PaymentEvent", "Checkout", "Operation", "AuditLog" CASCADE',
    );
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}/api/v1`;
    let admin = '',
      customer = '',
      other = '';
    let clientAddress: string | undefined;
    async function call(
      path: string,
      method = 'GET',
      body?: unknown,
      cookie = '',
      extra: Record<string, string> = {},
      retryRateLimit = true,
    ) {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          Cookie: cookie,
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      };
      const send = async (): Promise<Response> => {
        if (!clientAddress) return fetch(base + path, options);
        return new Promise((ok, fail) => {
          const req = httpRequest(
            base + path,
            {
              method: options.method,
              headers: {
                ...options.headers,
                ...(options.body !== undefined
                  ? { 'Content-Length': String(Buffer.byteLength(options.body)) }
                  : {}),
              },
              localAddress: clientAddress,
            },
            (response) => {
              const chunks: Buffer[] = [];
              response.on('data', (chunk) => chunks.push(chunk));
              response.on('end', () => {
                const headers = new Headers();
                for (const [key, value] of Object.entries(response.headers))
                  if (value !== undefined)
                    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
                ok(
                  new Response(response.statusCode === 204 ? null : Buffer.concat(chunks), {
                    status: response.statusCode,
                    headers,
                  }),
                );
              });
            },
          );
          req.on('error', fail);
          req.end(options.body);
        });
      };
      let res = await send();
      // The suite exceeds a real client rate window. Respect it without weakening API limits.
      const retrySeconds = Number(res.headers.get('retry-after'));
      if (retryRateLimit && res.status === 429 && retrySeconds > 0 && retrySeconds <= 60) {
        await res.text();
        await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000 + 100));
        res = await send();
      }
      return {
        status: res.status,
        body: (await res.json()) as any,
        cookie: res.headers.get('set-cookie')?.split(';')[0] || '',
        retryAfter: res.headers.get('retry-after'),
      };
    }
    const calls: string[] = [];
    let fileMock = false;
    const gameFiles = new Map<string, Buffer>();
    const fileOperations: any[] = [];
    let failNextTermination = false;
    let rejectNodeHealth = false;
    const node = createServer((req, res) => {
      calls.push(`${req.method} ${req.url} ${req.headers.authorization}`);
      res.setHeader('Content-Type', 'application/json');
      if (fileMock && req.url?.includes('/files/')) {
        const url = new URL(req.url, 'http://node.test');
        if (url.pathname.endsWith('/contents')) {
          const bytes = gameFiles.get(url.searchParams.get('file') || '');
          if (!bytes) {
            res.statusCode = 404;
            res.end('{}');
            return;
          }
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Length', bytes.length);
          res.end(bytes);
          return;
        }
        if (url.pathname.endsWith('/list-directory')) {
          res.end(
            JSON.stringify(
              [...gameFiles.keys()].map((path) => ({
                name: path.split('/').pop(),
                file: true,
                size: gameFiles.get(path)!.length,
              })),
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          if (url.pathname.endsWith('/write'))
            gameFiles.set(url.searchParams.get('file')!, Buffer.concat(chunks));
          else
            fileOperations.push({
              path: url.pathname,
              method: req.method,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            });
          res.statusCode = 204;
          res.end();
        });
        return;
      }
      if (req.method === 'DELETE' && failNextTermination) {
        failNextTermination = false;
        res.statusCode = 503;
        res.end('{}');
        return;
      }
      if (req.url === '/api/system' && rejectNodeHealth) {
        res.statusCode = 503;
        res.end('{}');
        return;
      }
      if (req.url === '/api/system') res.end('{"version":"test-contract"}');
      else if (req.url === '/api/servers') res.end('[]');
      else if (req.method === 'POST' && req.url === '/api/servers') res.end('{}');
      else {
        res.statusCode = 204;
        res.end();
      }
    });
    await new Promise<void>((r) => node.listen(0, '127.0.0.1', r));
    try {
      await t.test('setup status reads do not consume authentication attempts', async () => {
        for (let i = 0; i < 35; i++) assert.equal((await call('/setup')).status, 200);
      });
      await t.test('setup is token protected, atomic, and creates a secure session', async () => {
        assert.equal(
          (
            await call('/setup', 'POST', {
              companyName: 'Test Hosting',
              email: 'admin@example.com',
              password: 'test-admin-password',
              nodeMode: 'remote',
              setupToken: 'wrong-token'.repeat(8),
            })
          ).status,
          401,
        );
        const r = await call('/setup', 'POST', {
          companyName: 'Test Hosting',
          email: 'admin@example.com',
          password: 'test-admin-password',
          currency: 'USD',
          nodeMode: 'remote',
          setupToken: process.env.SETUP_TOKEN,
        });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        admin = r.cookie;
        assert(admin.includes('harbor_session='));
        assert.equal(
          (
            await call('/setup', 'POST', {
              companyName: 'Other',
              email: 'x@example.com',
              password: 'test-admin-password',
              currency: 'USD',
              nodeMode: 'local',
              setupToken: process.env.SETUP_TOKEN,
            })
          ).status,
          409,
        );
        assert.equal((await call('/auth/me', 'GET', undefined, admin)).body.data.role, 'admin');
      });
      await t.test(
        'registration persists customers while admin endpoints and cross-origin mutations are protected',
        async () => {
          customer = (
            await call('/auth/register', 'POST', {
              name: 'Customer',
              email: 'customer@example.com',
              password: 'customer-password',
            })
          ).cookie;
          other = (
            await call('/auth/register', 'POST', {
              name: 'Other',
              email: 'other@example.com',
              password: 'other-user-password',
            })
          ).cookie;
          assert.equal((await call('/nodes', 'GET', undefined, customer)).status, 403);
          assert.equal(
            (
              await call('/settings', 'PATCH', { storefrontEnabled: false }, admin, {
                Origin: 'https://attacker.example',
              })
            ).status,
            403,
          );
          assert.equal(
            (await call('/auth/login', 'POST', { email: 'admin@example.com', password: 'wrong' }))
              .status,
            401,
          );
          for (const session of [customer, other]) {
            assert.equal(
              (
                await call(
                  '/profile',
                  'PATCH',
                  {
                    name: session === customer ? 'Customer' : 'Other',
                    billingAddress: {
                      line1: '42 Test Street',
                      city: 'Test City',
                      postalCode: '12345',
                      country: 'US',
                    },
                  },
                  session,
                )
              ).status,
              200,
            );
          }
        },
      );
      let connectionId = '',
        productId = '',
        order: any;
      await t.test(
        'provider credentials stay private and products require a healthy connection',
        async () => {
          const r = await call(
            '/nodes',
            'POST',
            {
              name: 'Test Wings',
              provider: 'wings',
              url: `http://127.0.0.1:${(node.address() as any).port}`,
              config: {
                paperDownloadUrl: 'https://example.com/paper.jar',
                paperSha256: 'a'.repeat(64),
              },
              secret: { tokenId: 'node-identifier', token: 'daemon-secret-'.repeat(5) },
            },
            admin,
          );
          assert.equal(r.status, 201, JSON.stringify(r.body));
          connectionId = r.body.data.id;
          const product = {
            name: 'Minecraft Starter',
            description: 'A Minecraft server',
            category: 'game',
            provider: 'wings',
            price: 1000,
            cycle: 'monthly',
            active: true,
            connectionId,
            spec: { memoryMb: 1024, diskMb: 10240, cpu: 1 },
          };
          assert.equal((await call('/products', 'POST', product, admin)).status, 409);
          assert.equal((await call(`/nodes/${connectionId}/check`, 'POST', {}, admin)).status, 201);
          assert(
            !JSON.stringify((await call('/nodes', 'GET', undefined, admin)).body).includes(
              'daemon-secret',
            ),
          );
          const p = await call('/products', 'POST', product, admin);
          assert.equal(p.status, 201, JSON.stringify(p.body));
          productId = p.body.data.id;
          await call(
            `/nodes/${connectionId}/resources`,
            'POST',
            {
              kind: 'allocation',
              value: '203.0.113.10:25565',
              config: { ip: '203.0.113.10', port: 25565 },
            },
            admin,
          );
        },
      );
      await t.test(
        'orders reserve allocations once and customer isolation applies to invoices and services',
        async () => {
          const input = { productId, idempotencyKey: randomUUID() };
          const a = await call('/orders', 'POST', input, customer);
          assert.equal(a.status, 201, JSON.stringify(a.body));
          order = a.body.data;
          const b = await call('/orders', 'POST', input, customer);
          assert.equal(a.body.data.serviceId, b.body.data.serviceId);
          assert.equal(await db.service.count(), 1);
          assert.equal(
            (await call(`/services/${order.serviceId}`, 'GET', undefined, other)).status,
            404,
          );
          assert.equal(
            (
              await call(
                `/invoices/${order.invoiceId}/checkout`,
                'POST',
                { gateway: 'stripe' },
                other,
              )
            ).status,
            404,
          );
          assert.equal(
            (await call('/orders', 'POST', { productId, idempotencyKey: randomUUID() }, other))
              .status,
            409,
          );
        },
      );
      await t.test(
        'egg import, plan assignment, order snapshots and customer startup permissions',
        async () => {
          assert.equal((await call('/admin/eggs', 'GET', undefined, customer)).status, 403);
          const library = await call('/admin/eggs', 'GET', undefined, admin);
          assert.equal(library.status, 200);
          assert(
            library.body.data.some((e: any) => e.id === 'a2339869-9e45-4e7a-b72f-4d1038abca01'),
          );
          const definition = JSON.parse(await readFile('apps/api/assets/eggs/paper.json', 'utf8'));
          const input = { nest: 'Test games', definition, reviewedScript: true };
          assert.equal(
            (await call('/admin/eggs', 'POST', { ...input, reviewedScript: false }, admin)).status,
            400,
          );
          const imported = await call('/admin/eggs', 'POST', input, admin);
          assert.equal(imported.status, 201, JSON.stringify(imported.body));
          const eggId = imported.body.data.id;
          const original = await db.product.findUniqueOrThrow({ where: { id: productId } });
          const configured = await call(
            `/products/${productId}`,
            'PATCH',
            {
              ...original,
              gameConfig: {
                eggId,
                variables: { DL_PATH: 'https://example.com/private-custom.jar' },
              },
            },
            admin,
          );
          assert.equal(configured.status, 200, JSON.stringify(configured.body));
          assert(
            !JSON.stringify((await call('/catalog/products')).body).includes('private-custom.jar'),
          );
          const existing = await db.service.findUniqueOrThrow({ where: { id: order.serviceId } });
          assert.equal(
            existing.metadata.gameAssignment.eggId,
            'a2339869-9e45-4e7a-b72f-4d1038abca01',
          );
          assert.equal(
            (await call(`/services/${order.serviceId}/startup`, 'GET', undefined, other)).status,
            404,
          );
          const startup = await call(
            `/services/${order.serviceId}/startup`,
            'GET',
            undefined,
            customer,
          );
          assert.equal(startup.status, 200);
          assert.equal(startup.body.data.variables.length, 3);
          assert(!startup.body.data.variables.some((v: any) => v.env_variable === 'DL_PATH'));
          assert.equal(
            (
              await call(
                `/services/${order.serviceId}/startup`,
                'PATCH',
                { variables: { SERVER_PORT: '99' } },
                customer,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await call(
                `/services/${order.serviceId}/startup`,
                'PATCH',
                { variables: { SERVER_JARFILE: '../evil.jar' } },
                customer,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await call(
                `/services/${order.serviceId}/startup`,
                'PATCH',
                { variables: { MINECRAFT_VERSION: 'latest' } },
                customer,
              )
            ).status,
            200,
          );
          assert.equal(
            (await call(`/products/${productId}`, 'PATCH', { ...original, gameConfig: {} }, admin))
              .status,
            200,
          );
          assert.equal(
            (await call(`/admin/eggs/${eggId}`, 'PATCH', { ...input, archived: true }, admin))
              .status,
            200,
          );
          assert.equal(
            (
              await call(
                `/products/${productId}`,
                'PATCH',
                { ...original, gameConfig: { eggId } },
                admin,
              )
            ).status,
            400,
          );
        },
      );
      await t.test(
        'signed Stripe notifications settle an invoice exactly once, including replay and concurrent delivery',
        async () => {
          await app.get(Extensions).configure('stripe', {
            secretKey: 'sk_test_not_a_real_key',
            webhookSecret: 'whsec_testsecret',
          });
          await db.checkout.create({
            data: {
              invoiceId: order.invoiceId,
              gateway: 'stripe',
              externalId: 'cs_test_invoice',
              url: 'https://checkout.stripe.com/test',
            },
          });
          const event = {
            id: 'evt_test_payment',
            object: 'event',
            type: 'checkout.session.completed',
            data: {
              object: {
                id: 'cs_test_invoice',
                payment_status: 'paid',
                payment_intent: 'pi_test_payment',
                amount_total: 1000,
                currency: 'usd',
                metadata: { invoiceId: order.invoiceId },
              },
            },
          };
          const payload = JSON.stringify(event),
            signature = Stripe.webhooks.generateTestHeaderString({
              payload,
              secret: 'whsec_testsecret',
            });
          const send = () =>
            fetch(base + '/webhooks/stripe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
              body: payload,
            });
          const responses = await Promise.all([send(), send()]);
          for (const r of responses) assert.equal(r.status, 201, await r.text());
          assert.equal((await send()).status, 201);
          assert.equal(await db.payment.count(), 1);
          assert.equal(await db.operation.count(), 1);
          assert.equal(
            (await db.invoice.findUnique({ where: { id: order.invoiceId } })).status,
            'PAID',
          );
          await db.checkout.create({
            data: {
              invoiceId: order.invoiceId,
              gateway: 'stripe',
              externalId: 'cs_second_checkout',
              url: 'https://checkout.stripe.com/second',
            },
          });
          const extra = {
            ...event,
            id: 'evt_second_charge',
            data: {
              object: {
                ...event.data.object,
                id: 'cs_second_checkout',
                payment_intent: 'pi_second_charge',
              },
            },
          };
          const extraPayload = JSON.stringify(extra);
          const extraSignature = Stripe.webhooks.generateTestHeaderString({
            payload: extraPayload,
            secret: 'whsec_testsecret',
          });
          const extraResponse = await fetch(base + '/webhooks/stripe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'stripe-signature': extraSignature },
            body: extraPayload,
          });
          assert.equal(extraResponse.status, 201);
          assert((await extraResponse.json()).reviewRequired);
          assert.equal(await db.payment.count(), 2);
          assert.equal(await db.operation.count(), 1);
          const bad = await fetch(base + '/webhooks/stripe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'stripe-signature': 'bad' },
            body: payload,
          });
          assert.equal(bad.status, 400);
        },
      );
      await t.test(
        'worker provisioning uses the provider and the Wings callback confirms installation',
        async () => {
          const job = await db.operation.findFirst();
          await app.get(Jobs).execute(job.id);
          const service = await db.service.findUnique({ where: { id: order.serviceId } });
          assert.equal(service.status, 'INSTALLING');
          assert(calls.some((c) => c.startsWith('POST /api/servers Bearer daemon-secret-')));
          const remote = base.replace('/api/v1', '/api/remote');
          const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer node-identifier.${'daemon-secret-'.repeat(5)}`,
          };
          const cfg = await fetch(`${remote}/servers/${service.id}`, { headers });
          assert.equal(cfg.status, 200);
          assert.equal((await cfg.json()).settings.uuid, service.id);
          assert.equal(
            (
              await fetch(`${remote}/servers/${service.id}/install`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ successful: true }),
              })
            ).status,
            201,
          );
          assert.equal(
            (await db.service.findUnique({ where: { id: service.id } })).status,
            'ACTIVE',
          );
          assert.equal(
            (await call('/extensions/wings', 'PATCH', { enabled: false }, admin)).status,
            409,
          );
        },
      );
      await t.test(
        'game files stream binary upload/download, authorize before multipart, and validate destructive actions',
        async () => {
          fileMock = true;
          try {
            const endpoint = `${base}/services/${order.serviceId}/files`;
            const binary = Buffer.from([0, 1, 255, 128, 32, 10, 13]);
            const body = () => {
              const form = new FormData();
              form.append('file', new Blob([binary]), 'plugin.jar');
              return form;
            };
            const headers = { Cookie: customer, Origin: 'http://localhost:3000' };
            const unauthorized = await fetch(`${endpoint}/upload?directory=/plugins`, {
              method: 'POST',
              body: body(),
            });
            assert.equal(unauthorized.status, 401);
            await unauthorized.text();
            const foreign = await fetch(`${endpoint}/upload?directory=/plugins`, {
              method: 'POST',
              body: body(),
              headers: { Cookie: other, Origin: 'http://localhost:3000' },
            });
            assert.equal(foreign.status, 404);
            await foreign.text();
            const uploaded = await fetch(`${endpoint}/upload?directory=/plugins`, {
              method: 'POST',
              body: body(),
              headers,
            });
            assert.equal(uploaded.status, 201, await uploaded.clone().text());
            assert((await uploaded.json()).data.uploaded);
            assert.deepEqual(gameFiles.get('/plugins/plugin.jar'), binary);
            const downloaded = await fetch(`${endpoint}/download?path=/plugins/plugin.jar`, {
              headers,
            });
            assert.equal(downloaded.status, 200);
            assert.match(downloaded.headers.get('content-disposition')!, /attachment/);
            assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), binary);
            assert.equal(
              (
                await call(
                  `/services/${order.serviceId}/files/content?path=/plugins/plugin.jar`,
                  'GET',
                  undefined,
                  customer,
                )
              ).status,
              400,
            );
            assert.equal(
              (
                await call(
                  `/services/${order.serviceId}/files/operations`,
                  'POST',
                  { action: 'create-folder', directory: '/', name: 'plugins' },
                  customer,
                )
              ).status,
              201,
            );
            assert.equal(
              (
                await call(
                  `/services/${order.serviceId}/files/operations`,
                  'POST',
                  { action: 'rename', directory: '/plugins', name: 'old.yml', target: 'new.yml' },
                  customer,
                )
              ).status,
              201,
            );
            assert(
              fileOperations.some((o) => o.method === 'PUT' && o.body.files?.[0].to === 'new.yml'),
            );
            assert.equal(
              (
                await call(
                  `/services/${order.serviceId}/files/operations`,
                  'POST',
                  { action: 'delete', directory: '/', files: ['plugins'] },
                  customer,
                )
              ).status,
              400,
            );
            assert.equal(
              (
                await call(
                  `/services/${order.serviceId}/files/operations`,
                  'POST',
                  { action: 'delete', directory: '/', files: ['..'], confirmation: 'DELETE' },
                  customer,
                )
              ).status,
              400,
            );
            assert.equal(
              (
                await call(
                  `/services/${order.serviceId}/files/operations`,
                  'POST',
                  { action: 'delete', directory: '/', files: ['plugins'], confirmation: 'DELETE' },
                  customer,
                )
              ).status,
              201,
            );
            assert.equal(
              (
                await call(
                  `/services/${order.serviceId}/files/operations`,
                  'POST',
                  { action: 'create-folder', directory: '/../', name: 'invalid' },
                  customer,
                )
              ).status,
              400,
            );
            assert.equal(
              (
                await call(
                  `/services/${order.serviceId}/files/operations`,
                  'POST',
                  { action: 'create-file', directory: '/', name: 'new.txt' },
                  customer,
                )
              ).status,
              201,
            );
            assert.equal(gameFiles.get('/new.txt')!.length, 0);
            assert.equal(
              (
                await call(
                  `/services/${order.serviceId}/files/operations`,
                  'POST',
                  { action: 'create-file', directory: '/', name: 'new.txt' },
                  customer,
                )
              ).status,
              400,
            );
            assert.equal(
              (
                await call(
                  `/services/${order.serviceId}/files/operations`,
                  'POST',
                  { action: 'compress', directory: '/', files: ['new.txt'] },
                  customer,
                )
              ).status,
              201,
            );
            assert.equal(
              (
                await call(
                  `/services/${order.serviceId}/files/operations`,
                  'POST',
                  { action: 'decompress', directory: '/', name: 'backup.tar.gz' },
                  customer,
                )
              ).status,
              201,
            );
          } finally {
            fileMock = false;
          }
        },
      );
      await t.test(
        'renewals create one invoice, overdue suspension preserves data, and payment queues unsuspension',
        async () => {
          const due = new Date(Date.now() - 10 * 86400000);
          await db.service.update({ where: { id: order.serviceId }, data: { nextDueAt: due } });
          await app.get(Jobs).maintenance();
          await app.get(Jobs).maintenance();
          assert.equal(await db.invoice.count(), 2);
          const suspend = await db.operation.findFirst({ where: { action: 'suspend' } });
          await app.get(Jobs).execute(suspend.id);
          assert.equal(
            (await db.service.findUnique({ where: { id: order.serviceId } })).status,
            'SUSPENDED',
          );
          assert.equal(await db.resource.count({ where: { serviceId: order.serviceId } }), 1);
          const renewal = await db.invoice.findFirst({ where: { status: 'UNPAID' } });
          const payment = await call(
            `/invoices/${renewal.id}/manual-payment`,
            'POST',
            { reference: 'BANK-RENEWAL-001' },
            admin,
          );
          assert.equal(payment.status, 201, JSON.stringify(payment.body));
          const resume = await db.operation.findFirst({ where: { action: 'unsuspend' } });
          await app.get(Jobs).execute(resume.id);
          assert.equal(
            (await db.service.findUnique({ where: { id: order.serviceId } })).status,
            'ACTIVE',
          );
        },
      );
      await t.test(
        'Redis worker consumes a durable operation and reaches the provider',
        async () => {
          const op = await db.operation.create({
            data: { serviceId: order.serviceId, action: 'restart', idempotencyKey: randomUUID() },
          });
          const worker = spawn(process.execPath, ['apps/api/dist/worker.js'], {
            env: { ...process.env, REDIS_URL: 'redis://127.0.0.1:6379/15' },
            stdio: 'ignore',
          });
          try {
            const deadline = Date.now() + 20000;
            let state;
            while (Date.now() < deadline) {
              state = await db.operation.findUnique({ where: { id: op.id } });
              if (state.status === 'COMPLETE' || state.status === 'FAILED') break;
              await new Promise((r) => setTimeout(r, 200));
            }
            assert.equal(state.status, 'COMPLETE', state.error);
            assert(calls.some((c) => c.includes(`/api/servers/${order.serviceId}/power`)));
          } finally {
            worker.kill('SIGTERM');
            await new Promise<void>((resolve) => {
              worker.once('exit', () => resolve());
              setTimeout(() => {
                worker.kill('SIGKILL');
                resolve();
              }, 5000).unref();
            });
          }
        },
      );
      await t.test(
        'a paid overdue invoice cannot suspend a service when a delayed job executes',
        async () => {
          const job = await db.operation.findFirst({ where: { action: 'suspend' } });
          await db.operation.update({ where: { id: job.id }, data: { status: 'PENDING' } });
          await app.get(Jobs).execute(job.id);
          assert.equal(
            (await db.service.findUnique({ where: { id: order.serviceId } })).status,
            'ACTIVE',
          );
          assert((await db.operation.findUnique({ where: { id: job.id } })).result.skipped);
        },
      );
      await t.test(
        'extensions validate and install packages without automatically executing them',
        async () => {
          const dir = await mkdtemp(join(tmpdir(), 'harbor-package-'));
          try {
            await mkdir(join(dir, 'dist'));
            await writeFile(
              join(dir, 'harbor.json'),
              JSON.stringify({
                id: 'example-plugin',
                name: 'Example',
                version: '1.0.0',
                sdkVersion: '^1.0.0',
                type: 'plugin',
                description: 'Test',
                permissions: [],
                entry: 'dist/index.js',
              }),
            );
            await writeFile(
              join(dir, 'dist/index.js'),
              'module.exports={activate(){throw new Error("must not execute during installation")}}',
            );
            await tar.c({ gzip: true, file: join(dir, 'package.tgz'), cwd: dir }, [
              'harbor.json',
              'dist',
            ]);
            const installed = await app
              .get(Extensions)
              .install(await readFile(join(dir, 'package.tgz')));
            assert.equal(installed.enabled, false);
            assert.equal(
              (await db.extension.findUnique({ where: { id: 'example-plugin' } })).enabled,
              false,
            );
            await assert.rejects(() => app.get(Extensions).install(Buffer.from('not gzip')));
          } finally {
            await rm(dir, { recursive: true, force: true });
          }
        },
      );
      await t.test(
        'demo plans complete checkout without real gateways, real capacity, or revenue',
        async () => {
          const { seedDemoPlans } = await import('../apps/api/dist/demo.js');
          const before = (await call('/dashboard', 'GET', undefined, admin)).body.data;
          const plans = await seedDemoPlans(db);
          const placed = await call(
            '/orders',
            'POST',
            { productId: plans[0].id, idempotencyKey: randomUUID() },
            customer,
          );
          assert.equal(placed.status, 201, JSON.stringify(placed.body));
          const demo = placed.body.data;
          assert.equal(
            (
              await call(
                `/invoices/${demo.invoiceId}/checkout`,
                'POST',
                { gateway: 'stripe' },
                customer,
              )
            ).status,
            400,
          );
          assert.equal(
            (await call(`/invoices/${order.invoiceId}/demo-payment`, 'POST', {}, customer)).status,
            400,
          );
          const completed = await call(
            `/invoices/${demo.invoiceId}/demo-payment`,
            'POST',
            {},
            customer,
          );
          assert.equal(completed.status, 201, JSON.stringify(completed.body));
          const provision = await db.operation.findFirst({
            where: { serviceId: demo.serviceId, action: 'provision' },
          });
          await app.get(Jobs).execute(provision.id);
          const initial = await call(`/services/${demo.serviceId}`, 'GET', undefined, customer);
          assert(initial.body.data.isDemo);
          assert.equal(initial.body.data.status, 'stopped');
          const started = await call(
            `/services/${demo.serviceId}/actions`,
            'POST',
            { action: 'start', idempotencyKey: randomUUID() },
            customer,
          );
          assert.equal(started.status, 201);
          await app.get(Jobs).execute(started.body.data.operationId);
          assert.equal(
            (await call(`/services/${demo.serviceId}`, 'GET', undefined, customer)).body.data
              .status,
            'running',
          );
          const after = (await call('/dashboard', 'GET', undefined, admin)).body.data;
          assert.equal(
            after.metrics.find((m: any) => m.key === 'revenue').value,
            before.metrics.find((m: any) => m.key === 'revenue').value,
          );
          assert.equal(
            after.metrics.find((m: any) => m.key === 'services').value,
            before.metrics.find((m: any) => m.key === 'services').value,
          );
          assert.equal(await db.resource.count({ where: { serviceId: demo.serviceId } }), 0);
          assert.equal(
            (await db.service.findUnique({ where: { id: demo.serviceId } })).nextDueAt,
            null,
          );
          const demoInvoice = await call(`/invoices/${demo.invoiceId}`, 'GET', undefined, customer);
          assert(demoInvoice.body.data.isDemo);
          assert(demoInvoice.body.data.number.startsWith('DEMO-'));
        },
      );
      await t.test(
        'dashboard-only mode disables shopping while existing customers retain service and invoice access',
        async () => {
          assert.equal(
            (await call('/settings', 'PATCH', { storefrontEnabled: false }, admin)).status,
            200,
          );
          assert.equal((await call('/products', 'GET', undefined, customer)).status, 403);
          assert.equal((await call('/services', 'GET', undefined, customer)).status, 200);
          assert.equal((await call('/invoices', 'GET', undefined, customer)).status, 200);
          assert.equal(
            (
              await call('/auth/register', 'POST', {
                name: 'New',
                email: 'new@example.com',
                password: 'new-account-password',
              })
            ).status,
            403,
          );
        },
      );
      await t.test(
        'invoice addresses are snapshots and profile updates cannot alter previous invoices',
        async () => {
          const before = await db.invoice.findUniqueOrThrow({ where: { id: order.invoiceId } });
          assert.equal((before.billingSnapshot as any).buyer.line1, '42 Test Street');
          await call(
            '/profile',
            'PATCH',
            {
              name: 'Customer Updated',
              billingAddress: {
                line1: '99 New Street',
                city: 'New City',
                postalCode: '99999',
                country: 'US',
              },
            },
            customer,
          );
          const after = await db.invoice.findUniqueOrThrow({ where: { id: order.invoiceId } });
          assert.deepEqual(after.billingSnapshot, before.billingSnapshot);
        },
      );
      await t.test(
        'wallet deposits require staff approval and concurrent invoice debits cannot overdraw',
        async () => {
          const me = (await call('/profile', 'GET', undefined, customer)).body.data;
          assert.equal((await call('/admin/wallets', 'GET', undefined, customer)).status, 403);
          const topup = await call(
            '/wallet/topups',
            'POST',
            { amount: 1500, reference: 'bank-transfer-unique' },
            customer,
          );
          assert.equal(topup.status, 201);
          assert.equal((await call('/wallet', 'GET', undefined, customer)).body.data.balance, 0);
          assert.equal(
            (
              await call(
                `/admin/wallets/topups/${topup.body.data.id}/review`,
                'POST',
                { approve: true, note: 'not staff' },
                customer,
              )
            ).status,
            403,
          );
          const approvals = await Promise.all(
            [1, 2].map(() =>
              call(
                `/admin/wallets/topups/${topup.body.data.id}/review`,
                'POST',
                {
                  approve: true,
                  note: 'Bank transfer verified',
                  paymentReference: 'verified-bank-001',
                },
                admin,
              ),
            ),
          );
          assert(approvals.every((r) => r.status === 201));
          assert.equal((await call('/wallet', 'GET', undefined, customer)).body.data.balance, 1500);
          const invoices = await Promise.all(
            [1, 2].map((i) =>
              db.invoice.create({
                data: {
                  userId: me.id,
                  serviceId: order.serviceId,
                  amount: 1000,
                  currency: 'USD',
                  dueAt: new Date(),
                  periodStart: new Date(Date.now() + i * 100000),
                },
              }),
            ),
          );
          assert.equal(
            (await call(`/invoices/${invoices[0].id}/wallet-payment`, 'POST', {}, other)).status,
            404,
          );
          const charges = await Promise.all(
            invoices.map((i) => call(`/invoices/${i.id}/wallet-payment`, 'POST', {}, customer)),
          );
          assert.equal(charges.filter((r) => r.status === 201).length, 1);
          assert.equal(charges.filter((r) => r.status === 409).length, 1);
          const paid = invoices[charges.findIndex((r) => r.status === 201)];
          assert.equal(
            (await call(`/invoices/${paid.id}/wallet-payment`, 'POST', {}, customer)).status,
            201,
          );
          const wallet = (await call('/wallet', 'GET', undefined, customer)).body.data;
          assert.equal(wallet.balance, 500);
          assert.equal(wallet.entries.length, 2);
          assert.equal(await db.payment.count({ where: { gateway: 'wallet' } }), 1);
          const repeatedTransfer = await call(
            '/wallet/topups',
            'POST',
            { amount: 1500, reference: 'claim-the-same-bank-transfer' },
            other,
          );
          assert.equal(
            (
              await call(
                `/admin/wallets/topups/${repeatedTransfer.body.data.id}/review`,
                'POST',
                {
                  approve: true,
                  note: 'Duplicate transaction',
                  paymentReference: 'verified-bank-001',
                },
                admin,
              )
            ).status,
            409,
          );
          const unpaid = invoices[charges.findIndex((r) => r.status === 409)];
          assert.equal(
            (
              await call(
                `/invoices/${unpaid.id}/manual-payment`,
                'POST',
                { reference: 'verified-bank-001' },
                admin,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await call(
                '/wallet/topups',
                'POST',
                { amount: 1, reference: 'below-minimum' },
                customer,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await call(
                '/settings',
                'PATCH',
                {
                  walletSettings: {
                    depositsEnabled: false,
                    minDeposit: 100,
                    maxDeposit: 10000,
                    maxBalance: 20000,
                  },
                },
                admin,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await call(
                '/wallet/topups',
                'POST',
                { amount: 500, reference: 'disabled-deposit' },
                customer,
              )
            ).status,
            409,
          );
          assert.equal(
            (await call(`/admin/wallets/${me.id}`, 'GET', undefined, other)).status,
            403,
          );
          assert.equal(
            (await call(`/admin/wallets/${me.id}`, 'GET', undefined, admin)).body.data.balance,
            500,
          );
          const demo = await db.invoice.findFirstOrThrow({
            where: { service: { provider: 'demo-game' } },
          });
          assert.equal(
            (await call(`/invoices/${demo.id}/wallet-payment`, 'POST', {}, customer)).status,
            400,
          );
        },
      );
      await t.test(
        'Proxmox node settings, locations, IP pools, and placement survive default changes',
        async () => {
          assert.equal((await call('/locations', 'GET', undefined, customer)).status, 403);
          const location = await call(
            '/locations',
            'POST',
            { name: 'Frankfurt', city: 'Frankfurt', country: 'DE' },
            admin,
          );
          assert.equal(location.status, 201);
          const c = await call(
            '/nodes',
            'POST',
            {
              name: 'PVE EU',
              provider: 'proxmox',
              url: 'https://pve.example.test:8006',
              locationId: location.body.data.id,
              secret: { tokenId: 'harbor@pve!panel', tokenSecret: 'test-token-secret' },
              config: { node: 'pve01', storage: 'local-lvm', bridge: 'vmbr0', vlan: 42 },
            },
            admin,
          );
          assert.equal(c.status, 201, JSON.stringify(c.body));
          const id = c.body.data.id;
          const pool = await call(
            `/nodes/${id}/ip-pools`,
            'POST',
            {
              start: '203.0.113.0',
              end: '203.0.113.5',
              prefix: 24,
              gateway: '203.0.113.1',
              pool: 'public-eu',
            },
            admin,
          );
          assert.equal(pool.status, 201);
          assert.equal(pool.body.data.count, 4);
          const resources = (await call(`/nodes/${id}/resources`, 'GET', undefined, admin)).body
            .data;
          assert(
            !resources.some(
              (r: any) => r.value.startsWith('203.0.113.0/') || r.value.startsWith('203.0.113.1/'),
            ),
          );
          const clone = await call(
            `/nodes/${id}/cluster-nodes`,
            'POST',
            {
              name: 'Second node',
              config: { node: 'pve02', storage: 'local-zfs', bridge: 'vmbr0' },
            },
            admin,
          );
          assert.equal(clone.status, 201);
          const duplicate = await call(
            `/nodes/${id}/ip-pools`,
            'POST',
            {
              start: '203.0.113.2',
              end: '203.0.113.5',
              prefix: 25,
              gateway: '203.0.113.1',
              pool: 'other-prefix',
            },
            admin,
          );
          assert.equal(duplicate.body.data.count, 0);
          await db.connection.update({ where: { id }, data: { health: 'ONLINE' } });
          await db.setting.update({
            where: { id: 'installation' },
            data: { storefrontEnabled: true },
          });
          const product = await call(
            '/products',
            'POST',
            {
              name: 'LXC EU',
              description: 'Container fixture',
              category: 'vps',
              provider: 'proxmox',
              connectionId: id,
              price: 500,
              active: true,
              spec: {
                vmType: 'lxc',
                templateId: 'local:vztmpl/debian.tar.zst',
                ipPool: 'public-eu',
              },
            },
            admin,
          );
          assert.equal(product.status, 201, JSON.stringify(product.body));
          const placed = await call(
            '/orders',
            'POST',
            {
              productId: product.body.data.id,
              idempotencyKey: randomUUID(),
              sshKey: 'ssh-ed25519 AAAATEST test',
            },
            customer,
          );
          assert.equal(placed.status, 201, JSON.stringify(placed.body));
          const service = await db.service.findUniqueOrThrow({
            where: { id: placed.body.data.serviceId },
            include: { resource: true },
          });
          assert.equal((service.metadata as any).proxmox.node, 'pve01');
          assert.equal((service.resource!.config as any).pool, 'public-eu');
          assert.equal(
            (
              await call(
                `/nodes/${id}/resources/${service.resource!.id}`,
                'DELETE',
                undefined,
                admin,
              )
            ).status,
            409,
          );
          await call(
            `/nodes/${id}`,
            'PATCH',
            { config: { node: 'new-default', storage: 'other', bridge: 'vmbr2' } },
            admin,
          );
          const { ProxmoxProvider } = await import('../apps/api/dist/providers/proxmox.js');
          const provider = new ProxmoxProvider();
          assert.equal(
            provider.effective(
              {
                id,
                provider: 'proxmox',
                url: 'https://pve.example.test',
                secret: {},
                config: { node: 'new-default' },
              },
              { metadata: service.metadata } as any,
            ).config.node,
            'pve01',
          );
          assert.equal(
            (
              await call(
                `/nodes/${id}/ip-pools`,
                'POST',
                {
                  start: '203.0.113.10',
                  end: '203.0.114.10',
                  prefix: 24,
                  gateway: '203.0.113.1',
                  pool: 'bad',
                },
                admin,
              )
            ).status,
            400,
          );
          assert.equal(
            (await call(`/locations/${location.body.data.id}`, 'DELETE', undefined, admin)).status,
            409,
          );
        },
      );
      await t.test(
        'staff can manage customer profiles, inspect wallets and logins, and securely replace passwords',
        async () => {
          const me = (await call('/profile', 'GET', undefined, customer)).body.data;
          const owner = (await call('/profile', 'GET', undefined, admin)).body.data;
          assert.equal((await call(`/customers/${me.id}`, 'GET', undefined, other)).status, 403);
          assert.equal((await call(`/customers/${me.id}`)).status, 401);
          assert.equal((await call(`/customers/${owner.id}`, 'GET', undefined, admin)).status, 404);
          assert.equal(
            (await call(`/customers/${owner.id}`, 'PATCH', { name: 'Unauthorized target' }, admin))
              .status,
            404,
          );
          assert.equal(
            (await call(`/customers/${me.id}`, 'PATCH', { role: 'ADMIN' }, admin)).status,
            400,
          );
          const snapshot = await db.invoice.findUniqueOrThrow({ where: { id: order.invoiceId } });
          const edited = await call(
            `/customers/${me.id}`,
            'PATCH',
            {
              name: 'Managed Customer',
              email: 'managed@example.com',
              adminNotes: 'Private staff note',
              billingAddress: {
                line1: '7 Managed Road',
                city: 'London',
                postalCode: 'SW1A 1AA',
                country: 'GB',
              },
            },
            admin,
          );
          assert.equal(edited.status, 200, JSON.stringify(edited.body));
          assert.equal(edited.body.data.sessionsRevoked, true);
          assert.equal((await call('/profile', 'GET', undefined, customer)).status, 401);
          assert.deepEqual(
            (await db.invoice.findUniqueOrThrow({ where: { id: order.invoiceId } }))
              .billingSnapshot,
            snapshot.billingSnapshot,
          );
          const login = await call(
            '/auth/login',
            'POST',
            { email: 'managed@example.com', password: 'customer-password' },
            '',
            { 'User-Agent': 'CustomerBrowser/1.0' },
          );
          assert.equal(login.status, 201);
          const session = login.cookie;
          const details = (await call(`/customers/${me.id}`, 'GET', undefined, admin)).body.data;
          assert.equal(details.wallet.balance, 500);
          assert.equal(details.billingAddress.line1, '7 Managed Road');
          assert.equal(details.adminNotes, 'Private staff note');
          assert(details.lastLoginAt);
          assert.equal(details.lastLoginUserAgent, 'CustomerBrowser/1.0');
          assert(details.logins.length > 0);
          assert(details.activeSessions > 0);
          assert(!JSON.stringify(details).includes('passwordHash'));
          assert(!JSON.stringify(details).includes('totpSecret'));
          assert(!(await call('/profile', 'GET', undefined, session)).body.data.adminNotes);
          await db.resetToken.create({
            data: { id: 'a'.repeat(64), userId: me.id, expiresAt: new Date(Date.now() + 60000) },
          });
          assert.equal(
            (
              await call(
                `/customers/${me.id}/password`,
                'POST',
                { password: 'replacement-password', confirmPassword: 'different-password' },
                admin,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await call(
                `/customers/${me.id}/password`,
                'POST',
                { password: 'replacement-password', confirmPassword: 'replacement-password' },
                other,
              )
            ).status,
            403,
          );
          const changed = await call(
            `/customers/${me.id}/password`,
            'POST',
            { password: 'replacement-password', confirmPassword: 'replacement-password' },
            admin,
          );
          assert.equal(changed.status, 201);
          assert.equal((await call('/profile', 'GET', undefined, session)).status, 401);
          assert.equal(await db.resetToken.count({ where: { userId: me.id } }), 0);
          assert.equal(
            (
              await call('/auth/login', 'POST', {
                email: 'managed@example.com',
                password: 'customer-password',
              })
            ).status,
            401,
          );
          const fresh = await call('/auth/login', 'POST', {
            email: 'managed@example.com',
            password: 'replacement-password',
          });
          assert.equal(fresh.status, 201);
          const latest = (await call(`/customers/${me.id}`, 'GET', undefined, admin)).body.data;
          assert(latest.passwordChangedAt);
          assert(latest.activity.some((a: any) => a.action === 'customer.password.changed'));
          const audit = await db.auditLog.findMany({ where: { targetId: me.id } });
          assert(!JSON.stringify(audit).includes('replacement-password'));
          assert.equal(
            (await call(`/customers/${me.id}/revoke-sessions`, 'POST', {}, admin)).status,
            201,
          );
          assert.equal((await call('/profile', 'GET', undefined, fresh.cookie)).status, 401);
        },
      );
      await t.test(
        'regional prices are computed by the server, renew in the contracted currency, and keep wallets isolated',
        async () => {
          const login = await call('/auth/login', 'POST', {
            email: 'managed@example.com',
            password: 'replacement-password',
          });
          const client = login.cookie;
          const user = (await call('/profile', 'GET', undefined, client)).body.data;
          await call(
            '/settings',
            'PATCH',
            {
              regionalPricingEnabled: true,
              walletSettings: {
                depositsEnabled: true,
                minDeposit: 100,
                maxDeposit: 100000,
                maxBalance: 1000000,
              },
            },
            admin,
          );
          const region = await call(
            '/pricing/regions',
            'POST',
            { name: 'United Kingdom', country: 'GB', currency: 'GBP', active: true },
            admin,
          );
          assert.equal(region.status, 201, JSON.stringify(region.body));
          assert.equal((await call('/pricing/regions', 'GET', undefined, client)).status, 403);
          await call(
            '/pricing/prices',
            'POST',
            { regionId: region.body.data.id, productId, amount: 500 },
            admin,
          );
          const quoted = (await call('/products', 'GET', undefined, client)).body.data.find(
            (p: any) => p.id === productId,
          );
          assert.equal(quoted.price, 500);
          assert.equal(quoted.currency, 'GBP');
          assert(quoted.isRegional);
          assert.equal(
            (await call('/products')).body.data.find((p: any) => p.id === productId).currency,
            'USD',
          );
          await call(
            `/nodes/${connectionId}/resources`,
            'POST',
            {
              kind: 'allocation',
              value: '203.0.113.10:25570',
              config: { ip: '203.0.113.10', port: 25570 },
            },
            admin,
          );
          const placed = await call(
            '/orders',
            'POST',
            { productId, idempotencyKey: randomUUID(), price: 1, currency: 'EUR' },
            client,
          );
          assert.equal(placed.status, 201, JSON.stringify(placed.body));
          const initial = await db.invoice.findUniqueOrThrow({
            where: { id: placed.body.data.invoiceId },
          });
          assert.equal(initial.amount, 500);
          assert.equal(initial.currency, 'GBP');
          await call(
            '/pricing/prices',
            'POST',
            { regionId: region.body.data.id, productId, amount: 900 },
            admin,
          );
          await call(
            '/profile',
            'PATCH',
            {
              name: user.name,
              billingAddress: {
                line1: '1 US Street',
                city: 'Boston',
                postalCode: '02108',
                country: 'US',
              },
            },
            client,
          );
          await db.service.update({
            where: { id: placed.body.data.serviceId },
            data: { status: 'ACTIVE', nextDueAt: new Date(Date.now() + 86400000) },
          });
          await app.get(Jobs).maintenance();
          const renewal = await db.invoice.findFirstOrThrow({
            where: { serviceId: placed.body.data.serviceId, id: { not: initial.id } },
          });
          assert.equal(renewal.amount, 500);
          assert.equal(renewal.currency, 'GBP');
          assert.equal(
            (await call('/wallet?currency=GBP', 'GET', undefined, client)).body.data.balance,
            0,
          );
          assert.equal(
            (await call('/wallet?currency=USD', 'GET', undefined, client)).body.data.balance,
            500,
          );
          const topup = await call(
            '/wallet/topups',
            'POST',
            { amount: 500, currency: 'GBP', reference: 'GBP funding' },
            client,
          );
          assert.equal(topup.status, 201, JSON.stringify(topup.body));
          assert.equal(
            (
              await call(
                `/admin/wallets/topups/${topup.body.data.id}/review`,
                'POST',
                {
                  approve: true,
                  note: 'GBP bank transfer verified',
                  paymentReference: 'gbp-bank-transaction-001',
                },
                admin,
              )
            ).status,
            201,
          );
          assert.equal(
            (await call(`/invoices/${renewal.id}/wallet-payment`, 'POST', {}, client)).status,
            201,
          );
          assert.equal(
            (await call('/wallet?currency=GBP', 'GET', undefined, client)).body.data.balance,
            0,
          );
          assert.equal(
            (await call('/wallet?currency=USD', 'GET', undefined, client)).body.data.balance,
            500,
          );
          const dashboard = (await call('/dashboard', 'GET', undefined, admin)).body.data;
          assert.equal(dashboard.currency, 'USD');
          assert.equal(dashboard.currencyTotals.find((t: any) => t.currency === 'GBP').amount, 500);
          assert.equal(
            dashboard.metrics.find((m: any) => m.key === 'revenue').value,
            dashboard.currencyTotals.find((t: any) => t.currency === 'USD').amount,
          );
          await call('/settings', 'PATCH', { regionalPricingEnabled: false }, admin);
          assert.equal(
            (await call('/products', 'GET', undefined, client)).body.data.find(
              (p: any) => p.id === productId,
            ).price,
            1000,
          );
        },
      );
      await t.test(
        'account suspension blocks sessions, new sign-ins, and queued starts without deleting billing data',
        async () => {
          const login = await call('/auth/login', 'POST', {
              email: 'managed@example.com',
              password: 'replacement-password',
            }),
            client = login.cookie;
          const me = (await call('/profile', 'GET', undefined, client)).body.data;
          const invoices = await db.invoice.count({ where: { userId: me.id } });
          assert.equal(
            (
              await call(
                `/customers/${me.id}/suspension`,
                'POST',
                { suspended: true, reason: 'Account review' },
                other,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await call(
                `/customers/${me.id}/suspension`,
                'POST',
                { suspended: true, reason: 'Account review' },
                admin,
              )
            ).status,
            201,
          );
          assert.equal((await call('/profile', 'GET', undefined, client)).status, 401);
          assert.equal(
            (
              await call('/auth/login', 'POST', {
                email: 'managed@example.com',
                password: 'replacement-password',
              })
            ).status,
            403,
          );
          const queued = await db.operation.create({
            data: { serviceId: order.serviceId, action: 'start', idempotencyKey: randomUUID() },
          });
          await app.get(Jobs).execute(queued.id);
          assert.equal(
            (await db.operation.findUniqueOrThrow({ where: { id: queued.id } })).status,
            'FAILED',
          );
          assert.equal(await db.invoice.count({ where: { userId: me.id } }), invoices);
          assert.equal(
            (
              await call(
                `/customers/${me.id}/suspension`,
                'POST',
                { suspended: false, reason: 'Review completed' },
                admin,
              )
            ).status,
            201,
          );
          assert.equal(
            (
              await call('/auth/login', 'POST', {
                email: 'managed@example.com',
                password: 'replacement-password',
              })
            ).status,
            201,
          );
          assert.equal((await call('/profile', 'GET', undefined, client)).status, 401);
        },
      );
      await t.test(
        'real catalog previews cannot accept an order without healthy infrastructure',
        async () => {
          const product = await call(
            '/products',
            'POST',
            {
              name: 'Real Minecraft Draft',
              description: 'Not yet connected',
              category: 'game',
              provider: 'wings',
              price: 999,
              connectionId: null,
              active: false,
              listed: true,
              spec: { memoryMb: 2048, diskMb: 20480, cpu: 1 },
            },
            admin,
          );
          assert.equal(product.status, 201, JSON.stringify(product.body));
          const row = (await call('/products')).body.data.find(
            (p: any) => p.id === product.body.data.id,
          );
          assert.equal(row.available, false);
          assert.equal(row.isDemo, false);
          assert.equal(
            (
              await call(
                '/orders',
                'POST',
                { productId: row.id, idempotencyKey: randomUUID() },
                admin,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await call(
                `/products/${row.id}`,
                'PATCH',
                { ...product.body.data, active: true },
                admin,
              )
            ).status,
            409,
          );
        },
      );
      await t.test(
        'support threads enforce ownership, private notes, attachment downloads, and staff assignment',
        async () => {
          const login = await call('/auth/login', 'POST', {
              email: 'managed@example.com',
              password: 'replacement-password',
            }),
            client = login.cookie;
          const owner = (await call('/profile', 'GET', undefined, admin)).body.data;
          const department = await call(
            '/support/departments',
            'POST',
            { name: 'Game support', notificationEmail: 'support@example.test', active: true },
            admin,
          );
          assert.equal(department.status, 201, JSON.stringify(department.body));
          assert.equal((await call('/support/agents', 'GET', undefined, client)).status, 403);
          assert.equal(
            (await call('/support/departments', 'POST', { name: 'Unauthorized' }, client)).status,
            403,
          );
          assert(
            !JSON.stringify(
              (await call('/support/departments', 'GET', undefined, client)).body,
            ).includes('support@example.test'),
          );
          const created = await call(
            '/tickets',
            'POST',
            {
              subject: 'Minecraft startup issue',
              body: 'My game is not starting',
              departmentId: department.body.data.id,
              serviceId: order.serviceId,
            },
            client,
          );
          assert.equal(created.status, 201, JSON.stringify(created.body));
          const id = created.body.data.id;
          assert.equal((await call(`/tickets/${id}`, 'GET', undefined, other)).status, 404);
          assert.equal(
            (
              await call(
                '/tickets',
                'POST',
                { subject: 'Foreign service', body: 'Not mine', serviceId: order.serviceId },
                other,
              )
            ).status,
            400,
          );
          assert.equal(
            (await call(`/tickets/${id}`, 'PATCH', { assignedToId: owner.id }, client)).status,
            403,
          );
          assert.equal(
            (
              await call(
                `/tickets/${id}`,
                'PATCH',
                { assignedToId: owner.id, priority: 'HIGH' },
                admin,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await call(
                `/tickets/${id}/messages`,
                'POST',
                { body: 'Attempted hidden note', internal: true },
                client,
              )
            ).status,
            403,
          );
          const upload = async (
            cookie: string,
            internal: boolean,
            content: string,
            name: string,
            type = 'text/plain',
          ) => {
            const form = new FormData();
            form.set('body', internal ? 'Private investigation' : 'Attached log file');
            form.set('internal', String(internal));
            form.set('attachment', new Blob([content], { type }), name);
            return fetch(`${base}/tickets/${id}/messages`, {
              method: 'POST',
              headers: { Origin: 'http://localhost:3000', Cookie: cookie },
              body: form,
            });
          };
          assert.equal(
            (await upload(admin, true, 'Private stack trace', 'private.log')).status,
            201,
          );
          const adminView = (await call(`/tickets/${id}`, 'GET', undefined, admin)).body.data;
          const privateFile = adminView.messages.find((m: any) => m.internal).attachment;
          const clientView = (await call(`/tickets/${id}`, 'GET', undefined, client)).body.data;
          assert.equal(clientView.messages.length, 1);
          assert(!JSON.stringify(clientView).includes('Private investigation'));
          assert.equal(
            (
              await fetch(`${base}/support/attachments/${privateFile.id}`, {
                headers: { Cookie: client },
              })
            ).status,
            404,
          );
          assert.equal(
            (await upload(client, false, 'Public server log', '../server.log')).status,
            201,
          );
          const publicView = (await call(`/tickets/${id}`, 'GET', undefined, client)).body.data;
          const publicFile = publicView.messages.find((m: any) => m.attachment).attachment;
          const download = await fetch(`${base}/support/attachments/${publicFile.id}`, {
            headers: { Cookie: client },
          });
          assert.equal(download.status, 200);
          assert.equal(await download.text(), 'Public server log');
          assert.match(download.headers.get('content-disposition') || '', /attachment/);
          assert.equal(
            (
              await fetch(`${base}/support/attachments/${publicFile.id}`, {
                headers: { Cookie: other },
              })
            ).status,
            404,
          );
          assert.equal(
            (await upload(client, false, '<script>alert(1)</script>', 'attack.html', 'text/html'))
              .status,
            400,
          );
          assert.equal(
            (await call(`/tickets/${id}`, 'PATCH', { status: 'CLOSED' }, client)).status,
            200,
          );
          assert.equal(
            (await call(`/tickets/${id}/messages`, 'POST', { body: 'One more question' }, client))
              .status,
            201,
          );
          assert.equal(
            (await call(`/tickets/${id}`, 'GET', undefined, client)).body.data.status,
            'CUSTOMER_REPLY',
          );
          assert.equal(
            (
              await call(
                `/tickets/${id}/messages`,
                'POST',
                { body: 'Please try the repair option' },
                admin,
              )
            ).status,
            201,
          );
          assert.equal(
            (await call(`/tickets/${id}`, 'GET', undefined, client)).body.data.status,
            'ANSWERED',
          );
        },
      );
      await t.test(
        'coupons enforce scope, currencies, last-use concurrency, and free-order settlement',
        async () => {
          const login = await call('/auth/login', 'POST', {
              email: 'managed@example.com',
              password: 'replacement-password',
            }),
            client = login.cookie;
          assert.equal((await call('/coupons', 'GET', undefined, client)).status, 403);
          for (let port = 25580; port < 25587; port++)
            await call(
              `/nodes/${connectionId}/resources`,
              'POST',
              {
                kind: 'allocation',
                value: `203.0.113.10:${port}`,
                config: { ip: '203.0.113.10', port },
              },
              admin,
            );
          const limited = await call(
            '/coupons',
            'POST',
            {
              code: 'last-use',
              type: 'PERCENT',
              value: 5000,
              maxUses: 1,
              perCustomerLimit: 1,
              productIds: [productId],
            },
            admin,
          );
          assert.equal(limited.status, 201, JSON.stringify(limited.body));
          const quote = await call(
            '/orders/quote',
            'POST',
            { productId, couponCode: 'last-use' },
            client,
          );
          assert.equal(quote.status, 201);
          assert.equal(quote.body.data.total, 500);
          assert.equal(quote.body.data.recurringAmount, 1000);
          const concurrent = await Promise.all(
            [client, other].map((cookie) =>
              call(
                '/orders',
                'POST',
                {
                  productId,
                  couponCode: 'LAST-USE',
                  expectedTotal: 500,
                  expectedCurrency: 'USD',
                  idempotencyKey: randomUUID(),
                },
                cookie,
              ),
            ),
          );
          assert.equal(
            concurrent.filter((r) => r.status === 201).length,
            1,
            JSON.stringify(concurrent),
          );
          assert.equal(concurrent.filter((r) => r.status === 409).length, 1);
          assert.equal(
            await db.couponRedemption.count({ where: { couponId: limited.body.data.id } }),
            1,
          );
          const currency = await call(
            '/coupons',
            'POST',
            { code: 'eur-only', type: 'FIXED', value: 100, currency: 'EUR' },
            admin,
          );
          assert.equal(currency.status, 201);
          assert.equal(
            (await call('/orders/quote', 'POST', { productId, couponCode: 'eur-only' }, client))
              .status,
            400,
          );
          await call(
            '/coupons',
            'POST',
            { code: 'expired', type: 'PERCENT', value: 5000, endsAt: '2020-01-01T00:00:00Z' },
            admin,
          );
          assert.equal(
            (await call('/orders/quote', 'POST', { productId, couponCode: 'expired' }, client))
              .status,
            409,
          );
          await call(
            '/coupons',
            'POST',
            { code: 'first-only', type: 'PERCENT', value: 5000, firstPurchaseOnly: true },
            admin,
          );
          assert.equal(
            (await call('/orders/quote', 'POST', { productId, couponCode: 'first-only' }, client))
              .status,
            400,
          );
          const free = await call(
            '/coupons',
            'POST',
            {
              code: 'free-test',
              type: 'PERCENT',
              value: 10000,
              recurring: true,
              productIds: [productId],
            },
            admin,
          );
          assert.equal(free.status, 201);
          const before = (await call('/wallet?currency=USD', 'GET', undefined, client)).body.data
            .balance;
          const input = {
            productId,
            couponCode: 'FREE-TEST',
            expectedTotal: 0,
            expectedCurrency: 'USD',
            idempotencyKey: randomUUID(),
          };
          const placed = await call('/orders', 'POST', input, client);
          assert.equal(placed.status, 201, JSON.stringify(placed.body));
          const invoice = await db.invoice.findUniqueOrThrow({
            where: { id: placed.body.data.invoiceId },
          });
          assert.equal(invoice.amount, 0);
          assert.equal(invoice.status, 'PAID');
          assert.equal(
            (await db.service.findUniqueOrThrow({ where: { id: placed.body.data.serviceId } }))
              .recurringAmount,
            0,
          );
          assert.equal(
            (await call('/wallet?currency=USD', 'GET', undefined, client)).body.data.balance,
            before,
          );
          assert.equal(
            (await call('/orders', 'POST', input, client)).body.data.serviceId,
            placed.body.data.serviceId,
          );
          assert.equal(
            await db.operation.count({
              where: { serviceId: placed.body.data.serviceId, action: 'provision' },
            }),
            1,
          );
          assert.equal(
            (
              await db.couponRedemption.findUniqueOrThrow({
                where: { orderId: placed.body.data.id },
              })
            ).state,
            'REDEEMED',
          );
          assert.equal(
            (await call('/orders', 'POST', { ...input, idempotencyKey: randomUUID() }, client))
              .status,
            409,
          );
          await db.service.update({
            where: { id: placed.body.data.serviceId },
            data: { status: 'ACTIVE', nextDueAt: new Date(Date.now() + 86400000) },
          });
          await app.get(Jobs).maintenance();
          const renewal = await db.invoice.findFirstOrThrow({
            where: { serviceId: placed.body.data.serviceId, id: { not: invoice.id } },
          });
          assert.equal(renewal.amount, 0);
          assert.equal(renewal.status, 'PAID');
          const pending = concurrent.find((r) => r.status === 201)!.body.data;
          await db.invoice.update({
            where: { id: pending.invoiceId },
            data: { dueAt: new Date(Date.now() - 86400000) },
          });
          await app.get(Jobs).maintenance();
          assert.equal(
            (await db.couponRedemption.findUniqueOrThrow({ where: { orderId: pending.id } })).state,
            'RELEASED',
          );
        },
      );
      await t.test(
        'nested categories enforce visibility and stock reservations resist concurrent overselling',
        async () => {
          const client = (
            await call('/auth/login', 'POST', {
              email: 'managed@example.com',
              password: 'replacement-password',
            })
          ).cookie;
          assert(client);
          assert.equal(
            (await call('/catalog/categories', 'POST', { name: 'Denied', slug: 'denied' }, client))
              .status,
            403,
          );
          const parent = await call(
            '/catalog/categories',
            'POST',
            { name: 'Game hosting', slug: 'game-hosting' },
            admin,
          );
          assert.equal(parent.status, 201, JSON.stringify(parent.body));
          const child = await call(
            '/catalog/categories',
            'POST',
            { name: 'Minecraft', slug: 'minecraft', parentId: parent.body.data.id },
            admin,
          );
          assert.equal(child.status, 201);
          assert.equal(
            (
              await call(
                `/catalog/categories/${parent.body.data.id}`,
                'PATCH',
                { name: 'Games', slug: 'game-hosting', parentId: child.body.data.id },
                admin,
              )
            ).status,
            409,
          );
          const original = await db.product.findUniqueOrThrow({ where: { id: productId } });
          const payload = {
            name: 'Limited hosting',
            description: 'Limited capacity',
            category: 'game',
            provider: 'wings',
            price: 500,
            connectionId,
            spec: original.spec,
            active: true,
            listed: true,
            catalogCategoryId: child.body.data.id,
            stock: 2,
            perCustomerLimit: 1,
          };
          const plan = await call('/products', 'POST', payload, admin);
          assert.equal(plan.status, 201, JSON.stringify(plan.body));
          const planId = plan.body.data.id;
          for (let port = 25650; port < 25654; port++)
            await call(
              `/nodes/${connectionId}/resources`,
              'POST',
              {
                kind: 'allocation',
                value: `203.0.113.10:${port}`,
                config: { ip: '203.0.113.10', port },
              },
              admin,
            );
          await call(
            `/catalog/categories/${parent.body.data.id}`,
            'PATCH',
            { name: 'Games', slug: 'game-hosting', active: false },
            admin,
          );
          const publicCategories = (await call('/catalog/categories')).body.data;
          assert(
            !publicCategories.some((c: any) =>
              [parent.body.data.id, child.body.data.id].includes(c.id),
            ),
          );
          assert(!(await call('/products')).body.data.some((p: any) => p.id === planId));
          assert.equal(
            (await call('/orders/quote', 'POST', { productId: planId }, client)).status,
            409,
          );
          assert.equal(
            (
              await call(
                '/orders',
                'POST',
                { productId: planId, idempotencyKey: randomUUID() },
                client,
              )
            ).status,
            409,
          );
          await call(
            `/catalog/categories/${parent.body.data.id}`,
            'PATCH',
            { name: 'Games', slug: 'game-hosting', active: true },
            admin,
          );
          const key = randomUUID();
          const first = await call(
            '/orders',
            'POST',
            { productId: planId, idempotencyKey: key },
            client,
          );
          assert.equal(first.status, 201, JSON.stringify(first.body));
          const repeated = await call(
            '/orders',
            'POST',
            { productId: planId, idempotencyKey: key },
            client,
          );
          assert.equal(repeated.body.data.id, first.body.data.id);
          assert.equal(
            (
              await call(
                '/orders',
                'POST',
                { productId: planId, idempotencyKey: randomUUID() },
                client,
              )
            ).status,
            409,
          );
          let customerPlan = (await call('/products', 'GET', undefined, client)).body.data.find(
            (p: any) => p.id === planId,
          );
          assert.equal(customerPlan.available, false);
          assert.equal(customerPlan.unavailableReason, 'Purchase limit reached');
          await db.invoice.update({
            where: { id: first.body.data.invoiceId },
            data: { dueAt: new Date(Date.now() - 86400000) },
          });
          await app.get(Jobs).maintenance();
          assert.equal(
            (await db.service.findUniqueOrThrow({ where: { id: first.body.data.serviceId } }))
              .status,
            'TERMINATED',
          );
          // A single remaining slot with multiple competing order requests must only create one order.
          assert.equal(
            (
              await call(
                `/products/${planId}`,
                'PATCH',
                { ...payload, stock: 1, perCustomerLimit: null },
                admin,
              )
            ).status,
            200,
          );
          const orders = await Promise.all(
            [1, 2, 3].map(() =>
              call('/orders', 'POST', { productId: planId, idempotencyKey: randomUUID() }, client),
            ),
          );
          assert.equal(orders.filter((r) => r.status === 201).length, 1, JSON.stringify(orders));
          assert.equal(orders.filter((r) => r.status === 409).length, 2);
          assert.equal(
            await db.service.count({ where: { productId: planId, status: { not: 'TERMINATED' } } }),
            1,
          );
          customerPlan = (await call('/products', 'GET', undefined, client)).body.data.find(
            (p: any) => p.id === planId,
          );
          assert.equal(customerPlan.stockRemaining, 0);
          assert.equal(customerPlan.unavailableReason, 'Sold out');
          assert.equal(
            (await call('/orders/quote', 'POST', { productId: planId }, client)).status,
            409,
          );
          assert.equal(
            (await call(`/products/${planId}`, 'PATCH', { ...payload, stock: -1 }, admin)).status,
            400,
          );
        },
      );
      await t.test(
        'tax rates follow billing country, apply after discounts, and preserve issued invoices',
        async () => {
          const client = (
            await call('/auth/login', 'POST', {
              email: 'managed@example.com',
              password: 'replacement-password',
            })
          ).cookie;
          const me = (await call('/profile', 'GET', undefined, client)).body.data;
          await call(
            `/customers/${me.id}`,
            'PATCH',
            { billingAddress: { ...me.billingAddress, country: 'GB' } },
            admin,
          );
          assert.equal((await call('/tax-rates', 'GET', undefined, client)).status, 403);
          assert.equal(
            (
              await call(
                '/tax-rates',
                'POST',
                { name: 'Denied', country: 'GB', basisPoints: 2000 },
                client,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await call(
                '/profile',
                'PATCH',
                { name: me.name, billingAddress: me.billingAddress, taxExempt: true },
                client,
              )
            ).status,
            400,
          );
          await call(
            '/settings',
            'PATCH',
            { regionalPricingEnabled: false, taxEnabled: true, taxInclusive: false },
            admin,
          );
          const fallback = await call(
            '/tax-rates',
            'POST',
            { name: 'Fallback tax', country: '*', basisPoints: 1000 },
            admin,
          );
          assert.equal(fallback.status, 201);
          const rate = await call(
            '/tax-rates',
            'POST',
            { name: 'VAT', country: 'GB', basisPoints: 2000 },
            admin,
          );
          assert.equal(rate.status, 201);
          const original = await db.product.findUniqueOrThrow({ where: { id: productId } });
          const payload = {
            name: 'Taxable Minecraft',
            description: 'Tax calculation fixture',
            category: 'game',
            provider: 'wings',
            price: 1001,
            connectionId,
            spec: original.spec,
            active: true,
            taxable: true,
          };
          const plan = await call('/products', 'POST', payload, admin),
            id = plan.body.data.id;
          assert.equal(plan.status, 201);
          for (let port = 25660; port < 25665; port++)
            await call(
              `/nodes/${connectionId}/resources`,
              'POST',
              {
                kind: 'allocation',
                value: `203.0.113.10:${port}`,
                config: { ip: '203.0.113.10', port },
              },
              admin,
            );
          assert.equal(
            (
              await call(
                '/coupons',
                'POST',
                {
                  code: 'TAX-HALF',
                  type: 'PERCENT',
                  value: 5000,
                  perCustomerLimit: 10,
                  productIds: [id],
                },
                admin,
              )
            ).status,
            201,
          );
          const quote = async (couponCode?: string) =>
            (await call('/orders/quote', 'POST', { productId: id, couponCode }, client)).body.data;
          const firstQuote = await quote('TAX-HALF');
          assert.equal(firstQuote.subtotal, 1001);
          assert.equal(firstQuote.discount, 501);
          assert.equal(firstQuote.tax.amount, 100);
          assert.equal(firstQuote.total, 600);
          assert.equal(firstQuote.recurringAmount, 1201);
          assert.equal(
            (
              await call(
                '/orders',
                'POST',
                {
                  productId: id,
                  couponCode: 'TAX-HALF',
                  expectedTotal: 500,
                  expectedCurrency: 'USD',
                  idempotencyKey: randomUUID(),
                },
                client,
              )
            ).status,
            409,
          );
          const order = await call(
            '/orders',
            'POST',
            {
              productId: id,
              couponCode: 'TAX-HALF',
              expectedTotal: 600,
              expectedCurrency: 'USD',
              idempotencyKey: randomUUID(),
            },
            client,
          );
          assert.equal(order.status, 201, JSON.stringify(order.body));
          const first = await db.invoice.findUniqueOrThrow({
            where: { id: order.body.data.invoiceId },
          });
          assert.equal(first.amount, 600);
          assert.equal((first.billingSnapshot as any).pricing.tax.basisPoints, 2000);
          assert.equal(
            (await db.service.findUniqueOrThrow({ where: { id: order.body.data.serviceId } }))
              .recurringAmount,
            1001,
          );
          // Changing policy affects new contracts; the original service still adds exclusive tax.
          await call('/settings', 'PATCH', { taxInclusive: true }, admin);
          assert.equal((await quote()).total, 1001);
          assert.equal((await quote()).tax.amount, 167);
          await call(
            `/tax-rates/${rate.body.data.id}`,
            'PATCH',
            { name: 'Updated VAT', country: 'GB', basisPoints: 2500 },
            admin,
          );
          assert.equal((await quote()).tax.amount, 200);
          await db.service.update({
            where: { id: order.body.data.serviceId },
            data: { status: 'ACTIVE', nextDueAt: new Date(Date.now() + 2 * 86400000) },
          });
          await app.get(Jobs).maintenance();
          const renewal = await db.invoice.findFirstOrThrow({
            where: { serviceId: order.body.data.serviceId, id: { not: first.id } },
          });
          assert.equal(renewal.amount, 1251);
          assert.equal((renewal.billingSnapshot as any).pricing.tax.inclusive, false);
          assert.deepEqual(
            (await db.invoice.findUniqueOrThrow({ where: { id: first.id } })).billingSnapshot,
            first.billingSnapshot,
          );
          const inclusiveOrder = await call(
            '/orders',
            'POST',
            { productId: id, idempotencyKey: randomUUID(), expectedTotal: 1001 },
            client,
          );
          assert.equal(inclusiveOrder.status, 201);
          const inclusiveService = await db.service.findUniqueOrThrow({
            where: { id: inclusiveOrder.body.data.serviceId },
          });
          assert.equal((inclusiveService.metadata as any).taxPolicy.inclusive, true);
          await call(`/customers/${me.id}`, 'PATCH', { taxExempt: true }, admin);
          assert.equal((await quote()).tax.amount, 0);
          assert.equal((await quote()).total, 1001);
          await call(
            `/customers/${me.id}`,
            'PATCH',
            { taxExempt: false, billingAddress: { ...me.billingAddress, country: 'US' } },
            admin,
          );
          assert.equal((await quote()).tax.basisPoints, 1000);
          await call(`/products/${id}`, 'PATCH', { ...payload, taxable: false }, admin);
          assert.equal((await quote()).tax.amount, 0);
          await call('/settings', 'PATCH', { taxEnabled: false }, admin);
          assert.equal((await quote()).tax.amount, 0);
          assert.equal(
            (
              await call(
                `/tax-rates/${rate.body.data.id}`,
                'PATCH',
                { name: 'Invalid', country: 'GB', basisPoints: 10001 },
                admin,
              )
            ).status,
            400,
          );
        },
      );
      await t.test(
        'cancellation review, term cutoffs, withdrawal, and renewal races preserve billing',
        async () => {
          const client = (
            await call('/auth/login', 'POST', {
              email: 'managed@example.com',
              password: 'replacement-password',
            })
          ).cookie;
          assert(client);
          const original = await db.product.findUniqueOrThrow({ where: { id: productId } });
          const plan = await call(
            '/products',
            'POST',
            {
              name: 'Cancellation fixture',
              description: 'Cancellation contract test',
              category: 'game',
              provider: 'wings',
              price: 1000,
              connectionId,
              active: true,
              spec: original.spec,
            },
            admin,
          );
          assert.equal(plan.status, 201, JSON.stringify(plan.body));
          const planId = plan.body.data.id;
          for (let port = 25670; port < 25680; port++)
            await call(
              `/nodes/${connectionId}/resources`,
              'POST',
              {
                kind: 'allocation',
                value: `203.0.113.10:${port}`,
                config: { ip: '203.0.113.10', port },
              },
              admin,
            );
          const activeOrder = async () => {
            const order = await call(
              '/orders',
              'POST',
              { productId: planId, idempotencyKey: randomUUID() },
              client,
            );
            assert.equal(order.status, 201, JSON.stringify(order.body));
            await app.get(Payments).settle({
              gateway: 'manual',
              eventId: randomUUID(),
              paymentId: randomUUID(),
              invoiceId: order.body.data.invoiceId,
              amount: 1000,
              currency: 'USD',
            });
            // Simulate completed installation on the HTTP fixture; no real server is contacted.
            await db.operation.updateMany({
              where: { serviceId: order.body.data.serviceId },
              data: { status: 'COMPLETE' },
            });
            const service = await db.service.update({
              where: { id: order.body.data.serviceId },
              data: {
                status: 'ACTIVE',
                externalId: order.body.data.serviceId,
                nextDueAt: new Date(Date.now() + 2 * 86400000),
              },
            });
            return { ...order.body.data, service };
          };
          const order = await activeOrder(),
            id = order.service.id;
          const jobs = app.get(Jobs);
          await jobs.maintenance();
          const renewal = await db.invoice.findUniqueOrThrow({
            where: {
              serviceId_periodStart: { serviceId: id, periodStart: order.service.nextDueAt! },
            },
          });
          const paid = await db.invoice.findUniqueOrThrow({ where: { id: order.invoiceId } });
          const manualVoid = await db.invoice.create({
            data: {
              serviceId: id,
              userId: paid.userId,
              amount: 1000,
              currency: 'USD',
              status: 'VOID',
              dueAt: new Date(Date.now() + 3 * 86400000),
              periodStart: new Date(Date.now() + 3 * 86400000),
            },
          });
          assert.equal(
            (
              await call(
                `/services/${id}/cancellations`,
                'POST',
                {
                  mode: 'END_OF_TERM',
                  reason: 'No longer needed',
                  confirmation: order.service.name,
                },
                other,
              )
            ).status,
            404,
          );
          const request = await call(
            `/services/${id}/cancellations`,
            'POST',
            { mode: 'END_OF_TERM', reason: 'No longer needed', confirmation: order.service.name },
            client,
          );
          assert.equal(request.status, 201);
          const cancellationId = request.body.data.id;
          assert.equal(
            (await call('/cancellations', 'GET', undefined, other)).body.data.some(
              (c: any) => c.id === cancellationId,
            ),
            false,
          );
          assert.equal(
            (
              await call(
                `/cancellations/${cancellationId}/review`,
                'POST',
                { decision: 'APPROVE', note: 'Approved request', confirmation: order.service.name },
                client,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await call(
                `/cancellations/${cancellationId}/review`,
                'POST',
                { decision: 'APPROVE', note: 'Approved request', confirmation: 'wrong' },
                admin,
              )
            ).status,
            400,
          );
          const running = await db.operation.create({
            data: {
              serviceId: id,
              action: 'start',
              status: 'RUNNING',
              leaseUntil: new Date(Date.now() + 60000),
              idempotencyKey: randomUUID(),
            },
          });
          assert.equal(
            (
              await call(
                `/cancellations/${cancellationId}/review`,
                'POST',
                { decision: 'APPROVE', note: 'Approved request', confirmation: order.service.name },
                admin,
              )
            ).status,
            409,
          );
          await db.operation.update({ where: { id: running.id }, data: { status: 'COMPLETE' } });
          const approved = await call(
            `/cancellations/${cancellationId}/review`,
            'POST',
            { decision: 'APPROVE', note: 'Approved request', confirmation: order.service.name },
            admin,
          );
          assert.equal(approved.status, 201, JSON.stringify(approved.body));
          assert.equal(approved.body.data.status, 'APPROVED');
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: renewal.id } })).status,
            'VOID',
          );
          assert.equal(
            (await call(`/invoices/${renewal.id}/checkout`, 'POST', { gateway: 'manual' }, client))
              .status,
            409,
          );
          const balanceBefore = await db.wallet.findMany({ where: { userId: paid.userId } });
          assert.equal(
            (await call(`/invoices/${renewal.id}/wallet-payment`, 'POST', {}, client)).status,
            409,
          );
          assert.deepEqual(
            await db.wallet.findMany({ where: { userId: paid.userId } }),
            balanceBefore,
          );
          await jobs.maintenance();
          assert.equal(await db.invoice.count({ where: { serviceId: id } }), 3);
          assert.equal(
            (await call(`/cancellations/${cancellationId}/withdraw`, 'POST', {}, other)).status,
            404,
          );
          assert.equal(
            (await call(`/cancellations/${cancellationId}/withdraw`, 'POST', {}, client)).status,
            201,
          );
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: renewal.id } })).status,
            'UNPAID',
          );
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: manualVoid.id } })).status,
            'VOID',
          );
          assert.equal((await db.service.findUniqueOrThrow({ where: { id } })).cancelAt, null);
          const rejected = await call(
            `/services/${id}/cancellations`,
            'POST',
            {
              mode: 'END_OF_TERM',
              reason: 'Changed requirements',
              confirmation: order.service.name,
            },
            client,
          );
          assert.equal(
            (
              await call(
                `/cancellations/${rejected.body.data.id}/review`,
                'POST',
                { decision: 'REJECT', note: 'Customer wishes to retain service' },
                admin,
              )
            ).status,
            201,
          );
          assert.equal((await db.service.findUniqueOrThrow({ where: { id } })).cancelAt, null);
          // Race renewal issuance with approval. Either ordering must leave the renewal void or absent.
          const race = await activeOrder();
          const raceRequest = await call(
            `/services/${race.serviceId}/cancellations`,
            'POST',
            { mode: 'END_OF_TERM', reason: 'End of term please', confirmation: race.service.name },
            client,
          );
          const settings = await db.setting.findUniqueOrThrow({ where: { id: 'installation' } });
          const results = await Promise.all([
            jobs.renewalInvoice(race.serviceId, race.service.nextDueAt!, settings),
            call(
              `/cancellations/${raceRequest.body.data.id}/review`,
              'POST',
              {
                decision: 'APPROVE',
                note: 'Approved end of term',
                confirmation: race.service.name,
              },
              admin,
            ),
          ]);
          assert.equal((results[1] as any).status, 201);
          assert.equal(
            await db.invoice.count({
              where: {
                serviceId: race.serviceId,
                status: 'UNPAID',
                periodStart: { gte: race.service.nextDueAt! },
              },
            }),
            0,
          );
          // Move the fixture clock past the cutoff; repeated scans queue exactly one termination.
          await db.service.update({
            where: { id: race.serviceId },
            data: { cancelAt: new Date(Date.now() - 1000) },
          });
          await db.serviceCancellation.update({
            where: { id: raceRequest.body.data.id },
            data: { effectiveAt: new Date(Date.now() - 1000) },
          });
          await Promise.all([jobs.maintenance(), jobs.maintenance()]);
          const terminalRequest = await db.serviceCancellation.findUniqueOrThrow({
            where: { id: raceRequest.body.data.id },
          });
          assert.equal(terminalRequest.status, 'PROCESSING');
          assert.equal(
            await db.operation.count({
              where: { idempotencyKey: `cancellation-${terminalRequest.id}` },
            }),
            1,
          );
          const staleStart = await db.operation.create({
            data: { serviceId: race.serviceId, action: 'start', idempotencyKey: randomUUID() },
          });
          const providerCalls = calls.length;
          await jobs.execute(staleStart.id);
          assert.equal(calls.length, providerCalls);
          await jobs.execute(terminalRequest.operationId!);
          assert.equal(
            (await db.service.findUniqueOrThrow({ where: { id: race.serviceId } })).status,
            'TERMINATED',
          );
          assert.equal(await db.resource.count({ where: { serviceId: race.serviceId } }), 0);
          assert.equal(
            (await db.serviceCancellation.findUniqueOrThrow({ where: { id: terminalRequest.id } }))
              .status,
            'COMPLETE',
          );
          assert.deepEqual(await db.invoice.findUniqueOrThrow({ where: { id: paid.id } }), paid);
        },
      );
      await t.test(
        'unprovisioned cancellation, late payments, and failed provider deletion require safe reconciliation',
        async () => {
          const client = (
            await call('/auth/login', 'POST', {
              email: 'managed@example.com',
              password: 'replacement-password',
            })
          ).cookie;
          const plan = await db.product.findFirstOrThrow({
            where: { name: 'Cancellation fixture' },
          });
          const order = await call(
            '/orders',
            'POST',
            { productId: plan.id, idempotencyKey: randomUUID() },
            client,
          );
          assert.equal(order.status, 201);
          const service = await db.service.findUniqueOrThrow({
            where: { id: order.body.data.serviceId },
          });
          const requests = await Promise.all(
            [1, 2].map(() =>
              call(
                `/services/${service.id}/cancellations`,
                'POST',
                { mode: 'IMMEDIATE', reason: 'Ordered by mistake', confirmation: service.name },
                client,
              ),
            ),
          );
          assert.equal(requests.filter((r) => r.status === 201).length, 1);
          assert.equal(requests.filter((r) => r.status === 409).length, 1);
          const request = requests.find((r) => r.status === 201)!.body.data;
          const approved = await call(
            `/cancellations/${request.id}/review`,
            'POST',
            {
              decision: 'APPROVE',
              note: 'Unprovisioned order cancelled',
              confirmation: service.name,
            },
            admin,
          );
          assert.equal(approved.status, 201);
          assert.equal(approved.body.data.status, 'COMPLETE');
          assert.equal(
            (await db.service.findUniqueOrThrow({ where: { id: service.id } })).status,
            'TERMINATED',
          );
          assert.equal(await db.resource.count({ where: { serviceId: service.id } }), 0);
          const invoice = await db.invoice.findUniqueOrThrow({
            where: { id: order.body.data.invoiceId },
          });
          const receipt = {
            gateway: 'manual',
            eventId: randomUUID(),
            paymentId: randomUUID(),
            invoiceId: invoice.id,
            amount: invoice.amount,
            currency: invoice.currency,
          };
          assert.equal((await app.get(Payments).settle(receipt)).reviewRequired, true);
          assert.equal((await app.get(Payments).settle(receipt)).duplicate, true);
          assert.equal(await db.payment.count({ where: { invoiceId: invoice.id } }), 1);
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
            'VOID',
          );
          assert.equal(await db.operation.count({ where: { serviceId: service.id } }), 0);
          assert.equal((await call('/payments/review', 'GET', undefined, client)).status, 403);
          const payment = (await call('/payments/review', 'GET', undefined, admin)).body.data.find(
            (p: any) => p.invoiceId === invoice.id,
          );
          assert(payment.reviewRequired);
          assert.equal(
            (
              await call(
                `/payments/${payment.id}/review`,
                'POST',
                { resolution: 'Refund verified externally reference bank-test-001' },
                client,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await call(
                `/payments/${payment.id}/review`,
                'POST',
                { resolution: 'Refund verified externally reference bank-test-001' },
                admin,
              )
            ).status,
            201,
          );
          assert.equal(
            (
              await call(
                `/payments/${payment.id}/review`,
                'POST',
                { resolution: 'Duplicate review must be rejected' },
                admin,
              )
            ).status,
            409,
          );
          const customerInvoice = (
            await call('/invoices', 'GET', undefined, client)
          ).body.data.find((i: any) => i.id === invoice.id);
          assert.equal(customerInvoice.payments[0].reviewResolution, undefined);
          assert.equal(customerInvoice.payments[0].reviewedById, undefined);
          assert.equal(customerInvoice.canPay, false);
          const paidOrder = await call(
            '/orders',
            'POST',
            { productId: plan.id, idempotencyKey: randomUUID() },
            client,
          );
          const paidService = await db.service.findUniqueOrThrow({
            where: { id: paidOrder.body.data.serviceId },
          });
          await app.get(Payments).settle({
            gateway: 'manual',
            eventId: randomUUID(),
            paymentId: randomUUID(),
            invoiceId: paidOrder.body.data.invoiceId,
            amount: 1000,
            currency: 'USD',
          });
          await db.operation.updateMany({
            where: { serviceId: paidService.id },
            data: { status: 'COMPLETE' },
          });
          await db.service.update({
            where: { id: paidService.id },
            data: { status: 'ACTIVE', externalId: paidService.id },
          });
          const immediate = await call(
            `/services/${paidService.id}/cancellations`,
            'POST',
            { mode: 'IMMEDIATE', reason: 'Delete the fixture', confirmation: paidService.name },
            client,
          );
          const removal = await call(
            `/cancellations/${immediate.body.data.id}/review`,
            'POST',
            {
              decision: 'APPROVE',
              note: 'Confirmed deletion request',
              confirmation: paidService.name,
            },
            admin,
          );
          assert.equal(removal.body.data.status, 'PROCESSING');
          failNextTermination = true;
          await app.get(Jobs).execute(removal.body.data.operationId);
          assert.equal(
            (
              await db.serviceCancellation.findUniqueOrThrow({
                where: { id: immediate.body.data.id },
              })
            ).status,
            'FAILED',
          );
          assert.equal(await db.resource.count({ where: { serviceId: paidService.id } }), 1);
          assert.equal(
            (await call(`/services/${paidService.id}/actions`, 'POST', { action: 'start' }, client))
              .status,
            409,
          );
          assert.equal(
            (await call(`/cancellations/${immediate.body.data.id}/withdraw`, 'POST', {}, client))
              .status,
            409,
          );
          assert.equal(
            (await call(`/operations/${removal.body.data.operationId}/retry`, 'POST', {}, admin))
              .status,
            201,
          );
          await app.get(Jobs).execute(removal.body.data.operationId);
          assert.equal(
            (
              await db.serviceCancellation.findUniqueOrThrow({
                where: { id: immediate.body.data.id },
              })
            ).status,
            'COMPLETE',
          );
          assert.equal(
            (await db.service.findUniqueOrThrow({ where: { id: paidService.id } })).status,
            'TERMINATED',
          );
          assert.equal(await db.resource.count({ where: { serviceId: paidService.id } }), 0);
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: paidOrder.body.data.invoiceId } }))
              .status,
            'PAID',
          );
        },
      );
      await t.test(
        'billing variants, setup fees, options, and regional offers produce immutable contracts',
        async () => {
          const client = (
            await call('/auth/login', 'POST', {
              email: 'managed@example.com',
              password: 'replacement-password',
            })
          ).cookie;
          const me = (await call('/profile', 'GET', undefined, client)).body.data;
          await call(
            '/settings',
            'PATCH',
            { regionalPricingEnabled: false, taxEnabled: true, taxInclusive: false },
            admin,
          );
          await call(
            `/customers/${me.id}`,
            'PATCH',
            { taxExempt: false, billingAddress: { ...me.billingAddress, country: 'US' } },
            admin,
          );
          const original = await db.product.findUniqueOrThrow({ where: { id: productId } });
          const plan = await call(
            '/products',
            'POST',
            {
              name: 'Configurable Minecraft',
              description: 'Term and resource fixture',
              category: 'game',
              provider: 'wings',
              price: 1000,
              setupFee: 200,
              connectionId,
              active: true,
              spec: { ...original.spec, memoryMb: 2048, cpu: 1 },
            },
            admin,
          );
          assert.equal(plan.status, 201, JSON.stringify(plan.body));
          const id = plan.body.data.id;
          for (let port = 25710; port < 25720; port++)
            await call(
              `/nodes/${connectionId}/resources`,
              'POST',
              {
                kind: 'allocation',
                value: `203.0.113.10:${port}`,
                config: { ip: '203.0.113.10', port },
              },
              admin,
            );
          const region = await db.pricingRegion.findUniqueOrThrow({ where: { country: 'GB' } }),
            quarterId = randomUUID(),
            onceId = randomUUID(),
            freeId = randomUUID(),
            ramId = randomUUID(),
            cpuId = randomUUID(),
            textId = randomUUID();
          const config = {
            plans: [
              {
                id: quarterId,
                name: 'Quarterly',
                type: 'RECURRING',
                unit: 'MONTH',
                period: 3,
                amount: 2500,
                setupFee: 400,
                regionalPrices: [{ regionId: region.id, amount: 3000, setupFee: 500 }],
              },
              {
                id: onceId,
                name: 'Lifetime license',
                type: 'ONE_TIME',
                amount: 5000,
                setupFee: 100,
              },
              { id: freeId, name: 'Free community plan', type: 'FREE', amount: 0, setupFee: 0 },
            ],
            options: [
              {
                id: ramId,
                key: 'extra_ram',
                name: 'Extra memory',
                kind: 'SELECT',
                required: true,
                binding: 'memoryMb',
                choices: [
                  {
                    id: 'extra-2gb',
                    name: 'Extra 2 GB',
                    value: '2048',
                    prices: [
                      { planId: null, currency: 'USD', amount: 300, setupFee: 100 },
                      { planId: quarterId, currency: 'USD', amount: 700, setupFee: 150 },
                      { planId: quarterId, currency: 'GBP', amount: 500, setupFee: 50 },
                      { planId: onceId, currency: 'USD', amount: 500, setupFee: 100 },
                      { planId: freeId, currency: 'USD', amount: 0, setupFee: 0 },
                    ],
                  },
                ],
              },
              {
                id: cpuId,
                key: 'extra_cpu',
                name: 'Extra CPU',
                kind: 'QUANTITY',
                binding: 'cpu',
                min: 0,
                max: 10,
                step: 2,
                prices: [
                  { planId: null, currency: 'USD', amount: 100, setupFee: 20 },
                  { planId: quarterId, currency: 'GBP', amount: 150, setupFee: 10 },
                ],
              },
              {
                id: textId,
                key: 'world_name',
                name: 'World name',
                kind: 'TEXT',
                required: true,
                validation: 'slug',
                maxLength: 30,
              },
            ],
          };
          assert.equal(
            (await call(`/products/${id}/configuration`, 'GET', undefined, client)).status,
            403,
          );
          const saved = await call(
            `/products/${id}/configuration`,
            'PATCH',
            { ...config, expectedVersion: 0 },
            admin,
          );
          assert.equal(saved.status, 200, JSON.stringify(saved.body));
          assert.equal(
            (
              await call(
                `/products/${id}/configuration`,
                'PATCH',
                { ...config, expectedVersion: 0 },
                admin,
              )
            ).status,
            409,
          );
          assert.equal(
            (await call('/orders/quote', 'POST', { productId: id }, client)).status,
            400,
          );
          const chosen = { [ramId]: 'extra-2gb', [cpuId]: 2, [textId]: 'my-world' };
          assert.equal(
            (
              await call(
                '/orders/quote',
                'POST',
                { productId: id, options: { ...chosen, [randomUUID()]: 1 } },
                client,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await call(
                '/orders/quote',
                'POST',
                { productId: id, options: { ...chosen, [cpuId]: 3 } },
                client,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await call(
                '/orders/quote',
                'POST',
                { productId: id, options: { ...chosen, [textId]: '../../bad' } },
                client,
              )
            ).status,
            400,
          );
          const coupon = await call(
            '/coupons',
            'POST',
            {
              code: 'CONFIG-HALF',
              type: 'PERCENT',
              value: 5000,
              recurring: true,
              productIds: [id],
            },
            admin,
          );
          assert.equal(coupon.status, 201);
          const getQuote = async (extra: any = {}) =>
            await call(
              '/orders/quote',
              'POST',
              { productId: id, options: chosen, couponCode: 'CONFIG-HALF', ...extra },
              client,
            );
          const quoted = await getQuote(),
            quote = quoted.body.data;
          assert.equal(quoted.status, 201, JSON.stringify(quoted.body));
          assert.equal(quote.subtotal, 1840);
          assert.equal(quote.setupFee, 340);
          assert.equal(quote.discount, 750);
          assert.equal(quote.tax.amount, 109);
          assert.equal(quote.total, 1199);
          assert.equal(quote.recurringAmount, 825);
          assert.equal(quote.spec.memoryMb, 4096);
          assert.equal(quote.spec.cpu, 3);
          const changed = structuredClone(saved.body.data);
          changed.options[0].choices[0].value = '4096';
          const update = await call(
            `/products/${id}/configuration`,
            'PATCH',
            { plans: changed.plans, options: changed.options, expectedVersion: 1 },
            admin,
          );
          assert.equal(update.status, 200);
          const key = randomUUID();
          assert.equal(
            (
              await call(
                '/orders',
                'POST',
                {
                  productId: id,
                  options: chosen,
                  couponCode: 'CONFIG-HALF',
                  expectedQuoteId: quote.quoteId,
                  idempotencyKey: key,
                },
                client,
              )
            ).status,
            409,
          );
          const adminCatalog = (await call('/catalog/products', 'GET', undefined, admin)).body.data;
          assert(
            !adminCatalog.some((p: any) => !p.active && !p.listed),
            'Staff storefront must hide drafts just like the customer catalog',
          );
          const current = (await getQuote()).body.data;
          assert.equal(current.spec.memoryMb, 6144);
          const placed = await call(
            '/orders',
            'POST',
            {
              productId: id,
              options: chosen,
              couponCode: 'CONFIG-HALF',
              expectedQuoteId: current.quoteId,
              expectedTotal: 1199,
              expectedCurrency: 'USD',
              idempotencyKey: key,
            },
            client,
          );
          assert.equal(placed.status, 201, JSON.stringify(placed.body));
          const service = await db.service.findUniqueOrThrow({
              where: { id: placed.body.data.serviceId },
            }),
            invoice = await db.invoice.findUniqueOrThrow({
              where: { id: placed.body.data.invoiceId },
            });
          assert.equal((invoice.billingSnapshot as any).pricing.subtotal, 1840);
          assert.equal(
            (invoice.billingSnapshot as any).pricing.lines.reduce(
              (sum: number, line: any) => sum + line.amount,
              0,
            ),
            1840,
          );
          assert.equal((service.spec as any).memoryMb, 6144);
          assert.equal(service.recurringAmount, 750);
          assert.equal(
            (service.metadata as any).configuration.find((o: any) => o.key === 'world_name').value,
            'my-world',
          );
          await app.get(Payments).settle({
            gateway: 'manual',
            eventId: randomUUID(),
            paymentId: randomUUID(),
            invoiceId: invoice.id,
            amount: 1199,
            currency: 'USD',
          });
          await db.operation.updateMany({
            where: { serviceId: service.id },
            data: { status: 'COMPLETE' },
          });
          await db.service.update({
            where: { id: service.id },
            data: {
              status: 'ACTIVE',
              externalId: service.id,
              nextDueAt: new Date(Date.now() + 2 * 86400000),
            },
          });
          changed.options[0].choices[0].value = '2048';
          changed.options[0].choices[0].prices[0].amount = 900;
          assert.equal(
            (
              await call(
                `/products/${id}/configuration`,
                'PATCH',
                { plans: changed.plans, options: changed.options, expectedVersion: 2 },
                admin,
              )
            ).status,
            200,
          );
          await app.get(Jobs).maintenance();
          const renewal = await db.invoice.findFirstOrThrow({
            where: { serviceId: service.id, id: { not: invoice.id } },
          });
          assert.equal(renewal.amount, 825);
          assert.equal(
            (renewal.billingSnapshot as any).pricing.lines.some((l: any) => l.kind === 'SETUP'),
            false,
          );
          assert.equal((renewal.billingSnapshot as any).pricing.subtotal, 1500);
          assert.deepEqual(
            (await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).billingSnapshot,
            invoice.billingSnapshot,
          );
          assert.equal(
            ((await db.service.findUniqueOrThrow({ where: { id: service.id } })).spec as any)
              .memoryMb,
            6144,
          );
          await call('/settings', 'PATCH', { regionalPricingEnabled: true }, admin);
          await call(
            `/customers/${me.id}`,
            'PATCH',
            { billingAddress: { ...me.billingAddress, country: 'GB' } },
            admin,
          );
          const gbRate = await db.taxRate.findUniqueOrThrow({ where: { country: 'GB' } });
          await call(
            `/tax-rates/${gbRate.id}`,
            'PATCH',
            { name: 'VAT', country: 'GB', basisPoints: 2000 },
            admin,
          );
          const quarterOptions = { [ramId]: 'extra-2gb', [textId]: 'british-world' };
          const regionalQuote = (
            await getQuote({ planId: quarterId, options: quarterOptions, couponCode: undefined })
          ).body.data;
          assert.equal(regionalQuote.currency, 'GBP');
          assert.equal(regionalQuote.setupFee, 550);
          assert.equal(regionalQuote.total, 4860);
          assert.equal(regionalQuote.recurringAmount, 4200);
          const quarter = await call(
            '/orders',
            'POST',
            {
              productId: id,
              planId: quarterId,
              options: quarterOptions,
              expectedQuoteId: regionalQuote.quoteId,
              idempotencyKey: randomUUID(),
            },
            client,
          );
          assert.equal(quarter.status, 201, JSON.stringify(quarter.body));
          const qi = await db.invoice.findUniqueOrThrow({
            where: { id: quarter.body.data.invoiceId },
          });
          await app.get(Payments).settle({
            gateway: 'manual',
            eventId: randomUUID(),
            paymentId: randomUUID(),
            invoiceId: qi.id,
            amount: 4860,
            currency: 'GBP',
          });
          const qs = await db.service.findUniqueOrThrow({
            where: { id: quarter.body.data.serviceId },
          });
          const expected = new Date(qi.periodStart);
          const day = expected.getUTCDate();
          expected.setUTCDate(1);
          expected.setUTCMonth(expected.getUTCMonth() + 3);
          expected.setUTCDate(
            Math.min(
              day,
              new Date(
                Date.UTC(expected.getUTCFullYear(), expected.getUTCMonth() + 1, 0),
              ).getUTCDate(),
            ),
          );
          assert.equal(qs.nextDueAt!.toISOString(), expected.toISOString());
          assert.equal(
            (
              await call(
                `/pricing/regions/${region.id}`,
                'PATCH',
                { name: region.name, country: 'GB', currency: 'EUR', active: true },
                admin,
              )
            ).status,
            409,
          );
          const once = await call(
            '/orders',
            'POST',
            {
              productId: id,
              planId: onceId,
              options: quarterOptions,
              idempotencyKey: randomUUID(),
            },
            client,
          );
          assert.equal(once.status, 201, JSON.stringify(once.body));
          const oi = await db.invoice.findUniqueOrThrow({
            where: { id: once.body.data.invoiceId },
          });
          await app.get(Payments).settle({
            gateway: 'manual',
            eventId: randomUUID(),
            paymentId: randomUUID(),
            invoiceId: oi.id,
            amount: oi.amount,
            currency: oi.currency,
          });
          assert.equal(
            (await db.service.findUniqueOrThrow({ where: { id: once.body.data.serviceId } }))
              .nextDueAt,
            null,
          );
          const free = await call(
            '/orders',
            'POST',
            {
              productId: id,
              planId: freeId,
              options: quarterOptions,
              idempotencyKey: randomUUID(),
            },
            client,
          );
          assert.equal(free.status, 201, JSON.stringify(free.body));
          assert.equal(free.body.data.total, 0);
          assert.equal(free.body.data.status, 'paid');
          assert.equal(
            (await db.service.findUniqueOrThrow({ where: { id: free.body.data.serviceId } }))
              .nextDueAt,
            null,
          );
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: free.body.data.invoiceId } }))
              .status,
            'PAID',
          );
          const badConfig = structuredClone(changed);
          badConfig.options[0].binding = 'javaVersion';
          badConfig.options[0].choices[0].value = '99';
          assert.equal(
            (
              await call(
                `/products/${id}/configuration`,
                'PATCH',
                { plans: badConfig.plans, options: badConfig.options, expectedVersion: 3 },
                admin,
              )
            ).status,
            400,
          );
          const noPrice = await getQuote({
            planId: onceId,
            options: chosen,
            couponCode: undefined,
          });
          assert.equal(
            noPrice.status,
            409,
            'Never reuse another term or currency price for a missing option price',
          );
        },
      );
      let ledgerClient = '',
        ledgerUserId = '',
        mixedInvoiceId = '';
      const signedReceipt = async (
        invoice: any,
        amount: number,
        currency = invoice.currency,
        existingCheckout?: any,
      ) => {
        const checkout =
          existingCheckout ||
          (await db.checkout.create({
            data: {
              invoiceId: invoice.id,
              gateway: 'stripe',
              externalId: `cs_ledger_${randomUUID()}`,
              url: 'https://checkout.example.test/ledger',
              amount,
              currency,
            },
          }));
        const event = {
          id: `evt_ledger_${randomUUID()}`,
          object: 'event',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: checkout.externalId,
              payment_status: 'paid',
              amount_total: amount,
              currency: currency.toLowerCase(),
              payment_intent: `pi_${randomUUID()}`,
              metadata: { invoiceId: invoice.id },
            },
          },
        };
        const send = async (payload = event) =>
          call('/webhooks/stripe', 'POST', payload, '', {
            'stripe-signature': Stripe.webhooks.generateTestHeaderString({
              payload: JSON.stringify(payload),
              secret: 'whsec_testsecret',
            }),
          });
        return { checkout, event, send };
      };
      const createCharge = async (description: string, unitAmount: number, extra: any = {}) => {
        const r = await call(
          '/invoices',
          'POST',
          {
            userId: ledgerUserId,
            description,
            currency: 'USD',
            dueAt: new Date(Date.now() + 86400000).toISOString(),
            idempotencyKey: randomUUID(),
            items: [{ description, quantity: 1, unitAmount, taxable: false }],
            ...extra,
          },
          admin,
        );
        assert.equal(r.status, 201, JSON.stringify(r.body));
        return r.body.data;
      };
      await t.test(
        'ad-hoc invoices snapshot mixed tax lines, number uniquely, and accept exact partial allocations',
        async () => {
          const reg = await call('/auth/register', 'POST', {
            name: 'Ledger Customer',
            email: 'ledger@example.com',
            password: 'ledger-customer-password',
          });
          assert.equal(reg.status, 201);
          ledgerClient = reg.cookie;
          ledgerUserId = (await call('/profile', 'GET', undefined, ledgerClient)).body.data.id;
          await call(
            '/profile',
            'PATCH',
            {
              name: 'Ledger Customer',
              billingAddress: {
                line1: '10 Billing Road',
                city: 'Ledger City',
                postalCode: '10001',
                country: 'US',
              },
            },
            ledgerClient,
          );
          await call(
            '/settings',
            'PATCH',
            {
              invoicePrefix: 'BILL',
              taxEnabled: true,
              taxInclusive: false,
              walletSettings: {
                depositsEnabled: true,
                minDeposit: 100,
                maxDeposit: 100000,
                maxBalance: 1000000,
              },
            },
            admin,
          );
          const input = {
            userId: ledgerUserId,
            description: 'Consulting and non-taxable charge',
            currency: 'USD',
            dueAt: new Date(Date.now() + 86400000).toISOString(),
            items: [
              { description: 'Consulting', quantity: 2, unitAmount: 400, taxable: true },
              { description: 'Non-taxable charge', quantity: 1, unitAmount: 200, taxable: false },
            ],
          };
          assert.equal(
            (
              await call(
                '/invoices',
                'POST',
                { ...input, idempotencyKey: randomUUID() },
                ledgerClient,
              )
            ).status,
            403,
          );
          const quote = await call('/invoices/quote', 'POST', input, admin);
          assert.equal(quote.status, 201);
          assert.equal(quote.body.data.total, 1080);
          assert.equal(quote.body.data.billingSnapshot.pricing.tax.amount, 80);
          const key = randomUUID();
          assert.equal(
            (
              await call(
                '/invoices',
                'POST',
                { ...input, idempotencyKey: key, expectedQuoteId: '0'.repeat(64) },
                admin,
              )
            ).status,
            409,
          );
          const issued = await call(
            '/invoices',
            'POST',
            { ...input, idempotencyKey: key, expectedQuoteId: quote.body.data.quoteId },
            admin,
          );
          assert.equal(issued.status, 201, JSON.stringify(issued.body));
          mixedInvoiceId = issued.body.data.id;
          assert.match(issued.body.data.number, /^BILL-\d{4}-\d{6,}$/);
          assert.equal(
            (
              await call(
                '/invoices',
                'POST',
                { ...input, idempotencyKey: key, expectedQuoteId: quote.body.data.quoteId },
                admin,
              )
            ).body.data.id,
            mixedInvoiceId,
          );
          assert.equal(
            (
              await call(
                '/invoices',
                'POST',
                {
                  ...input,
                  description: 'Different request',
                  idempotencyKey: key,
                  expectedQuoteId: quote.body.data.quoteId,
                },
                admin,
              )
            ).status,
            409,
          );
          const items = await db.invoiceItem.findMany({ where: { invoiceId: mixedInvoiceId } });
          assert.equal(items.length, 2);
          assert.equal(
            items.reduce((n, i) => n + i.total, 0),
            1000,
          );
          assert.equal(items.filter((i) => i.taxable).length, 1);
          const fundingKey = randomUUID();
          const funding = await call(
            '/wallet/funding-invoices',
            'POST',
            { amount: 500, currency: 'USD', idempotencyKey: fundingKey },
            ledgerClient,
          );
          assert.equal(funding.status, 201, JSON.stringify(funding.body));
          assert.equal(funding.body.data.amount, 500);
          assert.equal(funding.body.data.serviceId, null);
          assert.equal(
            (
              await call(
                '/wallet/funding-invoices',
                'POST',
                { amount: 500, currency: 'USD', idempotencyKey: fundingKey },
                ledgerClient,
              )
            ).body.data.id,
            funding.body.data.id,
          );
          const before = (await call('/dashboard', 'GET', undefined, admin)).body.data.metrics.find(
            (m: any) => m.key === 'revenue',
          ).value;
          const receipt = await signedReceipt(funding.body.data, 500);
          const confirmations = await Promise.all([receipt.send(), receipt.send(), receipt.send()]);
          assert(confirmations.every((r) => r.status === 201));
          assert.equal(
            (await call('/wallet?currency=USD', 'GET', undefined, ledgerClient)).body.data.balance,
            500,
          );
          assert.equal(
            await db.walletEntry.count({
              where: { reference: `invoice-funding-${funding.body.data.id}` },
            }),
            1,
          );
          assert.equal(
            (await call('/dashboard', 'GET', undefined, admin)).body.data.metrics.find(
              (m: any) => m.key === 'revenue',
            ).value,
            before,
            'Deposits must not be counted as invoice collections',
          );
          assert.equal(
            (
              await call(
                `/invoices/${funding.body.data.id}/wallet-payment`,
                'POST',
                {},
                ledgerClient,
              )
            ).status,
            409,
            'A wallet cannot fund itself',
          );
          const partKey = randomUUID();
          const partial = await call(
            `/invoices/${mixedInvoiceId}/wallet-payment`,
            'POST',
            { amount: 250, idempotencyKey: partKey },
            ledgerClient,
          );
          assert.equal(partial.status, 201, JSON.stringify(partial.body));
          assert.equal(partial.body.data.partial, true);
          assert.equal(partial.body.data.remaining, 830);
          assert.equal(
            (
              await call(
                `/invoices/${mixedInvoiceId}/wallet-payment`,
                'POST',
                { amount: 250, idempotencyKey: partKey },
                ledgerClient,
              )
            ).body.data.duplicate,
            true,
          );
          assert.equal(
            (
              await call(
                `/invoices/${mixedInvoiceId}/wallet-payment`,
                'POST',
                { amount: 200, idempotencyKey: partKey },
                ledgerClient,
              )
            ).status,
            409,
          );
          assert.equal(
            (await call(`/invoices/${mixedInvoiceId}/wallet-payment`, 'POST', {}, ledgerClient))
              .status,
            409,
          );
          assert.equal(
            (
              await call(
                `/invoices/${mixedInvoiceId}/manual-payment`,
                'POST',
                { reference: 'ledger-mixed-bank-001', amount: 300 },
                admin,
              )
            ).body.data.partial,
            true,
          );
          assert.equal(
            (
              await call(
                `/invoices/${mixedInvoiceId}/wallet-payment`,
                'POST',
                { amount: 250, idempotencyKey: randomUUID() },
                ledgerClient,
              )
            ).body.data.remaining,
            280,
          );
          assert.equal(
            (
              await call(
                `/invoices/${mixedInvoiceId}/manual-payment`,
                'POST',
                { reference: 'ledger-mixed-bank-002', amount: 280 },
                admin,
              )
            ).body.data.paid,
            true,
          );
          const paid = await db.invoice.findUniqueOrThrow({
            where: { id: mixedInvoiceId },
            include: { payments: true },
          });
          assert.equal(paid.status, 'PAID');
          assert.equal(paid.paidAmount, 1080);
          assert.equal(
            paid.payments.reduce((n, p) => n + p.appliedAmount, 0),
            1080,
          );
          assert.equal(
            paid.payments.some((p) => p.reviewRequired),
            false,
          );
          assert.equal(
            (await call('/dashboard', 'GET', undefined, admin)).body.data.metrics.find(
              (m: any) => m.key === 'revenue',
            ).value - before,
            1080,
          );
          const zero = await createCharge('No-charge invoice', 0);
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: zero.id } })).status,
            'PAID',
          );
          const oldNumber = paid.number;
          await call('/settings', 'PATCH', { invoicePrefix: 'NEXT' }, admin);
          const numbered = await createCharge('Later invoice number', 100);
          assert.match(numbered.number, /^NEXT-/);
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: paid.id } })).number,
            oldNumber,
          );
          const numbers = (
            await db.invoice.findMany({
              where: { number: { not: null } },
              select: { number: true },
            })
          ).map((i) => i.number);
          assert.equal(new Set(numbers).size, numbers.length);
        },
      );
      await t.test(
        'checkout balances are pinned and overpayments, expiry, and cancellation preserve partial receipts',
        async (t) => {
          const invoice = await createCharge('Checkout balance race', 1000);
          const captured: any[] = [];
          const mock = t.mock.method(app.get(Extensions), 'gateway', async () => ({
            id: 'stripe',
            async checkout(input: any) {
              captured.push(input);
              return {
                url: 'https://checkout.example.test/race',
                externalId: `cs_race_${randomUUID()}`,
              };
            },
          }));
          let old: any;
          try {
            assert.equal(
              (
                await call(
                  `/invoices/${invoice.id}/checkout`,
                  'POST',
                  { gateway: 'stripe' },
                  ledgerClient,
                )
              ).status,
              201,
            );
            old = await db.checkout.findFirstOrThrow({
              where: { invoiceId: invoice.id },
              orderBy: { createdAt: 'asc' },
            });
            assert.equal(old.amount, 1000);
            await call(
              `/invoices/${invoice.id}/manual-payment`,
              'POST',
              { reference: 'ledger-race-bank-001', amount: 300 },
              admin,
            );
            assert.equal(
              (
                await call(
                  `/invoices/${invoice.id}/checkout`,
                  'POST',
                  { gateway: 'stripe' },
                  ledgerClient,
                )
              ).status,
              201,
            );
            assert.equal(
              (
                await call(
                  `/invoices/${invoice.id}/checkout`,
                  'POST',
                  { gateway: 'stripe' },
                  ledgerClient,
                )
              ).status,
              201,
            );
            assert.deepEqual(
              captured.map((i) => i.amount),
              [1000, 700],
            );
          } finally {
            mock.mock.restore();
          }
          const late = await signedReceipt(invoice, 1000, 'USD', old);
          assert.equal(
            (
              await late.send({
                ...late.event,
                data: { object: { ...late.event.data.object, amount_total: 999 } },
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await late.send({
                ...late.event,
                data: { object: { ...late.event.data.object, payment_intent: null } },
              } as any)
            ).status,
            400,
          );
          const settled = await late.send();
          assert.equal(settled.status, 201);
          assert.equal(settled.body.reviewRequired, true);
          assert.equal((await late.send()).body.duplicate, true);
          const allocation = await db.payment.findUniqueOrThrow({
            where: {
              gateway_externalId: {
                gateway: 'stripe',
                externalId: late.event.data.object.payment_intent,
              },
            },
          });
          assert.equal(allocation.amount, 1000);
          assert.equal(allocation.appliedAmount, 700);
          assert.equal(allocation.reviewRequired, true);
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).paidAmount,
            1000,
          );
          const voided = await createCharge('Part-paid cancellation charge', 200);
          await call(
            `/invoices/${voided.id}/manual-payment`,
            'POST',
            { reference: 'ledger-void-bank-001', amount: 50 },
            admin,
          );
          assert.equal(
            (
              await call(
                `/invoices/${voided.id}/void`,
                'POST',
                { reason: 'Charge withdrawn after partial receipt' },
                admin,
              )
            ).status,
            201,
          );
          const voidView = (await call('/invoices', 'GET', undefined, ledgerClient)).body.data.find(
            (i: any) => i.id === voided.id,
          );
          assert.equal(voidView.paidAmount, 50);
          assert.equal(voidView.balanceDue, 0);
          assert.equal(voidView.payments[0].reviewRequired, true);
          assert.equal(
            (await call('/payments/review', 'GET', undefined, admin)).body.data.find(
              (p: any) => p.invoiceId === voided.id,
            ).invoice.number,
            voided.number,
          );
          const original = await db.product.findUniqueOrThrow({ where: { id: productId } });
          const product = await call(
            '/products',
            'POST',
            {
              name: 'Partial payment hosting',
              description: 'Partial receipt expiry fixture',
              category: 'game',
              provider: 'wings',
              price: 500,
              taxable: false,
              connectionId,
              active: true,
              spec: original.spec,
            },
            admin,
          );
          assert.equal(product.status, 201);
          for (let port = 25900; port < 25903; port++)
            await call(
              `/nodes/${connectionId}/resources`,
              'POST',
              {
                kind: 'allocation',
                value: `203.0.113.10:${port}`,
                config: { ip: '203.0.113.10', port },
              },
              admin,
            );
          const order = await call(
            '/orders',
            'POST',
            { productId: product.body.data.id, idempotencyKey: randomUUID() },
            ledgerClient,
          );
          assert.equal(order.status, 201);
          await call(
            `/invoices/${order.body.data.invoiceId}/manual-payment`,
            'POST',
            { reference: 'ledger-expiry-bank-001', amount: 100 },
            admin,
          );
          assert.equal(
            await db.operation.count({ where: { serviceId: order.body.data.serviceId } }),
            0,
            'Partial payment must not provision',
          );
          await db.invoice.update({
            where: { id: order.body.data.invoiceId },
            data: { dueAt: new Date(Date.now() - 86400000) },
          });
          await app.get(Jobs).maintenance();
          assert.equal(
            (await db.service.findUniqueOrThrow({ where: { id: order.body.data.serviceId } }))
              .status,
            'TERMINATED',
          );
          assert.equal(
            await db.resource.count({ where: { serviceId: order.body.data.serviceId } }),
            0,
          );
          const expired = await db.invoice.findUniqueOrThrow({
            where: { id: order.body.data.invoiceId },
            include: { payments: true },
          });
          assert.equal(expired.status, 'VOID');
          assert.equal(expired.paidAmount, 100);
          assert.equal(expired.payments[0].reviewRequired, true);
          const live = await call(
            '/orders',
            'POST',
            { productId: product.body.data.id, idempotencyKey: randomUUID() },
            ledgerClient,
          );
          await call(
            `/invoices/${live.body.data.invoiceId}/manual-payment`,
            'POST',
            { reference: 'ledger-live-bank-001' },
            admin,
          );
          const service = await db.service.update({
            where: { id: live.body.data.serviceId },
            data: {
              status: 'ACTIVE',
              externalId: live.body.data.serviceId,
              nextDueAt: new Date(Date.now() + 2 * 86400000),
            },
          });
          await db.operation.updateMany({
            where: { serviceId: service.id },
            data: { status: 'COMPLETE' },
          });
          await app.get(Jobs).maintenance();
          const renewal = await db.invoice.findFirstOrThrow({
            where: { serviceId: service.id, status: 'UNPAID' },
          });
          await call(
            `/invoices/${renewal.id}/manual-payment`,
            'POST',
            { reference: 'ledger-renewal-bank-001', amount: 100 },
            admin,
          );
          const request = await call(
            `/services/${service.id}/cancellations`,
            'POST',
            { mode: 'END_OF_TERM', reason: 'Cancel after this term', confirmation: service.name },
            ledgerClient,
          );
          assert.equal(
            (
              await call(
                `/cancellations/${request.body.data.id}/review`,
                'POST',
                {
                  decision: 'APPROVE',
                  note: 'Approved end of paid term',
                  confirmation: service.name,
                },
                admin,
              )
            ).status,
            201,
          );
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: renewal.id } })).status,
            'VOID',
          );
          assert.equal(
            (
              await call(
                `/cancellations/${request.body.data.id}/withdraw`,
                'POST',
                {},
                ledgerClient,
              )
            ).status,
            201,
          );
          const restored = await db.invoice.findUniqueOrThrow({
            where: { id: renewal.id },
            include: { payments: true },
          });
          assert.equal(restored.status, 'UNPAID');
          assert.equal(restored.paidAmount, 100);
          assert.equal(restored.payments[0].reviewRequired, false);
          assert.equal(
            (
              await call(
                `/invoices/${renewal.id}/wallet-payment`,
                'POST',
                { amount: 500, idempotencyKey: randomUUID() },
                ledgerClient,
              )
            ).status,
            409,
            'Never charge more than the remaining balance',
          );
        },
      );
      await t.test(
        'gateway funding enforces caps, currency, receipts, policy changes, and reconciliation holds',
        async () => {
          const policy = {
            depositsEnabled: true,
            minDeposit: 100,
            maxDeposit: 1000,
            maxBalance: 1000,
          };
          await call('/settings', 'PATCH', { walletSettings: policy }, admin);
          const funding = await call(
            '/wallet/funding-invoices',
            'POST',
            { amount: 800, currency: 'USD', idempotencyKey: randomUUID() },
            ledgerClient,
          );
          assert.equal(funding.status, 201, JSON.stringify(funding.body));
          const request = await call(
            '/wallet/topups',
            'POST',
            { amount: 500, currency: 'USD', reference: 'ledger-cap-claim-001' },
            ledgerClient,
          );
          assert.equal(
            (
              await call(
                `/admin/wallets/topups/${request.body.data.id}/review`,
                'POST',
                {
                  approve: true,
                  paymentReference: 'ledger-cap-bank-001',
                  note: 'Verified bank receipt',
                },
                admin,
              )
            ).status,
            201,
          );
          const receipt = await signedReceipt(funding.body.data, 800);
          const paid = await receipt.send();
          assert.equal(paid.status, 201);
          assert.equal(paid.body.reviewRequired, true);
          assert.equal(
            (await call('/wallet?currency=USD', 'GET', undefined, ledgerClient)).body.data.balance,
            500,
          );
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: funding.body.data.id } }))
              .walletCreditedAt,
            null,
          );
          assert.equal(
            (await call(`/invoices/${funding.body.data.id}/funding-credit`, 'POST', {}, admin))
              .status,
            409,
          );
          await call(
            '/settings',
            'PATCH',
            { walletSettings: { ...policy, maxBalance: 2000 } },
            admin,
          );
          assert.equal(
            (
              await call(
                `/invoices/${funding.body.data.id}/funding-credit`,
                'POST',
                {},
                ledgerClient,
              )
            ).status,
            403,
          );
          assert.equal(
            (await call(`/invoices/${funding.body.data.id}/funding-credit`, 'POST', {}, admin)).body
              .data.credited,
            true,
          );
          assert.equal(
            (await call(`/invoices/${funding.body.data.id}/funding-credit`, 'POST', {}, admin)).body
              .data.duplicate,
            true,
          );
          assert.equal((await receipt.send()).body.duplicate, true);
          assert.equal(
            (await call('/wallet?currency=USD', 'GET', undefined, ledgerClient)).body.data.balance,
            1300,
          );
          const held = await call(
            '/wallet/funding-invoices',
            'POST',
            { amount: 500, currency: 'USD', idempotencyKey: randomUUID() },
            ledgerClient,
          );
          assert.equal(held.status, 201);
          const extra = await call(
            '/wallet/topups',
            'POST',
            { amount: 400, currency: 'USD', reference: 'ledger-cap-claim-002' },
            ledgerClient,
          );
          await call(
            `/admin/wallets/topups/${extra.body.data.id}/review`,
            'POST',
            {
              approve: true,
              paymentReference: 'ledger-cap-bank-002',
              note: 'Verified bank receipt',
            },
            admin,
          );
          await (await signedReceipt(held.body.data, 500)).send();
          const payment = await db.payment.findFirstOrThrow({
            where: { invoiceId: held.body.data.id },
          });
          assert.equal(payment.reviewRequired, true);
          await call(
            `/payments/${payment.id}/review`,
            'POST',
            { resolution: 'External refund verified for held funding receipt.' },
            admin,
          );
          await call(
            '/settings',
            'PATCH',
            { walletSettings: { ...policy, maxBalance: 3000 } },
            admin,
          );
          assert.equal(
            (await call(`/invoices/${held.body.data.id}/funding-credit`, 'POST', {}, admin)).status,
            409,
            'Reviewed funds cannot later turn into automatic spendable credit',
          );
          const key = randomUUID(),
            pending = await call(
              '/wallet/funding-invoices',
              'POST',
              { amount: 100, currency: 'USD', idempotencyKey: key },
              ledgerClient,
            );
          await call(
            '/settings',
            'PATCH',
            { walletSettings: { ...policy, maxBalance: 3000, depositsEnabled: false } },
            admin,
          );
          assert.equal(
            (
              await call(
                '/wallet/funding-invoices',
                'POST',
                { amount: 100, currency: 'USD', idempotencyKey: randomUUID() },
                ledgerClient,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await call(
                '/wallet/funding-invoices',
                'POST',
                { amount: 100, currency: 'USD', idempotencyKey: key },
                ledgerClient,
              )
            ).body.data.id,
            pending.body.data.id,
          );
          assert.equal(
            (
              await call(
                `/invoices/${pending.body.data.id}/manual-payment`,
                'POST',
                { reference: 'ledger-mixed-bank-001' },
                admin,
              )
            ).status,
            409,
            'An old bank reference cannot fund a wallet',
          );
          assert.equal(
            (
              await call(
                `/invoices/${pending.body.data.id}/manual-payment`,
                'POST',
                { reference: 'ledger-policy-bank-001' },
                admin,
              )
            ).body.data.paid,
            true,
            'Previously issued funding still honors verified receipts',
          );
          await call(
            '/settings',
            'PATCH',
            { walletSettings: { ...policy, maxBalance: 3000 } },
            admin,
          );
          const gb = await call(
            '/wallet/funding-invoices',
            'POST',
            { amount: 300, currency: 'GBP', idempotencyKey: randomUUID() },
            ledgerClient,
          );
          assert.equal(gb.status, 201, JSON.stringify(gb.body));
          const checkout = await db.checkout.create({
            data: {
              invoiceId: gb.body.data.id,
              gateway: 'stripe',
              externalId: `cs_gbp_${randomUUID()}`,
              url: 'https://checkout.example.test/gbp',
              amount: 300,
              currency: 'GBP',
            },
          });
          assert.equal(
            (await (await signedReceipt(gb.body.data, 300, 'USD', checkout)).send()).status,
            400,
          );
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: gb.body.data.id } })).paidAmount,
            0,
          );
          await (await signedReceipt(gb.body.data, 300, 'GBP', checkout)).send();
          assert.equal(
            (await call('/wallet?currency=GBP', 'GET', undefined, ledgerClient)).body.data.balance,
            300,
          );
          assert.equal(
            (await call('/wallet?currency=USD', 'GET', undefined, ledgerClient)).body.data.balance,
            1800,
          );
          const attempts = await Promise.all(
            [1, 2].map(() =>
              call(
                '/wallet/funding-invoices',
                'POST',
                { amount: 800, currency: 'USD', idempotencyKey: randomUUID() },
                ledgerClient,
              ),
            ),
          );
          assert.equal(
            attempts.filter((r) => r.status === 201).length,
            1,
            JSON.stringify(attempts),
          );
          assert.equal(attempts.filter((r) => r.status === 409).length, 1);
          const expire = attempts.find((r) => r.status === 201)!.body.data;
          await db.invoice.update({
            where: { id: expire.id },
            data: { dueAt: new Date(Date.now() - 1000) },
          });
          await app.get(Jobs).maintenance();
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: expire.id } })).status,
            'VOID',
          );
          const cancel = await call(
            '/wallet/funding-invoices',
            'POST',
            { amount: 800, currency: 'USD', idempotencyKey: randomUUID() },
            ledgerClient,
          );
          assert.equal(cancel.status, 201);
          assert.equal(
            (
              await call(
                `/invoices/${cancel.body.data.id}/void`,
                'POST',
                { reason: 'No longer depositing' },
                other,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await call(
                `/invoices/${cancel.body.data.id}/void`,
                'POST',
                { reason: 'No longer depositing' },
                ledgerClient,
              )
            ).status,
            201,
          );
          await call(
            '/settings',
            'PATCH',
            {
              invoicePrefix: 'INV',
              walletSettings: {
                depositsEnabled: true,
                minDeposit: 100,
                maxDeposit: 100000,
                maxBalance: 1000000,
              },
            },
            admin,
          );
        },
      );
      await t.test(
        'invoice PDFs enforce ownership, paginate Unicode items, and preserve issued billing snapshots',
        async () => {
          const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
          const before = (await call('/settings', 'GET', undefined, admin)).body.data;
          await call(
            '/settings',
            'PATCH',
            {
              companyBilling: {
                legalName: 'Original Café Hosting',
                line1: 'Saved invoice address',
              },
            },
            admin,
          );
          const invoice = await createCharge('PDF export — Café Ω', 100, {
            items: Array.from({ length: 50 }, (_, n) => ({
              description: `Item ${n + 1} — Café Ω résumé ${'long description '.repeat(5)}`,
              quantity: 2,
              unitAmount: 125,
              taxable: false,
            })),
          });
          await call(
            '/settings',
            'PATCH',
            {
              companyBilling: {
                legalName: 'Changed company after issue',
                line1: 'Must not replace snapshot',
              },
            },
            admin,
          );
          const path = `/invoices/${invoice.id}/pdf`;
          assert.equal((await fetch(base + path)).status, 401);
          assert.equal((await fetch(base + path, { headers: { Cookie: other } })).status, 404);
          assert.equal(
            (await call(`/invoices/${invoice.id}/deliveries`, 'GET', undefined, ledgerClient))
              .status,
            403,
          );
          const response = await fetch(base + path, { headers: { Cookie: ledgerClient } });
          assert.equal(response.status, 200);
          assert.equal(response.headers.get('content-type'), 'application/pdf');
          assert.match(
            response.headers.get('content-disposition')!,
            /attachment; filename="INV-\d{4}-\d{6}\.pdf"/,
          );
          assert.match(response.headers.get('cache-control')!, /no-store/);
          const bytes = new Uint8Array(await response.arrayBuffer());
          assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
          const document = await getDocument({
            data: bytes,
            useSystemFonts: false,
            isEvalSupported: false,
          }).promise;
          assert(document.numPages >= 3, `Expected pagination, got ${document.numPages}`);
          const pages: string[] = [];
          for (let p = 1; p <= document.numPages; p++)
            pages.push(
              (await (await document.getPage(p)).getTextContent()).items
                .map((i: any) => i.str)
                .join(' '),
            );
          const text = pages.join(' ');
          assert.match(text, /Original Café Hosting/);
          assert.match(text, /Saved invoice address/);
          assert(!text.includes('Changed company after issue'));
          assert.match(text, /Item 50 — Café Ω résumé/);
          assert.match(text, /USD\s*125\.00/);
          assert.match(text, /Balance due/);
          for (const [index, page] of pages.entries())
            assert(page.includes(`Page ${index + 1} of ${pages.length}`));
          await document.loadingTask.destroy();
          const { renderInvoicePdf } = await import('../apps/api/dist/invoice-pdf.js');
          const voided = await db.invoice.findFirstOrThrow({
            where: { kind: 'ADHOC', status: 'VOID', paidAmount: { gt: 0 } },
            include: { payments: true, lineItems: true },
          });
          const voidDocument = await getDocument({
            data: new Uint8Array(await renderInvoicePdf(voided)),
            isEvalSupported: false,
          }).promise;
          let voidText = '';
          for (let p = 1; p <= voidDocument.numPages; p++)
            voidText += (await (await voidDocument.getPage(p)).getTextContent()).items
              .map((i: any) => i.str)
              .join(' ');
          assert.match(voidText, /VOID/);
          assert.match(voidText, /Void reason/);
          assert.match(voidText, /PAYMENT HISTORY/);
          await voidDocument.loadingTask.destroy();
          await call('/settings', 'PATCH', { companyBilling: before.companyBilling }, admin);
        },
      );
      await t.test(
        'invoice email outbox queues atomically and SMTP accepts one PDF despite concurrent workers',
        async () => {
          const { InvoiceDocuments } = await import('../apps/api/dist/invoice-documents.js');
          const documents = app.get(InvoiceDocuments);
          const received: string[] = [];
          let rejectRecipient = false;
          const smtp = new SMTPServer({
            authOptional: true,
            disabledCommands: ['AUTH', 'STARTTLS'],
            onRcptTo(_address, _session, cb) {
              cb(
                rejectRecipient
                  ? Object.assign(new Error('Fixture recipient rejected'), { responseCode: 550 })
                  : undefined,
              );
            },
            onData(stream, _session, cb) {
              const parts: Buffer[] = [];
              stream.on('data', (b) => parts.push(b));
              stream.on('end', () => {
                received.push(Buffer.concat(parts).toString());
                cb();
              });
            },
          });
          await new Promise<void>((ok) => smtp.listen(0, '127.0.0.1', ok));
          const oldUrl = process.env.SMTP_URL,
            oldFrom = process.env.SMTP_FROM;
          try {
            delete process.env.SMTP_URL;
            process.env.SMTP_FROM = 'billing@harbor.test';
            await call('/settings', 'PATCH', { invoiceEmailsEnabled: true }, admin);
            const invoice = await createCharge('Automatic PDF email', 500);
            const queued = await db.invoiceDelivery.findMany({ where: { invoiceId: invoice.id } });
            assert.equal(queued.length, 1);
            assert.equal(queued[0].kind, 'ISSUED');
            await documents.deliver(queued[0].id);
            let delivery = await db.invoiceDelivery.findUniqueOrThrow({
              where: { id: queued[0].id },
            });
            assert.equal(delivery.status, 'PENDING');
            assert.equal(delivery.attempts, 0);
            assert.match(delivery.lastError!, /SMTP is not configured/);
            process.env.SMTP_URL = `smtp://127.0.0.1:${(smtp.server.address() as any).port}`;
            await db.invoiceDelivery.update({
              where: { id: delivery.id },
              data: { nextAttemptAt: new Date(0) },
            });
            await Promise.all([documents.deliver(delivery.id), documents.deliver(delivery.id)]);
            delivery = await db.invoiceDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
            assert.equal(delivery.status, 'SENT');
            assert.equal(delivery.attempts, 1);
            assert.equal(received.length, 1);
            assert.match(received[0], /Content-Type: application\/pdf/);
            assert(received[0].includes(invoice.number));
            assert.match(received[0], /To: ledger@example.com/);
            assert.match(received[0], /Message-ID: <harbor-invoice-/i);
            const attachment = received[0]
              .split(/Content-Type: application\/pdf/i)[1]
              .split(/\r?\n\r?\n/)
              .slice(1)
              .join('\n\n')
              .split(/\r?\n--/)[0];
            assert.equal(
              Buffer.from(attachment.replace(/\s/g, ''), 'base64').subarray(0, 5).toString(),
              '%PDF-',
            );
            assert.equal(
              (
                await call(
                  `/invoices/${invoice.id}/deliveries/${delivery.id}/retry`,
                  'POST',
                  {},
                  admin,
                )
              ).status,
              409,
            );
            const reference = `invoice-email-bank-${randomUUID()}`;
            const first = await call(
              `/invoices/${invoice.id}/manual-payment`,
              'POST',
              { reference },
              admin,
            );
            assert.equal(first.status, 201, JSON.stringify(first.body));
            assert.equal(
              (await call(`/invoices/${invoice.id}/manual-payment`, 'POST', { reference }, admin))
                .status,
              201,
            );
            assert.equal(
              await db.invoiceDelivery.count({ where: { invoiceId: invoice.id, kind: 'PAID' } }),
              1,
            );
            rejectRecipient = true;
            const receipt = await db.invoiceDelivery.findFirstOrThrow({
              where: { invoiceId: invoice.id, kind: 'PAID' },
            });
            await documents.deliver(receipt.id);
            delivery = await db.invoiceDelivery.findUniqueOrThrow({ where: { id: receipt.id } });
            assert.equal(delivery.status, 'FAILED');
            assert(!delivery.lastError!.includes('Fixture recipient'));
            assert.equal(
              (
                await call(
                  `/invoices/${invoice.id}/deliveries/${receipt.id}/retry`,
                  'POST',
                  {},
                  ledgerClient,
                )
              ).status,
              403,
            );
            assert.equal(
              (
                await call(
                  `/invoices/${invoice.id}/deliveries/${receipt.id}/retry`,
                  'POST',
                  {},
                  admin,
                )
              ).status,
              201,
            );
            rejectRecipient = false;
            await documents.deliver(receipt.id);
            assert.equal(
              (await db.invoiceDelivery.findUniqueOrThrow({ where: { id: receipt.id } })).status,
              'SENT',
            );
            assert.equal(received.length, 2);
            await call('/settings', 'PATCH', { invoiceEmailsEnabled: false }, admin);
            const noAuto = await createCharge('No automatic emails while disabled', 100);
            assert.equal(await db.invoiceDelivery.count({ where: { invoiceId: noAuto.id } }), 0);
            const key = randomUUID();
            assert.equal(
              (
                await call(
                  `/invoices/${noAuto.id}/deliveries`,
                  'POST',
                  { idempotencyKey: key },
                  ledgerClient,
                )
              ).status,
              403,
            );
            const manual = await call(
              `/invoices/${noAuto.id}/deliveries`,
              'POST',
              { idempotencyKey: key },
              admin,
            );
            assert.equal(manual.status, 201);
            assert.equal(
              (
                await call(
                  `/invoices/${noAuto.id}/deliveries`,
                  'POST',
                  { idempotencyKey: key },
                  admin,
                )
              ).body.data.id,
              manual.body.data.id,
            );
            assert.equal(
              (
                await call(
                  `/invoices/${invoice.id}/deliveries`,
                  'POST',
                  { idempotencyKey: key },
                  admin,
                )
              ).status,
              409,
            );
            assert.equal(
              (
                await call(
                  `/invoices/${noAuto.id}/deliveries`,
                  'POST',
                  { idempotencyKey: randomUUID() },
                  admin,
                )
              ).status,
              409,
            );
          } finally {
            if (oldUrl === undefined) delete process.env.SMTP_URL;
            else process.env.SMTP_URL = oldUrl;
            if (oldFrom === undefined) delete process.env.SMTP_FROM;
            else process.env.SMTP_FROM = oldFrom;
            await new Promise<void>((ok) => smtp.close(ok));
            await call('/settings', 'PATCH', { invoiceEmailsEnabled: false }, admin);
          }
        },
      );
      await t.test(
        'uncertain invoice mail deliveries require explicit staff review before retry',
        async () => {
          const { InvoiceDocuments } = await import('../apps/api/dist/invoice-documents.js');
          const documents = app.get(InvoiceDocuments);
          const invoice = await createCharge('Interrupted SMTP lease', 100);
          const request = await call(
            `/invoices/${invoice.id}/deliveries`,
            'POST',
            { idempotencyKey: randomUUID() },
            admin,
          );
          const id = request.body.data.id;
          await db.invoiceDelivery.update({
            where: { id },
            data: {
              status: 'SENDING',
              leaseToken: randomUUID(),
              leaseUntil: new Date(0),
              attempts: 1,
            },
          });
          await documents.scan();
          const delivery = await db.invoiceDelivery.findUniqueOrThrow({ where: { id } });
          assert.equal(delivery.status, 'UNKNOWN');
          assert.equal(delivery.leaseToken, null);
          assert.equal(
            (await call(`/invoices/${invoice.id}/deliveries/${id}/retry`, 'POST', {}, admin))
              .status,
            409,
          );
          assert.equal(
            (
              await call(
                `/invoices/${invoice.id}/deliveries/${id}/retry`,
                'POST',
                { acknowledgePossibleDuplicate: true },
                admin,
              )
            ).status,
            201,
          );
          assert.equal(
            (await db.invoiceDelivery.findUniqueOrThrow({ where: { id } })).status,
            'PENDING',
          );
          assert.equal(
            await db.auditLog.count({
              where: { action: 'invoice.email.retry', targetId: invoice.id },
            }),
            1,
          );
        },
      );
      await t.test(
        'settings revisions reject stale writers and branding uploads normalize real images',
        async () => {
          // Model a separate real loopback client; keep the production authentication limits intact.
          clientAddress = '127.0.0.2';
          const initial = (await call('/settings')).body.data;
          assert.equal((await call('/admin/settings', 'GET', undefined, ledgerClient)).status, 403);
          const first = await call(
            '/settings',
            'PATCH',
            {
              expectedVersion: initial.settingsVersion,
              experience: {
                ...initial.experience,
                siteTitle: 'Custom hosting portal',
                storefront: { ...initial.experience.storefront, title: 'Host your next big idea' },
              },
            },
            admin,
          );
          assert.equal(first.status, 200, JSON.stringify(first.body));
          assert.equal(first.body.data.settingsVersion, initial.settingsVersion + 1);
          assert.equal(
            (
              await call(
                '/settings',
                'PATCH',
                { expectedVersion: initial.settingsVersion, companyName: 'Stale company' },
                admin,
              )
            ).status,
            409,
          );
          assert.equal((await call('/settings')).body.data.companyName, initial.companyName);
          assert.equal(
            (
              await call(
                '/settings',
                'PATCH',
                {
                  experience: {
                    ...initial.experience,
                    links: { ...initial.experience.links, termsUrl: 'javascript:alert(1)' },
                  },
                },
                admin,
              )
            ).status,
            400,
          );
          const sharp = (await import('sharp')).default;
          const image = await sharp({
            create: { width: 8, height: 8, channels: 4, background: '#8b5cf6' },
          })
            .png()
            .toBuffer();
          const upload = async (bytes: Buffer, cookie: string) => {
            const form = new FormData();
            form.append(
              'file',
              new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
              'company.png',
            );
            const response = await fetch(base + '/admin/settings/logo', {
              method: 'POST',
              headers: { Origin: 'http://localhost:3000', Cookie: cookie },
              body: form,
            });
            return { status: response.status, body: (await response.json()) as any };
          };
          assert.equal((await upload(image, ledgerClient)).status, 403);
          assert.equal((await upload(Buffer.from('<svg onload="alert(1)"/>'), admin)).status, 400);
          assert.equal(
            (await upload(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), admin)).status,
            400,
          );
          const valid = await upload(image, admin);
          assert.equal(valid.status, 201, JSON.stringify(valid.body));
          assert.match(valid.body.data.url, /^\/api\/v1\/branding\/[a-f0-9-]+\.png$/);
          const response = await fetch(new URL(valid.body.data.url, base).href);
          assert.equal(response.status, 200);
          assert.equal(response.headers.get('content-type'), 'image/png');
          const decoded = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
          assert.equal(decoded.width, 8);
          const branded = await call('/settings', 'PATCH', { logoUrl: valid.body.data.url }, admin);
          assert.equal(branded.status, 200);
          assert.equal(branded.body.data.experience.storefront.title, 'Host your next big idea');
          assert.equal('mailConfig' in branded.body.data, false);
        },
      );
      await t.test(
        'registration, session, maintenance and staff two-factor policies enforce saved settings',
        async () => {
          const original = (await call('/settings')).body.data;
          const update = (value: any) =>
            call('/settings', 'PATCH', { access: { ...original.access, ...value } }, admin);
          assert.equal((await update({ registrationEnabled: false })).status, 200);
          assert.equal(
            (
              await call('/auth/register', 'POST', {
                email: 'disabled@example.com',
                name: 'Disabled',
                password: 'settings-account-password',
              })
            ).status,
            403,
          );
          assert.equal(
            (await update({ registrationDomains: ['approved.example'], sessionHours: 1 })).status,
            200,
          );
          assert.equal(
            (
              await call('/auth/register', 'POST', {
                email: 'outside@example.com',
                name: 'Outside',
                password: 'settings-account-password',
              })
            ).status,
            403,
          );
          const allowed = await call('/auth/register', 'POST', {
            email: 'allowed@approved.example',
            name: 'Allowed',
            password: 'settings-account-password',
          });
          assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
          const session = await db.session.findFirstOrThrow({
            where: { userId: allowed.body.data.id },
            orderBy: { createdAt: 'desc' },
          });
          assert(Math.abs(session.expiresAt.getTime() - Date.now() - 3600000) < 10000);
          const maintenance = await update({
            maintenanceEnabled: true,
            maintenanceMessage: 'Network maintenance in progress',
          });
          assert.equal(maintenance.status, 200);
          assert.equal((await call('/services', 'GET', undefined, ledgerClient)).status, 503);
          assert.equal((await call('/auth/me', 'GET', undefined, ledgerClient)).status, 200);
          assert.equal((await call('/admin/settings', 'GET', undefined, admin)).status, 200);
          const login = await call('/auth/login', 'POST', {
            email: 'ledger@example.com',
            password: 'ledger-customer-password',
          });
          assert.equal(login.status, 503);
          assert.equal((await update({ requireStaffTwoFactor: true })).status, 409);
          assert.equal((await call('/settings')).body.data.access.maintenanceEnabled, true);
          await call('/settings', 'PATCH', { access: original.access }, admin);
        },
      );
      await t.test(
        'encrypted SMTP settings, connection tests, notification templates and private delivery logs work together',
        async () => {
          const messages: string[] = [];
          const smtp = new SMTPServer({
            disabledCommands: ['STARTTLS'],
            allowInsecureAuth: true,
            onAuth(auth, _session, callback) {
              callback(
                auth.username === 'fixture-user' && auth.password === 'fixture-smtp-password'
                  ? undefined
                  : new Error('Fixture credentials rejected'),
                { user: 'fixture-user' },
              );
            },
            onData(stream, _session, callback) {
              const parts: Buffer[] = [];
              stream.on('data', (b) => parts.push(b));
              stream.on('end', () => {
                messages.push(Buffer.concat(parts).toString());
                callback();
              });
            },
          });
          await new Promise<void>((ok) => smtp.listen(0, '127.0.0.1', ok));
          const privateSettings = (await call('/admin/settings', 'GET', undefined, admin)).body
            .data;
          try {
            const payload = {
              source: 'custom',
              expectedVersion: privateSettings.settingsVersion,
              expectedMailRevision: privateSettings.mail.revision,
              host: '127.0.0.1',
              port: (smtp.server.address() as any).port,
              security: 'PLAIN',
              username: 'fixture-user',
              password: 'fixture-smtp-password',
              fromName: 'Harbor billing',
              fromAddress: 'billing@harbor.test',
            };
            const saved = await call('/admin/settings/mail', 'PATCH', payload, admin);
            assert.equal(saved.status, 200, JSON.stringify(saved.body));
            assert.equal(saved.body.data.mail.passwordSet, true);
            assert.equal(saved.body.data.mail.password, undefined);
            const stored = await db.setting.findUniqueOrThrow({ where: { id: 'installation' } });
            assert(stored.mailConfig && !stored.mailConfig.includes('fixture-smtp-password'));
            assert(
              !JSON.stringify((await call('/settings')).body).includes('fixture-smtp-password'),
            );
            assert(
              !JSON.stringify(
                (await call('/admin/settings', 'GET', undefined, admin)).body,
              ).includes('fixture-smtp-password'),
            );
            assert.equal((await call('/admin/settings/mail', 'PATCH', payload, admin)).status, 409);
            const retain = await call(
              '/admin/settings/mail',
              'PATCH',
              {
                ...payload,
                expectedVersion: stored.settingsVersion,
                expectedMailRevision: saved.body.data.mail.revision,
                password: '',
              },
              admin,
            );
            assert.equal(retain.status, 200);
            assert.equal((await call('/admin/settings/mail/test', 'POST', {}, admin)).status, 201);
            assert.equal(messages.length, 1);
            assert.match(messages[0], /email delivery test/);
            assert.equal(
              (await call('/admin/settings/mail/logs', 'GET', undefined, ledgerClient)).status,
              403,
            );
            const logs = (
              await call(
                '/admin/settings/mail/logs?search=email%20delivery%20test',
                'GET',
                undefined,
                admin,
              )
            ).body.data;
            assert.equal(logs.items[0].status, 'SENT');
            assert.equal(logs.items[0].kind, 'smtp.test');
            assert.equal(logs.items[0].body, undefined);
            const templates = (await call('/admin/settings/templates', 'GET', undefined, admin))
              .body.data;
            const reset = templates.find((v: any) => v.key === 'auth.reset');
            assert.equal(
              (
                await call(
                  '/admin/settings/templates/auth.reset',
                  'PATCH',
                  {
                    subject: 'Hello {{company}}',
                    body: 'Missing mandatory link',
                    expectedUpdatedAt: null,
                  },
                  admin,
                )
              ).status,
              400,
            );
            assert.equal(
              (
                await call(
                  '/admin/settings/templates/auth.reset',
                  'PATCH',
                  {
                    subject: 'Hello {{unknown}}',
                    body: 'Reset: {{link}}',
                    expectedUpdatedAt: null,
                  },
                  admin,
                )
              ).status,
              400,
            );
            const modified = await call(
              '/admin/settings/templates/auth.reset',
              'PATCH',
              {
                subject: 'Recover {{company}} account',
                body: 'Your secure reset link: {{link}}',
                expectedUpdatedAt: reset.updatedAt || null,
              },
              admin,
            );
            assert.equal(modified.status, 200);
            assert.equal(
              (
                await call(
                  '/admin/settings/templates/auth.reset',
                  'PATCH',
                  { subject: 'Stale change', body: '{{link}}', expectedUpdatedAt: null },
                  admin,
                )
              ).status,
              409,
            );
            const { Mailer } = await import('../apps/api/dist/mailer.js');
            assert.equal(
              await app.get(Mailer).template('customer@harbor.test', 'auth.reset', {
                company: 'Fixture Host',
                link: 'https://example.test/reset?token=not-a-real-token',
              }),
              true,
            );
            assert.match(messages.at(-1)!, /Recover Fixture Host account/);
            const updated = (await call('/admin/settings', 'GET', undefined, admin)).body.data;
            assert.equal(
              (
                await call(
                  '/admin/settings/mail',
                  'PATCH',
                  { source: 'environment', expectedVersion: updated.settingsVersion },
                  admin,
                )
              ).status,
              200,
            );
          } finally {
            await db.setting.update({ where: { id: 'installation' }, data: { mailConfig: null } });
            await new Promise<void>((ok) => smtp.close(ok));
          }
        },
      );
      let verificationService = '';
      await t.test(
        'email verification tokens are single-use, expire, bind to the address and gate only new orders',
        async () => {
          const { Mailer } = await import('../apps/api/dist/mailer.js');
          const mail = app.get(Mailer),
            originalTemplate = mail.template;
          const captured: { key: string; values: Record<string, string> }[] = [];
          mail.template = async (_to: string, key: string, values: Record<string, string>) => {
            captured.push({ key, values });
            return true;
          };
          const current = (await call('/settings')).body.data;
          try {
            const registered = await call('/auth/register', 'POST', {
              name: 'Verify customer',
              email: 'verify-settings@example.com',
              password: 'settings-verification-password',
            });
            assert.equal(registered.status, 201, JSON.stringify(registered.body));
            const cookie = registered.cookie,
              userId = registered.body.data.id;
            const address = (await db.user.findUniqueOrThrow({ where: { id: ledgerUserId } }))
              .billingAddress;
            assert.equal(
              (await call('/profile', 'PATCH', { billingAddress: address }, cookie)).status,
              200,
            );
            await call(
              '/settings',
              'PATCH',
              { access: { ...current.access, requireVerifiedEmail: true } },
              admin,
            );
            assert.equal(
              (await call('/orders', 'POST', { productId, idempotencyKey: randomUUID() }, cookie))
                .status,
              403,
            );
            assert.equal((await call('/auth/verification/resend', 'POST', {}, cookie)).status, 201);
            const first = new URL(captured.at(-1)!.values.link).searchParams.get('token')!;
            const persisted = await db.verificationToken.findFirstOrThrow({ where: { userId } });
            assert.notEqual(persisted.id, first);
            assert.equal(persisted.email, 'verify-settings@example.com');
            assert.equal((await call('/auth/verification/resend', 'POST', {}, cookie)).status, 409);
            await db.verificationToken.update({
              where: { id: persisted.id },
              data: { expiresAt: new Date(0), createdAt: new Date(0) },
            });
            assert.equal(
              (await call('/auth/verification/confirm', 'POST', { token: first })).status,
              401,
            );
            assert.equal((await call('/auth/verification/resend', 'POST', {}, cookie)).status, 201);
            const second = new URL(captured.at(-1)!.values.link).searchParams.get('token')!;
            assert.equal(
              (await call('/auth/verification/confirm', 'POST', { token: first })).status,
              401,
            );
            const confirmations = await Promise.all(
              [1, 2].map(() => call('/auth/verification/confirm', 'POST', { token: second })),
            );
            assert.deepEqual(confirmations.map((v) => v.status).sort(), [201, 401]);
            assert((await call('/profile', 'GET', undefined, cookie)).body.data.emailVerifiedAt);
            await db.resource.create({
              data: {
                connectionId,
                kind: 'allocation',
                value: '203.0.113.10:26300',
                config: { ip: '203.0.113.10', port: 26300 },
              },
            });
            const purchased = await call(
              '/orders',
              'POST',
              { productId, idempotencyKey: randomUUID() },
              cookie,
            );
            assert.equal(purchased.status, 201, JSON.stringify(purchased.body));
            verificationService = purchased.body.data.serviceId;
            assert.equal(
              (
                await call(
                  `/customers/${userId}`,
                  'PATCH',
                  { email: 'verify-changed@example.com' },
                  admin,
                )
              ).status,
              200,
            );
            assert.equal(
              (await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt,
              null,
            );
            assert.equal(
              (await call('/auth/verification/confirm', 'POST', { token: second })).status,
              401,
            );
            const fresh = await call('/auth/login', 'POST', {
              email: 'verify-changed@example.com',
              password: 'settings-verification-password',
            });
            assert.equal(fresh.status, 201);
            await call(
              '/profile',
              'PATCH',
              { notificationPreferences: { ticketReplies: false, loginAlerts: false } },
              fresh.cookie,
            );
            await call(
              '/settings',
              'PATCH',
              { notifications: { ...current.notifications, loginEmails: true } },
              admin,
            );
            const alertsBefore = captured.filter((v) => v.key === 'auth.login').length;
            await call('/auth/login', 'POST', {
              email: 'verify-changed@example.com',
              password: 'settings-verification-password',
            });
            assert.equal(captured.filter((v) => v.key === 'auth.login').length, alertsBefore);
            await call(
              '/profile',
              'PATCH',
              { notificationPreferences: { ticketReplies: true, loginAlerts: true } },
              fresh.cookie,
            );
            await call('/auth/login', 'POST', {
              email: 'verify-changed@example.com',
              password: 'settings-verification-password',
            });
            assert.equal(captured.filter((v) => v.key === 'auth.login').length, alertsBefore + 1);
          } finally {
            mail.template = originalTemplate;
            await call(
              '/settings',
              'PATCH',
              { access: current.access, notifications: current.notifications },
              admin,
            );
          }
        },
      );
      await t.test(
        'support settings control ticket creation, attachment uploads, open limits and customer status changes',
        async () => {
          const current = (await call('/settings')).body.data,
            policy = current.supportPolicy;
          try {
            await call(
              '/settings',
              'PATCH',
              { supportPolicy: { ...policy, ticketsEnabled: false } },
              admin,
            );
            assert.equal(
              (
                await call(
                  '/tickets',
                  'POST',
                  { subject: 'Disabled support fixture', body: 'Test support' },
                  ledgerClient,
                )
              ).status,
              403,
            );
            await call(
              '/settings',
              'PATCH',
              {
                supportPolicy: {
                  ...policy,
                  maxOpenTickets: 1,
                  allowAttachments: false,
                  customerCloseEnabled: false,
                },
              },
              admin,
            );
            const created = await call(
              '/tickets',
              'POST',
              { subject: 'Configured support fixture', body: 'Test support' },
              ledgerClient,
            );
            assert.equal(created.status, 201, JSON.stringify(created.body));
            const id = created.body.data.id;
            assert.equal(
              (
                await call(
                  '/tickets',
                  'POST',
                  { subject: 'Excess open ticket fixture', body: 'Test support' },
                  ledgerClient,
                )
              ).status,
              400,
            );
            assert.equal(
              (await call(`/tickets/${id}`, 'PATCH', { status: 'CLOSED' }, ledgerClient)).status,
              403,
            );
            const form = new FormData();
            form.append('body', 'Reply with attachment');
            form.append('attachment', new Blob(['fixture'], { type: 'text/plain' }), 'fixture.txt');
            const upload = await fetch(base + `/tickets/${id}/messages`, {
              method: 'POST',
              headers: { Cookie: ledgerClient, Origin: 'http://localhost:3000' },
              body: form,
            });
            assert.equal(upload.status, 403);
            assert.equal(
              (await call(`/tickets/${id}`, 'PATCH', { status: 'CLOSED' }, admin)).status,
              200,
            );
          } finally {
            await call('/settings', 'PATCH', { supportPolicy: policy }, admin);
          }
        },
      );
      await t.test(
        'billing settings control renewal lead times, opt-in wallet collection and delayed suspension jobs',
        async () => {
          const current = (await call('/settings')).body.data;
          clientAddress = '127.0.0.3';
          const account = await call('/auth/register', 'POST', {
            name: 'Autopay fixture',
            email: 'autopay-settings@example.com',
            password: 'autopay-settings-password',
          });
          assert.equal(account.status, 201, JSON.stringify(account.body));
          const autopayClient = account.cookie,
            userId = account.body.data.id;
          const address = (await db.user.findUniqueOrThrow({ where: { id: ledgerUserId } }))
            .billingAddress;
          await call('/profile', 'PATCH', { billingAddress: address }, autopayClient);
          for (const [currency, balance] of [
            ['USD', 2000],
            ['GBP', 700],
          ] as const)
            await db.wallet.create({
              data: {
                userId,
                currency,
                balance,
                entries: {
                  create: {
                    amount: balance,
                    balanceAfter: balance,
                    kind: 'OPENING',
                    reference: `test-opening-${currency}-${userId}`,
                    description: 'Isolated test opening balance',
                  },
                },
              },
            });

          const auto = {
            ...current.automation,
            invoiceDueDays: 3,
            renewalLeadDays: 0,
            automaticRenewalCredit: true,
            autoSuspendEnabled: false,
          };
          try {
            await call('/settings', 'PATCH', { automation: auto }, admin);
            const original = await db.product.findUniqueOrThrow({ where: { id: productId } });
            const plan = await call(
              '/products',
              'POST',
              {
                name: 'Settings renewal fixture',
                description: 'Automation configuration fixture',
                category: 'game',
                provider: 'wings',
                price: 200,
                taxable: false,
                active: true,
                connectionId,
                spec: original.spec,
              },
              admin,
            );
            assert.equal(plan.status, 201);
            await db.resource.create({
              data: {
                connectionId,
                kind: 'allocation',
                value: '203.0.113.10:26301',
                config: { ip: '203.0.113.10', port: 26301 },
              },
            });
            const purchased = await call(
              '/orders',
              'POST',
              { productId: plan.body.data.id, idempotencyKey: randomUUID() },
              autopayClient,
            );
            assert.equal(purchased.status, 201, JSON.stringify(purchased.body));
            const initial = await db.invoice.findUniqueOrThrow({
              where: { id: purchased.body.data.invoiceId },
            });
            assert(
              Math.abs(initial.dueAt.getTime() - initial.createdAt.getTime() - 3 * 86400000) <
                10000,
            );
            assert.equal(
              (
                await call(
                  `/invoices/${initial.id}/manual-payment`,
                  'POST',
                  { reference: `settings-renewal-initial-${randomUUID()}` },
                  admin,
                )
              ).status,
              201,
            );
            const serviceId = purchased.body.data.serviceId,
              start = new Date(Date.now() + 2 * 86400000);
            await db.service.update({
              where: { id: serviceId },
              data: { status: 'ACTIVE', nextDueAt: start, externalId: 'settings-fixture' },
            });
            const jobs = app.get(Jobs);
            await jobs.maintenance();
            assert.equal(await db.invoice.count({ where: { serviceId } }), 1);
            await call(
              '/settings',
              'PATCH',
              { automation: { ...auto, renewalLeadDays: 3 } },
              admin,
            );
            await jobs.maintenance();
            const renewal = await db.invoice.findUniqueOrThrow({
              where: { serviceId_periodStart: { serviceId, periodStart: start } },
            });
            assert.equal(renewal.status, 'UNPAID');
            assert.equal(renewal.amount, 200);
            const balance = (await call('/wallet?currency=USD', 'GET', undefined, autopayClient))
              .body.data.balance;
            const sterling = (await call('/wallet?currency=GBP', 'GET', undefined, autopayClient))
              .body.data.balance;
            assert.equal(
              (await call('/profile', 'PATCH', { autoPayWallet: true }, autopayClient)).status,
              200,
            );
            await Promise.all([jobs.maintenance(), jobs.maintenance()]);
            assert.equal(
              (await db.invoice.findUniqueOrThrow({ where: { id: renewal.id } })).status,
              'PAID',
            );
            assert.equal(
              (await call('/wallet?currency=USD', 'GET', undefined, autopayClient)).body.data
                .balance,
              balance - 200,
            );
            assert.equal(
              (await call('/wallet?currency=GBP', 'GET', undefined, autopayClient)).body.data
                .balance,
              sterling,
            );
            assert.equal(
              await db.payment.count({ where: { invoiceId: renewal.id, gateway: 'wallet' } }),
              1,
            );
            await call('/profile', 'PATCH', { autoPayWallet: false }, autopayClient);
            const late = new Date(Date.now() - 10 * 86400000);
            await db.service.update({ where: { id: serviceId }, data: { nextDueAt: late } });
            await jobs.maintenance();
            assert.equal(await db.operation.count({ where: { serviceId, action: 'suspend' } }), 0);
            await call(
              '/settings',
              'PATCH',
              { automation: { ...auto, renewalLeadDays: 3, autoSuspendEnabled: true } },
              admin,
            );
            await jobs.maintenance();
            const operation = await db.operation.findFirstOrThrow({
              where: { serviceId, action: 'suspend', status: 'PENDING' },
            });
            await call(
              '/settings',
              'PATCH',
              { automation: { ...auto, unpaidOrderExpiryHours: 1 } },
              admin,
            );
            await jobs.execute(operation.id);
            assert.equal(
              (await db.service.findUniqueOrThrow({ where: { id: serviceId } })).status,
              'ACTIVE',
            );
            assert.equal(
              (await db.operation.findUniqueOrThrow({ where: { id: operation.id } })).status,
              'COMPLETE',
            );
            await db.service.update({
              where: { id: verificationService },
              data: { createdAt: new Date(Date.now() - 2 * 3600000) },
            });
            await jobs.maintenance();
            assert.equal(
              (await db.service.findUniqueOrThrow({ where: { id: verificationService } })).status,
              'TERMINATED',
            );
          } finally {
            await call('/settings', 'PATCH', { automation: current.automation }, admin);
            await call('/profile', 'PATCH', { autoPayWallet: false }, autopayClient);
          }
        },
      );
      await t.test(
        'system monitoring protects logs, redacts request secrets and serializes maintenance',
        async () => {
          const { SystemMonitor } = await import('../apps/api/dist/system-monitor.js');
          const monitor = app.get(SystemMonitor);
          assert.equal((await call('/admin/system', 'GET', undefined, ledgerClient)).status, 403);
          assert.equal(
            (await call('/admin/system/http', 'GET', undefined, ledgerClient)).status,
            403,
          );
          const response = await fetch(base + '/profile?token=never-log-this-token', {
            headers: { Cookie: admin, 'X-Custom-Secret': 'never-log-this-header' },
          });
          assert.equal(response.status, 200);
          const requestId = response.headers.get('x-request-id');
          assert(requestId);
          let record: any;
          for (let attempt = 0; attempt < 50; attempt++) {
            record = await db.httpLog.findUnique({ where: { id: requestId } });
            if (record) break;
            await new Promise((r) => setTimeout(r, 10));
          }
          assert(record);
          assert.equal(record.status, 200);
          assert.equal(record.path, '/api/v1/profile');
          assert(!JSON.stringify(record).includes('never-log'));
          assert(record.actorId);
          const logs = (
            await call(
              `/admin/system/http?errorsOnly=false&search=${requestId}`,
              'GET',
              undefined,
              admin,
            )
          ).body.data;
          assert.equal(logs.items[0].id, requestId);
          const audit = (
            await call('/admin/system/audit?search=settings.updated', 'GET', undefined, admin)
          ).body.data;
          assert(audit.total > 0);
          let started = 0,
            release!: () => void;
          const waiting = new Promise<void>((r) => {
            release = r;
          });
          const first = monitor.maintenance(async () => {
            started++;
            await waiting;
          }, 'manual');
          for (let attempt = 0; attempt < 50; attempt++) {
            if (started) break;
            await new Promise((r) => setTimeout(r, 10));
          }
          assert.equal(started, 1);
          const second = await monitor.maintenance(async () => {
            started++;
          }, 'manual');
          assert.equal(second.skipped, true);
          release();
          assert.equal((await first).complete, true);
          assert.equal(started, 1);
          const failed = await monitor.maintenance(async () => {
            throw new Error('private fixture error must not persist');
          }, 'manual');
          assert.equal(failed.complete, false);
          const run = await db.systemRun.findUniqueOrThrow({ where: { id: failed.id } });
          assert.equal(run.status, 'FAILED');
          assert.equal(run.errorCode, 'MAINTENANCE_FAILED');
          assert(!JSON.stringify(run).includes('private fixture'));
          const expired = await db.systemRun.create({
            data: {
              task: 'maintenance',
              origin: 'scheduled',
              status: 'RUNNING',
              leaseUntil: new Date(0),
            },
          });
          assert.equal((await monitor.maintenance(async () => {}, 'manual')).complete, true);
          assert.equal(
            (await db.systemRun.findUniqueOrThrow({ where: { id: expired.id } })).errorCode,
            'LEASE_EXPIRED',
          );
          const status = (await call('/admin/system', 'GET', undefined, admin)).body.data;
          assert.equal(status.database, 'connected');
          assert(Array.isArray(status.recentRuns));
          assert.equal(typeof status.operations, 'object');
          assert.equal(
            (await call('/admin/system/jobs?status=FAILED', 'GET', undefined, admin)).status,
            200,
          );
          assert.equal(
            (await call('/admin/system/maintenance', 'POST', {}, ledgerClient)).status,
            403,
          );
        },
      );
      clientAddress = '127.0.0.4';
      let cartOwner = '',
        cartOwnerId = '',
        cartPlanA = '',
        cartPlanB = '';
      const cartCustomer = async (tag: string, country?: string) => {
        const r = await call('/auth/register', 'POST', {
          name: `Cart ${tag}`,
          email: `cart-${tag}@example.com`,
          password: 'cart-customer-password',
        });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const billing = (await db.user.findUniqueOrThrow({ where: { id: ledgerUserId } }))
          .billingAddress as any;
        await call(
          '/profile',
          'PATCH',
          { billingAddress: { ...billing, ...(country ? { country } : {}) } },
          r.cookie,
        );
        return { cookie: r.cookie, id: r.body.data.id };
      };
      const cartResources = async (nodeId: string, port: number, count: number) => {
        for (let n = 0; n < count; n++)
          await db.resource.create({
            data: {
              connectionId: nodeId,
              kind: 'allocation',
              value: `203.0.113.55:${port + n}`,
              config: { ip: '203.0.113.55', port: port + n },
            },
          });
      };
      const cartPlan = async (name: string, price: number, extra: any = {}) => {
        const r = await call(
          '/products',
          'POST',
          {
            name,
            description: 'Cart contract fixture',
            category: 'game',
            provider: 'wings',
            active: true,
            connectionId,
            price,
            taxable: false,
            spec: { memoryMb: 1024, diskMb: 10240, cpu: 1 },
            ...extra,
          },
          admin,
        );
        assert.equal(r.status, 201, JSON.stringify(r.body));
        return r.body.data.id;
      };
      const cartAdd = async (cookie: string, productId: string, extra: any = {}) => {
        const current = (await call('/cart', 'GET', undefined, cookie)).body.data;
        const r = await call(
          '/cart/items',
          'POST',
          { expectedVersion: current.version, item: { productId, ...extra } },
          cookie,
        );
        assert.equal(r.status, 201, JSON.stringify(r.body));
        return r.body.data;
      };
      const cartCheckout = (cart: any, key = randomUUID()) => ({
        cartId: cart.id,
        expectedVersion: cart.version,
        expectedQuoteId: cart.quoteId,
        idempotencyKey: key,
      });
      const cartClear = async (cookie: string) => {
        let current = (await call('/cart', 'GET', undefined, cookie)).body.data;
        while (current.items.length) {
          const r = await call(
            `/cart/items/${current.items[0].id}`,
            'DELETE',
            { cartId: current.id, expectedVersion: current.version },
            cookie,
          );
          assert.equal(r.status, 200);
          current = r.body.data;
        }
      };
      await t.test(
        'cart items are owned, versioned, repriced and removable without reserving services',
        async () => {
          const customer = await cartCustomer('owner');
          cartOwner = customer.cookie;
          cartOwnerId = customer.id;
          cartPlanA = await cartPlan('Cart Alpha', 400);
          cartPlanB = await cartPlan('Cart Beta', 600);
          await cartResources(connectionId, 26500, 8);
          const first = await cartAdd(cartOwner, cartPlanA);
          assert.equal(first.ready, true);
          assert.equal(first.total, 400);
          assert.equal(
            (
              await call(
                '/cart/items',
                'POST',
                { expectedVersion: 0, item: { productId: cartPlanB } },
                cartOwner,
              )
            ).status,
            409,
          );
          const second = await cartAdd(cartOwner, cartPlanB);
          assert.equal(second.total, 1000);
          assert.equal(second.items.length, 2);
          assert.equal(
            (
              await call(
                `/cart/items/${second.items[0].id}`,
                'DELETE',
                { cartId: second.id, expectedVersion: second.version },
                other,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await call(
                `/cart/items/${second.items[0].id}`,
                'DELETE',
                { cartId: second.id, expectedVersion: second.version - 1 },
                cartOwner,
              )
            ).status,
            409,
          );
          const quote = cartCheckout(second);
          await db.product.update({ where: { id: cartPlanA }, data: { price: 500 } });
          assert.equal((await call('/cart/checkout', 'POST', quote, cartOwner)).status, 409);
          assert.equal(await db.order.count({ where: { userId: cartOwnerId } }), 0);
          await db.product.update({ where: { id: cartPlanA }, data: { price: 400 } });
          await cartClear(cartOwner);
          assert.equal(
            (await call('/cart', 'GET', undefined, cartOwner)).body.data.items.length,
            0,
          );
        },
      );
      await t.test(
        'one cart invoice allocates resources once and fulfills every service only after full payment',
        async () => {
          await cartAdd(cartOwner, cartPlanA);
          const cart = await cartAdd(cartOwner, cartPlanB);
          const body = cartCheckout(cart);
          const placed = await Promise.all(
            [1, 2].map(() => call('/cart/checkout', 'POST', body, cartOwner)),
          );
          assert(
            placed.every((r) => r.status === 201),
            JSON.stringify(placed),
          );
          assert.equal(placed[0].body.data.invoiceId, placed[1].body.data.invoiceId);
          const id = placed[0].body.data.invoiceId;
          let invoice = await db.invoice.findUniqueOrThrow({
            where: { id },
            include: { linkedServices: { include: { service: true } } },
          });
          assert.equal(invoice.kind, 'CART');
          assert.equal(invoice.amount, 1000);
          assert.equal(invoice.serviceId, null);
          assert.equal(invoice.linkedServices.length, 2);
          assert.equal(
            invoice.linkedServices.reduce((sum, l) => sum + l.amount, 0),
            1000,
          );
          assert.equal(await db.invoice.count({ where: { userId: cartOwnerId } }), 1);
          assert.equal(await db.order.count({ where: { userId: cartOwnerId } }), 2);
          assert.equal(
            await db.operation.count({ where: { service: { userId: cartOwnerId } } }),
            0,
          );
          assert.equal((await call(`/invoices/${id}`, 'GET', undefined, other)).status, 404);
          assert.equal(
            (
              await call(
                '/cart/checkout',
                'POST',
                { ...body, expectedVersion: body.expectedVersion + 1 },
                cartOwner,
              )
            ).status,
            409,
          );
          await db.wallet.create({
            data: {
              userId: cartOwnerId,
              currency: 'USD',
              balance: 2000,
              entries: {
                create: {
                  amount: 2000,
                  balanceAfter: 2000,
                  kind: 'OPENING',
                  reference: `cart-opening-${cartOwnerId}`,
                  description: 'Isolated cart fixture opening balance',
                },
              },
            },
          });
          assert.equal(
            (
              await call(
                `/invoices/${id}/wallet-payment`,
                'POST',
                { amount: 400, idempotencyKey: randomUUID() },
                cartOwner,
              )
            ).status,
            201,
          );
          assert.equal(
            await db.operation.count({ where: { service: { userId: cartOwnerId } } }),
            0,
          );
          const reference = `cart-bank-${randomUUID()}`;
          assert.equal(
            (
              await call(
                `/invoices/${id}/manual-payment`,
                'POST',
                { reference, amount: 600 },
                admin,
              )
            ).status,
            201,
          );
          assert.equal(
            (
              await call(
                `/invoices/${id}/manual-payment`,
                'POST',
                { reference, amount: 600 },
                admin,
              )
            ).status,
            201,
          );
          invoice = await db.invoice.findUniqueOrThrow({
            where: { id },
            include: { linkedServices: { include: { service: true } } },
          });
          assert.equal(invoice.status, 'PAID');
          assert.equal(invoice.paidAmount, 1000);
          assert(invoice.linkedServices.every((l) => l.service.nextDueAt));
          const ops = await db.operation.findMany({
            where: { service: { userId: cartOwnerId }, action: 'provision' },
          });
          assert.equal(ops.length, 2);
          assert.notEqual(ops[0].idempotencyKey, ops[1].idempotencyKey);
          await app.get(Jobs).execute(ops[0].id);
          assert.equal(
            (await db.operation.findUniqueOrThrow({ where: { id: ops[0].id } })).status,
            'COMPLETE',
          );
          assert.equal(
            (await call('/wallet?currency=USD', 'GET', undefined, cartOwner)).body.data.balance,
            1600,
          );
          assert.equal(
            (
              await call(
                `/invoices/${id}/cancel-checkout`,
                'POST',
                { reason: 'Cannot cancel paid checkout' },
                cartOwner,
              )
            ).status,
            409,
          );
        },
      );
      await t.test(
        'competing carts cannot oversell stock or hold partial allocations after a failed batch',
        async () => {
          const limited = await cartPlan('Cart last stock', 300, { stock: 1, perCustomerLimit: 1 }),
            left = await cartCustomer('stock-left'),
            right = await cartCustomer('stock-right');
          await cartAdd(left.cookie, cartPlanA);
          const a = await cartAdd(left.cookie, limited),
            b = await cartAdd(right.cookie, limited);
          const sequence = await db.invoiceSequence.findUniqueOrThrow({
            where: { id: 'installation' },
          });
          const orders = await Promise.all([
            call('/cart/checkout', 'POST', cartCheckout(a), left.cookie),
            call('/cart/checkout', 'POST', cartCheckout(b), right.cookie),
          ]);
          assert.equal(orders.filter((r) => r.status === 201).length, 1, JSON.stringify(orders));
          assert.equal(orders.filter((r) => r.status === 409).length, 1);
          const loser = orders[0].status === 201 ? right : left,
            winner = orders[0].status === 201 ? left : right,
            success = orders.find((r) => r.status === 201)!.body.data;
          assert.equal(await db.service.count({ where: { userId: loser.id } }), 0);
          assert.equal(await db.order.count({ where: { userId: loser.id } }), 0);
          assert.equal(await db.invoice.count({ where: { userId: loser.id } }), 0);
          assert.equal(
            (await db.invoiceSequence.findUniqueOrThrow({ where: { id: 'installation' } }))
              .lastNumber,
            sequence.lastNumber + 1,
          );
          assert.equal(
            await db.service.count({
              where: { productId: limited, status: { not: 'TERMINATED' } },
            }),
            1,
          );
          assert.equal(
            (
              await call(
                `/invoices/${success.invoiceId}/void`,
                'POST',
                { reason: 'Use the cart cancellation route' },
                admin,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await call(
                `/invoices/${success.invoiceId}/cancel-checkout`,
                'POST',
                { reason: 'Release unpaid cart stock' },
                winner.cookie,
              )
            ).status,
            201,
          );
          assert.equal(
            await db.service.count({ where: { userId: winner.id, status: { not: 'TERMINATED' } } }),
            0,
          );
          assert.equal((await call('/cart', 'GET', undefined, loser.cookie)).body.data.ready, true);
          const nodeConfig = await db.connection.findUniqueOrThrow({ where: { id: connectionId } });
          const createdNode = await call(
            '/nodes',
            'POST',
            {
              name: 'Cart scarce node',
              provider: 'wings',
              url: nodeConfig.url,
              config: nodeConfig.config,
              secret: { tokenId: 'cart-scarce', token: 'cart-scarce-daemon-token-'.repeat(3) },
            },
            admin,
          );
          assert.equal(createdNode.status, 201);
          const scarce = createdNode.body.data.id;
          await call(`/nodes/${scarce}/check`, 'POST', {}, admin);
          await cartResources(scarce, 26600, 3);
          const constrained = await cartPlan('Cart shared allocations', 200, {
              connectionId: scarce,
            }),
            c = await cartCustomer('capacity-left'),
            d = await cartCustomer('capacity-right');
          await cartAdd(c.cookie, constrained);
          const cq = await cartAdd(c.cookie, constrained);
          await cartAdd(d.cookie, constrained);
          const dq = await cartAdd(d.cookie, constrained);
          assert(cq.ready && dq.ready);
          const race = await Promise.all([
            call('/cart/checkout', 'POST', cartCheckout(cq), c.cookie),
            call('/cart/checkout', 'POST', cartCheckout(dq), d.cookie),
          ]);
          assert.equal(race.filter((r) => r.status === 201).length, 1, JSON.stringify(race));
          assert.equal(race.filter((r) => r.status === 409).length, 1);
          const capacityLoser = race[0].status === 201 ? d : c,
            capacityWinner = race[0].status === 201 ? c : d;
          assert.equal(await db.order.count({ where: { userId: capacityLoser.id } }), 0);
          assert.equal(
            await db.resource.count({ where: { connectionId: scarce, serviceId: { not: null } } }),
            2,
          );
          const invoiceId = race.find((r) => r.status === 201)!.body.data.invoiceId;
          await call(
            `/invoices/${invoiceId}/cancel-checkout`,
            'POST',
            { reason: 'Release capacity fixture' },
            capacityWinner.cookie,
          );
          assert.equal(
            await db.resource.count({ where: { connectionId: scarce, serviceId: { not: null } } }),
            0,
          );
        },
      );
      await t.test(
        'cart tax rounds once after discounts and mixed currencies cannot create an invoice',
        async () => {
          const before = (await call('/settings')).body.data;
          const buyer = await cartCustomer('tax', 'NL'),
            tiny = await cartPlan('Cart taxable cents', 5, { taxable: true }),
            untaxed = await cartPlan('Cart exempt cents', 5);
          const oldRate = await db.taxRate.findUnique({ where: { country: 'NL' } });
          await db.taxRate.upsert({
            where: { country: 'NL' },
            create: { country: 'NL', name: 'Cart VAT', basisPoints: 1000 },
            update: { name: 'Cart VAT', basisPoints: 1000, active: true },
          });
          try {
            await call('/settings', 'PATCH', { taxEnabled: true, taxInclusive: false }, admin);
            await cartAdd(buyer.cookie, tiny);
            await cartAdd(buyer.cookie, tiny);
            let cart = await cartAdd(buyer.cookie, untaxed);
            assert.equal(cart.total, 16);
            assert.equal(cart.tax.amount, 1);
            assert.equal(
              cart.items.reduce((sum, i) => sum + i.cartAmount, 0),
              16,
            );
            let placed = await call('/cart/checkout', 'POST', cartCheckout(cart), buyer.cookie);
            assert.equal(placed.status, 201, JSON.stringify(placed.body));
            let invoice = await db.invoice.findUniqueOrThrow({
              where: { id: placed.body.data.invoiceId },
              include: { lineItems: true, linkedServices: true },
            });
            assert.equal(invoice.amount, 16);
            assert.equal((invoice.billingSnapshot as any).pricing.tax.net, 15);
            assert.equal(invoice.lineItems.filter((i) => i.taxable).length, 2);
            assert.equal(
              invoice.linkedServices.reduce((sum, l) => sum + l.amount, 0),
              16,
            );
            await call(
              `/invoices/${invoice.id}/cancel-checkout`,
              'POST',
              { reason: 'End tax fixture' },
              buyer.cookie,
            );
            await call('/settings', 'PATCH', { taxInclusive: true }, admin);
            await cartAdd(buyer.cookie, tiny);
            await cartAdd(buyer.cookie, tiny);
            cart = await cartAdd(buyer.cookie, untaxed);
            assert.equal(cart.total, 15);
            assert.equal(cart.tax.amount, 1);
            placed = await call('/cart/checkout', 'POST', cartCheckout(cart), buyer.cookie);
            assert.equal(placed.status, 201);
            invoice = await db.invoice.findUniqueOrThrow({
              where: { id: placed.body.data.invoiceId },
              include: { lineItems: true, linkedServices: true },
            });
            assert.equal((invoice.billingSnapshot as any).pricing.tax.net, 14);
            await call(
              `/invoices/${invoice.id}/cancel-checkout`,
              'POST',
              { reason: 'End inclusive tax fixture' },
              buyer.cookie,
            );
            const region = await db.pricingRegion.upsert({
              where: { country: 'NL' },
              create: { country: 'NL', name: 'Cart region', currency: 'EUR' },
              update: { currency: 'EUR', active: true },
            });
            await db.regionalPrice.upsert({
              where: { productId_regionId: { productId: cartPlanA, regionId: region.id } },
              create: { productId: cartPlanA, regionId: region.id, amount: 350 },
              update: { amount: 350 },
            });
            await call('/settings', 'PATCH', { regionalPricingEnabled: true }, admin);
            await cartAdd(buyer.cookie, cartPlanA);
            cart = await cartAdd(buyer.cookie, cartPlanB);
            assert.equal(cart.ready, false);
            assert.equal(cart.total, 0);
            assert(cart.errors.some((e: string) => e.includes('one currency')));
            assert.equal(
              (await call('/cart/checkout', 'POST', cartCheckout(cart), buyer.cookie)).status,
              409,
            );
            await cartClear(buyer.cookie);
          } finally {
            await call(
              '/settings',
              'PATCH',
              {
                taxEnabled: before.taxEnabled,
                taxInclusive: before.taxInclusive,
                regionalPricingEnabled: before.regionalPricingEnabled,
              },
              admin,
            );
            if (oldRate)
              await db.taxRate.update({
                where: { id: oldRate.id },
                data: {
                  name: oldRate.name,
                  basisPoints: oldRate.basisPoints,
                  active: oldRate.active,
                },
              });
            else await db.taxRate.delete({ where: { country: 'NL' } });
          }
        },
      );
      await t.test(
        'part-paid cart cancellation and expiry preserve receipts while releasing every reservation',
        async () => {
          const buyer = await cartCustomer('cancel');
          await cartAdd(buyer.cookie, cartPlanA);
          let cart = await cartAdd(buyer.cookie, cartPlanB);
          let placed = await call('/cart/checkout', 'POST', cartCheckout(cart), buyer.cookie);
          assert.equal(placed.status, 201);
          const id = placed.body.data.invoiceId;
          assert.equal(
            (
              await call(
                `/invoices/${id}/manual-payment`,
                'POST',
                { reference: `cart-partial-${randomUUID()}`, amount: 100 },
                admin,
              )
            ).status,
            201,
          );
          assert.equal(
            (
              await call(
                `/invoices/${id}/cancel-checkout`,
                'POST',
                { reason: 'Customer cannot abandon allocated money' },
                buyer.cookie,
              )
            ).status,
            409,
          );
          const child = await db.service.findFirstOrThrow({ where: { userId: buyer.id } });
          assert.equal(
            (
              await call(
                `/services/${child.id}/cancellations`,
                'POST',
                {
                  mode: 'IMMEDIATE',
                  reason: 'Cancel this whole unpaid checkout',
                  confirmation: child.name,
                },
                buyer.cookie,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await call(
                `/invoices/${id}/cancel-checkout`,
                'POST',
                { reason: 'Staff reconciles the partial receipt' },
                admin,
              )
            ).status,
            201,
          );
          let invoice = await db.invoice.findUniqueOrThrow({
            where: { id },
            include: { payments: true },
          });
          assert.equal(invoice.status, 'VOID');
          assert.equal(invoice.paidAmount, 100);
          assert.equal(invoice.payments[0].reviewRequired, true);
          assert.equal(
            await db.service.count({ where: { userId: buyer.id, status: { not: 'TERMINATED' } } }),
            0,
          );
          const reference = `cart-late-${randomUUID()}`;
          await call(`/invoices/${id}/manual-payment`, 'POST', { reference, amount: 50 }, admin);
          await call(`/invoices/${id}/manual-payment`, 'POST', { reference, amount: 50 }, admin);
          invoice = await db.invoice.findUniqueOrThrow({
            where: { id },
            include: { payments: true },
          });
          assert.equal(invoice.paidAmount, 100);
          assert.equal(invoice.payments.length, 2);
          assert.equal(invoice.payments.find((p) => p.externalId === reference)!.appliedAmount, 0);
          assert.equal(await db.operation.count({ where: { service: { userId: buyer.id } } }), 0);
          await cartAdd(buyer.cookie, cartPlanA);
          cart = await cartAdd(buyer.cookie, cartPlanB);
          placed = await call('/cart/checkout', 'POST', cartCheckout(cart), buyer.cookie);
          assert.equal(placed.status, 201);
          await db.invoice.update({
            where: { id: placed.body.data.invoiceId },
            data: { dueAt: new Date(Date.now() - 1000) },
          });
          await app.get(Jobs).maintenance();
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: placed.body.data.invoiceId } }))
              .status,
            'VOID',
          );
          assert.equal(
            await db.service.count({ where: { userId: buyer.id, status: { not: 'TERMINATED' } } }),
            0,
          );
        },
      );
      await t.test(
        'cart coupons reserve per service and zero-total checkout commits payment and provisioning atomically',
        async () => {
          const buyer = await cartCustomer('coupon');
          const coupon = await call(
            '/coupons',
            'POST',
            {
              code: 'CARTFIRST',
              type: 'PERCENT',
              value: 10000,
              firstPurchaseOnly: true,
              perCustomerLimit: 1,
              productIds: [cartPlanB],
            },
            admin,
          );
          assert.equal(coupon.status, 201);
          await cartAdd(buyer.cookie, cartPlanA);
          const cart = await cartAdd(buyer.cookie, cartPlanB, { couponCode: 'CARTFIRST' });
          assert.equal(cart.total, 400);
          const placed = await call('/cart/checkout', 'POST', cartCheckout(cart), buyer.cookie);
          assert.equal(placed.status, 201, JSON.stringify(placed.body));
          assert.equal(
            await db.couponRedemption.count({ where: { userId: buyer.id, state: 'RESERVED' } }),
            1,
          );
          await call(
            `/invoices/${placed.body.data.invoiceId}/cancel-checkout`,
            'POST',
            { reason: 'Release reserved first-purchase coupon' },
            buyer.cookie,
          );
          assert.equal(
            await db.couponRedemption.count({ where: { userId: buyer.id, state: 'RELEASED' } }),
            1,
          );
          const free = await cartPlan('Cart free service', 0, { cycle: 'free' });
          await cartAdd(buyer.cookie, free);
          const zero = await cartAdd(buyer.cookie, free),
            body = cartCheckout(zero),
            payments = app.get(Payments),
            original = payments.settle;
          payments.settle = async () => {
            throw new Error('Simulated failure before zero checkout commit');
          };
          try {
            assert.equal((await call('/cart/checkout', 'POST', body, buyer.cookie)).status, 500);
          } finally {
            payments.settle = original;
          }
          assert.equal((await call('/cart', 'GET', undefined, buyer.cookie)).body.data.id, zero.id);
          assert.equal(await db.invoice.count({ where: { userId: buyer.id, status: 'PAID' } }), 0);
          assert.equal(
            await db.service.count({ where: { userId: buyer.id, status: { not: 'TERMINATED' } } }),
            0,
          );
          const recovered = await call('/cart/checkout', 'POST', body, buyer.cookie);
          assert.equal(recovered.status, 201, JSON.stringify(recovered.body));
          const invoice = await db.invoice.findUniqueOrThrow({
            where: { id: recovered.body.data.invoiceId },
            include: { payments: true, linkedServices: { include: { service: true } } },
          });
          assert.equal(invoice.amount, 0);
          assert.equal(invoice.status, 'PAID');
          assert.equal(invoice.payments.length, 1);
          assert.equal(invoice.payments[0].gateway, 'promotion');
          assert(invoice.linkedServices.every((l) => l.service.nextDueAt === null));
          assert.equal(
            await db.operation.count({
              where: { service: { userId: buyer.id }, action: 'provision' },
            }),
            2,
          );
          assert.equal(
            (await call('/cart/checkout', 'POST', body, buyer.cookie)).body.data.invoiceId,
            invoice.id,
          );
          assert.equal(await db.payment.count({ where: { invoiceId: invoice.id } }), 1);
        },
      );
      clientAddress = '127.0.0.5';
      const setupCustomer = (
        await call('/auth/register', 'POST', {
          name: 'Node setup customer',
          email: `node-setup-${randomUUID()}@example.test`,
          password: 'node-setup-customer-password',
        })
      ).cookie;
      assert(setupCustomer);
      let setupNode = '',
        setupGrant: any;
      const setupOptions = {
        tlsMode: 'none',
        addAllocations: true,
        allocationIp: '203.0.113.90',
        portStart: 25600,
        portEnd: 25602,
      };
      const setupAuth = (g: any) => ({ Authorization: `Bearer ${g.token}` });
      const issueSetup = async () => {
        const r = await call(`/nodes/${setupNode}/installations`, 'POST', setupOptions, admin);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        return r.body.data;
      };
      await t.test(
        'node setup grants are staff-only, unique, revocable and never return daemon credentials',
        async () => {
          const created = await call(
            '/nodes',
            'POST',
            {
              name: 'Automatic node fixture',
              provider: 'wings',
              url: `http://127.0.0.1:${(node.address() as any).port}`,
              secret: {},
              config: {},
            },
            admin,
          );
          assert.equal(created.status, 201);
          setupNode = created.body.data.id;
          assert.equal(
            (await call(`/nodes/${setupNode}/installations`, 'POST', setupOptions, setupCustomer))
              .status,
            403,
          );
          assert.equal((await call(`/nodes/${setupNode}/installations`)).status, 401);
          assert.equal(
            (await call(`/nodes/${setupNode}/installations`, 'GET', undefined, setupCustomer))
              .status,
            403,
          );
          const first = await issueSetup();
          setupGrant = await issueSetup();
          assert.notEqual(first.token, setupGrant.token);
          const stale = await call(
            `/node-setup/${first.id}/claim`,
            'POST',
            { machineKey: 'a'.repeat(64) },
            '',
            setupAuth(first),
          );
          assert.equal(stale.status, 401);
          const stored = await db.nodeInstallation.findUniqueOrThrow({
            where: { id: setupGrant.id },
          });
          assert.notEqual(stored.tokenHash, setupGrant.token);
          const history = await call(`/nodes/${setupNode}/installations`, 'GET', undefined, admin);
          assert.equal(history.status, 200);
          assert(!JSON.stringify(history.body).includes(setupGrant.token));
          assert(!JSON.stringify(history.body).includes(stored.tokenHash));
          const noAuth = await fetch(`${base}/node-setup/${setupGrant.id}/script`);
          assert.equal(noAuth.status, 401);
          const script = await fetch(`${base}/node-setup/${setupGrant.id}/script`, {
            headers: setupAuth(setupGrant),
          });
          assert.equal(script.status, 200);
          assert.equal(script.headers.get('cache-control'), 'no-store');
          const content = await script.text();
          const config = (await call(`/nodes/${setupNode}/configuration`, 'GET', undefined, admin))
            .body.data.config;
          assert(!content.includes(config.token));
          assert(content.includes(setupGrant.token));
          const file = join(extensionDir, 'generated-node.sh');
          await writeFile(file, content, { mode: 0o600 });
          execFileSync('bash', ['-n', file]);
          assert.match(execFileSync('bash', [file, '--help'], { encoding: 'utf8' }), /Run as root/);
          assert.match(
            execFileSync('bash', [file, '--dry-run'], { encoding: 'utf8' }),
            /No changes made/,
          );
          assert.equal(
            (await db.nodeInstallation.findUniqueOrThrow({ where: { id: setupGrant.id } })).status,
            'WAITING',
          );
          assert(content.includes('sha256sum --check'));
          assert(content.includes('docker-ce'));
          assert(content.includes('certbot certonly'));
          const pinned = await readFile('scripts/install-wings.sh', 'utf8');
          for (const hash of content.match(/checksum=([a-f0-9]{64})/g) || [])
            assert(pinned.includes(hash));
        },
      );
      let winningMachine = '';
      await t.test(
        'a setup grant binds atomically to one machine and resumes only on that machine',
        async () => {
          const results = await Promise.all(
            ['a', 'b'].map((c) =>
              call(
                `/node-setup/${setupGrant.id}/claim`,
                'POST',
                { machineKey: c.repeat(64) },
                '',
                setupAuth(setupGrant),
              ),
            ),
          );
          assert.equal(results.filter((r) => r.status === 201).length, 1);
          assert.equal(results.filter((r) => r.status === 401).length, 1);
          winningMachine = (results[0].status === 201 ? 'a' : 'b').repeat(64);
          const result = results.find((r) => r.status === 201)!;
          assert.equal(result.body.data.config.uuid, setupNode);
          assert.equal(result.body.data.config.system.sftp.bind_port, 2023);
          assert.equal(
            result.body.data.config.system.root_directory,
            `/var/lib/harbor/wings/${setupNode}`,
          );
          assert.equal(result.body.data.config.docker.network.name, `harbor_wings_${setupNode}`);
          assert.equal(result.body.data.config.remote, 'http://localhost:3000');
          assert.equal(
            (
              await call(
                `/node-setup/${setupGrant.id}/claim`,
                'POST',
                { machineKey: winningMachine },
                '',
                setupAuth(setupGrant),
              )
            ).status,
            201,
          );
          assert.equal(
            (
              await fetch(`${base}/node-setup/${setupGrant.id}/script`, {
                headers: setupAuth(setupGrant),
              })
            ).status,
            401,
          );
          assert.equal(
            (await call(`/nodes/${setupNode}/installations`, 'POST', setupOptions, admin)).status,
            409,
          );
          const failed = await call(
            `/node-setup/${setupGrant.id}/progress`,
            'POST',
            { machineKey: winningMachine, step: 'docker', status: 'failed' },
            '',
            setupAuth(setupGrant),
          );
          assert.equal(failed.status, 201);
          assert.equal(failed.body.data.status, 'FAILED');
          assert.equal(
            (
              await call(
                `/node-setup/${setupGrant.id}/claim`,
                'POST',
                { machineKey: winningMachine },
                '',
                setupAuth(setupGrant),
              )
            ).status,
            201,
          );
        },
      );
      await t.test(
        'node completion requires a real health response and registers allocations exactly once',
        async () => {
          rejectNodeHealth = true;
          const body = { machineKey: winningMachine, step: 'verifying', status: 'complete' };
          try {
            assert.equal(
              (
                await call(
                  `/node-setup/${setupGrant.id}/progress`,
                  'POST',
                  body,
                  '',
                  setupAuth(setupGrant),
                )
              ).status,
              409,
            );
          } finally {
            rejectNodeHealth = false;
          }
          assert.equal(await db.resource.count({ where: { connectionId: setupNode } }), 0);
          assert.equal(
            (await db.nodeInstallation.findUniqueOrThrow({ where: { id: setupGrant.id } })).status,
            'RUNNING',
          );
          assert.equal(
            (
              await call(
                `/node-setup/${setupGrant.id}/progress`,
                'POST',
                body,
                '',
                setupAuth(setupGrant),
              )
            ).body.data.status,
            'COMPLETE',
          );
          assert.equal(await db.resource.count({ where: { connectionId: setupNode } }), 3);
          assert.equal(
            (await db.connection.findUniqueOrThrow({ where: { id: setupNode } })).health,
            'ONLINE',
          );
          assert.equal(
            (
              await call(
                `/node-setup/${setupGrant.id}/progress`,
                'POST',
                body,
                '',
                setupAuth(setupGrant),
              )
            ).body.data.status,
            'COMPLETE',
          );
          assert.equal(await db.resource.count({ where: { connectionId: setupNode } }), 3);
          assert.equal(
            (
              await call(
                `/node-setup/${setupGrant.id}/claim`,
                'POST',
                { machineKey: winningMachine },
                '',
                setupAuth(setupGrant),
              )
            ).status,
            401,
          );
          assert.equal(
            await db.auditLog.count({
              where: { targetId: setupGrant.id, action: 'node.installation.completed' },
            }),
            1,
          );
        },
      );
      await t.test(
        'expired, revoked and changed-node setup grants cannot disclose configuration',
        async () => {
          const isolatedNodeConfig = (
            await db.connection.findUniqueOrThrow({ where: { id: setupNode } })
          ).config as any;
          let g = await issueSetup();
          assert.equal(
            (
              await call(
                `/node-setup/${g.id}/progress`,
                'POST',
                { machineKey: 'c'.repeat(64), step: 'docker', status: 'running' },
                '',
                setupAuth(g),
              )
            ).status,
            409,
          );
          await db.nodeInstallation.update({
            where: { id: g.id },
            data: { expiresAt: new Date(Date.now() - 1000) },
          });
          assert.equal(
            (
              await call(
                `/node-setup/${g.id}/claim`,
                'POST',
                { machineKey: 'c'.repeat(64) },
                '',
                setupAuth(g),
              )
            ).status,
            401,
          );
          assert.equal(
            (await call(`/nodes/${setupNode}/installations`, 'GET', undefined, admin)).body.data[0]
              .status,
            'EXPIRED',
          );
          g = await issueSetup();
          assert.equal(
            (await call(`/nodes/${setupNode}/installations/${g.id}/revoke`, 'POST', {}, admin))
              .status,
            201,
          );
          assert.equal(
            (
              await call(
                `/node-setup/${g.id}/claim`,
                'POST',
                { machineKey: 'c'.repeat(64) },
                '',
                setupAuth(g),
              )
            ).status,
            401,
          );
          g = await issueSetup();
          await db.connection.update({
            where: { id: setupNode },
            data: { config: { ...isolatedNodeConfig, listenPort: 12345 } },
          });
          assert.equal(
            (
              await call(
                `/node-setup/${g.id}/claim`,
                'POST',
                { machineKey: 'c'.repeat(64) },
                '',
                setupAuth(g),
              )
            ).status,
            409,
          );
          assert.equal(
            (await call(`/nodes/${setupNode}/installations`, 'POST', setupOptions, admin)).status,
            400,
          );
          await db.connection.update({
            where: { id: setupNode },
            data: { config: isolatedNodeConfig },
          });
          assert.equal(
            (
              await call(
                `/nodes/${setupNode}/installations`,
                'POST',
                { ...setupOptions, portEnd: 25800 },
                admin,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await call(
                `/nodes/${setupNode}/installations`,
                'POST',
                { ...setupOptions, tlsMode: 'auto', email: 'admin@example.com' },
                admin,
              )
            ).status,
            400,
          );
        },
      );
      assert.equal(
        (
          await call(
            `/nodes/${setupNode}/installations`,
            'POST',
            { ...setupOptions, portStart: 2023, portEnd: 2023 },
            admin,
          )
        ).status,
        400,
      );

      await t.test(
        'side-by-side installers update only their own connection and reject unsafe legacy migrations',
        async () => {
          const legacy = await call(
            '/nodes',
            'POST',
            {
              name: 'Legacy coexisting fixture',
              provider: 'wings',
              url: 'http://203.0.113.40:8080',
              secret: {},
              config: { listenPort: 8080 },
            },
            admin,
          );
          assert.equal(legacy.status, 201);
          const id = legacy.body.data.id;
          const before = await db.connection.findUniqueOrThrow({ where: { id } });
          const isolated = await call(
            '/nodes',
            'POST',
            {
              name: 'Isolated coexisting fixture',
              provider: 'wings',
              url: 'http://203.0.113.40:8080',
              secret: {},
              config: { listenPort: 8080 },
            },
            admin,
          );
          assert.equal(isolated.status, 201);
          const generated = await call(
            `/nodes/${isolated.body.data.id}/installations`,
            'POST',
            { tlsMode: 'none', daemonPort: 8081, sftpPort: 2023, addAllocations: false },
            admin,
          );
          assert.equal(generated.status, 201, JSON.stringify(generated.body));
          assert.equal(generated.body.data.instance.endpoint, 'http://203.0.113.40:8081');
          assert.equal(generated.body.data.instance.sftpPort, 2023);
          assert(generated.body.data.instance.config.startsWith('/etc/harbor/wings/'));
          assert.deepEqual(await db.connection.findUniqueOrThrow({ where: { id } }), before);
          assert.equal(
            (
              await call(
                `/nodes/${isolated.body.data.id}/installations`,
                'POST',
                { tlsMode: 'none', daemonPort: 8081, sftpPort: 8081 },
                admin,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await call(
                `/nodes/${isolated.body.data.id}/installations`,
                'POST',
                {
                  tlsMode: 'none',
                  daemonPort: 8081,
                  sftpPort: 2023,
                  portStart: 2023,
                  portEnd: 2023,
                },
                admin,
              )
            ).status,
            400,
          );
          const actor = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
          await db.nodeInstallation.create({
            data: {
              connectionId: id,
              createdBy: actor.id,
              tokenHash: randomUUID(),
              fingerprint: 'legacy-fixture',
              options: {},
              status: 'COMPLETE',
              expiresAt: new Date(Date.now() + 86400000),
            },
          });
          assert.equal(
            (
              await call(
                `/nodes/${id}/installations`,
                'POST',
                { tlsMode: 'none', daemonPort: 8082, sftpPort: 2024, addAllocations: false },
                admin,
              )
            ).status,
            409,
          );
          assert.deepEqual(await db.connection.findUniqueOrThrow({ where: { id } }), before);
        },
      );
      clientAddress = '127.0.0.6';
      const apiPassword = 'api-owner-password-123';
      const apiSignup = await call('/auth/register', 'POST', {
        name: 'API owner',
        email: `api-owner-${randomUUID()}@example.test`,
        password: apiPassword,
      });
      assert.equal(apiSignup.status, 201, JSON.stringify(apiSignup.body));
      const apiOwner = { id: apiSignup.body.data.id, cookie: apiSignup.cookie };
      const apiHeaders = (raw: string) => ({ Authorization: `Bearer ${raw}`, Origin: '' });
      const apiCall = (raw: string, path: string, method = 'GET', body?: unknown, cookie = '') =>
        call(path, method, body, cookie, apiHeaders(raw), false);
      const makeApiKey = async (
        scopes: string[],
        kind = 'CLIENT',
        cookie = apiOwner.cookie,
        extra: any = {},
      ) => {
        const r = await call(
          '/api-keys',
          'POST',
          {
            name: 'Integration API key',
            kind,
            scopes,
            password: cookie === admin ? 'test-admin-password' : apiPassword,
            ...extra,
          },
          cookie,
        );
        assert.equal(r.status, 201, JSON.stringify(r.body));
        return r.body.data;
      };
      let apiRead: any, apiWrite: any, adminRead: any, adminWrite: any, apiOrder: any;
      await t.test(
        'API keys require a session and current credentials, distinguish admin keys, and never expose hashes',
        async () => {
          assert.equal((await call('/api-keys')).status, 401);
          assert.equal(
            (
              await call(
                '/api-keys',
                'POST',
                { name: 'bad', scopes: ['services:read'], password: 'wrong' },
                apiOwner.cookie,
              )
            ).status,
            401,
          );
          assert.equal(
            (
              await call(
                '/api-keys',
                'POST',
                {
                  name: 'bad',
                  kind: 'ADMIN',
                  scopes: ['admin:services:read'],
                  password: apiPassword,
                },
                apiOwner.cookie,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await call(
                '/api-keys',
                'POST',
                { name: 'bad', scopes: ['admin:services:read'], password: apiPassword },
                apiOwner.cookie,
              )
            ).status,
            403,
          );
          apiRead = await makeApiKey([
            'services:read',
            'profile:read',
            'profile:write',
            'invoices:read',
          ]);
          apiWrite = await makeApiKey([
            'services:read',
            'services:control',
            'profile:write',
            'orders:write',
            'invoices:read',
            'invoices:pay',
          ]);
          adminRead = await makeApiKey(
            ['admin:customers:read', 'admin:services:read'],
            'ADMIN',
            admin,
          );
          adminWrite = await makeApiKey(
            [
              'admin:customers:read',
              'admin:customers:write',
              'admin:catalog:write',
              'admin:orders:write',
              'admin:orders:read',
              'admin:billing:read',
              'admin:billing:write',
            ],
            'ADMIN',
            admin,
          );
          assert.match(apiRead.token, /^hbr_c_[a-f0-9]{64}$/);
          assert.match(adminRead.token, /^hbr_a_[a-f0-9]{64}$/);
          const stored = await db.apiKey.findUniqueOrThrow({ where: { id: apiRead.id } });
          assert.notEqual(stored.tokenHash, apiRead.token);
          const metadata = (await call('/api-keys', 'GET', undefined, apiOwner.cookie)).body.data;
          assert(metadata.some((k: any) => k.id === apiRead.id));
          assert(!JSON.stringify(metadata).includes(apiRead.token));
          assert(!JSON.stringify(metadata).includes(stored.tokenHash));
          const historicalIds = Array.from({ length: 101 }, () => randomUUID());
          await db.apiKey.createMany({
            data: historicalIds.map((id, i) => ({
              id,
              userId: apiOwner.id,
              name: 'Historical revoked fixture',
              kind: 'CLIENT',
              tokenHash: randomUUID(),
              prefix: 'hbr_c_history',
              scopes: ['services:read'],
              credentialFingerprint: stored.credentialFingerprint,
              revokedAt: new Date(),
              expiresAt: new Date(Date.now() + 86400000),
              createdAt: new Date(Date.now() + i),
            })),
          });
          try {
            const visible = (await call('/api-keys', 'GET', undefined, apiOwner.cookie)).body.data;
            assert(
              visible.some((k: any) => k.id === apiRead.id),
              'Older active keys must remain manageable after many historical revocations',
            );
          } finally {
            await db.apiKey.deleteMany({ where: { id: { in: historicalIds } } });
          }

          assert.equal(
            (
              await apiCall(
                'hbr_c_' + '0'.repeat(64),
                '/services',
                'GET',
                undefined,
                apiOwner.cookie,
              )
            ).status,
            401,
          );
          assert.equal((await apiCall(apiRead.token, '/api-keys')).status, 403);
          assert.equal(
            (await apiCall(apiRead.token, '/auth/totp/setup', 'POST', { password: apiPassword }))
              .status,
            403,
          );
          assert.equal((await apiCall(adminWrite.token, '/admin/api-keys')).status, 403);
          assert.equal(
            (await apiCall(adminWrite.token, '/extensions/hello-world/routes/private', 'POST', {}))
              .status,
            403,
          );
          assert.equal((await apiCall(apiRead.token, '/customers')).status, 403);
          const adminClient = await makeApiKey(['profile:read', 'services:read'], 'CLIENT', admin);
          assert.equal((await apiCall(adminClient.token, '/auth/me')).body.data.role, 'customer');
          assert.equal((await apiCall(adminClient.token, '/customers')).status, 403);
        },
      );
      await t.test(
        'customer API orders preserve ownership, renewal consent and action permissions',
        async () => {
          assert.equal(
            (
              await call(
                '/profile',
                'PATCH',
                {
                  billingAddress: {
                    line1: '10 API Street',
                    city: 'Austin',
                    postalCode: '78701',
                    country: 'US',
                  },
                },
                apiOwner.cookie,
              )
            ).status,
            200,
          );
          assert.equal(
            (await apiCall(apiRead.token, '/profile', 'PATCH', { autoPayWallet: true })).status,
            403,
          );
          assert.equal(
            (await apiCall(apiWrite.token, '/profile', 'PATCH', { autoPayWallet: true })).status,
            200,
          );
          assert.equal(
            (await apiCall(apiWrite.token, '/profile', 'PATCH', { autoPayWallet: false })).status,
            200,
          );
          const product = await apiCall(adminWrite.token, '/products', 'POST', {
            name: 'API hosting contract',
            description: 'Isolated API fixture',
            provider: 'wings',
            category: 'game',
            connectionId: setupNode,
            price: 500,
            currency: 'USD',
            active: true,
            taxable: false,
            spec: { memoryMb: 1024, diskMb: 10240, cpu: 1 },
          });
          assert.equal(product.status, 201, JSON.stringify(product.body));
          const quote = await apiCall(apiWrite.token, '/orders/quote', 'POST', {
            productId: product.body.data.id,
          });
          assert.equal(quote.status, 201, JSON.stringify(quote.body));
          const body = {
            productId: product.body.data.id,
            idempotencyKey: randomUUID(),
            expectedQuoteId: quote.body.data.quoteId,
          };
          apiOrder = await apiCall(apiWrite.token, '/orders', 'POST', body);
          assert.equal(apiOrder.status, 201, JSON.stringify(apiOrder.body));
          apiOrder = apiOrder.body.data;
          assert.equal(
            (await apiCall(apiWrite.token, '/orders', 'POST', body)).body.data.invoiceId,
            apiOrder.invoiceId,
          );
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: apiOrder.invoiceId } })).userId,
            apiOwner.id,
          );
          assert.equal(
            (await apiCall(apiRead.token, `/services/${apiOrder.serviceId}`)).status,
            200,
          );
          assert.equal(
            (await apiCall(apiRead.token, `/invoices/${apiOrder.invoiceId}`)).status,
            200,
          );
          const otherKey = await makeApiKey(
            ['services:read', 'invoices:read'],
            'CLIENT',
            setupCustomer,
            { password: 'node-setup-customer-password' },
          );
          assert.equal(
            (await apiCall(otherKey.token, `/services/${apiOrder.serviceId}`)).status,
            404,
          );
          assert.equal(
            (await apiCall(otherKey.token, `/invoices/${apiOrder.invoiceId}`)).status,
            404,
          );
          assert.equal(
            (
              await apiCall(apiRead.token, `/services/${apiOrder.serviceId}/actions`, 'POST', {
                action: 'restart',
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await apiCall(apiWrite.token, `/services/${apiOrder.serviceId}/actions`, 'POST', {
                action: 'terminate',
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await apiCall(apiWrite.token, `/services/${apiOrder.serviceId}/actions`, 'POST', {
                action: 'files.list',
              })
            ).status,
            403,
          );
          await db.service.update({
            where: { id: apiOrder.serviceId },
            data: { status: 'ACTIVE', externalId: apiOrder.serviceId },
          });
          const action = { action: 'restart', idempotencyKey: randomUUID() };
          const result = await apiCall(
            apiWrite.token,
            `/services/${apiOrder.serviceId}/actions`,
            'POST',
            action,
          );
          assert.equal(result.status, 201, JSON.stringify(result.body));
          assert.equal(
            (
              await apiCall(
                apiWrite.token,
                `/services/${apiOrder.serviceId}/actions`,
                'POST',
                action,
              )
            ).body.data.operationId,
            result.body.data.operationId,
          );
          assert.equal(
            (await apiCall(adminRead.token, `/services/${apiOrder.serviceId}`)).status,
            200,
          );
          assert.equal(
            (await apiCall(adminRead.token, `/nodes/${setupNode}/configuration`)).status,
            403,
          );
          assert.equal(
            (await apiCall(adminRead.token, '/settings', 'PATCH', { companyName: 'forbidden' }))
              .status,
            403,
          );
        },
      );

      await t.test(
        'Wings console tickets preserve API key permissions instead of granting unrequested power controls',
        async () => {
          const key = await makeApiKey(['services:console'], 'CLIENT', apiOwner.cookie);
          const result = await apiCall(
            key.token,
            `/services/${apiOrder.serviceId}/console`,
            'POST',
          );
          assert.equal(result.status, 201, JSON.stringify(result.body));
          const jwt = JSON.parse(
            Buffer.from(result.body.data.token.split('.')[1], 'base64url').toString(),
          );
          assert.deepEqual(jwt.permissions, ['websocket.connect', 'control.console']);
          const withPower = await makeApiKey(
            ['services:console', 'services:control'],
            'CLIENT',
            apiOwner.cookie,
          );
          const power = await apiCall(
            withPower.token,
            `/services/${apiOrder.serviceId}/console`,
            'POST',
          );
          assert.equal(power.status, 201, JSON.stringify(power.body));
          const claims = JSON.parse(
            Buffer.from(power.body.data.token.split('.')[1], 'base64url').toString(),
          );
          assert(claims.permissions.includes('control.start'));
        },
      );
      await t.test(
        'admin API creates customers and issues orders/invoices with the correct owner and audit identity',
        async () => {
          assert.equal(
            (await apiCall(adminRead.token, '/customers', 'POST', { name: 'denied' })).status,
            403,
          );
          const customerInput = {
            name: 'Admin API customer',
            email: `admin-api-${randomUUID()}@example.test`,
            password: 'created-by-admin-api-password',
            billingAddress: {
              line1: '22 API Lane',
              city: 'Austin',
              postalCode: '78701',
              country: 'US',
            },
          };
          assert.equal(
            (
              await apiCall(adminWrite.token, '/customers', 'POST', {
                ...customerInput,
                role: 'ADMIN',
              })
            ).status,
            400,
          );
          const result = await apiCall(adminWrite.token, '/customers', 'POST', customerInput);
          assert.equal(result.status, 201, JSON.stringify(result.body));
          const target = result.body.data;
          assert.equal(target.role, 'CUSTOMER');
          assert(!JSON.stringify(target).includes('passwordHash'));
          assert.equal((await apiCall(adminRead.token, `/customers/${target.id}`)).status, 200);
          assert.equal(
            (await apiCall(adminRead.token, `/customers/${target.id}`, 'PATCH', { name: 'denied' }))
              .status,
            403,
          );
          assert.equal(
            (
              await apiCall(adminWrite.token, `/customers/${target.id}`, 'PATCH', {
                name: 'Edited by admin API',
              })
            ).status,
            200,
          );
          const product = await db.product.findFirstOrThrow({
            where: { name: 'API hosting contract' },
          });
          const quote = await apiCall(
            adminWrite.token,
            `/customers/${target.id}/orders/quote`,
            'POST',
            { productId: product.id },
          );
          assert.equal(quote.status, 201, JSON.stringify(quote.body));
          const order = await apiCall(adminWrite.token, `/customers/${target.id}/orders`, 'POST', {
            productId: product.id,
            idempotencyKey: randomUUID(),
            expectedQuoteId: quote.body.data.quoteId,
          });
          assert.equal(order.status, 201, JSON.stringify(order.body));
          assert.equal(
            (await db.invoice.findUniqueOrThrow({ where: { id: order.body.data.invoiceId } }))
              .userId,
            target.id,
          );
          const audit = await db.auditLog.findFirstOrThrow({
            where: { targetId: order.body.data.id, action: 'order.created' },
          });
          assert.equal(
            audit.actorId,
            (await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } })).id,
          );
          assert.equal((audit.details as any).customerId, target.id);
          assert.equal((audit.details as any).apiKeyId, adminWrite.id);
          const invoiceInput = {
            userId: target.id,
            description: 'API assistance',
            currency: 'USD',
            dueAt: new Date(Date.now() + 86400000).toISOString(),
            items: [{ description: 'Assistance', quantity: 1, unitAmount: 200, taxable: false }],
          };
          const invoiceQuote = await apiCall(
            adminWrite.token,
            '/invoices/quote',
            'POST',
            invoiceInput,
          );
          assert.equal(invoiceQuote.status, 201, JSON.stringify(invoiceQuote.body));
          const invoice = await apiCall(adminWrite.token, '/invoices', 'POST', {
            ...invoiceInput,
            idempotencyKey: randomUUID(),
            expectedQuoteId: invoiceQuote.body.data.quoteId,
          });
          assert.equal(invoice.status, 201, JSON.stringify(invoice.body));
          assert.equal(invoice.body.data.userId, target.id);
          assert.equal(invoice.body.data.amount, 200);
        },
      );
      await t.test(
        'API key rotation and revocation are owner-scoped, atomic and irreversible',
        async () => {
          const candidate = await makeApiKey(['services:read'], 'CLIENT', apiOwner.cookie, {
            allowedIps: ['127.0.0.6'],
          });
          assert.equal(
            (
              await call(
                `/api-keys/${candidate.id}/rotate`,
                'POST',
                { password: apiPassword },
                setupCustomer,
              )
            ).status,
            404,
          );
          const rotated = await Promise.all(
            [1, 2].map(() =>
              call(
                `/api-keys/${candidate.id}/rotate`,
                'POST',
                { password: apiPassword, expiresInDays: 30 },
                apiOwner.cookie,
              ),
            ),
          );
          assert.equal(rotated.filter((r) => r.status === 201).length, 1);
          assert.equal(rotated.filter((r) => r.status === 409).length, 1);
          const next = rotated.find((r) => r.status === 201)!.body.data;
          assert.notEqual(next.token, candidate.token);
          assert.deepEqual(next.scopes, candidate.scopes);
          assert.deepEqual(next.allowedIps, ['127.0.0.6/32']);
          assert.equal((await apiCall(candidate.token, '/services')).status, 401);
          assert.equal((await apiCall(next.token, '/services')).status, 200);
          assert.equal(
            (await call(`/api-keys/${next.id}`, 'DELETE', undefined, setupCustomer)).status,
            404,
          );
          assert.equal(
            (await call(`/api-keys/${next.id}`, 'DELETE', undefined, apiOwner.cookie)).status,
            200,
          );
          assert.equal((await apiCall(next.token, '/services')).status, 401);
          assert.equal(
            (await call(`/api-keys/${next.id}`, 'DELETE', undefined, apiOwner.cookie)).status,
            200,
          );
          assert.equal(
            await db.auditLog.count({ where: { targetId: next.id, action: 'api-key.revoked' } }),
            1,
          );
        },
      );
      await t.test(
        'IP allowlists, expiration and staff revocation stop API keys without leaking secrets',
        async () => {
          const restricted = await makeApiKey(['services:read'], 'CLIENT', apiOwner.cookie, {
            allowedIps: ['127.0.0.6/32', '2001:db8::/32'],
          });
          clientAddress = '127.0.0.7';
          assert.equal((await apiCall(restricted.token, '/services')).status, 403);
          clientAddress = '127.0.0.6';
          assert.equal((await apiCall(restricted.token, '/services')).status, 200);
          assert.equal(
            (await db.apiKey.findUniqueOrThrow({ where: { id: restricted.id } })).lastUsedIp,
            '127.0.0.6',
          );
          await db.apiKey.update({
            where: { id: restricted.id },
            data: { expiresAt: new Date(Date.now() - 1) },
          });
          assert.equal((await apiCall(restricted.token, '/services')).status, 401);
          const staffKey = await makeApiKey(['services:read']);
          assert.equal(
            (
              await call(
                `/admin/api-keys/${staffKey.id}/revoke`,
                'POST',
                { reason: 'integration removed' },
                setupCustomer,
              )
            ).status,
            403,
          );
          const listed = await call('/admin/api-keys?search=API%20key', 'GET', undefined, admin);
          assert.equal(listed.status, 200);
          assert(!JSON.stringify(listed.body).includes(staffKey.token));
          assert(!JSON.stringify(listed.body).includes('tokenHash'));
          assert(!JSON.stringify(listed.body).includes('credentialFingerprint'));
          assert.equal(
            (
              await call(
                `/admin/api-keys/${staffKey.id}/revoke`,
                'POST',
                { reason: 'Integration no longer authorized' },
                admin,
              )
            ).status,
            201,
          );
          assert.equal((await apiCall(staffKey.token, '/services')).status, 401);
          const log = await db.auditLog.findFirstOrThrow({
            where: { targetId: staffKey.id, action: 'api-key.staff-revoked' },
          });
          assert.equal((log.details as any).ownerId, apiOwner.id);
        },
      );
      await t.test(
        'suspension, credential changes and staff demotion cannot leave usable API access',
        async () => {
          assert.equal((await apiCall(apiRead.token, '/services')).status, 200);
          await db.user.update({ where: { id: apiOwner.id }, data: { suspendedAt: new Date() } });
          assert.equal((await apiCall(apiRead.token, '/services')).status, 403);
          await db.user.update({ where: { id: apiOwner.id }, data: { suspendedAt: null } });
          assert.equal((await apiCall(apiRead.token, '/services')).status, 200);
          const { hashPassword } = await import('../apps/api/dist/security.js');
          const elevated = await db.user.create({
            data: {
              name: 'API staff fixture',
              email: `api-staff-${randomUUID()}@example.test`,
              role: 'ADMIN',
              passwordHash: await hashPassword(apiPassword),
            },
          });
          const login = await call('/auth/login', 'POST', {
            email: elevated.email,
            password: apiPassword,
          });
          assert.equal(login.status, 201);
          const key = await makeApiKey(['admin:services:read'], 'ADMIN', login.cookie);
          await db.user.update({ where: { id: elevated.id }, data: { role: 'CUSTOMER' } });
          assert.equal((await apiCall(key.token, '/services')).status, 401);
          await db.user.update({ where: { id: elevated.id }, data: { role: 'ADMIN' } });
          assert.equal((await apiCall(key.token, '/services')).status, 401);
          assert.equal(
            (
              await call(
                `/customers/${apiOwner.id}/password`,
                'POST',
                {
                  password: 'replacement-api-owner-password',
                  confirmPassword: 'replacement-api-owner-password',
                },
                admin,
              )
            ).status,
            201,
          );
          assert.equal((await apiCall(apiRead.token, '/services')).status, 401);
          assert.equal(
            (await db.apiKey.findUniqueOrThrow({ where: { id: apiRead.id } })).revokedAt !== null,
            true,
          );
        },
      );
      await t.test(
        'two-factor owners must confirm TOTP before issuing keys and security changes revoke prior keys',
        async () => {
          const first = await makeApiKey(['services:read'], 'CLIENT', setupCustomer, {
            password: 'node-setup-customer-password',
          });
          const { authenticator } = await import('otplib');
          const start = await call(
            '/auth/totp/setup',
            'POST',
            { password: 'node-setup-customer-password' },
            setupCustomer,
          );
          assert.equal(start.status, 201);
          assert.equal((await apiCall(first.token, '/services')).status, 401);
          const code = authenticator.generate(start.body.data.secret);
          assert.equal(
            (await call('/auth/totp/confirm', 'POST', { code }, setupCustomer)).status,
            201,
          );
          assert.equal(
            (
              await call(
                '/api-keys',
                'POST',
                {
                  name: 'Needs TOTP',
                  scopes: ['services:read'],
                  password: 'node-setup-customer-password',
                },
                setupCustomer,
              )
            ).status,
            401,
          );
          const confirmed = await makeApiKey(['services:read'], 'CLIENT', setupCustomer, {
            password: 'node-setup-customer-password',
            totp: authenticator.generate(start.body.data.secret),
          });
          assert.equal((await apiCall(confirmed.token, '/services')).status, 200);
        },
      );
      await t.test(
        'per-key rate limiting and metadata logs identify the key without recording credentials',
        async () => {
          const limited = await makeApiKey(['services:read'], 'CLIENT', admin);
          clientAddress = '127.0.0.8';
          for (let i = 0; i < 120; i++)
            assert.equal((await apiCall(limited.token, '/services')).status, 200);
          const over = await apiCall(limited.token, '/services');
          assert.equal(over.status, 429);
          assert.match(over.body.error.message, /API key rate limit/);
          assert(Number(over.retryAfter) > 0);
          const another = await makeApiKey(['services:read'], 'CLIENT', admin);
          assert.equal((await apiCall(another.token, '/services')).status, 200);
          await new Promise((r) => setTimeout(r, 50));
          const logs = await db.httpLog.findMany({ where: { apiKeyId: limited.id } });
          assert(logs.length >= 120);
          assert(logs.some((l) => l.status === 429));
          assert(logs.every((l) => l.actorId !== null));
          assert(!JSON.stringify(logs).includes(limited.token));
          assert(!JSON.stringify(logs).includes('Authorization'));
        },
      );
      await t.test(
        'key password-confirmation limits are per account and never block emergency revocation',
        async () => {
          clientAddress = '127.0.0.10';
          const signup = async () => {
            const r = await call('/auth/register', 'POST', {
              name: 'Credential limit fixture',
              email: `limit-${randomUUID()}@example.test`,
              password: apiPassword,
            });
            assert.equal(r.status, 201, JSON.stringify(r.body));
            return r.cookie;
          };
          const a = await signup(),
            b = await signup();
          const existing = await makeApiKey(['services:read'], 'CLIENT', a);
          for (let i = 0; i < 29; i++)
            assert.equal(
              (
                await call(
                  '/api-keys',
                  'POST',
                  {
                    name: 'Wrong password attempt',
                    scopes: ['services:read'],
                    password: 'incorrect-password',
                  },
                  a,
                  {},
                  false,
                )
              ).status,
              401,
            );
          const over = await call(
            '/api-keys',
            'POST',
            { name: 'Throttled key', scopes: ['services:read'], password: apiPassword },
            a,
            {},
            false,
          );
          assert.equal(over.status, 429);
          assert.match(over.body.error.message, /password confirmations/);
          assert(Number(over.retryAfter) > 60);
          assert.equal((await call('/api-keys', 'GET', undefined, a)).status, 200);
          assert.equal(
            (await call(`/api-keys/${existing.id}`, 'DELETE', undefined, a)).status,
            200,
          );
          assert.equal((await apiCall(existing.token, '/services')).status, 401);
          const independent = await makeApiKey(['services:read'], 'CLIENT', b);
          assert.equal((await apiCall(independent.token, '/services')).status, 200);
        },
      );
    } finally {
      await app.close();
      await new Promise<void>((r) => node.close(() => r()));
      await rm(extensionDir, { recursive: true, force: true });
    }
  },
);
