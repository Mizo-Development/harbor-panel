import { gameRuntime, runtimeEnvironment, eggInvocation, eggProcess } from './egg-runtime';
import { paperInstall } from '../game-egg-definition';
import type {
  HostingProvider,
  HostingService,
  ProviderConnection,
  ServiceAction,
} from '@harbor/sdk';
import { requestJson, pathSegment as seg } from './http';
import jwt from 'jsonwebtoken';
import { isolatedWingsLayout, wingsInstanceLayout } from './wings-layout';
import { randomUUID } from 'node:crypto';
export function wingsSettings(s: HostingService, suspended = false) {
  const r = s.metadata.resource as any;
  if (!r?.config?.ip || !r.config.port)
    throw new Error('Reserve an IP and port allocation before provisioning');
  return {
    uuid: s.id,
    meta: { name: s.name, description: `Managed by Harbor: ${s.id}` },
    suspended,
    invocation: gameRuntime(s)
      ? eggInvocation(s)
      : `java -Xms128M -Xmx${s.plan.memoryMb}M -Dterminal.jline=false -Dterminal.ansi=true -jar server.jar nogui`,
    skip_egg_scripts: false,
    environment: runtimeEnvironment(s),
    labels: { 'harbor.service': s.id },
    allocations: {
      force_outgoing_ip: false,
      default: { ip: r.config.ip, port: Number(r.config.port) },
      mappings: { [r.config.ip]: [Number(r.config.port)] },
    },
    build: {
      memory_limit: s.plan.memoryMb,
      swap: 0,
      io_weight: 500,
      cpu_limit: s.plan.cpu * 100,
      threads: null,
      disk_space: s.plan.diskMb,
      oom_disabled: true,
    },
    crash_detection_enabled: true,
    mounts: [],
    egg: {
      id: gameRuntime(s)?.eggId || 'a2339869-9e45-4e7a-b72f-4d1038abca01',
      file_denylist: gameRuntime(s)?.definition.file_denylist || [],
    },
    container: {
      image: gameRuntime(s)?.image || `ghcr.io/pterodactyl/yolks:java_${s.plan.javaVersion}`,
    },
  };
}
export function wingsProcess(s?: HostingService) {
  if (s && gameRuntime(s)) return eggProcess(s);
  return {
    startup: { done: ['Done ('], user_interaction: [], strip_ansi: false },
    stop: { type: 'command', value: 'stop' },
    configs: [],
  };
}
export function wingsInstall(c: ProviderConnection, s?: HostingService) {
  if (s && gameRuntime(s)?.install) return gameRuntime(s).install;
  // Compatibility for previously provisioned pinned installations; new installs are prepared by the egg worker.
  return paperInstall({
    url: String(c.config.paperDownloadUrl || ''),
    sha256: String(c.config.paperSha256 || ''),
  });
}
export class WingsProvider implements HostingProvider {
  id = 'wings';
  capabilities = [
    'start',
    'stop',
    'restart',
    'rebuild',
    'backup',
    'restore',
    'console',
    'files',
    'usage',
    'suspend',
    'unsuspend',
    'terminate',
  ];
  async call(c: ProviderConnection, path: string, method = 'GET', data?: unknown) {
    return requestJson(`${c.url}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${c.secret.token}`, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }
  async health(c: ProviderConnection) {
    return this.call(c, '/system');
  }
  async provision(c: ProviderConnection, s: HostingService) {
    wingsInstall(c, s);
    const servers = await this.call(c, '/servers');
    if (
      !(Array.isArray(servers) ? servers : servers.data || []).some(
        (v: any) => (v.uuid || v.configuration?.uuid) === s.id,
      )
    ) {
      await this.call(c, '/servers', 'POST', {
        start_on_completion: true,
        ...wingsSettings(s),
        process_configuration: wingsProcess(s),
      });
    } else if (s.metadata.lifecycleStatus === 'FAILED') {
      await this.call(c, `/servers/${seg(s.id)}/reinstall`, 'POST');
    }
    return { externalId: s.id, pending: true };
  }
  async inspect(c: ProviderConnection, s: HostingService) {
    return this.call(c, `/servers/${seg(s.id)}`);
  }
  async action(
    c: ProviderConnection,
    s: HostingService,
    action: ServiceAction,
    input: Record<string, unknown>,
  ) {
    const path = `/servers/${seg(s.id)}`;
    if (['start', 'stop', 'restart'].includes(action))
      return this.call(c, `${path}/power`, 'POST', { action });
    if (action === 'terminate') return this.call(c, path, 'DELETE');
    if (action === 'rebuild') return this.call(c, `${path}/reinstall`, 'POST');
    if (action === 'suspend' || action === 'unsuspend')
      return this.call(c, `${path}/sync`, 'POST', {
        ...wingsSettings(s, action === 'suspend'),
        process_configuration: wingsProcess(s),
      });
    if (action === 'backup') {
      const backupId = String(input.backupId || randomUUID());
      await this.call(c, `${path}/backup`, 'POST', {
        adapter: 'wings',
        uuid: backupId,
        ignore: '',
      });
      return { backupId, accepted: true };
    }
    if (action === 'restore')
      return this.call(c, `${path}/backup/${seg(input.backupId)}/restore`, 'POST', {
        adapter: 'wings',
        truncate_directory: true,
      });
    throw new Error('Unsupported game server action');
  }
  console(
    c: ProviderConnection,
    s: HostingService,
    userId: string,
    permissions = ['control.console', 'control.start', 'control.stop', 'control.restart'],
  ) {
    const issued = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        scope: 'websocket',
        server_uuid: s.id,
        permissions: [...new Set(['websocket.connect', ...permissions])],
        user_uuid: userId,
        iat: issued,
        nbf: issued - 5,
        exp: issued + 300,
      },
      c.secret.token,
      { algorithm: 'HS256' },
    );
    return { url: `${c.url.replace(/^http/, 'ws')}/api/servers/${s.id}/ws`, token };
  }
  files(c: ProviderConnection, s: HostingService, directory: string) {
    return this.call(
      c,
      `/servers/${s.id}/files/list-directory?directory=${encodeURIComponent(directory)}`,
    );
  }
  content(c: ProviderConnection, s: HostingService, file: string) {
    return fetch(`${c.url}/api/servers/${s.id}/files/contents?file=${encodeURIComponent(file)}`, {
      headers: { Authorization: `Bearer ${c.secret.token}` },
      signal: AbortSignal.timeout(30000),
    });
  }
}

