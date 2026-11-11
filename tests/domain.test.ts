import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calculateDueDate, validateManifest, hostnameSchema } from '../packages/sdk/src';
import { encrypt, decrypt, hashPassword, verifyPassword } from '../apps/api/src/security';
import { safePath, readContent, writeContent } from '../apps/agent/src/files';
import { parsePlesk, PleskProvider } from '../apps/api/src/providers/plesk';
import { WingsProvider } from '../apps/api/src/providers/wings';
import { ProxmoxProvider } from '../apps/api/src/providers/proxmox';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
test('renewal dates clamp month ends and leap years without drifting into the next month', () => {
  assert.equal(
    calculateDueDate(new Date('2024-01-31T12:00:00Z'), 'monthly').toISOString(),
    '2024-02-29T12:00:00.000Z',
  );
  assert.equal(
    calculateDueDate(new Date('2024-02-29T12:00:00Z'), 'annual').toISOString(),
    '2025-02-28T12:00:00.000Z',
  );
});
test('extension manifests reject incompatible SDKs and unsafe backend or frontend paths', () => {
  const base = {
    id: 'hello-world',
    name: 'Hello',
    version: '1.0.0',
    sdkVersion: '^1.0.0',
    type: 'plugin',
    description: 'Example',
    permissions: [],
    entry: 'dist/index.js',
  };
  assert.equal(validateManifest(base).id, 'hello-world');
  assert.throws(() => validateManifest({ ...base, sdkVersion: '^2.0.0' }));
  assert.throws(() => validateManifest({ ...base, entry: 'dist/../outside.js' }));
  assert.throws(() => validateManifest({ ...base, frontendEntry: 'ui/../../outside.tsx' }));
});
test('tenant filenames cannot escape through traversal or symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harbor-files-'));
  try {
    await mkdir(join(root, 'public'));
    await writeFile(join(root, 'secret'), 'private');
    await symlink(join(root, 'secret'), join(root, 'public', 'leak'));
    await assert.rejects(() => safePath(join(root, 'public'), '/../../secret'));
    await assert.rejects(() => readContent(join(root, 'public'), '/leak'));
    await assert.rejects(() => writeContent(join(root, 'public'), '/leak', 'overwrite'));
    await writeContent(join(root, 'public'), '/index.html', 'Hello');
    assert.deepEqual(await readContent(join(root, 'public'), '/index.html'), { content: 'Hello' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('password hashes verify and encrypted provider credentials reject tampering', async () => {
  const hash = await hashPassword('a-long-password');
  assert(await verifyPassword('a-long-password', hash));
  assert(!(await verifyPassword('wrong', hash)));
  const encrypted = encrypt({ token: 'private' });
  assert.deepEqual(decrypt(encrypted), { token: 'private' });
  const [iv, tag, data] = encrypted.split('.');
  assert.throws(() => decrypt(`${iv}.${tag}.${data.slice(0, -2)}00`));
});
test('Plesk responses reject API errors, entity declarations, and escape customer values', async () => {
  assert.throws(() =>
    parsePlesk(
      '<packet><customer><add><result><status>error</status><errcode>1001</errcode></result></add></customer></packet>',
    ),
  );
  assert.throws(() =>
    parsePlesk('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><packet/>'),
  );
  assert.deepEqual(
    parsePlesk('<packet><server><get><result><status>ok</status></result></get></server></packet>')
      .server.get.result.status,
    'ok',
  );
  assert(!hostnameSchema.safeParse('example.com; rm -rf /').success);
});
test('Wings uses the daemon token outbound, not the token ID used for callbacks', async () => {
  const old = global.fetch;
  let authorization = '';
  global.fetch = async (_url, init) => {
    authorization = (init?.headers as Record<string, string>).Authorization;
    return new Response('{}', { status: 200 });
  };
  try {
    await new WingsProvider().health({
      id: 'node',
      provider: 'wings',
      url: 'https://node.example',
      config: {},
      secret: { tokenId: 'identifier', token: 'daemon-secret' },
    });
    assert.equal(authorization, 'Bearer daemon-secret');
  } finally {
    global.fetch = old;
  }
});
test('Proxmox refuses to manage an existing VM without its service ownership marker', async () => {
  const provider = new ProxmoxProvider();
  provider.call = async () => ({ description: 'someone-elses-vm' });
  await assert.rejects(
    () =>
      provider.inspect(
        {
          id: 'pve',
          provider: 'proxmox',
          url: 'https://pve.example',
          config: { node: 'pve' },
          secret: {},
        },
        {
          id: 'service',
          externalId: '100',
          name: 'VPS',
          domain: null,
          user: { id: 'u', email: 'u@example.com', name: 'U' },
          plan: { memoryMb: 1024, diskMb: 10240, cpu: 1, javaVersion: '21' },
          metadata: {},
        },
      ),
    /ownership/,
  );
});

test('custom billing terms use UTC calendar arithmetic and reject invalid periods', () => {
  const start = new Date('2024-01-31T12:00:00Z');
  assert.equal(
    calculateDueDate(start, { unit: 'MONTH', period: 3 }).toISOString(),
    '2024-04-30T12:00:00.000Z',
  );
  assert.equal(
    calculateDueDate(start, { unit: 'WEEK', period: 2 }).toISOString(),
    '2024-02-14T12:00:00.000Z',
  );
  assert.equal(
    calculateDueDate(new Date('2024-02-28T12:00:00Z'), { unit: 'DAY', period: 2 }).toISOString(),
    '2024-03-01T12:00:00.000Z',
  );
  assert.throws(() => calculateDueDate(start, { unit: 'MONTH', period: 0 }));
  assert.throws(() => calculateDueDate(start, { unit: 'DAY', period: 1.5 }));
});
