import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apiScope,
  apiScopeCatalog,
  apiRouteCatalog,
  apiIpAllowed,
  normalizeCidr,
} from '../apps/api/src/api-key-policy';
test('API permissions deny unknown endpoints, authentication changes and key management by default', () => {
  for (const kind of ['CLIENT', 'ADMIN'] as const) {
    for (const path of [
      'api-keys',
      'api-keys/options',
      'admin/api-keys',
      'auth/login',
      'auth/totp/setup',
      'extensions/anything/routes/run',
      'new-sensitive-route',
    ])
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE'])
        assert.equal(apiScope(kind, method, `/api/v1/${path}`), null);
    const allowed = new Set(apiScopeCatalog(kind).map((s) => s.id));
    for (const entry of apiRouteCatalog(kind)) {
      const [method, path] = entry.route.split(' ');
      assert(allowed.has(entry.scope));
      assert.equal(apiScope(kind, method, `/api/v1/${path}`), entry.scope);
    }
  }
  assert.equal(apiScope('CLIENT', 'GET', '/api/v1/customers'), null);
  assert.equal(apiScope('ADMIN', 'GET', '/api/v1/customers'), 'admin:customers:read');
  assert.equal(apiScope('CLIENT', 'HEAD', '/api/v1/services/123?ignored=yes'), 'services:read');
});
test('shared service-action routes distinguish read, power, console, file and destructive permissions', () => {
  const path = '/api/v1/services/server-id/actions';
  for (const [action, scope] of Object.entries({
    'console.tail': 'services:read',
    'console.send': 'services:console',
    'files.list': 'services:files:read',
    restart: 'services:control',
    rebuild: 'services:rebuild',
    restore: 'services:backups',
  }))
    assert.equal(apiScope('CLIENT', 'POST', path, { action }), scope);
  assert.equal(apiScope('CLIENT', 'POST', path, { action: 'terminate' }), null);
  assert.equal(
    apiScope('ADMIN', 'POST', path, { action: 'terminate' }),
    'admin:services:destructive',
  );
  assert.equal(apiScope('ADMIN', 'POST', path, { action: 'constructor' }), null);
  assert.equal(apiScope('ADMIN', 'POST', path, { action: '__proto__' }), null);
  assert.equal(
    apiScope('ADMIN', 'POST', path, {
      action: {
        toString() {
          throw Error('do not coerce input');
        },
      },
    }),
    null,
  );
});
test('API IP restrictions handle IPv4, IPv6, CIDR bounds and mapped proxy addresses', () => {
  assert.equal(normalizeCidr('203.0.113.8'), '203.0.113.8/32');
  assert.equal(normalizeCidr('2001:db8::1'), '2001:db8::1/128');
  assert(apiIpAllowed('::ffff:203.0.113.8', ['203.0.113.0/24']));
  assert(apiIpAllowed('2001:db8:abcd::1', ['2001:db8::/32']));
  assert(!apiIpAllowed('203.0.114.1', ['203.0.113.0/24']));
  assert(!apiIpAllowed('2001:db9::1', ['2001:db8::/32']));
  assert(!apiIpAllowed(undefined, ['0.0.0.0/0']));
  assert(apiIpAllowed('192.0.2.1', []));
  for (const input of [
    '127.0.0.1/33',
    '2001:db8::/129',
    'address',
    '127.0.0.1/-1',
    '127.0.0.1/',
    '127.0.0.1/24/1',
  ])
    assert.throws(() => normalizeCidr(input));
});