export function wingsNodeConfiguration(c: ProviderConnection, panelUrl: string) {
  const u = new URL(c.url);
  const config = {
    debug: false,
    uuid: c.id,
    token_id: c.secret.tokenId,
    token: c.secret.token,
    api: {
      host: c.config.behindProxy ? '127.0.0.1' : '0.0.0.0',
      port: Number(c.config.listenPort || u.port || (u.protocol === 'https:' ? 443 : 80)),
      ssl: {
        enabled: !c.config.behindProxy && u.protocol === 'https:',
        cert: `/etc/letsencrypt/live/${u.hostname}/fullchain.pem`,
        key: `/etc/letsencrypt/live/${u.hostname}/privkey.pem`,
      },
      upload_limit: 100,
    },
    system: { data: '/var/lib/pterodactyl/volumes', sftp: { bind_port: 2022 } },
    allowed_mounts: [],
    remote: panelUrl,
    allowed_origins: [panelUrl],
  };
  if (c.config.wingsLayout === isolatedWingsLayout) {
    const l = wingsInstanceLayout(c.id);
    Object.assign(config.system, {
      root_directory: l.root,
      data: `${l.root}/volumes`,
      archive_directory: `${l.root}/archives`,
      backup_directory: `${l.root}/backups`,
      log_directory: l.logs,
      tmp_directory: l.temporary,
      username: l.username,
      enable_log_rotate: false,
      passwd: { enabled: false, directory: `${l.runtime}/etc` },
      machine_id: { enabled: true, directory: `${l.runtime}/machine-id` },
      sftp: { bind_port: Number(c.config.sftpPort || 2023) },
    });
    Object.assign(config, {
      docker: { network: { name: l.network, network_mode: l.network, driver: 'bridge' } },
    });
    const certName = c.config.wingsCertificateMode === 'auto' ? l.name : u.hostname;
    config.api.ssl.cert = `/etc/letsencrypt/live/${certName}/fullchain.pem`;
    config.api.ssl.key = `/etc/letsencrypt/live/${certName}/privkey.pem`;
  }
  return config;
}
