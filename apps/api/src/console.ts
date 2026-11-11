import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  OnModuleDestroy,
} from '@nestjs/common';
import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { Platform } from './platform';
import { Auth, Actor } from './auth';
import { appUrl, digest } from './security';
import { ProxmoxProvider } from './providers/proxmox';
@Injectable()
export class Consoles implements OnModuleDestroy {
  private grants = new Map<
    string,
    {
      userId: string;
      session: string;
      serviceId: string;
      expires: number;
      url: string;
      auth: string;
      password: string;
    }
  >();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  constructor(
    @Inject(Platform) private platform: Platform,
    @Inject(Auth) private auth: Auth,
  ) {}
  async grant(actor: Actor, req: Request, id: string) {
    const s = await this.platform.rawService(actor, id);
    if (
      s.provider !== 'proxmox' ||
      s.status !== 'ACTIVE' ||
      (s.cancelAt && s.cancelAt <= new Date())
    )
      throw new BadRequestException('VPS console is unavailable');
    for (const [key, value] of this.grants) if (value.expires < Date.now()) this.grants.delete(key);
    if (this.grants.size > 1000) throw new BadRequestException('Too many pending console sessions');
    const provider = (await this.platform.extensions.provider('proxmox')) as ProxmoxProvider;
    const c = this.platform.connection(s.product.connection);
    const result = await provider.console(c, this.platform.hostingService(s));
    const raw = randomBytes(32).toString('hex');
    const url = new URL(c.url);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `/api2/json/nodes/${encodeURIComponent(String(result.node))}/${result.type}/${result.vmid}/vncwebsocket`;
    url.search = new URLSearchParams({
      port: String(result.ticket.port),
      vncticket: result.ticket.ticket,
    }).toString();
    this.grants.set(digest(raw), {
      userId: actor.id,
      session: digest(req.cookies.harbor_session),
      serviceId: id,
      expires: Date.now() + 60000,
      url: url.toString(),
      auth: `PVEAPIToken=${c.secret.tokenId}=${c.secret.tokenSecret}`,
      password: result.ticket.ticket,
    });
    await this.platform.audit(actor, 'service.console.opened', id);
    return { path: `/api/v1/console/${raw}`, password: result.ticket.ticket };
  }
  attach(server: Server) {
    server.on('upgrade', (req, socket, head) => {
      void (async () => {
        const path = new URL(req.url || '/', appUrl()).pathname;
        const match = path.match(/^\/api\/v1\/console\/([a-f0-9]{64})$/);
        if (!match) {
          socket.destroy();
          return;
        }
        const grant = this.grants.get(digest(match[1]));
        this.grants.delete(digest(match[1]));
        if (!grant || grant.expires < Date.now() || req.headers.origin !== appUrl())
          throw new ForbiddenException();
        const raw =
          req.headers.cookie
            ?.split(';')
            .map((s) => s.trim())
            .find((s) => s.startsWith('harbor_session='))
            ?.slice('harbor_session='.length) || '';
        const actor = await this.auth.actor(
          Object.assign(req, { cookies: { harbor_session: raw } }) as unknown as Request,
        );
        if (!actor || actor.id !== grant.userId || digest(raw) !== grant.session)
          throw new ForbiddenException();
        const service = await this.platform.rawService(actor, grant.serviceId);
        if (service.status !== 'ACTIVE' || (service.cancelAt && service.cancelAt <= new Date()))
          throw new ForbiddenException();
        this.wss.handleUpgrade(req, socket, head, (client) => {
          const remote = new WebSocket(grant.url, {
            headers: { Authorization: grant.auth },
            rejectUnauthorized: true,
            handshakeTimeout: 10000,
            maxPayload: 4 * 1024 * 1024,
          });
          const buffered: Array<{ data: any; binary: boolean }> = [];
          let bytes = 0;
          client.on('message', (data, binary) => {
            if (remote.readyState === WebSocket.OPEN) {
              if (remote.bufferedAmount > 4 * 1024 * 1024) {
                client.close();
                remote.close();
              } else remote.send(data, { binary });
            } else {
              bytes += (data as Buffer).length || 0;
              if (bytes > 65536) {
                client.close();
                remote.close();
              } else buffered.push({ data, binary });
            }
          });
          remote.on('open', () => {
            for (const entry of buffered) remote.send(entry.data, { binary: entry.binary });
            buffered.length = 0;
          });
          remote.on('message', (data, binary) => {
            if (client.readyState === WebSocket.OPEN) {
              if (client.bufferedAmount > 4 * 1024 * 1024) {
                client.close();
                remote.close();
              } else client.send(data, { binary });
            }
          });
          remote.on('error', () => client.close(1011, 'Upstream console connection failed'));
          client.on('error', () => remote.close());
          remote.on('close', () => client.close());
          client.on('close', () => remote.close());
        });
      })().catch(() => socket.destroy());
    });
  }
  onModuleDestroy() {
    this.wss.close();
    this.grants.clear();
  }
}
