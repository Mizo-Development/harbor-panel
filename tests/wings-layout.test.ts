import test from 'node:test';
import assert from 'node:assert/strict';
import { wingsNodeConfiguration } from '../apps/api/src/providers/wings';
import { wingsInstanceLayout, isolatedWingsLayout } from '../apps/api/src/providers/wings-layout';
const id = '12345678-1234-4321-8765-123456789abc';
const connection = {
  id,
  provider: 'wings',
  url: 'https://node.example.com:8081',
  secret: { tokenId: 'identifier', token: 'daemon-token' },
  config: {
    wingsLayout: isolatedWingsLayout,
    listenPort: 8081,
    sftpPort: 2023,
    wingsCertificateMode: 'auto',
  },
};
test('isolated Wings config separates every host path, Unix user and Docker network', () => {
  const config: any = wingsNodeConfiguration(connection, 'https://panel.example.com'),
    l = wingsInstanceLayout(id);
  assert.equal(config.system.root_directory, l.root);
  assert.equal(config.system.data, `${l.root}/volumes`);
  assert.equal(config.system.archive_directory, `${l.root}/archives`);
  assert.equal(config.system.backup_directory, `${l.root}/backups`);
  assert.equal(config.system.log_directory, l.logs);
  assert.equal(config.system.tmp_directory, l.temporary);
  assert.equal(config.system.machine_id.directory, `${l.runtime}/machine-id`);
  assert.equal(config.system.passwd.directory, `${l.runtime}/etc`);
  assert.notEqual(config.system.username, 'pterodactyl');
  assert.equal(config.system.enable_log_rotate, false);
  assert.equal(config.docker.network.name, l.network);
  assert.equal(config.docker.network.network_mode, l.network);
  assert.equal(config.api.port, 8081);
  assert.equal(config.system.sftp.bind_port, 2023);
  assert.equal(config.api.ssl.cert, `/etc/letsencrypt/live/${l.name}/fullchain.pem`);
  assert(!JSON.stringify(config).includes('/var/lib/pterodactyl'));
  assert(!JSON.stringify(config).includes('/run/wings/'));
  const other = wingsInstanceLayout('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  for (const field of Object.keys(l) as (keyof typeof l)[]) assert.notEqual(l[field], other[field]);
  assert(l.bridge.length <= 15);
  assert(l.username.length <= 32);
  assert.throws(() => wingsInstanceLayout('../../pterodactyl'));
});
test('legacy Wings configurations remain unchanged and existing certificates can be reused', () => {
  const legacy: any = wingsNodeConfiguration(
    { ...connection, config: {} },
    'https://panel.example.com',
  );
  assert.equal(legacy.system.data, '/var/lib/pterodactyl/volumes');
  assert.equal(legacy.system.sftp.bind_port, 2022);
  assert.equal(legacy.api.ssl.cert, '/etc/letsencrypt/live/node.example.com/fullchain.pem');
  assert.equal(legacy.docker, undefined);
  const reuse: any = wingsNodeConfiguration(
    { ...connection, config: { ...connection.config, wingsCertificateMode: 'existing' } },
    'https://panel.example.com',
  );
  assert.equal(reuse.api.ssl.cert, legacy.api.ssl.cert);
  assert.equal(reuse.system.sftp.bind_port, 2023);
});
