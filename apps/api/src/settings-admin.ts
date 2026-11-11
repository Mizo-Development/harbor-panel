import {
  Inject,
  Injectable,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import sharp from 'sharp';
import { Db } from './db';
import { Mailer } from './mailer';
import { decrypt, encrypt, digest } from './security';
import { serial } from './transactions';
import type { Actor } from './auth';
import { notificationTemplates, type NotificationKey } from './notification-templates';
const mailSchema = z
  .object({
    source: z.enum(['environment', 'custom']),
    expectedVersion: z.number().int().min(0),
    expectedMailRevision: z.string().max(64).optional(),
    host: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9.:-]{1,253}$/)
      .optional(),
    port: z.number().int().min(1).max(65535).optional(),
    security: z.enum(['TLS', 'STARTTLS', 'PLAIN']).optional(),
    username: z.string().trim().max(320).default(''),
    password: z.string().max(1000).optional(),
    fromName: z
      .string()
      .trim()
      .max(100)
      .regex(/^[^\r\n]*$/)
      .default(''),
    fromAddress: z.email().optional(),
  })
  .strict();
@Injectable()
export class SettingsAdmin {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Mailer) private mail: Mailer,
  ) {}
  async info() {
    const settings = await this.db.setting.findUniqueOrThrow({ where: { id: 'installation' } });
    const custom = settings.mailConfig ? decrypt<any>(settings.mailConfig) : null;
    return {
      settingsVersion: settings.settingsVersion,
      mail: {
        source: custom ? 'custom' : 'environment',
        revision: settings.mailConfig ? digest(settings.mailConfig) : 'environment',
        configured: await this.mail.configured(),
        ...(custom
          ? {
              host: custom.host,
              port: custom.port,
              security: custom.security,
              username: custom.username,
              fromName: custom.fromName,
              fromAddress: custom.fromAddress,
              passwordSet: !!custom.password,
            }
          : { passwordSet: !!process.env.SMTP_URL }),
      },
    };
  }
  async saveMail(actor: Actor, input: unknown) {
    const d = mailSchema.parse(input);
    await serial(this.db, async (tx) => {
      const current = await tx.setting.findUniqueOrThrow({ where: { id: 'installation' } });
      if (
        d.expectedMailRevision !== undefined
          ? d.expectedMailRevision !==
            (current.mailConfig ? digest(current.mailConfig) : 'environment')
          : current.settingsVersion !== d.expectedVersion
      )
        throw new ConflictException('Settings changed. Reload before saving email configuration.');
      let config: string | null = null;
      if (d.source === 'custom') {
        if (!d.host || !d.port || !d.security || !d.fromAddress)
          throw new BadRequestException('Host, port, security and sender address are required');
        const old = current.mailConfig ? decrypt<any>(current.mailConfig) : null;
        const password =
          d.password || (old?.host === d.host && old?.username === d.username ? old.password : '');
        if (d.username && !password)
          throw new BadRequestException('Enter the SMTP password for these credentials');
        config = encrypt({
          host: d.host,
          port: d.port,
          security: d.security,
          username: d.username,
          password,
          fromName: d.fromName,
          fromAddress: d.fromAddress,
        });
      }
      await tx.setting.update({
        where: { id: 'installation' },
        data: { mailConfig: config, settingsVersion: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'settings.mail.updated', details: { source: d.source } },
      });
    });
    return this.info();
  }
  async testMail(actor: Actor) {
    const configuration = await this.mail.configuration();
    if (!configuration) throw new ConflictException('Configure SMTP before sending a test email');
    try {
      await nodemailer
        .createTransport({
          ...configuration.options,
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
          disableFileAccess: true,
          disableUrlAccess: true,
        })
        .verify();
      await this.mail.send(
        actor.email,
        'Harbor email delivery test',
        'This test confirms that your hosting panel can submit email through the saved SMTP connection.',
        [],
        undefined,
        'smtp.test',
      );
    } catch {
      throw new ServiceUnavailableException(
        'The SMTP connection or message was rejected. Check host, security, credentials and sender settings.',
      );
    }
    await this.db.auditLog.create({ data: { actorId: actor.id, action: 'settings.mail.test' } });
    return { accepted: true, recipient: actor.email };
  }
  async templates() {
    const saved = await this.db.notificationTemplate.findMany();
    return Object.entries(notificationTemplates).map(([key, defaultValue]) => ({
      key,
      ...defaultValue,
      ...saved.find((s) => s.key === key),
      isCustomized: saved.some((s) => s.key === key),
    }));
  }
  async saveTemplate(actor: Actor, key: string, input: unknown) {
    const fallback = notificationTemplates[key as NotificationKey];
    if (!fallback) throw new BadRequestException('Unknown notification template');
    const d = z
      .object({
        subject: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[^\r\n]*$/),
        body: z.string().trim().min(1).max(10000),
        expectedUpdatedAt: z.string().datetime().nullable(),
      })
      .strict()
      .parse(input);
    const placeholders = [...(d.subject + d.body).matchAll(/\{\{(.*?)\}\}/g)].map((m) => m[1]);
    if (placeholders.some((p) => !(fallback.variables as readonly string[]).includes(p)))
      throw new BadRequestException('Use only the variables shown for this template');
    if ((fallback.variables as readonly string[]).includes('link') && !d.body.includes('{{link}}'))
      throw new BadRequestException('This template must include {{link}} in its message');
    await serial(this.db, async (tx) => {
      const current = await tx.notificationTemplate.findUnique({ where: { key } });
      if ((current?.updatedAt.toISOString() || null) !== d.expectedUpdatedAt)
        throw new ConflictException('Template changed. Reload before saving.');
      await tx.notificationTemplate.upsert({
        where: { key },
        create: { key, subject: d.subject, body: d.body },
        update: { subject: d.subject, body: d.body },
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'notification.template.updated', targetId: key },
      });
    });
    return this.templates();
  }
  async logs(query: unknown) {
    const d = z
      .object({
        page: z.coerce.number().int().min(1).max(10000).default(1),
        search: z.string().trim().max(200).default(''),
        status: z.enum(['', 'SENT', 'FAILED', 'SENDING', 'NOT_SENT', 'UNKNOWN']).default(''),
      })
      .parse(query);
    const where = {
      ...(d.status ? { status: d.status } : {}),
      ...(d.search
        ? {
            OR: [
              { recipient: { contains: d.search, mode: 'insensitive' as const } },
              { subject: { contains: d.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.db.mailLog.count({ where }),
      this.db.mailLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (d.page - 1) * 25,
        take: 25,
      }),
    ]);
    return { total, page: d.page, items };
  }
  async upload(actor: Actor, file?: { buffer: Buffer; mimetype: string }) {
    if (!file?.buffer.length || file.buffer.length > 1024 * 1024)
      throw new BadRequestException('Choose a PNG, JPEG or WebP image up to 1 MiB');
    const b = file.buffer;
    const extension = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : b[0] === 255 && b[1] === 216 && b[2] === 255
        ? 'jpg'
        : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
          ? 'webp'
          : null;
    if (!extension) throw new BadRequestException('The file must be a PNG, JPEG or WebP image');
    let image: Buffer;
    try {
      image = await sharp(b, { limitInputPixels: 16_000_000, animated: false })
        .rotate()
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch {
      throw new BadRequestException('The image is damaged or exceeds the supported dimensions');
    }
    const root = resolve(process.env.BRANDING_DIR || 'data/branding'),
      name = `${randomUUID()}.png`;
    await mkdir(root, { recursive: true });
    await writeFile(join(root, name), image, { flag: 'wx', mode: 0o644 });
    await this.db.auditLog.create({
      data: { actorId: actor.id, action: 'branding.image.uploaded', targetId: name },
    });
    return { url: `/api/v1/branding/${name}` };
  }
  async image(name: string) {
    if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name))
      throw new BadRequestException('Invalid image');
    try {
      return {
        content: await readFile(join(resolve(process.env.BRANDING_DIR || 'data/branding'), name)),
        type: name.endsWith('.png')
          ? 'image/png'
          : name.endsWith('.jpg')
            ? 'image/jpeg'
            : 'image/webp',
      };
    } catch {
      throw new BadRequestException('Branding image not found');
    }
  }
}
