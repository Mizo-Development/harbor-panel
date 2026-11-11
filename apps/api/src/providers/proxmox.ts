import { createHash } from 'node:crypto';
import type {
  HostingProvider,
  HostingService,
  ProviderConnection,
  ServiceAction,
} from '@harbor/sdk';
import { requestJson, pathSegment as seg } from './http';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class ProxmoxProvider implements HostingProvider {
  id = 'proxmox';
  capabilities = [
    'start',
    'stop',
    'restart',
    'rebuild',
    'backup',
    'restore',
    'console',
    'usage',
    'suspend',
    'unsuspend',
    'terminate',
  ];
  async call(c: ProviderConnection, path: string, method = 'GET', data?: Record<string, unknown>) {
    const headers: Record<string, string> = {
      Authorization: `PVEAPIToken=${c.secret.tokenId}=${c.secret.tokenSecret}`,
    };
    const body = data
      ? new URLSearchParams(
          Object.entries(data)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        )
      : undefined;
    const result = await requestJson(`${c.url}/api2/json${path}`, { method, headers, body });
    return result.data;
  }
  node(c: ProviderConnection) {
    if (!c.config.node) throw new Error('Select a Proxmox node');
    return seg(c.config.node);
  }
  async wait(c: ProviderConnection, upid: string) {
    const node = upid.split(':')[1];
    const started = Date.now();
    while (Date.now() - started < 240000) {
      const state = await this.call(c, `/nodes/${seg(node)}/tasks/${seg(upid)}/status`);
      if (state.status === 'stopped') {
        if (state.exitstatus !== 'OK') throw new Error(`Proxmox task failed: ${state.exitstatus}`);
        return;
      }
      await delay(1500);
    }
    throw new Error('Proxmox task is still running; reconciliation is required before retry');
  }
  async health(c: ProviderConnection) {
    const version = await this.call(c, '/version');
    const nodes = await this.call(c, '/nodes');
    return { version: version.version, nodes };
  }
  effective(c: ProviderConnection, s: HostingService): ProviderConnection {
    return { ...c, config: { ...c.config, ...((s.metadata.proxmox as object) || {}) } };
  }
  type(s: HostingService) {
    return s.plan.vmType === 'lxc' ? 'lxc' : 'qemu';
  }
  async inventory(c: ProviderConnection, selectedNode?: string, storage?: string) {
    const nodes = await this.call(c, '/nodes');
    const node = selectedNode || String(c.config.node);
    if (!nodes.some((n: any) => n.node === node))
      throw new Error('Choose a node returned by this cluster');
    const base = `/nodes/${seg(node)}`;
    const warnings: string[] = [];
    const optional = async (path: string, label: string) => {
      try {
        return await this.call(c, path);
      } catch (e) {
        warnings.push(`${label}: ${e instanceof Error ? e.message : 'unavailable'}`);
        return [];
      }
    };
    const [storages, networks, qemu, containers, pools] = await Promise.all([
      this.call(c, `${base}/storage`),
      optional(`${base}/network`, 'Networks'),
      this.call(c, `${base}/qemu`),
      this.call(c, `${base}/lxc`),
      optional('/pools', 'Resource pools'),
    ]);
    if (storage && !storages.some((s: any) => s.storage === storage))
      throw new Error('Choose storage returned by the selected node');
    const templates = storage
      ? await optional(
          `${base}/storage/${seg(storage)}/content?content=vztmpl`,
          'Container templates',
        )
      : [];
    return { nodes, node, storages, networks, qemu, containers, pools, templates, warnings };
  }
  vmid(s: HostingService) {
    return (
      s.externalId ??
      String(100000 + (createHash('sha256').update(s.id).digest().readUInt32BE(0) % 900000000))
    );
  }
  async owned(c: ProviderConnection, s: HostingService) {
    c = this.effective(c, s);
    const path = `/nodes/${this.node(c)}/${this.type(s)}/${seg(this.vmid(s))}`;
    const config = await this.call(c, `${path}/config`);
    if (config.description !== `harbor:${s.id}`)
      throw new Error('VM ownership marker does not match this service');
    return { path, config };
  }
  async provision(c: ProviderConnection, s: HostingService) {
    c = this.effective(c, s);
    if (this.type(s) === 'lxc') return this.provisionContainer(c, s);
    if (!s.plan.templateId || !/^\d+$/.test(s.plan.templateId))
      throw new Error('Select a numeric cloud-init template ID');
    const node = this.node(c);
    const vmid = this.vmid(s);
    const path = `/nodes/${node}/qemu/${vmid}`;
    const list = await this.call(c, `/nodes/${node}/qemu`);
    if (list.some((v: any) => String(v.vmid) === vmid)) await this.owned(c, s);
    else {
      const task = await this.call(c, `/nodes/${node}/qemu/${s.plan.templateId}/clone`, 'POST', {
        newid: vmid,
        full: 1,
        name: `harbor-${s.id.slice(0, 8)}`,
        description: `harbor:${s.id}`,
        storage: c.config.storage,
        pool: c.config.pool || undefined,
      });
      await this.wait(c, task);
    }
    const resource = s.metadata.resource as any;
    if (!resource?.value || !resource.config?.gateway)
      throw new Error('A reserved IP/CIDR and gateway are required');
    const sshKey = s.metadata.sshKey;
    if (!sshKey || typeof sshKey !== 'string')
      throw new Error('An SSH public key is required for VPS provisioning');
    await this.call(c, `${path}/config`, 'PUT', {
      memory: s.plan.memoryMb,
      cores: s.plan.cpu,
      ipconfig0: `ip=${resource.value},gw=${resource.config.gateway}`,
      sshkeys: encodeURIComponent(sshKey),
      ciuser: 'harbor',
      net0: this.network(c, 'virtio'),
      cpu: c.config.cpuModel || undefined,
      nameserver: c.config.nameserver || undefined,
      searchdomain: c.config.searchdomain || undefined,
      onboot: c.config.onboot === false ? 0 : 1,
    });
    // The template defines the boot disk; resize only upwards and verify its current size first.
    const config = await this.call(c, `${path}/config`);
    const disk = String(c.config.disk || 'scsi0');
    const size = String(config[disk] || '').match(/size=(\d+(?:\.\d+)?)([MGT])/);
    if (!size) throw new Error('Unable to determine template disk size');
    const currentMb = Number(size[1]) * { M: 1, G: 1024, T: 1048576 }[size[2]]!;
    if (s.plan.diskMb < currentMb)
      throw new Error('Plan disk is smaller than the selected template');
    if (s.plan.diskMb > currentMb) {
      const task = await this.call(c, `${path}/resize`, 'PUT', {
        disk,
        size: `${Math.ceil(s.plan.diskMb / 1024)}G`,
      });
      if (task) await this.wait(c, task);
    }
    const task = await this.call(c, `${path}/status/start`, 'POST');
    if (task) await this.wait(c, task);
    return { externalId: vmid, metadata: { ip: resource.value, proxmox: c.config } };
  }
  network(
    c: ProviderConnection,
    model: string,
    address?: { value: string; config: { gateway: string } },
  ) {
    return [
      model,
      `bridge=${c.config.bridge || 'vmbr0'}`,
      c.config.firewall === undefined ? undefined : `firewall=${c.config.firewall ? 1 : 0}`,
      c.config.vlan ? `tag=${c.config.vlan}` : undefined,
      c.config.mtu ? `mtu=${c.config.mtu}` : undefined,
      c.config.rateMbps ? `rate=${Number(c.config.rateMbps) / 8}` : undefined,
      address ? `ip=${address.value},gw=${address.config.gateway}` : undefined,
    ]
      .filter(Boolean)
      .join(',');
  }
  async provisionContainer(c: ProviderConnection, s: HostingService) {
    if (!/^[a-zA-Z0-9_.-]+:vztmpl\/[a-zA-Z0-9_.-]+$/.test(s.plan.templateId || ''))
      throw new Error('Select an LXC OS template volume');
    const resource = s.metadata.resource as any;
    if (!resource?.value || !resource.config?.gateway)
      throw new Error('A reserved IP/CIDR and gateway are required');
    if (typeof s.metadata.sshKey !== 'string') throw new Error('An SSH public key is required');
    const node = this.node(c),
      vmid = this.vmid(s),
      path = `/nodes/${node}/lxc/${vmid}`;
    const list = await this.call(c, `/nodes/${node}/lxc`);
    if (list.some((v: any) => String(v.vmid) === vmid)) await this.owned(c, s);
    else {
      const task = await this.call(c, `/nodes/${node}/lxc`, 'POST', {
        vmid,
        ostemplate: s.plan.templateId,
        hostname: `harbor-${s.id.slice(0, 8)}`,
        description: `harbor:${s.id}`,
        unprivileged: 1,
        rootfs: `${c.config.storage}:${Math.ceil(s.plan.diskMb / 1024)}`,
        memory: s.plan.memoryMb,
        cores: s.plan.cpu,
        swap: s.plan.swapMb ?? 512,
        net0: this.network(c, 'name=eth0', resource),
        'ssh-public-keys': s.metadata.sshKey,
        nameserver: c.config.nameserver || undefined,
        searchdomain: c.config.searchdomain || undefined,
        pool: c.config.pool || undefined,
        onboot: c.config.onboot === false ? 0 : 1,
        start: 0,
      });
      await this.wait(c, task);
    }
    const task = await this.call(c, `${path}/status/start`, 'POST');
    if (task) await this.wait(c, task);
    return { externalId: vmid, metadata: { ip: resource.value, proxmox: c.config } };
  }
  async inspect(c: ProviderConnection, s: HostingService) {
    const { path } = await this.owned(c, s);
    return await this.call(c, `${path}/status/current`);
  }
  async action(
    c: ProviderConnection,
    s: HostingService,
    action: ServiceAction,
    input: Record<string, unknown>,
  ) {
    c = this.effective(c, s);
    const { path } = await this.owned(c, s);
    let task;
    if (['start', 'stop', 'restart', 'suspend', 'unsuspend'].includes(action)) {
      const mapped =
        { restart: 'reboot', suspend: 'stop', unsuspend: 'start' }[action as string] || action;
      task = await this.call(c, `${path}/status/${mapped}`, 'POST');
    } else if (action === 'backup') {
      if (!c.config.backupStorage) throw new Error('Configure Proxmox backup storage first');
      task = await this.call(c, `/nodes/${this.node(c)}/vzdump`, 'POST', {
        vmid: this.vmid(s),
        storage: c.config.backupStorage,
        mode: 'snapshot',
        compress: 'zstd',
      });
    } else if (action === 'restore') {
      const archive = String(input.archive || '');
      // Only accept a backup returned by this configured node/storage for this VM.
      const backups = await this.call(
        c,
        `/nodes/${this.node(c)}/storage/${seg(c.config.backupStorage)}/content?content=backup&vmid=${this.vmid(s)}`,
      );
      if (!backups.some((b: any) => b.volid === archive))
        throw new Error('Choose a backup belonging to this VPS');
      const stop = await this.call(c, `${path}/status/stop`, 'POST');
      if (stop) await this.wait(c, stop);
      task = await this.call(c, `/nodes/${this.node(c)}/${this.type(s)}`, 'POST', {
        vmid: this.vmid(s),
        ...(this.type(s) === 'lxc' ? { ostemplate: archive, restore: 1 } : { archive }),
        force: 1,
        storage: c.config.storage,
      });
    } else if (action === 'rebuild') {
      // Keep the VM reservation and replace only this owned VM.
      const stop = await this.call(c, `${path}/status/stop`, 'POST');
      if (stop) await this.wait(c, stop);
      const remove = await this.call(c, path, 'DELETE', { purge: 1 });
      if (remove) await this.wait(c, remove);
      const result = await this.provision(c, { ...s, externalId: null });
      return { ...result };
    } else if (action === 'terminate') {
      const stop = await this.call(c, `${path}/status/stop`, 'POST');
      if (stop) await this.wait(c, stop);
      task = await this.call(c, path, 'DELETE', { purge: 1 });
    } else throw new Error('Unsupported VPS operation');
    if (task) await this.wait(c, task);
    return { completed: true };
  }
  async console(c: ProviderConnection, s: HostingService) {
    c = this.effective(c, s);
    const { path } = await this.owned(c, s);
    // Ticket must be consumed by an authenticated backend websocket proxy, never expose API tokens.
    const ticket = await this.call(c, `${path}/vncproxy`, 'POST', { websocket: 1 });
    return { ticket, vmid: this.vmid(s), node: c.config.node, type: this.type(s) };
  }
}
