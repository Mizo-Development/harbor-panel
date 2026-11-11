import { defineConfig } from '@playwright/test';
const database = process.env.TEST_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith('_test'))
  throw new Error('Set TEST_DATABASE_URL to a dedicated database ending in _test');
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 15000 },
  timeout: 300000,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure', actionTimeout: 15000 },
  webServer: [
    {
      command:
        'node node_modules/prisma/build/index.js migrate deploy && node apps/api/dist/main.js',
      url: 'http://127.0.0.1:4100/api/v1/health',
      reuseExistingServer: false,
      env: {
        DATABASE_URL: database,
        ENCRYPTION_KEY: 'd'.repeat(64),
        SETUP_TOKEN: 'e'.repeat(64),
        APP_URL: 'http://127.0.0.1:3100',
        API_PORT: '4100',
        NODE_ENV: 'test',
        EXTENSIONS_DIR: '/tmp/harbor-ui-extensions',
        ATTACHMENTS_DIR: '/tmp/harbor-ui-ticket-files',
        BRANDING_DIR: '/tmp/harbor-ui-branding',
      },
    },
    {
      command: 'npm run dev -w @harbor/web -- --port 3100',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: false,
      timeout: 180000,
      env: { API_URL: 'http://127.0.0.1:4100', APP_URL: 'http://127.0.0.1:3100' },
    },
  ],
  globalSetup: './tests/browser/setup.ts',
});
