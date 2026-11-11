import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../apps/api/dist/auth.js';

test('HTTPS sessions use secure cookies even when a host preview retains development mode', async () => {
  const previousUrl = process.env.APP_URL,
    previousMode = process.env.NODE_ENV;
  const issued: any[] = [];
  const auth = new Auth(
    {
      setting: { findUnique: async () => ({ access: { sessionHours: 2 } }) },
      session: {
        create: async ({ data }: any) => {
          issued.push(data);
        },
      },
    } as any,
    {} as any,
    {} as any,
  );
  try {
    for (const [mode, url, secure] of [
      ['development', 'https://harbor.example.test', true],
      ['development', 'http://localhost:3000', false],
      ['production', 'https://harbor.example.test', true],
    ] as const) {
      process.env.APP_URL = url;
      process.env.NODE_ENV = mode;
      let cookie: any;
      await auth.session('cookie-customer', {
        cookie: (name: string, value: string, options: any) => {
          cookie = { name, value, options };
        },
      } as any);
      assert.equal(cookie.name, 'harbor_session');
      assert.equal(cookie.options.secure, secure);
      assert.equal(cookie.options.httpOnly, true);
      assert.equal(cookie.options.sameSite, 'lax');
      assert.equal(cookie.options.path, '/');
      assert.equal(cookie.value.length, 64);
      assert.notEqual(issued.at(-1).id, cookie.value);
      assert(Math.abs(cookie.options.expires.getTime() - Date.now() - 2 * 3600000) < 2000);
    }
  } finally {
    if (previousUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousUrl;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
});
