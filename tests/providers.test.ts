import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PleskProvider } from '../apps/api/src/providers/plesk';
import { ProxmoxProvider } from '../apps/api/src/providers/proxmox';
import type { HostingService, ProviderConnection } from '../packages/sdk/src';
const service: HostingService = {
  id: 'd8829343-d619-48c6-9bd3-5d20bc354279',
  externalId: null,
  name: 'Example',
  domain: 'example.com',
  user: {
    id: '11111111-2222-4333-8444-555555555555',
    name: 'Alice & Bob',
    email: 'alice@example.com',
  },
  plan: {
    memoryMb: 1024,
    diskMb: 10240,
    cpu: 1,
    javaVersion: '21',
    servicePlan: 'Starter & More',
    templateId: '9000',
  },
  metadata: {
    sshKey: 'ssh-ed25519 AAAATEST user',
    resource: { value: '203.0.113.10/24', config: { gateway: '203.0.113.1' } },
  },
};
test('Plesk creates customers and plan subscriptions, then reuses matching resources', async () => {
  const packets: string[] = [];
  let customer = false,
    subscription = false;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    packets.push(body);
    assert.equal(req.headers.key, 'plesk-test-key');
    let xml = '';
    if (body.includes('<service-plan>'))
      xml =
        '<service-plan><get><result><status>ok</status><id>1</id><name>Starter</name></result></get></service-plan>';
    else if (body.includes('<customer>') && body.includes('<get>'))
      xml = customer
        ? '<customer><get><result><status>ok</status><id>42</id></result></get></customer>'
        : '<customer><get><result><status>error</status><errcode>1013</errcode></result></get></customer>';
    else if (body.includes('<customer>') && body.includes('<add>')) {
      customer = true;
      xml = '<customer><add><result><status>ok</status><id>42</id></result></add></customer>';
    } else if (body.includes('<webspace>') && body.includes('<get>'))
      xml = subscription
        ? '<webspace><get><result><status>ok</status><id>77</id><data><gen_info><owner-id>42</owner-id><status>0</status></gen_info></data></result></get></webspace>'
        : '<webspace><get><result><status>error</status><errcode>1013</errcode></result></get></webspace>';
    else if (body.includes('<webspace>') && body.includes('<add>')) {
      subscription = true;
      xml = '<webspace><add><result><status>ok</status><id>77</id></result></add></webspace>';
    } else if (body.includes('<create_session>'))
      xml =
        '<server><create_session><result><status>ok</status><id>abcdef1234</id></result></create_session></server>';
    else xml = '<webspace><set><result><status>ok</status></result></set></webspace>';
    res.end(`<packet>${xml}</packet>`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const c: ProviderConnection = {
      id: 'plesk',
      provider: 'plesk',
      url: `http://127.0.0.1:${(server.address() as any).port}`,
      config: { ip: '203.0.113.20' },
      secret: { apiKey: 'plesk-test-key' },
    };
    const p = new PleskProvider();
    assert.equal((await p.health(c)).plans?.[0].name, 'Starter');
    const first = await p.provision(c, service);
    assert.equal(first.externalId, '77');
    assert(packets.some((p) => p.includes('Starter &amp; More')));
    assert(packets.some((p) => p.includes('Alice &amp; Bob')));
    const second = await p.provision(c, service);
    assert.equal(second.externalId, '77');
    assert.equal(packets.filter((p) => p.includes('<webspace>') && p.includes('<add>')).length, 1);
    const url = await p.login(
      c,
      { ...service, externalId: '77', metadata: first.metadata! },
      '203.0.113.50',
    );
    assert(url.url.includes('PLESKSESSID=abcdef1234'));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test('Proxmox clone, cloud-init, disk resize, and repeat provisioning preserve VM identity', async () => {
  const requests: Array<{ path: string; method: string; body: URLSearchParams }> = [];
  let vm: any = null;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = new URLSearchParams(raw);
    const path = new URL(req.url!, 'http://localhost').pathname;
    requests.push({ path, method: req.method!, body });
    assert.equal(req.headers.authorization, 'PVEAPIToken=harbor@pve!panel=test-secret');
    let data: any = {};
    if (path.endsWith('/qemu') && req.method === 'GET') data = vm ? [{ vmid: vm.vmid }] : [];
    else if (path.endsWith('/clone')) {
      vm = {
        vmid: body.get('newid'),
        description: body.get('description'),
        scsi0: 'local-lvm:vm-disk,size=8G',
      };
      data = 'UPID:pve:task';
    } else if (path.endsWith('/tasks/UPID%3Apve%3Atask/status') || path.includes('/tasks/'))
      data = { status: 'stopped', exitstatus: 'OK' };
    else if (path.endsWith('/config') && req.method === 'GET') data = vm;
    else if (path.endsWith('/resize')) {
      vm.scsi0 = 'local-lvm:vm-disk,size=10G';
      data = 'UPID:pve:task';
    } else if (path.endsWith('/status/start')) data = 'UPID:pve:task';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const c: ProviderConnection = {
      id: 'pve',
      provider: 'proxmox',
      url: `http://127.0.0.1:${(server.address() as any).port}`,
      config: { node: 'pve', storage: 'local-lvm', bridge: 'vmbr0' },
      secret: { tokenId: 'harbor@pve!panel', tokenSecret: 'test-secret' },
    };
    const p = new ProxmoxProvider();
    const first = await p.provision(c, service);
    const second = await p.provision(c, { ...service, externalId: first.externalId });
    assert.equal(first.externalId, second.externalId);
    assert.equal(requests.filter((r) => r.path.endsWith('/clone')).length, 1);
    assert.equal(requests.filter((r) => r.path.endsWith('/resize')).length, 1);
    const configured = requests.find((r) => r.path.endsWith('/config') && r.method === 'PUT')!;
    assert.equal(configured.body.get('ipconfig0'), 'ip=203.0.113.10/24,gw=203.0.113.1');
    assert.equal(configured.body.get('cores'), '1');
    assert.equal(vm.description, `harbor:${service.id}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('LXC provisioning uses OS templates, isolated containers, pinned placement, and matching console paths', async () => {
  const requests: Array<{ path: string; method: string; body: URLSearchParams }> = [];
  let created: any = null;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = new URLSearchParams(raw),
      path = new URL(req.url!, 'http://localhost').pathname;
    requests.push({ path, method: req.method!, body });
    let data: any = {};
    if (path.endsWith('/lxc') && req.method === 'GET')
      data = created ? [{ vmid: created.vmid }] : [];
    else if (path.endsWith('/lxc') && req.method === 'POST') {
      created = { vmid: body.get('vmid'), description: body.get('description') };
      data = 'UPID:pinned:task';
    } else if (path.includes('/tasks/')) data = { status: 'stopped', exitstatus: 'OK' };
    else if (path.endsWith('/config')) data = created;
    else if (path.endsWith('/status/start')) data = 'UPID:pinned:task';
    else if (path.endsWith('/vncproxy')) data = { port: 5900, ticket: 'short-lived-ticket' };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const c: ProviderConnection = {
      id: 'pve',
      provider: 'proxmox',
      url: `http://127.0.0.1:${(server.address() as any).port}`,
      secret: { tokenId: 'test', tokenSecret: 'secret' },
      config: { node: 'changed-default', storage: 'other' },
    };
    const s: HostingService = {
      ...service,
      plan: {
        ...service.plan,
        vmType: 'lxc',
        swapMb: 256,
        templateId: 'local:vztmpl/debian.tar.zst',
      },
      metadata: {
        ...service.metadata,
        proxmox: { node: 'pinned', storage: 'local-zfs', bridge: 'vmbr1', vlan: 42, rateMbps: 80 },
      },
    };
    const p = new ProxmoxProvider(),
      first = await p.provision(c, s);
    await p.provision(c, { ...s, externalId: first.externalId });
    assert.equal(requests.filter((r) => r.path.endsWith('/lxc') && r.method === 'POST').length, 1);
    const create = requests.find((r) => r.path.endsWith('/lxc') && r.method === 'POST')!;
    assert.equal(create.path, '/api2/json/nodes/pinned/lxc');
    assert.equal(create.body.get('unprivileged'), '1');
    assert.equal(create.body.get('rootfs'), 'local-zfs:10');
    assert.equal(create.body.get('swap'), '256');
    assert.match(
      create.body.get('net0')!,
      /bridge=vmbr1,tag=42,rate=10,ip=203.0.113.10\/24,gw=203.0.113.1/,
    );
    const console = await p.console(c, { ...s, externalId: first.externalId });
    assert.equal(console.type, 'lxc');
    assert.equal(console.node, 'pinned');
    assert(!requests.some((r) => r.path.includes('/qemu/') || r.path.includes('changed-default')));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
