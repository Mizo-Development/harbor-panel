import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import jwt from 'jsonwebtoken';
import { WingsProvider } from '../apps/api/src/providers/wings';
const { gameFilePath, gameFileName } = createRequire(import.meta.url)(
  '../apps/api/dist/game-files.js',
);
test('game paths stay in the service root while accepting ordinary nested and dotted filenames', () => {
  assert.equal(gameFilePath('plugins/config.yml'), '/plugins/config.yml');
  assert.equal(gameFilePath('/world//region/'), '/world/region/');
  assert.equal(gameFileName('my.plugin-1.2.jar'), 'my.plugin-1.2.jar');
  for (const value of [
    '/../etc/passwd',
    'plugins/../../secret',
    '/world/..',
    '/bad\\path',
    '/bad\0file',
  ])
    assert.throws(() => gameFilePath(value));
  for (const value of ['', '.', '..', 'a/b', 'a\\b', 'nul\0byte'])
    assert.throws(() => gameFileName(value));
  assert.throws(() => gameFilePath('/', false));
});
test('every Wings console JWT has connect permission while restricted tickets do not gain power controls', () => {
  const provider = new WingsProvider(),
    c: any = { url: 'https://games.example.com:8081', secret: { token: 'node-secret' } };
  const s: any = { id: 'server-uuid' };
  const restricted: any = jwt.verify(
    provider.console(c, s, 'user-uuid', ['control.console']).token,
    'node-secret',
  );
  assert.deepEqual(restricted.permissions, ['websocket.connect', 'control.console']);
  assert.equal(restricted.scope, 'websocket');
  assert.equal(restricted.server_uuid, s.id);
  const full: any = jwt.verify(provider.console(c, s, 'user-uuid').token, 'node-secret');
  assert(full.permissions.includes('websocket.connect'));
  assert(full.permissions.includes('control.start'));
  assert(full.exp - full.iat <= 300);
});
