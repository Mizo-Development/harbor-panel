import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, copyFile, cp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createServer } from 'node:net';
import { wingsNodeConfiguration } from '../apps/api/src/providers/wings';
import { wingsInstanceLayout, isolatedWingsLayout } from '../apps/api/src/providers/wings-layout';
const nodeId = '12345678-1234-4321-8765-123456789abc',
  layout = wingsInstanceLayout(nodeId);
const supported = process.platform === 'linux' && process.getuid?.() === 0;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'harbor-wings-sandbox-'));
  const put = async (path: string, body: string, mode = 0o600) => {
    await mkdir(dirname(root + path), { recursive: true });
    await writeFile(root + path, body, { mode });
  };
  const copied = new Set<string>();
  const binary = async (path: string) => {
    if (copied.has(path)) return;
    copied.add(path);
    await mkdir(dirname(root + path), { recursive: true });
    await copyFile(path, root + path);
    const dependencies =
      execFileSync('ldd', [path], { encoding: 'utf8' }).match(/\/[A-Za-z0-9_./+:-]+/g) || [];
    for (const dependency of dependencies) {
      try {
        await mkdir(dirname(root + dependency), { recursive: true });
        await copyFile(dependency, root + dependency);
      } catch (error) {
        if ((error as any).code !== 'ENOENT') throw error;
      }
    }
  };
  for (const command of [
    'bash',
    'env',
    'uname',
    'cat',
    'tr',
    'chmod',
    'install',
    'mv',
    'cp',
    'rm',
    'mktemp',
    'flock',
    'grep',
    'dirname',
  ])
    await binary(execFileSync('which', [command], { encoding: 'utf8' }).trim());
  await binary('/usr/bin/python3');
  const stdlib = execFileSync(
    '/usr/bin/python3',
    ['-c', 'import sysconfig;print(sysconfig.get_path("stdlib"))'],
    { encoding: 'utf8' },
  ).trim();
  await cp(stdlib, root + stdlib, {
    recursive: true,
    filter: (p) =>
      !p.includes('__pycache__') && !p.includes('/test/') && !p.includes('/dist-packages/'),
  });
  await mkdir(root + '/run/systemd/system', { recursive: true });
  await mkdir(root + '/sys/fs/cgroup', { recursive: true });
  await mkdir(root + '/var/lock', { recursive: true });
  await mkdir(root + '/tmp', { recursive: true });
  await put('/dev/null', '', 0o666);
  await put('/etc/os-release', 'ID=ubuntu\nVERSION_ID=24.04\nVERSION_CODENAME=noble\n');
  await put('/proc/sys/kernel/random/uuid', nodeId + '\n');
  const legacy: Record<string, string> = {
    '/etc/pterodactyl/config.yml': 'legacy Wings configuration\n',
    '/usr/local/bin/wings': 'legacy Wings executable\n',
    '/etc/systemd/system/wings.service': 'legacy Wings unit\n',
    '/var/lib/pterodactyl/volumes/legacy/server.jar': 'legacy game data\n',
    '/var/lib/pterodactyl/states.json': 'legacy state\n',
    '/etc/docker/daemon.json': '{"legacy":true}\n',
    '/etc/logrotate.d/wings': 'legacy rotation\n',
    '/etc/letsencrypt/live/node.example.com/fullchain.pem': 'existing certificate\n',
    '/etc/letsencrypt/live/node.example.com/privkey.pem': 'existing private key\n',
    '/etc/letsencrypt/renewal-hooks/deploy/existing-wings': 'existing renewal hook\n',
  };
  for (const [path, body] of Object.entries(legacy)) await put(path, body);
  await put(
    '/fixture/containers.json',
    JSON.stringify([
      {
        HostConfig: { PortBindings: { '25565/tcp': [{ HostIp: '0.0.0.0', HostPort: '25565' }] } },
        NetworkSettings: { Networks: { pterodactyl_nw: {} } },
      },
    ]),
  );
  await put(
    '/fixture/claim.json',
    JSON.stringify({
      data: {
        config: wingsNodeConfiguration(
          {
            id: nodeId,
            provider: 'wings',
            url: 'https://node.example.com:8081',
            secret: { tokenId: 'fixture-node', token: 'fixture-daemon-token' },
            config: {
              wingsLayout: isolatedWingsLayout,
              listenPort: 8081,
              sftpPort: 2023,
              wingsCertificateMode: 'existing',
            },
          },
          'https://panel.example.com',
        ),
      },
    }),
  );
  await put(
    '/mock/systemctl',
    `#!/usr/bin/env bash\nprintf 'systemctl %s\\n' "$*" >> /fixture/commands\nif [[ "$*" == *" wings.service"* || "$*" == 'restart docker'* ]]; then exit 98; fi\ncase "$1" in show) [[ ! -f '${layout.config}' ]] || { echo 42;exit 0; };echo 0;; is-active) exit 0;; esac\n`,
    0o755,
  );
  await put(
    '/mock/ss',
    `#!/usr/bin/env bash\nif [[ "$*" == *':8080'* || "$*" == *':2022'* ]]; then echo 'LISTEN 0 128 0.0.0.0:8080 0.0.0.0:* users:(("wings",pid=777,fd=3))';fi\nif [[ -f /fixture/owned-listener && "$*" == *':8081'* ]];then echo 'LISTEN 0 128 0.0.0.0:8081 0.0.0.0:* users:(("wings",pid=42,fd=3))';fi\n`,
    0o755,
  );
  await put(
    '/mock/apt-get',
    `#!/usr/bin/env bash\nprintf 'apt-get %s\\n' "$*" >> /fixture/commands\n`,
    0o755,
  );
  await put('/mock/sha256sum', `#!/usr/bin/env bash\ncat >/dev/null\n`, 0o755);
  await put(
    '/mock/curl',
    `#!/usr/bin/env bash\noutput='';url='';while (($#));do case "$1" in -o) output="$2";shift 2;; *) url="$1";shift;; esac;done\nprintf 'curl %s\\n' "$url" >> /fixture/commands\ncase "$url" in */claim) cp /fixture/claim.json "$output";; */progress) printf '{"data":{"status":"COMPLETE"}}' > "$output";; *wings_linux_*) printf '#!/bin/sh\\nexit 0\\n' > "$output";; *) exit 97;;esac\n`,
    0o755,
  );
  const network = {
    Name: layout.network,
    Driver: 'bridge',
    Labels: { 'harbor.node.id': nodeId },
    IPAM: { Config: [{ Subnet: '172.30.0.0/16', Gateway: '172.30.0.1' }] },
  };
  await put('/fixture/new-network.json', JSON.stringify([network]));
  await put(
    '/mock/docker',
    `#!/usr/bin/env bash\nprintf 'docker %s\\n' "$*" >> /fixture/commands\ncase "$1 $2" in 'info ') exit 0;;'ps -aq') echo legacy-container;;'inspect legacy-container')cat /fixture/containers.json;;'network inspect')[[ -f /fixture/network-created ]] || exit 1;cat /fixture/new-network.json;;'network create')printf yes > /fixture/network-created;echo new-network;;*)exit 96;;esac\n`,
    0o755,
  );
  const template = await readFile('scripts/node-bootstrap.sh', 'utf8');
  const socket = createServer();
  await new Promise<void>((ok) => socket.listen(0, '127.0.0.1', ok));
  const port = (socket.address() as any).port;
  await new Promise<void>((ok) => socket.close(() => ok()));
  const script = async (overrides: Record<string, string> = {}) => {
    const vars = {
      HARBOR_BASE: 'https://panel.example.com/api/v1/node-setup/fixture',
      HARBOR_TOKEN: 'a'.repeat(64),
      HARBOR_NODE: nodeId,
      HARBOR_HOST: 'node.example.com',
      HARBOR_ENDPOINT: 'https://node.example.com:8081',
      HARBOR_PORT: '8081',
      HARBOR_SFTP_PORT: '2023',
      HARBOR_TLS: 'existing',
      HARBOR_EMAIL: '',
      HARBOR_ALLOCATION_IP: '127.0.0.1',
      HARBOR_ADD_ALLOCATIONS: 'true',
      HARBOR_PORT_START: String(port),
      HARBOR_PORT_END: String(port),
      ...overrides,
    };
    await put(
      '/installer.sh',
      '#!/usr/bin/env bash\n' +
        Object.entries(vars)
          .map(([k, v]) => `${k}='${v}'`)
          .join('\n') +
        '\n' +
        template.replace(/^#![^\n]*\n/, ''),
    );
    return spawnSync(
      '/usr/sbin/chroot',
      [
        root,
        '/usr/bin/env',
        'PATH=/mock:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        'LC_ALL=C',
        '/usr/bin/bash',
        '/installer.sh',
      ],
      { encoding: 'utf8', timeout: 20000 },
    );
  };
  const assertLegacy = async () => {
    for (const [path, body] of Object.entries(legacy)) {
      assert.equal(await readFile(root + path, 'utf8'), body, path);
      assert.equal((await stat(root + path)).mode & 0o777, 0o600, path);
    }
  };
  return {
    root,
    put,
    script,
    assertLegacy,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
test(
  'installer coexists with legacy Wings and resumes only its own service and network',
  { skip: !supported },
  async () => {
    const f = await fixture();
    try {
      const result = await f.script();
      assert.equal(result.status, 0, result.stderr + '\n' + result.stdout);
      await f.assertLegacy();
      const unit = await readFile(f.root + `/etc/systemd/system/${layout.service}`, 'utf8');
      assert(unit.includes(`ExecStart=${layout.binary} --config ${layout.config}`));
      const config = JSON.parse(await readFile(f.root + layout.config, 'utf8'));
      assert.equal(config.system.sftp.bind_port, 2023);
      assert.equal(config.docker.network.interface, '172.30.0.1');
      assert.equal(config.system.data, `${layout.root}/volumes`);
      const hook = await readFile(
        f.root + `/etc/letsencrypt/renewal-hooks/deploy/${layout.name}`,
        'utf8',
      );
      assert(hook.includes(`systemctl try-restart "${layout.service}"`));
      assert(hook.includes('RENEWED_LINEAGE'));
      await f.put('/fixture/owned-listener', 'yes');
      const retry = await f.script();
      assert.equal(retry.status, 0, retry.stderr + '\n' + retry.stdout);
      await f.assertLegacy();
      const commands = await readFile(f.root + '/fixture/commands', 'utf8');
      assert(!commands.includes('systemctl restart wings.service'));
      assert(!commands.includes('systemctl restart docker'));
      assert(!commands.includes('docker-ce'));
      assert.equal((commands.match(/docker network create/g) || []).length, 1);
    } finally {
      await f.cleanup();
    }
  },
);
test(
  'occupied daemon and game ports fail without replacing a legacy Wings installation',
  { skip: !supported },
  async () => {
    const f = await fixture();
    try {
      const busy = await f.script({ HARBOR_PORT: '8080' });
      assert.equal(busy.status, 1);
      assert.match(busy.stderr, /TCP port 8080 is already in use/);
      await f.assertLegacy();
      const preflight = await readFile(f.root + '/fixture/commands', 'utf8');
      assert(!preflight.includes('curl '));
      assert(!preflight.includes('apt-get '));
      assert(!preflight.includes('docker '));
      const game = await f.script({ HARBOR_PORT_START: '25565', HARBOR_PORT_END: '25565' });
      assert.equal(game.status, 1);
      assert.match(game.stderr, /reserved by another Docker container/);
      await f.assertLegacy();
      await assert.rejects(readFile(f.root + layout.config, 'utf8'), { code: 'ENOENT' });
      await assert.rejects(readFile(f.root + `/etc/systemd/system/${layout.service}`, 'utf8'), {
        code: 'ENOENT',
      });
    } finally {
      await f.cleanup();
    }
  },
);
