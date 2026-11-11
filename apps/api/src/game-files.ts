import {
  BadGatewayException,
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  Res,
  HttpException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { createReadStream, mkdtempSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { Auth, Actor } from './auth';
import { Platform } from './platform';
import { WingsProvider } from './providers/wings';
const { diskStorage } = require('multer');
const temporary = mkdtempSync(join(tmpdir(), 'harbor-file-upload-'));
export const MAX_GAME_UPLOAD = 100 * 1024 * 1024;
export function gameFilePath(value: unknown, allowRoot = true) {
  const path = z.string().min(1).max(2000).parse(value);
  if (/[\\\x00-\x1f\x7f]/.test(path) || path.split('/').includes('..'))
    throw new BadRequestException('Invalid file path');
  const normalized = posix.normalize('/' + path.replace(/^\/+/, ''));
  if (!allowRoot && normalized === '/') throw new BadRequestException('Select a file or folder');
  return normalized;
}
export function gameFileName(value: unknown) {
  const name = z.string().min(1).max(255).parse(value);
  if (name === '.' || name === '..' || /[/\\\x00-\x1f\x7f]/.test(name))
    throw new BadRequestException('Use a single file or folder name');
  return name;
}
type FileRequest = Request & { gameFileService: any; gameFileActor: Actor };
@Injectable()
export class GameFilesGuard implements CanActivate {
  private uploads = new Map<string, number>();
  constructor(
    @Inject(Auth) private auth: Auth,
    @Inject(Platform) private platform: Platform,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<FileRequest>(),
      res = context.switchToHttp().getResponse<Response>();
    const actor = await this.auth.require(req);
    const service = await this.platform.rawService(actor, String(req.params.id));
    if (
      service.provider !== 'wings' ||
      service.status !== 'ACTIVE' ||
      (service.cancelAt && service.cancelAt <= new Date())
    )
      throw new BadRequestException('An active game server is required');
    req.gameFileActor = actor;
    req.gameFileService = service;
    if (req.path.endsWith('/upload')) {
      if (
        (this.uploads.get(actor.id) || 0) >= 2 ||
        [...this.uploads.values()].reduce((a, b) => a + b, 0) >= 8
      )
        throw new HttpException('Wait for the current uploads to finish', 429);
      this.uploads.set(actor.id, (this.uploads.get(actor.id) || 0) + 1);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        const count = (this.uploads.get(actor.id) || 1) - 1;
        if (count) this.uploads.set(actor.id, count);
        else this.uploads.delete(actor.id);
      };
      res.once('finish', release);
      res.once('close', release);
    }
    return true;
  }
}
@Controller('api/v1/services/:id/files')
@UseGuards(GameFilesGuard)
export class GameFilesController {
  constructor(@Inject(Platform) private platform: Platform) {}
  private connection(req: FileRequest) {
    return this.platform.connection(req.gameFileService.product.connection);
  }
  private async provider() {
    return (await this.platform.extensions.provider('wings')) as WingsProvider;
  }
  @Get('download') async download(
    @Req() req: FileRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Query('path') input: string,
  ) {
    const path = gameFilePath(input, false),
      c = this.connection(req);
    const abort = new AbortController();
    res.once('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    const response = await fetch(
      `${c.url}/api/servers/${id}/files/contents?file=${encodeURIComponent(path)}&download=1`,
      {
        headers: { Authorization: `Bearer ${c.secret.token}` },
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30 * 60000)]),
        redirect: 'error',
      },
    );
    if (!response.ok || !response.body)
      throw new BadGatewayException('Unable to download this file from the game node');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(posix.basename(path)).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    );
    const length = response.headers.get('content-length');
    if (length && /^\d+$/.test(length)) res.setHeader('Content-Length', length);
    try {
      await pipeline(Readable.fromWeb(response.body as any), res);
    } catch (error) {
      if (!abort.signal.aborted) {
        res.destroy();
      }
    }
  }
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: temporary,
        filename: (_req: unknown, _file: unknown, cb: (error: unknown, name: string) => void) =>
          cb(null, randomUUID()),
      }),
      limits: { fileSize: MAX_GAME_UPLOAD, files: 1, fields: 0 },
    }),
  )
  async upload(
    @Req() req: FileRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Query('directory') input: string,
    @UploadedFile() file?: { path: string; size: number; originalname: string },
  ) {
    if (!file) throw new BadRequestException('Choose a file to upload');
    try {
      const directory = gameFilePath(input || '/'),
        name = gameFileName(file.originalname),
        target = posix.join(directory, name),
        c = this.connection(req);
      const abort = new AbortController();
      res.once('close', () => {
        if (!res.writableEnded) abort.abort();
      });
      const response = await fetch(
        `${c.url}/api/servers/${id}/files/write?file=${encodeURIComponent(target)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${c.secret.token}`,
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(file.size),
          },
          body: createReadStream(file.path) as any,
          duplex: 'half',
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5 * 60000)]),
          redirect: 'error',
        } as RequestInit,
      );
      await response.body?.cancel();
      if (!response.ok)
        throw new BadGatewayException(`Game node rejected upload (HTTP ${response.status})`);
      await this.platform.audit(req.gameFileActor, 'service.file.uploaded', id, {
        path: target,
        size: file.size,
      });
      return { data: { uploaded: true, path: target, size: file.size } };
    } finally {
      await unlink(file.path).catch(() => {});
    }
  }
  @Post('operations') async operate(
    @Req() req: FileRequest,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const d = z
      .object({
        action: z.enum([
          'create-file',
          'create-folder',
          'rename',
          'copy',
          'delete',
          'compress',
          'decompress',
        ]),
        directory: z.string().default('/'),
        name: z.string().optional(),
        target: z.string().optional(),
        files: z.array(z.string()).min(1).max(100).optional(),
        confirmation: z.literal('DELETE').optional(),
      })
      .strict()
      .parse(input);
    const root = gameFilePath(d.directory),
      provider = await this.provider(),
      c = this.connection(req);
    let result: unknown;
    if (d.action === 'create-file') {
      const name = gameFileName(d.name);
      const entries = await provider.call(
        c,
        `/servers/${id}/files/list-directory?directory=${encodeURIComponent(root)}`,
      );
      if ((Array.isArray(entries) ? entries : entries.data || []).some((f: any) => f.name === name))
        throw new BadRequestException('An item with this name already exists');
      const response = await fetch(
        `${c.url}/api/servers/${id}/files/write?file=${encodeURIComponent(posix.join(root, name))}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${c.secret.token}`, 'Content-Type': 'text/plain' },
          body: '',
          signal: AbortSignal.timeout(30000),
          redirect: 'error',
        },
      );
      await response.body?.cancel();
      if (!response.ok) throw new BadGatewayException('Unable to create file on the game node');
    } else if (d.action === 'create-folder')
      result = await provider.call(c, `/servers/${id}/files/create-directory`, 'POST', {
        path: root,
        name: gameFileName(d.name),
      });
    else if (d.action === 'rename')
      result = await provider.call(c, `/servers/${id}/files/rename`, 'PUT', {
        root,
        files: [{ from: gameFileName(d.name), to: gameFileName(d.target) }],
      });
    else if (d.action === 'copy')
      result = await provider.call(c, `/servers/${id}/files/copy`, 'POST', {
        location: posix.join(root, gameFileName(d.name)),
      });
    else if (d.action === 'delete') {
      if (d.confirmation !== 'DELETE') throw new BadRequestException('Confirm deletion');
      const files = z.array(z.string()).min(1).max(100).parse(d.files).map(gameFileName);
      result = await provider.call(c, `/servers/${id}/files/delete`, 'POST', { root, files });
    } else if (d.action === 'compress') {
      const files = z.array(z.string()).min(1).max(100).parse(d.files).map(gameFileName);
      result = await provider.call(c, `/servers/${id}/files/compress`, 'POST', { root, files });
    } else
      result = await provider.call(c, `/servers/${id}/files/decompress`, 'POST', {
        root,
        file: gameFileName(d.name),
      });
    await this.platform.audit(req.gameFileActor, `service.files.${d.action}`, id, {
      directory: root,
      name: d.name,
      files: d.files,
    });
    return { data: { complete: true, result } };
  }
}
