import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Db, json } from './db';
import { Platform } from './platform';
import { Auth, type Actor } from './auth';
import { appUrl, digest, safeEqual, token } from './security';
import { serial } from './transactions';
import { wingsNodeConfiguration } from './providers/wings';
import { isolatedWingsLayout, wingsInstanceLayout } from './providers/wings-layout';
const steps = z.enum([
  'waiting',
  'preflight',
  'docker',
  'wings',
  'tls',
  'configuration',
  'starting',
  'verifying',
  'complete',
]);
const optionsSchema = z
  .object({
    tlsMode: z.enum(['auto', 'existing', 'none']),
    email: z.string().email().max(200).optional(),
    allocationIp: z.union([z.ipv4(), z.literal('')]).default(''),
    portStart: z.number().int().min(1024).max(65535).default(25565),
    portEnd: z.number().int().min(1024).max(65535).default(25574),
    addAllocations: z.boolean().default(true),
    daemonPort: z.number().int().min(1).max(65535).optional(),
    sftpPort: z.number().int().min(1024).max(65535).optional(),
  })
  .strict()
  .refine(
    (o) => o.portEnd >= o.portStart && o.portEnd - o.portStart < 100,
    'Use a range of 1–100 game ports',
  );
const fingerprint = (c: any) => digest(JSON.stringify([c.url, c.config, c.secret]));
const shellQuote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
const view = (r: any) => ({
  id: r.id,
  connectionId: r.connectionId,
  status:
    r.expiresAt < new Date() && !['COMPLETE', 'REVOKED'].includes(r.status) ? 'EXPIRED' : r.status,
  step: r.step,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
  claimedAt: r.claimedAt,
  lastSeenAt: r.lastSeenAt,
  completedAt: r.completedAt,
});
@Injectable()
export class NodeInstallations {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Platform) private platform: Platform,
  ) {}
  async list(id: string) {
    await this.node(id);
    return (
      await this.db.nodeInstallation.findMany({
        where: { connectionId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
    ).map(view);
  }
  async node(id: string) {
    const c = await this.db.connection.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Node not found');
    if (c.provider !== 'wings')
      throw new BadRequestException('Automatic installation is available for Wings game nodes');
    return c;
  }
  async generate(actor: Actor, id: string, input: unknown) {
    const options = optionsSchema.parse(input),
      raw = token();
    const c = await this.node(id),
      url = new URL(c.url),
      config = c.config as any;
    if (config.behindProxy)
      throw new BadRequestException(
        'Automatic setup requires Wings to listen directly. Configure an existing reverse proxy manually.',
      );
    if (
      (url.protocol === 'https:' && options.tlsMode === 'none') ||
      (url.protocol === 'http:' && options.tlsMode !== 'none')
    )
      throw new BadRequestException('The TLS choice must match the node endpoint URL');
    if (
      options.tlsMode === 'auto' &&
      (isIP(url.hostname) ||
        !/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,63}$/.test(url.hostname) ||
        !options.email)
    )
      throw new BadRequestException(
        'Automatic TLS needs a domain name and certificate contact email',
      );
    const port = z
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(
        Number(
          options.daemonPort ||
            config.listenPort ||
            url.port ||
            (url.protocol === 'https:' ? 443 : 80),
        ),
      );
    const sftpPort = z
      .number()
      .int()
      .min(1024)
      .max(65535)
      .parse(
        options.sftpPort ??
          (config.wingsLayout === isolatedWingsLayout ? Number(config.sftpPort || 2023) : 2023),
      );
    const layout = wingsInstanceLayout(id);
    if (options.daemonPort) url.port = String(port);
    if (options.tlsMode === 'auto' && port === 80)
      throw new BadRequestException(
        'Automatic certificate renewal needs port 80 free. Use daemon port 8080 or 443.',
      );
    if (port !== Number(url.port || (url.protocol === 'https:' ? 443 : 80)))
      throw new BadRequestException(
        'The endpoint port and daemon listen port must match for direct setup',
      );
    if (
      options.addAllocations &&
      [port, sftpPort].some((p) => p >= options.portStart && p <= options.portEnd)
    )
      throw new BadRequestException('Game ports must not overlap the daemon or SFTP ports');
    if (port === sftpPort)
      throw new BadRequestException('The daemon and SFTP ports must be different');
    const record = await serial(this.db, async (tx) => {
      const fresh = await tx.connection.findUniqueOrThrow({ where: { id } });
      if (fingerprint(fresh) !== fingerprint(c))
        throw new ConflictException('Node settings changed. Reload them before generating setup.');
      if (
        config.wingsLayout !== isolatedWingsLayout &&
        ((await tx.service.count({
          where: { product: { connectionId: id }, status: { not: 'TERMINATED' } },
        })) ||
          (await tx.nodeInstallation.count({ where: { connectionId: id, status: 'COMPLETE' } })))
      )
        throw new ConflictException(
          'This connection already uses a legacy Wings layout. Add a separate connection for the additional Harbor instance.',
        );
      const running = await tx.nodeInstallation.findFirst({
        where: { connectionId: id, status: 'RUNNING', expiresAt: { gt: new Date() } },
      });
      if (running)
        throw new ConflictException(
          'An installer is running. Revoke its setup access before generating another.',
        );
      await tx.nodeInstallation.updateMany({
        where: { connectionId: id, status: { in: ['WAITING', 'RUNNING', 'FAILED'] } },
        data: { status: 'REVOKED' },
      });
      const updated = await tx.connection.update({
        where: { id },
        data: {
          url: url.origin,
          config: json({
            ...config,
            listenPort: port,
            sftpPort,
            wingsLayout: isolatedWingsLayout,
            wingsCertificateMode: options.tlsMode,
          }),
          ...(url.origin !== c.url ||
          config.wingsLayout !== isolatedWingsLayout ||
          Number(config.sftpPort || 2023) !== sftpPort
            ? { health: 'UNCONFIGURED' }
            : {}),
        },
      });
      const r = await tx.nodeInstallation.create({
        data: {
          connectionId: id,
          createdBy: actor.id,
          tokenHash: digest(raw),
          fingerprint: fingerprint(updated),
          options: json({
            ...options,
            daemonPort: port,
            sftpPort,
            layoutVersion: isolatedWingsLayout,
          }),
          expiresAt: new Date(Date.now() + 60 * 60000),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'node.installation.generated',
          targetId: r.id,
          details: { connectionId: id, tlsMode: options.tlsMode },
        },
      });
      return r;
    });
    const endpoint = `${appUrl()}/api/v1/node-setup/${record.id}`;
    const filename = `harbor-node-${record.id}.sh`;
    const protocols = new URL(appUrl()).protocol === 'https:' ? '=https' : '=http,https';
    return {
      ...view(record),
      instance: { ...layout, daemonPort: port, sftpPort, endpoint: url.origin },
      token: raw,
      scriptUrl: `${endpoint}/script`,
      filename,
      command: `umask 077; curl --fail --silent --show-error --location --proto '${protocols}' --proto-redir '${protocols}' -H ${shellQuote(`Authorization: Bearer ${raw}`)} ${shellQuote(`${endpoint}/script`)} -o ${shellQuote(filename)} && bash ${shellQuote(filename)}`,
    };
  }
  async revoke(actor: Actor, connectionId: string, id: string) {
    const result = await this.db.nodeInstallation.updateMany({
      where: { id, connectionId, status: { notIn: ['COMPLETE', 'REVOKED'] } },
      data: { status: 'REVOKED' },
    });
    if (!result.count)
      throw new ConflictException('This setup grant is already closed or does not exist');
    await this.platform.audit(actor, 'node.installation.revoked', id, { connectionId });
    return { revoked: true };
  }
  async authorized(id: string, raw: string, key?: string, completed = false, tx: any = this.db) {
    const r = await tx.nodeInstallation.findUnique({
      where: { id },
      include: { connection: true },
    });
    if (
      !r ||
      !safeEqual(r.tokenHash, digest(raw)) ||
      r.expiresAt < new Date() ||
      r.status === 'REVOKED' ||
      (!completed && r.status === 'COMPLETE')
    )
      throw new UnauthorizedException(
        'This setup command has expired, was revoked, or has already completed',
      );
    if (
      (r.options as any).layoutVersion !== isolatedWingsLayout ||
      (r.connection.config as any).wingsLayout !== isolatedWingsLayout
    )
      throw new ConflictException(
        'Generate a new installer to use the isolated Harbor Wings layout',
      );
    if (r.machineHash && (!key || !safeEqual(r.machineHash, digest(key))))
      throw new UnauthorizedException('This setup command is already bound to another machine');
    if (fingerprint(r.connection) !== r.fingerprint)
      throw new ConflictException('Node settings changed. Generate a new installer.');
    return r;
  }
  async script(id: string, raw: string) {
    const r = await this.authorized(id, raw);
    if (r.status !== 'WAITING')
      throw new ConflictException(
        'Use the script already downloaded on the target machine to resume setup',
      );
    const o = r.options as any,
      u = new URL(r.connection.url);
    const vars: Record<string, string> = {
      HARBOR_BASE: `${appUrl()}/api/v1/node-setup/${id}`,
      HARBOR_TOKEN: raw,
      HARBOR_NODE: r.connectionId,
      HARBOR_HOST: u.hostname,
      HARBOR_ENDPOINT: u.origin,
      HARBOR_PORT: String(
        (r.connection.config as any).listenPort || u.port || (u.protocol === 'https:' ? 443 : 80),
      ),
      HARBOR_TLS: o.tlsMode,
      HARBOR_SFTP_PORT: String((r.connection.config as any).sftpPort || 2023),
      HARBOR_EMAIL: o.email || '',
      HARBOR_ALLOCATION_IP: o.allocationIp || '',
      HARBOR_ADD_ALLOCATIONS: o.addAllocations ? 'true' : 'false',
      HARBOR_PORT_START: String(o.portStart),
      HARBOR_PORT_END: String(o.portEnd),
    };
    const template = await readFile(resolve(process.cwd(), 'scripts/node-bootstrap.sh'), 'utf8');
    return (
      '#!/usr/bin/env bash\nset +x\n' +
      Object.entries(vars)
        .map(([k, v]) => `${k}=${shellQuote(v)}`)
        .join('\n') +
      '\n' +
      template.replace(/^#![^\n]*\n/, '')
    );
  }
  async claim(id: string, raw: string, input: unknown) {
    const d = z
      .object({ machineKey: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(input);
    const record = await serial(this.db, async (tx) => {
      const r = await this.authorized(id, raw, d.machineKey, false, tx);
      await tx.nodeInstallation.update({
        where: { id },
        data: {
          machineHash: digest(d.machineKey),
          status: 'RUNNING',
          step: 'preflight',
          claimedAt: r.claimedAt || new Date(),
          lastSeenAt: new Date(),
          expiresAt: r.claimedAt ? r.expiresAt : new Date(Date.now() + 3 * 60 * 60000),
        },
      });
      return { config: wingsNodeConfiguration(this.platform.connection(r.connection), appUrl()) };
    });
    return record;
  }
  async report(id: string, raw: string, input: unknown) {
    const d = z
      .object({
        machineKey: z.string().regex(/^[a-f0-9]{64}$/),
        step: steps,
        status: z.enum(['running', 'failed', 'complete']),
        allocationIp: z.ipv4().optional(),
      })
      .strict()
      .parse(input);
    const r = await this.authorized(id, raw, d.machineKey, true);
    if (!r.machineHash) throw new ConflictException('Claim setup before reporting progress');
    if (r.status === 'COMPLETE') return { status: 'COMPLETE' };
    if (d.status === 'complete') {
      try {
        await this.platform.connectionHealth(r.connectionId);
      } catch {
        throw new ConflictException(
          'Wings is not reachable from the panel yet. Check the endpoint, DNS, TLS and firewall, then rerun this script.',
        );
      }
    }
    return serial(this.db, async (tx) => {
      const current = await this.authorized(id, raw, d.machineKey, true, tx);
      if (current.status === 'COMPLETE') return { status: 'COMPLETE' };
      if (d.status === 'complete') {
        const options = current.options as any,
          ip = options.allocationIp || d.allocationIp;
        if (options.addAllocations && !ip)
          throw new BadRequestException('An allocation IPv4 address is required');
        if (options.addAllocations)
          for (let port = options.portStart; port <= options.portEnd; port++)
            await tx.resource.createMany({
              data: [
                {
                  connectionId: r.connectionId,
                  kind: 'allocation',
                  value: `${ip}:${port}`,
                  config: { ip, port },
                },
              ],
              skipDuplicates: true,
            });
      }
      const status =
        d.status === 'complete' ? 'COMPLETE' : d.status === 'failed' ? 'FAILED' : 'RUNNING';
      await tx.nodeInstallation.update({
        where: { id },
        data: {
          status,
          step: d.status === 'complete' ? 'complete' : d.step,
          lastSeenAt: new Date(),
          completedAt: d.status === 'complete' ? new Date() : undefined,
        },
      });
      if (status === 'COMPLETE')
        await tx.auditLog.create({
          data: {
            actorId: r.createdBy,
            action: 'node.installation.completed',
            targetId: id,
            details: { connectionId: r.connectionId },
          },
        });
      return { status };
    });
  }
}
@Controller('api/v1')
export class NodeSetupController {
  constructor(
    @Inject(Auth) private auth: Auth,
    @Inject(NodeInstallations) private installs: NodeInstallations,
  ) {}
  private bearer(req: Request) {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get('authorization') || '');
    if (!match) throw new UnauthorizedException('A setup token is required');
    return match[1];
  }
  @Get('nodes/:id/installations') async list(@Req() req: Request, @Param('id') id: string) {
    await this.auth.require(req, true);
    return { data: await this.installs.list(id) };
  }
  @Post('nodes/:id/installations') async generate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { data: await this.installs.generate(await this.auth.require(req, true), id, body) };
  }
  @Post('nodes/:id/installations/:installationId/revoke') async revoke(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('installationId') installationId: string,
  ) {
    return {
      data: await this.installs.revoke(await this.auth.require(req, true), id, installationId),
    };
  }
  @Get('node-setup/:id/script') async script(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const content = await this.installs.script(id, this.bearer(req));
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="harbor-node.sh"');
    res.send(content);
  }
  @Post('node-setup/:id/claim') async claim(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { data: await this.installs.claim(id, this.bearer(req), body) };
  }
  @Post('node-setup/:id/progress') async progress(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { data: await this.installs.report(id, this.bearer(req), body) };
  }
}
