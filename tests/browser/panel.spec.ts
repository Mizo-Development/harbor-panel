import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedDemoPlans } from '../../apps/api/dist/demo.js';
const storageDir = process.env.HARBOR_BROWSER_STORAGE_DIR || 'test-results';
test('first-time setup, admin management, theme modes, storefront and mobile navigation', async ({
  page,
}) => {
  // Public HTTP previews do not expose this secure-context-only API.
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: 'artifacts/screenshots/setup-dark.png', fullPage: true });
  await page.getByLabel('Company name', { exact: true }).fill('Harbor Hosting');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Administrator email').fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByLabel('Installation setup token').fill('e'.repeat(64));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'On a separate machine', exact: false }).click();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Ready for your first node')).toBeVisible();
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'artifacts/screenshots/admin-dark-default.png', fullPage: true });
  await page.getByRole('button', { name: 'Change color mode' }).click();
  await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.screenshot({ path: 'artifacts/screenshots/admin-light.png', fullPage: true });
  await page.getByRole('button', { name: 'Change color mode' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: 'artifacts/screenshots/admin-dark.png', fullPage: true });
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search pages…').fill('Products');
  await page.getByRole('option', { name: /Products/ }).click();
  await expect(page).toHaveURL(/\/admin\/products$/);
  await page.getByRole('link', { name: 'Infrastructure', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Infrastructure' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect provider', exact: true }).click();
  await page.getByLabel('Provider', { exact: true }).selectOption('plesk');
  await expect(page.getByLabel('XML API access key')).toBeVisible();
  await expect(page.getByLabel('Hosting IPv4 address')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: 'Extensions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plesk Obsidian', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'PayPal', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Themes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Themes' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Legal company name', { exact: true }).fill('Harbor Hosting Ltd');
  await page.getByLabel('Billing email', { exact: true }).fill('billing@harbor.test');
  await page.getByLabel('Address line 1', { exact: true }).fill('10 Harbor Road');
  await page.getByLabel('City', { exact: true }).fill('London');
  await page.getByLabel('Postal code', { exact: true }).fill('SW1A 1AA');
  await page.getByLabel('Country code', { exact: true }).fill('GB');
  await page
    .getByLabel('Wallet and offline payment instructions')
    .fill('Contact billing to arrange a bank transfer.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Storefront', exact: true }).click();
  await page.getByRole('switch', { name: 'Enable public storefront', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
  await page.goto('/store');
  await expect(
    page.getByRole('heading', { name: 'The storefront is currently unavailable' }),
  ).toBeVisible();
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Storefront', exact: true }).click();
  await page.getByRole('switch', { name: 'Enable public storefront', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
  await page.goto('/store');
  await expect(page.getByRole('heading', { name: 'New plans are on the way' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/storefront.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Invoices', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: /Open account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await page.getByRole('button', { name: /Open account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Jamie');
  await page.getByLabel('Email address', { exact: true }).fill('jamie@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('customer-browser-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Welcome back, Jamie.' })).toBeVisible();
  await page.goto('/dashboard/account');
  await page.getByLabel('Address line 1', { exact: true }).fill('42 Customer Street');
  await page.getByLabel('City', { exact: true }).fill('Manchester');
  await page.getByLabel('Postal code', { exact: true }).fill('M1 1AA');
  await page.getByLabel('Country code', { exact: true }).fill('GB');
  await page.getByRole('button', { name: 'Save billing profile' }).click();
  await expect(page.getByText('Billing profile saved', { exact: true })).toBeVisible();
  await page.goto('/dashboard/wallet');
  await page.getByRole('button', { name: 'Request top-up', exact: true }).click();
  await page.getByLabel('Top-up amount (USD)').fill('25.00');
  await page.getByLabel('Transfer reference').fill('browser-bank-reference');
  await page.getByRole('button', { name: 'Submit deposit for review' }).click();
  await expect(page.getByText('PENDING', { exact: true })).toBeVisible();
  process.env.ENCRYPTION_KEY = 'd'.repeat(64);
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
  });
  try {
    await seedDemoPlans(db);
  } finally {
    await db.$disconnect();
  }
  const worker = spawn(process.execPath, ['apps/api/dist/worker.js'], {
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL!,
      ENCRYPTION_KEY: 'd'.repeat(64),
      REDIS_URL: 'redis://127.0.0.1:6379/14',
      EXTENSIONS_DIR: '/tmp/harbor-ui-extensions',
    },
    stdio: 'ignore',
  });
  try {
    await page.goto('/store');
    const plan = page.locator('article').filter({
      has: page.getByRole('heading', { name: 'Minecraft Starter (Demo)', exact: true }),
    });
    await expect(plan).toBeVisible();
    await page.waitForTimeout(700);
    await page.screenshot({
      path: 'artifacts/screenshots/storefront-demo-plans.png',
      fullPage: true,
    });
    await plan.getByRole('button', { name: 'Get started' }).click();
    await expect(page.getByRole('dialog')).toContainText('No money will be charged');
    await page.getByRole('button', { name: 'Create order', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/invoices\//);
    await expect(page.getByText('Harbor Hosting Ltd', { exact: true })).toBeVisible();
    await expect(page.getByText('42 Customer Street', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Complete demo order' }).click();
    await expect(
      page.getByText('Demo order completed — no payment collected', { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Manage demo service' }).click();
    await expect(page).toHaveURL(/\/dashboard\/services\//);
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled({
      timeout: 20000,
    });
    await expect(page.getByText('Demo service.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByText('Running', { exact: true })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByText('Stopped', { exact: true })).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: 'artifacts/screenshots/demo-service.png', fullPage: true });
    const dashboard = await (await page.request.get('/api/v1/dashboard')).json();
    expect(dashboard.data.metrics.find((m: any) => m.key === 'revenue').value).toBe(0);
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
  expect(errors).toEqual([]);
});

test('reduced-motion users keep a readable dark interface', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('admin reviews wallet deposits and configures Proxmox locations and IP pools', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/wallets');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByLabel('Review note').fill('Bank transfer verified');
  await page.getByLabel('Verified bank transaction ID').fill('browser-bank-transaction-001');
  await page.getByRole('button', { name: 'Confirm funds received', exact: true }).click();
  await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();
  await expect(page.getByText('$25.00', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'View transactions', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('browser-bank-transaction-001');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.goto('/admin/proxmox');
  await page.getByRole('button', { name: 'Locations', exact: true }).click();
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  await page.getByLabel('Location name', { exact: true }).fill('Frankfurt EU');
  await page.getByLabel('City', { exact: true }).fill('Frankfurt');
  await page.getByLabel('Country code', { exact: true }).fill('DE');
  await page.getByRole('button', { name: 'Save location', exact: true }).click();
  await page.getByRole('button', { name: 'Connect cluster', exact: true }).click();
  await page.getByLabel('Connection name', { exact: true }).fill('Browser Proxmox');
  await page.getByLabel('Endpoint URL', { exact: true }).fill('https://pve.example.invalid:8006');
  await page.getByLabel('API token ID', { exact: true }).fill('harbor@pve!panel');
  await page.getByLabel('API token secret', { exact: true }).fill('browser-test-secret');
  await page.getByLabel('Node name', { exact: true }).fill('pve01');
  await page.getByLabel('Guest disk storage', { exact: true }).fill('local-lvm');
  await page
    .getByLabel('Location', { exact: true })
    .selectOption({ label: 'Frankfurt EU · Frankfurt, DE' });
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Nodes & connections', exact: true }).click();
  await page.getByRole('button', { name: 'Manage Proxmox', exact: true }).click();
  await page.getByRole('button', { name: 'ip pools', exact: true }).click();
  await page.getByLabel('IP pool name', { exact: true }).fill('public-eu');
  await page.getByLabel('First IPv4 address', { exact: true }).fill('203.0.113.10');
  await page.getByLabel('Last IPv4 address', { exact: true }).fill('203.0.113.12');
  await page.getByLabel('CIDR prefix', { exact: true }).fill('24');
  await page.getByLabel('IPv4 gateway', { exact: true }).fill('203.0.113.1');
  await page.getByRole('button', { name: 'Add IP pool', exact: true }).click();
  await expect(page.getByText('203.0.113.10/24', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/proxmox-ip-pools.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('staff opens a customer, edits billing details, changes password, and revokes sessions', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await page.getByLabel('Search customers').fill('jamie@harbor.test');
  await page.getByRole('link', { name: 'View customer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Jamie', exact: true })).toBeVisible();
  await expect(page.getByText('42 Customer Street', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'wallet', exact: true }).click();
  await expect(
    page.getByRole('cell').filter({ hasText: 'Verified deposit: browser-bank-transaction-001' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit customer', exact: true }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Jamie Managed');
  await page.getByLabel('Customer email', { exact: true }).fill('jamie.managed@harbor.test');
  await page.getByLabel('Address line 1', { exact: true }).fill('99 Managed Road');
  await page.getByLabel('Internal staff notes', { exact: true }).fill('Priority hosting customer');
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Jamie Managed', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'overview', exact: true }).click();
  await expect(page.getByText('99 Managed Road', { exact: true })).toBeVisible();
  await expect(page.getByText('Priority hosting customer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await page.getByLabel('New customer password', { exact: true }).fill('managed-browser-password');
  await page
    .getByLabel('Confirm new customer password', { exact: true })
    .fill('managed-browser-password');
  await page.getByRole('button', { name: 'Set new password', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const clientContext = await browser.newContext();
  try {
    const client = await clientContext.newPage();
    await client.goto('http://127.0.0.1:3100/login');
    await client.getByLabel('Email address', { exact: true }).fill('jamie.managed@harbor.test');
    await client.getByLabel('Password', { exact: true }).fill('managed-browser-password');
    await client.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard$/);
    const me = await (await client.request.get('http://127.0.0.1:3100/api/v1/auth/me')).json();
    expect(me.data.adminNotes).toBeUndefined();
    await page.reload();
    await page.getByRole('tab', { name: 'security', exact: true }).click();
    await expect(page.getByText('Recent successful logins', { exact: true })).toBeVisible();
    await expect(page.getByText('Observed login IP', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/screenshots/customer-security.png', fullPage: true });
    await page.getByRole('button', { name: 'Sign out all sessions', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out customer', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await client.request.get('http://127.0.0.1:3100/api/v1/auth/me')).status()).toBe(401);
    await page.getByRole('tab', { name: 'overview', exact: true }).click();
    await page.screenshot({ path: 'artifacts/screenshots/customer-overview.png', fullPage: true });
  } finally {
    await clientContext.close();
  }
  expect(errors).toEqual([]);
});

test('admin configures exact regional prices and suspends or restores customer access', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'Create product', exact: true }).click();
  await page.getByLabel('Show this plan in the storefront').check();
  await page.getByLabel('Product name', { exact: true }).fill('Regional Minecraft');
  await page
    .getByLabel('Description', { exact: true })
    .fill('A real hosting plan awaiting a node.');
  await page.getByLabel('Base price (USD)', { exact: true }).fill('10.00');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/admin/pricing');
  await page.getByLabel('Enable regional pricing', { exact: true }).check();
  await page.getByRole('button', { name: 'Save pricing policy', exact: true }).click();
  await page.getByRole('button', { name: 'Add pricing region', exact: true }).click();
  await page.getByLabel('Region name', { exact: true }).fill('United Kingdom');
  await page.getByLabel('Billing country code', { exact: true }).fill('GB');
  await page.getByLabel('Region currency', { exact: true }).selectOption('GBP');
  await page.getByRole('button', { name: 'Save region', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add product price', exact: true }).click();
  await page.getByLabel('Product', { exact: true }).selectOption({ label: 'Regional Minecraft' });
  await page.getByLabel('Regional amount (GBP)', { exact: true }).fill('7.50');
  await page.getByRole('button', { name: 'Save regional price', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({
    path: 'artifacts/screenshots/regional-pricing-admin.png',
    fullPage: true,
  });
  const clientContext = await browser.newContext();
  try {
    const client = await clientContext.newPage();
    await client.goto('http://127.0.0.1:3100/login');
    await client.getByLabel('Email address', { exact: true }).fill('jamie.managed@harbor.test');
    await client.getByLabel('Password', { exact: true }).fill('managed-browser-password');
    await client.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard$/);
    await client.goto('http://127.0.0.1:3100/store');
    const plan = client
      .locator('article')
      .filter({ has: client.getByRole('heading', { name: 'Regional Minecraft', exact: true }) });
    await expect(plan).toContainText('£7.50');
    await expect(plan.getByRole('button', { name: 'Coming soon', exact: true })).toBeDisabled();
    await client.goto('http://127.0.0.1:3100/dashboard/wallet');
    await expect(client.getByLabel('Wallet currency', { exact: true })).toHaveValue('GBP');
    await client.getByLabel('Wallet currency', { exact: true }).selectOption('USD');
    await expect(client.getByText('$25.00', { exact: true }).first()).toBeVisible();
    await page.goto('/admin/customers');
    await page.getByLabel('Search customers').fill('jamie.managed');
    await page.getByRole('link', { name: 'View customer', exact: true }).click();
    await page.getByRole('button', { name: 'Suspend customer', exact: true }).click();
    await page.getByLabel('Account status reason').fill('Manual account review');
    await page.getByRole('button', { name: 'Suspend account', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await client.request.get('http://127.0.0.1:3100/api/v1/auth/me')).status()).toBe(401);
    await client.goto('http://127.0.0.1:3100/login');
    await client.getByLabel('Email address', { exact: true }).fill('jamie.managed@harbor.test');
    await client.getByLabel('Password', { exact: true }).fill('managed-browser-password');
    await client.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      client.getByText('Your account is suspended. Contact support.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Restore account access', exact: true }).click();
    await page.getByLabel('Account status reason').fill('Review complete');
    await page.getByRole('button', { name: 'Restore access', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await client.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard$/);
  } finally {
    await clientContext.close();
  }
  expect(errors).toEqual([]);
});

test('support conversations include private notes, assignment, attachments, and close/reopen', async ({
  page,
  browser,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/tickets');
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  await page.getByRole('button', { name: 'Add department', exact: true }).click();
  await page.getByLabel('Department name', { exact: true }).fill('Game support');
  await page.getByRole('button', { name: 'Save department', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const context = await browser.newContext();
  try {
    const client = await context.newPage();
    await client.goto('http://127.0.0.1:3100/login');
    await client.getByLabel('Email address', { exact: true }).fill('jamie.managed@harbor.test');
    await client.getByLabel('Password', { exact: true }).fill('managed-browser-password');
    await client.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard$/);
    await client.getByRole('link', { name: 'Support', exact: true }).click();
    await client.getByRole('button', { name: 'New ticket', exact: true }).click();
    await client.getByLabel('Ticket subject', { exact: true }).fill('Browser support request');
    await client
      .getByLabel('Support department', { exact: true })
      .selectOption({ label: 'Game support' });
    await client
      .getByLabel('Describe the issue', { exact: true })
      .fill('Please inspect my server log.');
    await client.getByRole('button', { name: 'Create ticket', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard\/tickets\//);
    await client.getByLabel('Your reply', { exact: true }).fill('Here are my logs');
    await client.getByLabel('Attach a file', { exact: true }).setInputFiles({
      name: 'client.log',
      mimeType: 'text/plain',
      buffer: Buffer.from('Browser test server log'),
    });
    await client.getByRole('button', { name: 'Send reply', exact: true }).click();
    await expect(client.getByText('Here are my logs', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('link', { name: /Browser support request/ }).click();
    await page.getByLabel('Your reply', { exact: true }).fill('Internal staff diagnosis');
    await page.getByLabel('Private staff note (hidden from customer)').check();
    await page.getByRole('button', { name: 'Send reply', exact: true }).click();
    await expect(page.getByText('Internal staff diagnosis', { exact: true })).toBeVisible();
    await client.reload();
    await expect(client.getByText('Internal staff diagnosis', { exact: true })).toHaveCount(0);
    await page.getByLabel('Your reply', { exact: true }).fill('Please try restarting now.');
    await page.getByRole('button', { name: 'Send reply', exact: true }).click();
    await expect(page.getByText('Please try restarting now.', { exact: true })).toBeVisible();
    await client.reload();
    await expect(client.getByText('Please try restarting now.', { exact: true })).toBeVisible();
    const downloadPromise = client.waitForEvent('download');
    await client.getByRole('link', { name: /client.log/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('client.log');
    await page.getByRole('button', { name: 'Ticket settings', exact: true }).click();
    await page
      .getByLabel('Assigned support agent', { exact: true })
      .selectOption({ label: 'Administrator' });
    await page.getByLabel('Ticket priority', { exact: true }).selectOption('HIGH');
    await page.getByRole('button', { name: 'Save ticket settings', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await client.getByRole('button', { name: 'Close ticket', exact: true }).click();
    await expect(client.getByRole('button', { name: 'Reopen ticket', exact: true })).toBeVisible();
    await client.getByRole('button', { name: 'Reopen ticket', exact: true }).click();
    await expect(client.getByRole('button', { name: 'Close ticket', exact: true })).toBeVisible();
    await page.reload();
    await page.screenshot({ path: 'artifacts/screenshots/support-ticket.png', fullPage: true });
  } finally {
    await context.close();
  }
});

test('admin creates a coupon and checkout settles a fully discounted order without spending wallet funds', async ({
  page,
  browser,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post(`/api/v1${path}`, {
      headers: { Origin: 'http://127.0.0.1:3100' },
      data,
    });
    expect(r.status()).toBe(201);
    return (await r.json()).data;
  };
  const node = await post('/nodes', {
    name: 'Contract fixture node',
    provider: 'wings',
    url: 'http://127.0.0.1:9',
    config: { paperDownloadUrl: 'https://example.test/paper.jar', paperSha256: 'a'.repeat(64) },
    secret: {},
  });
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
  });
  try {
    await db.connection.update({ where: { id: node.id }, data: { health: 'ONLINE' } });
  } finally {
    await db.$disconnect();
  }
  await post(`/nodes/${node.id}/resources`, {
    kind: 'allocation',
    value: '203.0.113.20:25565',
    config: { ip: '203.0.113.20', port: 25565 },
  });
  await post('/products', {
    name: 'Coupon Minecraft',
    description: 'Contract checkout fixture; no real hosting node.',
    provider: 'wings',
    category: 'game',
    connectionId: node.id,
    price: 1000,
    active: true,
    spec: { memoryMb: 2048, diskMb: 20480, cpu: 1 },
  });
  await page.goto('/admin/coupons');
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await page.getByLabel('Coupon code', { exact: true }).fill('FREEUI');
  await page.getByLabel('Discount percentage', { exact: true }).fill('100');
  await page.getByLabel('Coupon Minecraft', { exact: true }).check();
  await page.getByRole('button', { name: 'Save coupon', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const context = await browser.newContext();
  try {
    const client = await context.newPage();
    await client.goto('http://127.0.0.1:3100/login');
    await client.getByLabel('Email address', { exact: true }).fill('jamie.managed@harbor.test');
    await client.getByLabel('Password', { exact: true }).fill('managed-browser-password');
    await client.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard$/);
    await client.goto('http://127.0.0.1:3100/store');
    const plan = client
      .locator('article')
      .filter({ has: client.getByRole('heading', { name: 'Coupon Minecraft', exact: true }) });
    await plan.getByRole('button', { name: 'Get started', exact: true }).click();
    await client.getByLabel('Coupon code', { exact: true }).fill('FREEUI');
    await client.getByRole('button', { name: 'Apply coupon', exact: true }).click();
    await expect(client.getByText(/Coupon FREEUI:/)).toBeVisible();
    await client.getByRole('button', { name: 'Create order', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard\/invoices\//);
    await expect(
      client.getByText('Covered by promotion — no payment collected', { exact: true }),
    ).toBeVisible();
    await expect(client.getByText('Coupon FREEUI', { exact: true })).toBeVisible();
    expect(
      (await (await client.request.get('http://127.0.0.1:3100/api/v1/wallet?currency=USD')).json())
        .data.balance,
    ).toBe(2500);
    await client.screenshot({ path: 'artifacts/screenshots/coupon-invoice.png', fullPage: true });
  } finally {
    await context.close();
  }
});

test('catalog category, capacity, and tax settings carry through checkout and wallet payment', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/categories');
  await page.getByRole('button', { name: 'Create category', exact: true }).click();
  await page.getByLabel('Category name', { exact: true }).fill('Minecraft servers');
  await page.getByLabel('Category slug', { exact: true }).fill('minecraft-servers');
  await page.getByRole('button', { name: 'Save category', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'Create product', exact: true }).click();
  await page.getByLabel('Product name', { exact: true }).fill('Tax Minecraft');
  await page.getByLabel('Description', { exact: true }).fill('Tax and capacity checkout fixture');
  await page.getByLabel('Show this plan in the storefront', { exact: true }).check();
  await page
    .getByLabel('Catalog category', { exact: true })
    .selectOption({ label: 'Minecraft servers' });
  await page
    .getByLabel('Hosting connection', { exact: true })
    .selectOption({ label: 'Contract fixture node' });
  await page.getByLabel('Base price (USD)', { exact: true }).fill('10.00');
  await page.getByLabel('Total stock', { exact: true }).fill('1');
  await page.getByLabel('Limit per customer', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: 'Tax Minecraft' });
  await row.getByRole('button', { name: 'Enable orders', exact: true }).click();
  await expect(row.getByText('Orders enabled', { exact: true })).toBeVisible();
  const nodes = (await (await page.request.get('/api/v1/nodes')).json()).data;
  const node = nodes.find((n: any) => n.name === 'Contract fixture node');
  expect(
    (
      await page.request.post(`/api/v1/nodes/${node.id}/resources`, {
        headers: { Origin: 'http://127.0.0.1:3100' },
        data: {
          kind: 'allocation',
          value: '203.0.113.20:25566',
          config: { ip: '203.0.113.20', port: 25566 },
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto('/admin/taxes');
  await page.getByLabel('Enable tax calculation', { exact: true }).check();
  await page.getByRole('button', { name: 'Save tax policy', exact: true }).click();
  await page.getByRole('button', { name: 'Add tax rate', exact: true }).click();
  await page.getByLabel('Tax name', { exact: true }).fill('VAT');
  await page.getByLabel('Country code', { exact: true }).fill('GB');
  await page.getByLabel('Tax percentage', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Save tax rate', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/screenshots/tax-settings.png', fullPage: true });
  const context = await browser.newContext();
  try {
    const client = await context.newPage();
    client.on('pageerror', (e) => errors.push(e.message));
    await client.goto('http://127.0.0.1:3100/login');
    await client.getByLabel('Email address', { exact: true }).fill('jamie.managed@harbor.test');
    await client.getByLabel('Password', { exact: true }).fill('managed-browser-password');
    await client.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard$/);
    await client.goto('http://127.0.0.1:3100/store');
    await client
      .getByLabel('Browse category', { exact: true })
      .selectOption({ label: 'Minecraft servers' });
    await expect(client.locator('article')).toHaveCount(1);
    await client.getByRole('button', { name: 'Get started', exact: true }).click();
    await expect(
      client.getByText('VAT (20%): $2.00 added to discounted price.', { exact: true }),
    ).toBeVisible();
    await client.getByRole('button', { name: 'Create order', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard\/invoices\//);
    await expect(client.getByText('VAT (20%)', { exact: true })).toBeVisible();
    await expect(client.getByText('$12.00', { exact: true }).first()).toBeVisible();
    await client.getByRole('button', { name: /^Pay with wallet/ }).click();
    await expect(client.getByText('Paid', { exact: true }).first()).toBeVisible();
    const wallet = (
      await (await client.request.get('http://127.0.0.1:3100/api/v1/wallet?currency=USD')).json()
    ).data;
    expect(wallet.balance).toBe(1300);
    await client.screenshot({ path: 'artifacts/screenshots/tax-invoice.png', fullPage: true });
    await client.goto('http://127.0.0.1:3100/store');
    await client
      .getByLabel('Browse category', { exact: true })
      .selectOption({ label: 'Minecraft servers' });
    await expect(client.getByRole('button', { name: 'Sold out', exact: true })).toBeDisabled();
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});

test('customer cancellation, staff review, withdrawal, and late-payment reconciliation work together', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const context = await browser.newContext();
  try {
    const client = await context.newPage();
    client.on('pageerror', (e) => errors.push(e.message));
    await client.goto('http://127.0.0.1:3100/login');
    await client.getByLabel('Email address', { exact: true }).fill('jamie.managed@harbor.test');
    await client.getByLabel('Password', { exact: true }).fill('managed-browser-password');
    await client.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard$/);
    const services = (
      await (await client.request.get('http://127.0.0.1:3100/api/v1/services')).json()
    ).data;
    const service = services.find((s: any) => s.plan === 'Tax Minecraft');
    expect(service).toBeTruthy();
    const invoices = (
      await (await client.request.get('http://127.0.0.1:3100/api/v1/invoices')).json()
    ).data;
    const invoice = invoices.find((i: any) => i.serviceId === service.id);
    await client.goto(`http://127.0.0.1:3100/dashboard/services/${service.id}`);
    const request = async (reason: string, mode: string) => {
      await client.getByRole('button', { name: 'Request cancellation', exact: true }).click();
      await client.getByLabel('Cancellation timing', { exact: true }).selectOption(mode);
      await client.getByLabel('Cancellation reason', { exact: true }).fill(reason);
      await client.getByLabel('Confirm service name', { exact: true }).fill(service.name);
      await client
        .getByRole('button', { name: 'Submit cancellation request', exact: true })
        .click();
      await expect(client.getByRole('dialog')).toHaveCount(0);
    };
    const review = async (reason: string, decision: string) => {
      await page.goto('/admin/cancellations');
      const row = page.getByRole('row').filter({ hasText: reason });
      await row.getByRole('button', { name: 'Review request', exact: true }).click();
      await page.getByLabel('Review decision', { exact: true }).selectOption(decision);
      await page
        .getByLabel('Response to customer', { exact: true })
        .fill(
          decision === 'APPROVE'
            ? 'Approved as requested by the customer.'
            : 'Please confirm that the installation can be removed.',
        );
      if (decision === 'APPROVE')
        await page.getByLabel('Confirm service name', { exact: true }).fill(service.name);
      await page
        .getByRole('button', {
          name: decision === 'APPROVE' ? 'Approve cancellation' : 'Reject cancellation',
          exact: true,
        })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    await request('End my service when the current term ends', 'END_OF_TERM');
    await review('End my service when the current term ends', 'APPROVE');
    await client.reload();
    await expect(client.getByText(/Cancellation approved for/)).toBeVisible();
    await client.getByRole('button', { name: 'Withdraw request', exact: true }).click();
    await expect(client.getByText('WITHDRAWN', { exact: true })).toBeVisible();
    await request('Cancel unused installation now', 'IMMEDIATE');
    await review('Cancel unused installation now', 'REJECT');
    await client.reload();
    await expect(client.getByText('REJECTED', { exact: true })).toBeVisible();
    await request('Confirmed removal of unused installation', 'IMMEDIATE');
    await review('Confirmed removal of unused installation', 'APPROVE');
    await client.reload();
    await expect(client.getByText('Terminated', { exact: true })).toBeVisible();
    await expect(client.getByText('COMPLETE', { exact: true })).toBeVisible();
    await client.screenshot({
      path: 'artifacts/screenshots/service-cancellation.png',
      fullPage: true,
    });
    const receipt = await page.request.post(`/api/v1/invoices/${invoice.id}/manual-payment`, {
      headers: { Origin: 'http://127.0.0.1:3100' },
      data: { reference: 'cancellation-browser-late-transfer' },
    });
    expect(receipt.status()).toBe(201);
    expect((await receipt.json()).data.reviewRequired).toBe(true);
    await page.goto('/admin/payment-reviews');
    await page.getByRole('button', { name: 'Record resolution', exact: true }).click();
    await page
      .getByLabel('Resolution notes', { exact: true })
      .fill('External refund verified against test transfer reference refund-browser-001.');
    await page.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/External refund verified against test transfer/)).toBeVisible();
    const wallet = (
      await (await client.request.get('http://127.0.0.1:3100/api/v1/wallet?currency=USD')).json()
    ).data;
    expect(wallet.balance).toBe(1300);
    await page.screenshot({ path: 'artifacts/screenshots/payment-review.png', fullPage: true });
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});

test('staff configures regional billing plans and priced resource options for customer checkout', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'Create product', exact: true }).click();
  await page.getByLabel('Product name', { exact: true }).fill('Flexible Minecraft');
  await page
    .getByLabel('Description', { exact: true })
    .fill('Configurable billing and resources fixture');
  await page.getByLabel('Show this plan in the storefront', { exact: true }).check();
  await page
    .getByLabel('Hosting connection', { exact: true })
    .selectOption({ label: 'Contract fixture node' });
  await page.getByLabel('Base price (USD)', { exact: true }).fill('10.00');
  await page.getByLabel('Setup fee (USD)', { exact: true }).fill('3.00');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: 'Flexible Minecraft' });
  await row.getByRole('button', { name: 'Enable orders', exact: true }).click();
  await expect(row.getByText('Orders enabled', { exact: true })).toBeVisible();
  await row.getByRole('link', { name: 'Configure options', exact: true }).click();
  await page.getByRole('button', { name: 'Add billing plan', exact: true }).click();
  await page.getByLabel('Billing plan name', { exact: true }).fill('Quarterly flexible');
  await page.getByLabel('Billing period', { exact: true }).fill('3');
  await page.getByLabel('Plan amount (USD)', { exact: true }).fill('20.00');
  await page.getByLabel('Plan setup fee (USD)', { exact: true }).fill('5.00');
  await page.getByRole('button', { name: 'Add regional plan price', exact: true }).click();
  await page
    .getByLabel('Plan region 1', { exact: true })
    .selectOption({ label: 'United Kingdom · GBP' });
  await page.getByLabel('Regional plan amount 1', { exact: true }).fill('18.00');
  await page.getByLabel('Regional plan setup fee 1', { exact: true }).fill('4.00');
  await page.getByRole('button', { name: 'Save billing plan', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add option', exact: true }).click();
  await page.getByLabel('Option name', { exact: true }).fill('Extra memory');
  await page.getByLabel('Property key', { exact: true }).fill('extra_memory');
  await page.getByRole('checkbox', { name: 'Required', exact: true }).check();
  await page.getByLabel('Resource binding', { exact: true }).selectOption('memoryMb');
  await page.getByRole('button', { name: 'Add choice', exact: true }).click();
  await page.getByLabel('Choice 1 name', { exact: true }).fill('Extra 2 GB');
  await page.getByLabel('Choice 1 value', { exact: true }).fill('2048');
  const addPrice = async (
    label: string,
    index: number,
    term: string,
    currency: string,
    amount: string,
    fee: string,
  ) => {
    await page
      .getByRole('button', { name: `Add ${label.toLowerCase()} price`, exact: true })
      .click();
    if (term)
      await page
        .getByLabel(`${label} ${index} billing plan`, { exact: true })
        .selectOption({ label: term });
    await page.getByLabel(`${label} ${index} currency`, { exact: true }).selectOption(currency);
    await page.getByLabel(`${label} ${index} recurring price`, { exact: true }).fill(amount);
    await page.getByLabel(`${label} ${index} setup fee`, { exact: true }).fill(fee);
  };
  await addPrice('Choice 1', 1, '', 'USD', '2.00', '1.00');
  await addPrice('Choice 1', 2, 'Quarterly flexible', 'GBP', '3.00', '1.00');
  await page.getByRole('button', { name: 'Save option', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add option', exact: true }).click();
  await page.getByLabel('Option name', { exact: true }).fill('Extra CPU');
  await page.getByLabel('Property key', { exact: true }).fill('extra_cpu');
  await page.getByLabel('Option type', { exact: true }).selectOption('QUANTITY');
  await page.getByLabel('Resource binding', { exact: true }).selectOption('cpu');
  await page.getByLabel('Maximum quantity', { exact: true }).fill('4');
  await addPrice('Option', 1, '', 'USD', '1.00', '0.00');
  await addPrice('Option', 2, 'Quarterly flexible', 'GBP', '1.00', '0.25');
  await page.getByRole('button', { name: 'Save option', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add option', exact: true }).click();
  await page.getByLabel('Option name', { exact: true }).fill('World name');
  await page.getByLabel('Property key', { exact: true }).fill('world_name');
  await page.getByLabel('Option type', { exact: true }).selectOption('TEXT');
  await page.getByRole('checkbox', { name: 'Required', exact: true }).check();
  await page.getByLabel('Property validation', { exact: true }).selectOption('slug');
  await page.getByRole('button', { name: 'Save option', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({
    path: 'artifacts/screenshots/product-configuration.png',
    fullPage: true,
  });
  const nodes = (await (await page.request.get('/api/v1/nodes')).json()).data;
  const node = nodes.find((n: any) => n.name === 'Contract fixture node');
  expect(
    (
      await page.request.post(`/api/v1/nodes/${node.id}/resources`, {
        headers: { Origin: 'http://127.0.0.1:3100' },
        data: {
          kind: 'allocation',
          value: '203.0.113.20:25567',
          config: { ip: '203.0.113.20', port: 25567 },
        },
      })
    ).status(),
  ).toBe(201);
  const context = await browser.newContext();
  try {
    const client = await context.newPage();
    client.on('pageerror', (e) => errors.push(e.message));
    await client.goto('http://127.0.0.1:3100/login');
    await client.getByLabel('Email address', { exact: true }).fill('jamie.managed@harbor.test');
    await client.getByLabel('Password', { exact: true }).fill('managed-browser-password');
    await client.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard$/);
    await client.goto('http://127.0.0.1:3100/store');
    const product = client
      .locator('article')
      .filter({ has: client.getByRole('heading', { name: 'Flexible Minecraft', exact: true }) });
    await product.getByRole('button', { name: 'Get started', exact: true }).click();
    await expect(client.getByRole('button', { name: 'Create order', exact: true })).toBeDisabled();
    const billing = client.getByLabel('Billing plan', { exact: true });
    const quarterly = await billing
      .locator('option')
      .filter({ hasText: 'Quarterly flexible' })
      .getAttribute('value');
    await billing.selectOption(quarterly!);
    await client.getByLabel('Extra CPU', { exact: true }).fill('2');
    await client.getByLabel('World name *', { exact: true }).fill('my-world');
    await expect(client.getByRole('dialog').getByText('£34.20', { exact: true })).toBeVisible();
    await expect(
      client.getByText(/Configured resources: 4096 MB memory.*3 CPU cores/),
    ).toBeVisible();
    await expect(client.getByText(/Renews at £27.60 \/ 3 months/)).toBeVisible();
    await client.screenshot({
      path: 'artifacts/screenshots/configured-checkout.png',
      fullPage: true,
    });
    await client.getByRole('button', { name: 'Create order', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard\/invoices\//);
    await expect(client.getByText('Setup fees', { exact: true })).toBeVisible();
    await expect(client.getByText('Extra memory: Extra 2 GB', { exact: true })).toBeVisible();
    await expect(client.getByText('£5.50', { exact: true })).toBeVisible();
    const invoiceId = client.url().split('/').pop()!;
    const receipt = await page.request.post(`/api/v1/invoices/${invoiceId}/manual-payment`, {
      headers: { Origin: 'http://127.0.0.1:3100' },
      data: { reference: 'configured-browser-bank-001' },
    });
    expect(receipt.status()).toBe(201);
    const invoices = (
      await (await client.request.get('http://127.0.0.1:3100/api/v1/invoices')).json()
    ).data;
    const invoice = invoices.find((i: any) => i.id === invoiceId);
    const services = (
      await (await client.request.get('http://127.0.0.1:3100/api/v1/services')).json()
    ).data;
    const service = services.find((s: any) => s.id === invoice.serviceId);
    expect(service.interval).toBe('3 months');
    expect(service.price).toBe(2300);
    expect(service.currency).toBe('GBP');
    const expected = new Date(invoice.periodStart);
    expected.setUTCMonth(expected.getUTCMonth() + 3);
    expect(service.renewsAt).toBe(expected.toISOString());
    await client.goto(`http://127.0.0.1:3100/dashboard/services/${service.id}`);
    await expect(
      client.getByRole('heading', { name: 'Purchased configuration', exact: true }),
    ).toBeVisible();
    await expect(client.getByText('my-world', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});

test('a stale administrator edit cannot overwrite another writer configuration', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const products = (await (await page.request.get('/api/v1/products')).json()).data;
  const product = products.find((p: any) => p.name === 'Flexible Minecraft');
  expect(product).toBeTruthy();
  await page.goto(`/admin/products/${product.id}`);
  const row = page.getByRole('row').filter({ hasText: 'World name' });
  await row.getByRole('button', { name: 'Edit option', exact: true }).click();
  await page
    .getByLabel('Option description', { exact: true })
    .fill('This older draft must not replace a concurrent edit.');
  const configuration = (
    await (await page.request.get(`/api/v1/products/${product.id}/configuration`)).json()
  ).data;
  const options = configuration.options.map((o: any) =>
    o.key === 'world_name' ? { ...o, description: 'Saved by another administrator.' } : o,
  );
  const external = await page.request.patch(`/api/v1/products/${product.id}/configuration`, {
    headers: { Origin: 'http://127.0.0.1:3100' },
    data: { plans: configuration.plans, options, expectedVersion: configuration.version },
  });
  expect(external.status()).toBe(200);
  // The configuration refreshes in place while the older form remains open.
  const refresh = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/v1/products/${product.id}/configuration`) &&
      r.request().method() === 'GET',
    // Allow two refresh intervals plus network time when the browser is under load.
    { timeout: 30000 },
  );
  await refresh;
  await page.getByRole('button', { name: 'Save option', exact: true }).click();
  await expect(
    page.getByText('Configuration changed. Reload before saving.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  const current = (
    await (await page.request.get(`/api/v1/products/${product.id}/configuration`)).json()
  ).data;
  expect(current.version).toBe(configuration.version + 1);
  expect(current.options.find((o: any) => o.key === 'world_name').description).toBe(
    'Saved by another administrator.',
  );
});

test('staff issues a numbered multi-item invoice and the customer pays partially before funding a wallet', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/settings?section=billing');
  await page.getByLabel('Invoice number prefix', { exact: true }).fill('ACME');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
  await page.goto('/admin/invoices');
  await page.getByRole('button', { name: 'Create invoice', exact: true }).click();
  const users = (await (await page.request.get('/api/v1/customers')).json()).data;
  const customer = users.find((u: any) => u.email === 'jamie.managed@harbor.test');
  await page.getByLabel('Invoice customer', { exact: true }).selectOption(customer.id);
  await page
    .getByLabel('Invoice description', { exact: true })
    .fill('Managed migration assistance');
  await page.getByLabel('Invoice currency', { exact: true }).selectOption('USD');
  await page.getByLabel('Item 1 description', { exact: true }).fill('Migration assistance');
  await page.getByLabel('Item 1 quantity', { exact: true }).fill('2');
  await page.getByLabel('Item 1 unit price (USD)', { exact: true }).fill('10.00');
  await page.getByRole('button', { name: 'Add invoice item', exact: true }).click();
  await page.getByLabel('Item 2 description', { exact: true }).fill('Non-taxable charge');
  await page.getByLabel('Item 2 unit price (USD)', { exact: true }).fill('5.00');
  await page.getByRole('checkbox', { name: 'Taxable item 2', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Review invoice', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('$29.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/invoices\//);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const invoiceId = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { name: /ACME-2026-/ })).toBeVisible();
  const context = await browser.newContext();
  try {
    const client = await context.newPage();
    client.on('pageerror', (e) => errors.push(e.message));
    await client.goto('http://127.0.0.1:3100/login');
    await client.getByLabel('Email address', { exact: true }).fill('jamie.managed@harbor.test');
    await client.getByLabel('Password', { exact: true }).fill('managed-browser-password');
    await client.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard$/);
    await client.goto(`http://127.0.0.1:3100/dashboard/invoices/${invoiceId}`);
    await client.getByRole('button', { name: 'Pay part with wallet', exact: true }).click();
    await client.getByLabel('Wallet payment amount (USD)', { exact: true }).fill('10.00');
    await client.getByRole('button', { name: 'Apply wallet payment', exact: true }).click();
    await expect(client.getByRole('dialog')).toHaveCount(0);
    await expect(client.getByText('Part paid', { exact: true })).toBeVisible();
    let invoice = (
      await (await client.request.get(`http://127.0.0.1:3100/api/v1/invoices/${invoiceId}`)).json()
    ).data;
    expect(invoice.paidAmount).toBe(1000);
    expect(invoice.balanceDue).toBe(1900);
    expect(invoice.serviceId).toBeNull();
    await page.reload();
    await page.getByRole('button', { name: 'Record offline payment', exact: true }).click();
    await page
      .getByLabel('Bank or payment reference', { exact: true })
      .fill('browser-adhoc-partial-001');
    await page.getByLabel('Received amount (USD)', { exact: true }).fill('5.00');
    await page.getByRole('button', { name: 'Confirm payment received', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await client.reload();
    await expect(
      client
        .getByText('Balance due', { exact: true })
        .locator('..')
        .getByText('$14.00', { exact: true }),
    ).toBeVisible();
    await client.screenshot({ path: 'artifacts/screenshots/partial-invoice.png', fullPage: true });
    await page.getByRole('button', { name: 'Record offline payment', exact: true }).click();
    await page
      .getByLabel('Bank or payment reference', { exact: true })
      .fill('browser-adhoc-final-001');
    await page.getByRole('button', { name: 'Confirm payment received', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
    invoice = (
      await (await client.request.get(`http://127.0.0.1:3100/api/v1/invoices/${invoiceId}`)).json()
    ).data;
    expect(invoice.paidAmount).toBe(2900);
    expect(invoice.balanceDue).toBe(0);
    expect(invoice.payments.every((p: any) => !p.reviewRequired)).toBe(true);
    await client.goto('http://127.0.0.1:3100/dashboard/wallet');
    await client.getByLabel('Wallet currency', { exact: true }).selectOption('USD');
    await expect(client.getByText('$3.00', { exact: true }).first()).toBeVisible();
    await client.getByRole('button', { name: 'Add funds', exact: true }).click();
    await client.getByLabel('Funding amount (USD)', { exact: true }).fill('5.00');
    await client.getByRole('button', { name: 'Create funding invoice', exact: true }).click();
    await expect(client).toHaveURL(/\/dashboard\/invoices\//);
    const fundingId = client.url().split('/').pop()!;
    await expect(client.getByRole('button', { name: /^Pay with wallet/ })).toHaveCount(0);
    await expect(
      client.getByText(/Wallet funding invoice. No service tax is charged/),
    ).toBeVisible();
    await page.goto(`/admin/invoices/${fundingId}`);
    await page.getByRole('button', { name: 'Record offline payment', exact: true }).click();
    await page
      .getByLabel('Bank or payment reference', { exact: true })
      .fill('browser-gateway-funding-bank-001');
    await page.getByRole('button', { name: 'Confirm payment received', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await client.reload();
    await expect(client.getByText('Funds credited to your wallet.', { exact: true })).toBeVisible();
    const wallet = (
      await (await client.request.get('http://127.0.0.1:3100/api/v1/wallet?currency=USD')).json()
    ).data;
    expect(wallet.balance).toBe(800);
    await client.screenshot({ path: 'artifacts/screenshots/funding-invoice.png', fullPage: true });
    await page.goto(`/admin/customers/${customer.id}`);
    await page.getByRole('tab', { name: 'invoices', exact: true }).click();
    await expect(page.getByText('Managed migration assistance', { exact: true })).toBeVisible();
    await expect(page.getByText('Wallet funding (USD)', { exact: true })).toBeVisible();
    await context.storageState({ path: 'test-results/cart-customer-state.json' });
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});

test('voiding a part-paid ad-hoc invoice retains the receipt and opens reconciliation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/invoices');
  await page.getByRole('button', { name: 'Create invoice', exact: true }).click();
  const users = (await (await page.request.get('/api/v1/customers')).json()).data;
  const user = users.find((u: any) => u.email === 'jamie.managed@harbor.test');
  await page.getByLabel('Invoice customer', { exact: true }).selectOption(user.id);
  await page.getByLabel('Invoice description', { exact: true }).fill('Withdrawn setup assistance');
  await page.getByLabel('Item 1 description', { exact: true }).fill('Setup assistance');
  await page.getByLabel('Item 1 unit price (USD)', { exact: true }).fill('10.00');
  await page.getByRole('checkbox', { name: 'Taxable item 1', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Review invoice', exact: true }).click();
  await page.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/invoices\//);
  const id = page.url().split('/').pop()!;
  await page.getByRole('button', { name: 'Record offline payment', exact: true }).click();
  await page
    .getByLabel('Bank or payment reference', { exact: true })
    .fill(`browser-voided-receipt-${id}`);
  await page.getByLabel('Received amount (USD)', { exact: true }).fill('2.00');
  await page.getByRole('button', { name: 'Confirm payment received', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Void invoice', exact: true }).click();
  await page
    .getByLabel('Void reason', { exact: true })
    .fill('Charge withdrawn after partial receipt; reconciliation required.');
  await page.getByRole('button', { name: 'Confirm invoice void', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Void', { exact: true })).toBeVisible();
  const invoice = (await (await page.request.get(`/api/v1/invoices/${id}`)).json()).data;
  expect(invoice.paidAmount).toBe(200);
  expect(invoice.balanceDue).toBe(0);
  expect(invoice.payments[0].reviewRequired).toBe(true);
  await page.goto('/admin/payment-reviews');
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: invoice.number, exact: true }) });
  await expect(row).toContainText('Part-paid invoice voided');
  await expect(row).toContainText('Applied $2.00');
  await row.getByRole('button', { name: 'Record resolution', exact: true }).click();
  await page
    .getByLabel('Resolution notes', { exact: true })
    .fill('External refund verified against the bank receipt; no wallet credit applied.');
  await page.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const wallet = (
    await (await page.request.get(`/api/v1/admin/wallets/${user.id}?currency=USD`)).json()
  ).data;
  expect(wallet.balance).toBe(800);
  await page.screenshot({
    path: 'artifacts/screenshots/partial-void-reconciliation.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('invoice PDF downloads and staff email history work with automatic delivery settings', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const invoices = (await (await page.request.get('/api/v1/invoices')).json()).data;
  const invoice = invoices.find((i: any) => i.description === 'Managed migration assistance');
  await page.goto(`/admin/invoices/${invoice.id}`);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download PDF', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`${invoice.number}.pdf`);
  await download.saveAs('artifacts/screenshots/invoice-download.pdf');
  const pdf = await page.request.get(`/api/v1/invoices/${invoice.id}/pdf`);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByRole('button', { name: 'Email invoice', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('jamie.managed@harbor.test');
  await page.getByRole('button', { name: 'Queue invoice email', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const history = page.getByRole('region', { name: 'Invoice email delivery' });
  await expect(history).toContainText('Staff request');
  await expect(history).toContainText('pending');
  await expect(history).toContainText('SMTP is not configured');
  await page.screenshot({
    path: 'artifacts/screenshots/invoice-email-history.png',
    fullPage: true,
  });
  await page.goto('/admin/settings?section=email');
  await page.getByRole('switch', { name: 'Automatically email invoice PDFs', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
  expect(
    (await (await page.request.get('/api/v1/settings')).json()).data.invoiceEmailsEnabled,
  ).toBe(true);
  const created = await page.request.post('/api/v1/invoices', {
    headers: { Origin: 'http://127.0.0.1:3100' },
    data: {
      userId: invoice.userId,
      description: 'Automatic invoice PDF fixture',
      currency: 'USD',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      idempotencyKey: '0bde98b0-f7a6-49b5-b2c9-a4e770737fee',
      items: [
        { description: 'Email workflow validation', quantity: 1, unitAmount: 100, taxable: false },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const issued = (await created.json()).data;
  await page.goto(`/admin/invoices/${issued.id}`);
  await expect(page.getByRole('region', { name: 'Invoice email delivery' })).toContainText(
    'Invoice issued',
  );
  await page.goto('/admin/settings?section=email');
  await page.getByRole('switch', { name: 'Automatically email invoice PDFs', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('settings customization saves sections independently, protects drafts and updates the real portal', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const original = (await (await page.request.get('/api/v1/settings')).json()).data;
  const headers = { Origin: 'http://127.0.0.1:3100' };
  try {
    await page.goto('/admin/settings');
    await page.getByLabel('Search settings', { exact: true }).fill('logo');
    await expect(page.getByText('Make the workspace yours', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Branding', exact: true }).click();
    await expect(page.getByLabel('Search settings', { exact: true })).toHaveValue('');
    await page.getByLabel('Browser title', { exact: true }).fill('Mizo Control');
    await page.getByLabel('Brand accent', { exact: true }).fill('#8b5cf6');
    await page.getByLabel('Interface density', { exact: true }).selectOption('compact');
    const sharp = (await import('sharp')).default;
    const buffer = await sharp({
      create: { width: 16, height: 16, channels: 4, background: '#8b5cf6' },
    })
      .png()
      .toBuffer();
    await page
      .getByLabel('Upload company logo', { exact: true })
      .setInputFiles({ name: 'brand.png', mimeType: 'image/png', buffer });
    await expect(page.getByLabel('Logo URL', { exact: true })).toHaveValue(
      /^\/api\/v1\/branding\//,
    );
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
    await expect(page).toHaveTitle('Mizo Control');
    await expect(page.locator('html')).toHaveAttribute('data-harbor-density', 'compact');
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
      ),
    ).toBe('#8b5cf6');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'artifacts/screenshots/settings-branding.png', fullPage: true });
    await page.getByLabel('Browser title', { exact: true }).fill('Draft title not published');
    await page.getByRole('button', { name: 'Storefront', exact: true }).click();
    await page.getByLabel('Hero headline', { exact: true }).fill('Power your next world');
    await page.getByRole('switch', { name: 'Show announcement', exact: true }).click();
    await page
      .getByLabel('Announcement message', { exact: true })
      .fill('Scheduled network expansion');
    await page
      .getByLabel('Terms of service URL', { exact: true })
      .fill('https://example.test/terms');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
    const saved = (await (await page.request.get('/api/v1/settings')).json()).data;
    expect(saved.experience.siteTitle).toBe('Mizo Control');
    expect(saved.experience.storefront.title).toBe('Power your next world');
    await page.getByRole('button', { name: 'Branding', exact: true }).click();
    await expect(page.getByLabel('Browser title', { exact: true })).toHaveValue(
      'Draft title not published',
    );
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByLabel('Browser title', { exact: true })).toHaveValue('Mizo Control');
    await page.goto('/store');
    await expect(
      page.getByRole('heading', { name: 'Power your next world', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Scheduled network expansion', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Terms', exact: true })).toHaveAttribute(
      'href',
      'https://example.test/terms',
    );
    await page.getByRole('button', { name: 'Dismiss announcement', exact: true }).click();
    await expect(page.getByText('Scheduled network expansion', { exact: true })).toHaveCount(0);
    await page.goto('/admin/settings?section=branding');
    await page.getByLabel('Browser title', { exact: true }).fill('Conflicting draft title');
    expect(
      (
        await page.request.patch('/api/v1/settings', {
          headers,
          data: { companyName: 'Remote company change' },
        })
      ).status(),
    ).toBe(200);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(
      page.getByText('Settings changed in another session. Your draft is preserved.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel('Browser title', { exact: true })).toHaveValue(
      'Conflicting draft title',
    );
    await page.getByRole('button', { name: 'Reload latest', exact: true }).click();
    await page.getByRole('button', { name: 'Discard drafts and reload', exact: true }).click();
    await expect(page.getByLabel('Browser title', { exact: true })).toHaveValue('Mizo Control');
    await page.getByRole('button', { name: 'Security & access', exact: true }).click();
    await page.getByRole('switch', { name: 'Enable maintenance mode', exact: true }).click();
    await page
      .getByLabel('Maintenance message', { exact: true })
      .fill('Upgrading the hosting network.');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    try {
      await visitor.goto('http://127.0.0.1:3100/store');
      await expect(
        visitor.getByRole('heading', { name: 'Scheduled maintenance', exact: true }),
      ).toBeVisible();
      await expect(
        visitor.getByText('Upgrading the hosting network.', { exact: true }),
      ).toBeVisible();
    } finally {
      await anonymous.close();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/settings?section=branding');
    await expect(page.getByLabel('Browser title', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'artifacts/screenshots/settings-mobile.png', fullPage: true });
  } finally {
    await page.request.patch('/api/v1/settings', {
      headers,
      data: {
        companyName: original.companyName,
        experience: original.experience,
        access: original.access,
        accentColor: original.accentColor,
        logoUrl: original.logoUrl,
      },
    });
  }
  expect(errors).toEqual([]);
});

test('staff configures encrypted SMTP, submits a test email and edits validated notification templates', async ({
  page,
}) => {
  const { SMTPServer } = await import('smtp-server');
  const received: string[] = [];
  const smtp = new SMTPServer({
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    onAuth(auth, _s, cb) {
      cb(
        auth.username === 'browser-smtp' && auth.password === 'browser-smtp-password'
          ? undefined
          : new Error('Fixture credentials rejected'),
        { user: 'browser-smtp' },
      );
    },
    onData(stream, _s, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (b) => chunks.push(b));
      stream.on('end', () => {
        received.push(Buffer.concat(chunks).toString());
        cb();
      });
    },
  });
  await new Promise<void>((ok) => smtp.listen(0, '127.0.0.1', ok));
  try {
    await page.goto('/login');
    await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
    await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/settings?section=email');
    await page.getByLabel('SMTP configuration source', { exact: true }).selectOption('custom');
    await page.getByLabel('SMTP host', { exact: true }).fill('127.0.0.1');
    await page
      .getByLabel('SMTP port', { exact: true })
      .fill(String((smtp.server.address() as any).port));
    await page.getByLabel('Connection security', { exact: true }).selectOption('PLAIN');
    await page.getByLabel('SMTP username', { exact: true }).fill('browser-smtp');
    await page.getByLabel('SMTP password', { exact: true }).fill('browser-smtp-password');
    await page.getByLabel('Sender name', { exact: true }).fill('Harbor test');
    await page.getByLabel('Sender email', { exact: true }).fill('billing@harbor.test');
    await page.getByRole('button', { name: 'Save SMTP connection', exact: true }).click();
    await expect(page.getByText('SMTP settings saved', { exact: true })).toBeVisible();
    await expect(page.getByLabel('SMTP password', { exact: true })).toHaveValue('');
    const info = (await (await page.request.get('/api/v1/admin/settings')).json()).data;
    expect(info.mail.passwordSet).toBe(true);
    expect(JSON.stringify(info)).not.toContain('browser-smtp-password');
    await page.getByRole('button', { name: 'Send test email', exact: true }).click();
    await expect(
      page.getByText('Test email accepted for owner@harbor.test', { exact: true }),
    ).toBeVisible();
    expect(received).toHaveLength(1);
    await page.getByRole('tab', { name: 'Templates', exact: true }).click();
    await page.getByRole('button', { name: 'Edit template', exact: true }).first().click();
    await page.getByLabel('Email subject', { exact: true }).fill('Recover {{company}} account');
    await page.getByLabel('Email message', { exact: true }).fill('Your reset link: {{link}}');
    await page.getByRole('button', { name: 'Save template', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Customized', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Delivery logs', exact: true }).click();
    await page.getByLabel('Search mail logs', { exact: true }).fill('email delivery test');
    await expect(page.getByText('Harbor email delivery test', { exact: true })).toBeVisible();
    await expect(page.getByText('sent', { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'artifacts/screenshots/settings-email.png', fullPage: true });
    await page.getByRole('tab', { name: 'Delivery', exact: true }).click();
    await page.getByLabel('SMTP configuration source', { exact: true }).selectOption('environment');
    await page.getByRole('button', { name: 'Save SMTP connection', exact: true }).click();
    await expect(page.getByText('SMTP settings saved', { exact: true })).toBeVisible();
  } finally {
    await new Promise<void>((ok) => smtp.close(ok));
  }
});

test('administrators inspect system traces and run serialized maintenance from settings', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('owner@harbor.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/settings?section=system');
  await expect(page.getByText('Worker heartbeat', { exact: true })).toBeVisible();
  await expect(page.getByText('connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run maintenance', exact: true }).click();
  await expect(page.getByText('Maintenance completed', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Audit log', exact: true }).click();
  await page.getByLabel('Search system logs', { exact: true }).fill('system.maintenance.requested');
  await expect(
    page.getByText('system.maintenance.requested', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Inspect', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toContainText('system.maintenance.requested');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const response = await page.request.get('/api/v1/profile?token=do-not-store-this-query');
  const id = response.headers()['x-request-id'];
  expect(id).toBeTruthy();
  await page.getByRole('tab', { name: 'HTTP log', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Errors only', exact: true }).uncheck();
  await page.getByLabel('Search system logs', { exact: true }).fill(id);
  await expect(page.getByText('/api/v1/profile', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toContainText('do-not-store-this-query');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('tab', { name: 'Background jobs', exact: true }).click();
  await expect(page.getByLabel('Job status', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/screenshots/system-settings.png', fullPage: true });
  await page.context().storageState({ path: 'test-results/cart-admin-state.json' });
});

test.describe('combined checkout', () => {
  test.use({ storageState: `${storageDir}/cart-admin-state.json` });
  test('customers combine hosting plans, pay once and cancel an unpaid reservation', async ({
    page,
    browser,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const post = async (path: string, data: unknown) => {
      const response = await page.request.post(`/api/v1${path}`, {
        headers: { Origin: 'http://127.0.0.1:3100' },
        data,
      });
      expect(response.status(), await response.text()).toBe(201);
      return (await response.json()).data;
    };
    const nodes = (await (await page.request.get('/api/v1/nodes')).json()).data;
    const node = nodes.find((n: any) => n.provider === 'wings' && n.health === 'ONLINE');
    expect(node).toBeTruthy();
    for (let port = 26900; port < 26904; port++)
      await post(`/nodes/${node.id}/resources`, {
        kind: 'allocation',
        value: `203.0.113.22:${port}`,
        config: { ip: '203.0.113.22', port },
      });
    for (const [name, price] of [
      ['Cart browser Alpha', 100],
      ['Cart browser Beta', 200],
    ] as const)
      await post('/products', {
        name,
        description: 'Isolated cart browser fixture',
        category: 'game',
        provider: 'wings',
        connectionId: node.id,
        price,
        currency: 'USD',
        active: true,
        taxable: false,
        spec: { memoryMb: 1024, diskMb: 10240, cpu: 1 },
      });
    const context = await browser.newContext({
      storageState: `${storageDir}/cart-customer-state.json`,
    });
    try {
      const client = await context.newPage();
      client.on('pageerror', (e) => errors.push(e.message));
      const addBoth = async () => {
        for (const name of ['Cart browser Alpha', 'Cart browser Beta']) {
          await client.goto('http://127.0.0.1:3100/store');
          const card = client
            .locator('article')
            .filter({ has: client.getByRole('heading', { name, exact: true }) });
          await card.getByRole('button', { name: 'Get started', exact: true }).click();
          await client.getByRole('button', { name: 'Add to cart', exact: true }).click();
          await expect(client).toHaveURL(/\/dashboard\/cart$/);
        }
        await expect(client.getByText('$3.00', { exact: true })).toBeVisible();
      };
      await addBoth();
      await client.setViewportSize({ width: 390, height: 844 });
      expect(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await client.screenshot({ path: 'artifacts/screenshots/cart-mobile.png', fullPage: true });
      await client.setViewportSize({ width: 1280, height: 900 });
      await client.getByRole('button', { name: 'Create combined invoice', exact: true }).click();
      await expect(client).toHaveURL(/\/dashboard\/invoices\//);
      const paidId = client.url().split('/').pop()!;
      await expect(client.getByText('Services in this checkout', { exact: true })).toBeVisible();
      await client.getByRole('button', { name: /^Pay with wallet/ }).click();
      await expect(client.getByText(/^Payment received /).first()).toBeVisible();
      const paid = (await (await client.request.get(`/api/v1/invoices/${paidId}`)).json()).data;
      expect(paid.kind).toBe('CART');
      expect(paid.linkedServices).toHaveLength(2);
      expect(paid.paidAmount).toBe(300);
      expect(
        (await (await client.request.get('/api/v1/wallet?currency=USD')).json()).data.balance,
      ).toBe(500);
      await client.screenshot({
        path: 'artifacts/screenshots/combined-invoice.png',
        fullPage: true,
      });
      await addBoth();
      await client.getByRole('button', { name: 'Create combined invoice', exact: true }).click();
      await expect(client).toHaveURL(/\/dashboard\/invoices\//);
      const cancelledId = client.url().split('/').pop()!;
      await client.getByRole('button', { name: 'Cancel checkout', exact: true }).click();
      await client
        .getByLabel('Cancellation reason', { exact: true })
        .fill('Cancel both unprovisioned reservations');
      await client
        .getByRole('button', { name: 'Confirm checkout cancellation', exact: true })
        .click();
      await expect(client.getByRole('dialog')).toHaveCount(0);
      const cancelled = (await (await client.request.get(`/api/v1/invoices/${cancelledId}`)).json())
        .data;
      expect(cancelled.status).toBe('void');
      expect(cancelled.linkedServices).toHaveLength(2);
      expect(cancelled.linkedServices.every((s: any) => s.service.status === 'TERMINATED')).toBe(
        true,
      );
      expect(
        (await (await client.request.get('/api/v1/wallet?currency=USD')).json()).data.balance,
      ).toBe(500);
    } finally {
      await context.close();
    }
    expect(errors).toEqual([]);
  });
});

test.describe('game node onboarding', () => {
  test.use({ storageState: `${storageDir}/cart-admin-state.json` });
  test('staff generates a unique Linux installer, follows progress and revokes setup access', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/admin/nodes');
    await page.getByRole('button', { name: 'Connect provider', exact: true }).click();
    await page.getByLabel('Provider', { exact: true }).selectOption('wings');
    await page.getByLabel('Connection name', { exact: true }).fill('Linux setup browser node');
    await page.getByLabel('Endpoint URL', { exact: true }).fill('http://203.0.113.77:8080');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Install game node');
    await expect(page.getByLabel('Harbor daemon port', { exact: true })).toHaveValue('8081');
    await expect(page.getByLabel('Harbor SFTP port', { exact: true })).toHaveValue('2023');
    await page.getByLabel('Game allocation IPv4', { exact: true }).fill('203.0.113.77');
    await page.getByLabel('First game port', { exact: true }).fill('27000');
    await page.getByLabel('Last game port', { exact: true }).fill('27002');
    await page.getByRole('button', { name: 'Generate install command', exact: true }).click();
    const command = page.getByLabel('Node installation command', { exact: true });
    await expect(command).toContainText('curl --fail');
    const text = (await command.textContent())!;
    const token = /Bearer ([a-f0-9]{64})/.exec(text)![1];
    const id = /node-setup\/([a-f0-9-]{36})\/script/.exec(text)![1];
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download script', exact: true }).click();
    const artifact = await download;
    expect(artifact.suggestedFilename()).toBe(`harbor-node-${id}.sh`);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile((await artifact.path())!, 'utf8');
    expect(content).toContain('systemctl enable "$service"');
    expect(content).toContain('harbor-wings-$HARBOR_NODE');
    expect(content).not.toContain('systemctl restart wings');
    expect(content).toContain('sha256sum --check');
    expect(content).toContain('docker-ce');
    expect(content).toContain(token);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: 'artifacts/screenshots/game-node-installer.png',
      fullPage: true,
    });
    const headers = { Origin: 'http://127.0.0.1:3100', Authorization: `Bearer ${token}` };
    const machineKey = 'd'.repeat(64);
    expect(
      (
        await page.request.post(`/api/v1/node-setup/${id}/claim`, { headers, data: { machineKey } })
      ).status(),
    ).toBe(201);
    await expect(page.getByText('Checking the VPS', { exact: true })).toBeVisible();
    expect(
      (
        await page.request.post(`/api/v1/node-setup/${id}/progress`, {
          headers,
          data: { machineKey, status: 'failed', step: 'docker' },
        })
      ).status(),
    ).toBe(201);
    await expect(page.getByText(/Fix the error shown on your VPS/)).toBeVisible();
    await page.getByRole('button', { name: 'Revoke setup access', exact: true }).click();
    await expect(page.getByText('revoked', { exact: true })).toBeVisible();
    await expect(command).toHaveCount(0);
    expect(
      (
        await page.request.post(`/api/v1/node-setup/${id}/claim`, { headers, data: { machineKey } })
      ).status(),
    ).toBe(401);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('scoped API access', () => {
  test.use({ storageState: `${storageDir}/cart-admin-state.json` });
  test('a customer creates a one-time secret, rotates it and revokes API access', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: `${storageDir}/cart-customer-state.json`,
    });
    try {
      const client = await context.newPage();
      const errors: string[] = [];
      client.on('pageerror', (e) => errors.push(e.message));
      await client.goto('http://127.0.0.1:3100/dashboard/api-keys');
      await expect(
        client.getByRole('heading', { name: 'Your API keys', exact: true }),
      ).toBeVisible();
      await client.getByRole('button', { name: 'Create API key', exact: true }).click();
      await client.getByLabel('Key name', { exact: true }).fill('Browser customer integration');
      await client.getByLabel('Permission invoices:read', { exact: true }).check();
      await client.getByLabel('Allowed IPs or CIDRs', { exact: true }).fill('127.0.0.1/32');
      await client
        .getByLabel('Confirm your password', { exact: true })
        .fill('managed-browser-password');
      await client.getByRole('button', { name: 'Create key', exact: true }).click();
      await expect(client.getByRole('dialog')).toContainText('Save your API key');
      const original = await client.getByLabel('API key secret', { exact: true }).inputValue();
      expect(original).toMatch(/^hbr_c_[a-f0-9]{64}$/);
      await client.getByRole('button', { name: 'Copy secret', exact: true }).click();
      await expect(client.getByText('API key copied', { exact: true })).toBeVisible();
      const headers = { Authorization: `Bearer ${original}` };
      expect(
        (await client.request.get('http://127.0.0.1:3100/api/v1/services', { headers })).status(),
      ).toBe(200);
      expect(
        (await client.request.get('http://127.0.0.1:3100/api/v1/customers', { headers })).status(),
      ).toBe(403);
      await client.getByRole('button', { name: "I've saved my key", exact: true }).click();
      await expect(client.getByLabel('API key secret', { exact: true })).toHaveCount(0);
      await client.reload();
      const card = client
        .locator('[data-slot="card"]')
        .filter({
          has: client.getByRole('heading', { name: 'Browser customer integration', exact: true }),
        })
        .filter({ has: client.getByText('active', { exact: true }) });
      await expect(card).toContainText('127.0.0.1/32');
      await card.getByRole('button', { name: 'Rotate', exact: true }).click();
      await client
        .getByLabel('Confirm your password', { exact: true })
        .fill('managed-browser-password');
      await client.getByRole('button', { name: 'Rotate key', exact: true }).click();
      const replacement = await client.getByLabel('API key secret', { exact: true }).inputValue();
      expect(replacement).not.toBe(original);
      expect(
        (await client.request.get('http://127.0.0.1:3100/api/v1/services', { headers })).status(),
      ).toBe(401);
      expect(
        (
          await client.request.get('http://127.0.0.1:3100/api/v1/services', {
            headers: { Authorization: `Bearer ${replacement}` },
          })
        ).status(),
      ).toBe(200);
      await client.getByRole('button', { name: "I've saved my key", exact: true }).click();
      await card.getByRole('button', { name: 'Revoke', exact: true }).click();
      await client.getByRole('button', { name: 'Revoke key', exact: true }).click();
      await expect(client.getByRole('dialog')).toHaveCount(0);
      expect(
        (
          await client.request.get('http://127.0.0.1:3100/api/v1/services', {
            headers: { Authorization: `Bearer ${replacement}` },
          })
        ).status(),
      ).toBe(401);
      await client.setViewportSize({ width: 390, height: 844 });
      expect(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await client.screenshot({
        path: 'artifacts/screenshots/customer-api-keys-mobile.png',
        fullPage: true,
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
  test('an administrator creates a scoped admin key and audits/revokes account API keys', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/admin/api-keys');
    await expect(page.getByRole('heading', { name: 'API access', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create API key', exact: true }).click();
    await page.getByLabel('API key type', { exact: true }).selectOption('ADMIN');
    await page.getByLabel('Key name', { exact: true }).fill('Browser staff read integration');
    await page.getByLabel('Permission admin:customers:read', { exact: true }).check();
    await page.getByLabel('Confirm your password', { exact: true }).fill('browser-test-password');
    await page.getByRole('button', { name: 'Create key', exact: true }).click();
    const secret = await page.getByLabel('API key secret', { exact: true }).inputValue();
    expect(secret).toMatch(/^hbr_a_[a-f0-9]{64}$/);
    const headers = { Authorization: `Bearer ${secret}`, Origin: 'http://127.0.0.1:3100' };
    expect((await page.request.get('/api/v1/customers', { headers })).status()).toBe(200);
    expect(
      (
        await page.request.patch('/api/v1/settings', {
          headers,
          data: { companyName: 'Forbidden scope change' },
        })
      ).status(),
    ).toBe(403);
    await page.getByRole('button', { name: "I've saved my key", exact: true }).click();
    await page.getByRole('tab', { name: 'All account keys', exact: true }).click();
    await page.getByLabel('Search API keys', { exact: true }).fill('Browser customer integration');
    await expect(
      page.getByText('jamie.managed@harbor.test', { exact: true }).first(),
    ).toBeVisible();
    await page
      .getByLabel('Search API keys', { exact: true })
      .fill('Browser staff read integration');
    const card = page.locator('[data-slot="card"]').filter({
      has: page.getByRole('heading', { name: 'Browser staff read integration', exact: true }),
    });
    await card.getByRole('button', { name: 'Revoke', exact: true }).click();
    await page
      .getByLabel('Revocation reason', { exact: true })
      .fill('Retired browser automation integration');
    await page.getByRole('button', { name: 'Revoke key', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card.getByText('revoked', { exact: true })).toBeVisible();
    expect((await page.request.get('/api/v1/customers', { headers })).status()).toBe(401);
    await page.screenshot({ path: 'artifacts/screenshots/admin-api-access.png', fullPage: true });
    const schema = await (await page.request.get('/api/docs-json')).json();
    expect(schema.components.securitySchemes.apiKey.scheme).toBe('bearer');
    expect(schema.components.securitySchemes.harbor_session.in).toBe('cookie');
    expect(schema.paths['/api/v1/customers'].get['x-harbor-scopes'].admin).toBe(
      'admin:customers:read',
    );
    expect(
      schema.paths['/api/v1/customers'].post.requestBody.content['application/json'].schema
        .properties.password.writeOnly,
    ).toBe(true);
    expect(errors).toEqual([]);
  });
});
