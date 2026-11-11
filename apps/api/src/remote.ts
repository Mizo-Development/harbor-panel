import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Db, json } from './db';
import { Platform } from './platform';
import { decrypt, safeEqual, verifyPassword } from './security';
import { wingsSettings, wingsProcess, wingsInstall } from './providers/wings';
import { serial } from './transactions';
@Controller('api/remote')
export class RemoteController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Platform) private platform: Platform,
  ) {}
  async node(req: Request) {
    const auth = req.get('authorization') || '';
    if (!auth.startsWith('Bearer ') || auth.length > 1000)
      throw new UnauthorizedException('Invalid node credentials');
    for (const c of await this.db.connection.findMany({ where: { provider: 'wings' } })) {
      const secret = decrypt(c.secret);
      if (safeEqual(auth, `Bearer ${secret.tokenId}.${secret.token}`)) {
        await this.platform.extensions.provider('wings');
        return c;
      }
    }
    throw new UnauthorizedException('Invalid node credentials');
  }
  async service(req: Request, id: string) {
    const node = await this.node(req);
    const service = await this.db.service.findFirst({
      where: {
        id,
        provider: 'wings',
        product: { connectionId: node.id },
        status: { notIn: ['PENDING', 'TERMINATED'] },
      },
      include: { product: { include: { connection: true } }, user: true, resource: true },
    });
    if (!service) throw new NotFoundException('Server not found');
    return { node, service };
  }
  @Get('servers') async list(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    const node = await this.node(req);
    const size = Math.min(100, Math.max(1, Number(perPage) || 50));
    const current = Math.max(1, Number(page) || 1);
    const where = {
      provider: 'wings',
      product: { connectionId: node.id },
      status: { notIn: ['PENDING', 'TERMINATED'] as any },
    };
    const total = await this.db.service.count({ where });
    const rows = await this.db.service.findMany({
      where,
      include: { product: { include: { connection: true } }, user: true, resource: true },
      skip: (current - 1) * size,
      take: size,
    });
    return {
      data: rows.map((s) => ({
        uuid: s.id,
        settings: wingsSettings(this.platform.hostingService(s), s.status === 'SUSPENDED'),
        process_configuration: wingsProcess(this.platform.hostingService(s)),
      })),
      meta: {
        current_page: current,
        from: (current - 1) * size + 1,
        last_page: Math.max(1, Math.ceil(total / size)),
        per_page: size,
        to: Math.min(current * size, total),
        total,
      },
    };
  }
  @Post('servers/reset') async reset(@Req() req: Request) {
    const node = await this.node(req);
    await this.db.service.updateMany({
      where: { provider: 'wings', product: { connectionId: node.id }, status: 'INSTALLING' },
      data: {
        status: 'FAILED',
        error: 'Wings restarted during installation. Inspect the node and retry installation.',
      },
    });
    return {};
  }
  @Get('servers/:id') async configuration(@Req() req: Request, @Param('id') id: string) {
    const { service: s } = await this.service(req, id);
    return {
      settings: wingsSettings(this.platform.hostingService(s), s.status === 'SUSPENDED'),
      process_configuration: wingsProcess(this.platform.hostingService(s)),
    };
  }
  @Get('servers/:id/install') async install(@Req() req: Request, @Param('id') id: string) {
    const { node, service } = await this.service(req, id);
    return wingsInstall(this.platform.connection(node), this.platform.hostingService(service));
  }
  @Post('servers/:id/install') async installed(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const { service } = await this.service(req, id);
    const d = z.object({ successful: z.boolean() }).passthrough().parse(input);
    if (service.status === 'TERMINATED')
      throw new BadRequestException('Server has been terminated');
    await this.db.service.updateMany({
      where: { id, status: { not: 'TERMINATED' } },
      data: {
        status: d.successful ? 'ACTIVE' : 'FAILED',
        error: d.successful ? null : 'Wings reported an installation failure',
        externalId: id,
      },
    });
    return {};
  }
  @Post('sftp/auth') async sftp(@Req() req: Request, @Body() input: unknown) {
    const node = await this.node(req);
    const d = z
      .object({
        type: z.literal('password'),
        username: z.string().max(320),
        password: z.string().max(200),
      })
      .passthrough()
      .parse(input);
    // Login format: email.service-uuid. Password authentication respects account TOTP policy.
    const match = d.username.match(/^(.+)\.([a-f0-9-]{36})$/i);
    if (!match) throw new ForbiddenException('Invalid SFTP credentials');
    const user = await this.db.user.findUnique({ where: { email: match[1].toLowerCase() } });
    if (!user || user.totpEnabled || !(await verifyPassword(d.password, user.passwordHash)))
      throw new ForbiddenException(
        'Invalid SFTP credentials; accounts with TOTP must use the panel file manager',
      );
    const s = await this.db.service.findFirst({
      where: {
        id: match[2],
        userId: user.id,
        provider: 'wings',
        status: 'ACTIVE',
        OR: [{ cancelAt: null }, { cancelAt: { gt: new Date() } }],
        product: { connectionId: node.id },
      },
    });
    if (!s) throw new ForbiddenException('SFTP access denied');
    return {
      server: s.id,
      user: user.id,
      permissions: ['file.read', 'file.create', 'file.update', 'file.delete'],
    };
  }
  @Post('backups/:id') async backup(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const node = await this.node(req);
    const d = z
      .object({
        successful: z.boolean(),
        checksum: z.string().max(200).optional(),
        checksum_type: z.string().max(20).optional(),
        size: z.number().nonnegative().optional(),
      })
      .passthrough()
      .parse(input);
    const op = await this.db.operation.findFirst({
      where: {
        action: 'backup',
        input: { path: ['backupId'], equals: id },
        service: { provider: 'wings', product: { connectionId: node.id } },
      },
    });
    if (!op) throw new NotFoundException('Backup not found');
    await serial(this.db, async (tx) => {
      const s = await tx.service.findUniqueOrThrow({ where: { id: op.serviceId } });
      const meta = s.metadata as any;
      await tx.service.update({
        where: { id: s.id },
        data: {
          metadata: json({
            ...meta,
            backups: {
              ...meta.backups,
              [id]: { ...d, completed: d.successful, createdAt: new Date().toISOString() },
            },
          }),
        },
      });
    });
    return {};
  }
  @Post('backups/:id/restore') async restored(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const node = await this.node(req);
    const d = z.object({ successful: z.boolean() }).parse(input);
    const op = await this.db.operation.findFirst({
      where: {
        action: 'restore',
        input: { path: ['backupId'], equals: id },
        service: { product: { connectionId: node.id } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!op) throw new NotFoundException('Restore operation not found');
    if (!d.successful)
      await this.db.operation.update({
        where: { id: op.id },
        data: { status: 'FAILED', error: 'Wings reported a restoration failure' },
      });
    return {};
  }
  @Post('activity') async activity(@Req() req: Request) {
    await this.node(req);
    return {};
  }
}
