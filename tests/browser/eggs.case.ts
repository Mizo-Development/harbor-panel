import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';

test('egg library imports, assigns a plan and manages service startup variables', async ({
  page,
}) => {
  const setup = await page.request.post('/api/v1/setup', {
    data: {
      companyName: 'Egg UI Test',
      email: 'eggs@harbor.test',
      password: 'browser-eggs-password',
      nodeMode: 'remote',
      setupToken: 'e'.repeat(64),
    },
  });
  expect(setup.status()).toBe(201);
  await page.goto('/admin/eggs');
  await expect(page.getByRole('heading', { name: 'Game eggs', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Paper (automatic stable releases)', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Import egg', exact: true }).click();
  await page.getByLabel('Nest / game group').fill('Browser Minecraft');
  await page.getByLabel('Egg JSON file').setInputFiles('apps/api/assets/eggs/paper.json');
  await expect(page.getByLabel('Egg definition')).toHaveValue(/"PTDL_v2"/);
  await page.getByRole('checkbox', { name: /reviewed and trust/ }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Import egg', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Paper', exact: true })).toBeVisible();
  const library = (await (await page.request.get('/api/v1/admin/eggs')).json()).data;
  const imported = library.find((e: any) => e.nest === 'Browser Minecraft');
  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'Create product', exact: true }).click();
  await page.getByLabel('Product name').fill('Egg-powered game server');
  await page
    .getByLabel('Description', { exact: true })
    .fill('Test game plan using an imported egg');
  await page.getByLabel('Game egg', { exact: true }).selectOption(imported.id);
  await expect(page.getByLabel('Download Path', { exact: true })).toBeVisible();
  await page.getByLabel('Minecraft Version', { exact: true }).fill('1.21.11');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Egg-powered game server', { exact: true })).toBeVisible();
  const products = (await (await page.request.get('/api/v1/products')).json()).data;
  const product = products.find((p: any) => p.name === 'Egg-powered game server');
  expect(product.gameConfig.eggId).toBe(imported.id);
  expect(product.gameConfig.variables.MINECRAFT_VERSION).toBe('1.21.11');
  // Seed an isolated, unprovisioned test record to exercise startup UI without creating a remote server.
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
  });
  let serviceId = '';
  try {
    const owner = await db.user.findUniqueOrThrow({ where: { email: 'eggs@harbor.test' } });
    const order = await db.order.create({
      data: { userId: owner.id, productId: product.id, idempotencyKey: randomUUID() },
    });
    const environment = Object.fromEntries(
      imported.definition.variables.map((v: any) => [
        v.env_variable,
        product.gameConfig.variables[v.env_variable] ?? v.default_value,
      ]),
    );
    const service = await db.service.create({
      data: {
        name: 'Browser egg server',
        userId: owner.id,
        productId: product.id,
        orderId: order.id,
        provider: 'wings',
        spec: product.spec,
        metadata: {
          gameAssignment: {
            eggId: imported.id,
            name: imported.name,
            digest: imported.digest,
            definition: imported.definition,
            image: Object.values(imported.definition.docker_images)[0],
            environment,
          },
        },
      },
    });
    serviceId = service.id;
  } finally {
    await db.$disconnect();
  }
  await page.goto(`/admin/services/${serviceId}`);
  await page.getByRole('button', { name: 'startup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paper', exact: true })).toBeVisible();
  await page.getByLabel('Minecraft Version', { exact: true }).fill('latest');
  await page.getByRole('button', { name: 'Save startup variables', exact: true }).click();
  await expect(
    page.getByText('Variables saved for the next reinstall', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'startup', exact: true }).click();
  await expect(page.getByLabel('Minecraft Version', { exact: true })).toHaveValue('latest');
  await page.screenshot({ path: 'artifacts/screenshots/game-egg-startup.png', fullPage: true });
});

test('workspace fits phones, tablets and desktops with readable file controls and dialogs', async ({
  page,
}) => {
  const login = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:3100' },
    data: { email: 'eggs@harbor.test', password: 'browser-eggs-password' },
  });
  expect(login.status()).toBe(201);
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
  });
  let serviceId = '';
  try {
    serviceId = (await db.service.findFirstOrThrow({ where: { name: 'Browser egg server' } })).id;
  } finally {
    await db.$disconnect();
  }
  await page.route('**/api/v1/services/*/actions', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action !== 'files.list') return route.continue();
    await route.fulfill({
      json: {
        data: {
          entries: [
            { name: 'world', type: 'directory', size: 0 },
            {
              name: 'a-very-long-plugin-filename-with-a-version-and-custom-configuration.yml',
              type: 'file',
              size: 1024,
            },
          ],
        },
      },
    });
  });
  for (const width of [320, 390, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      '/admin/products',
      '/admin/settings',
      '/admin/eggs',
      '/admin/proxmox',
      `/admin/services/${serviceId}`,
    ]) {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
    }
    await page.getByRole('button', { name: 'files', exact: true }).click();
    await expect(page.getByRole('button', { name: 'world', exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    for (const name of ['Upload', 'New file', 'New folder']) {
      const control = page.getByRole('button', { name, exact: true }),
        rect = await control.boundingBox();
      expect(rect).toBeTruthy();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1);
      if (width < 640) expect(rect!.height).toBeGreaterThanOrEqual(44);
    }
    const title = page.getByText('File manager', { exact: true });
    const titleRect = await title.boundingBox();
    expect(titleRect!.width).toBeGreaterThan(100);
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const rect = await dialog.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1);
    expect(rect!.height).toBeLessThan(900);
    await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if ([390, 1280].includes(width))
      await page.screenshot({
        path: `artifacts/screenshots/responsive-files-${width}.png`,
        fullPage: true,
      });
  }
});
