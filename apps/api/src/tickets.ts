import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { Db } from './db';
import type { Actor } from './auth';
import { Mailer } from './mailer';
import { serial } from './transactions';
import { supportPolicy, notificationPolicy } from './settings-policy';
const ticketStatus = z.enum(['OPEN', 'ANSWERED', 'CUSTOMER_REPLY', 'ON_HOLD', 'CLOSED']);
const ticketPriority = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export type TicketUpload = { originalname: string; mimetype: string; size: number; buffer: Buffer };
const relations = {
  customer: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  service: { select: { id: true, name: true } },
} as const;
@Injectable()
export class Tickets implements OnModuleInit {
  root = resolve(process.env.ATTACHMENTS_DIR || 'data/tickets');
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Mailer) private mail: Mailer,
  ) {}
  async onModuleInit() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }
  async authorized(actor: Actor, id: string) {
    const ticket = await this.db.supportTicket.findFirst({
      where: { id, ...(actor.role === 'ADMIN' ? {} : { customerId: actor.id }) },
      include: relations,
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }
  async list(actor: Actor) {
    return this.db.supportTicket.findMany({
      where: actor.role === 'ADMIN' ? {} : { customerId: actor.id },
      include: relations,
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }
  async detail(actor: Actor, id: string) {
    const ticket = await this.authorized(actor, id);
    const messages = await this.db.ticketMessage.findMany({
      where: { ticketId: id, ...(actor.role === 'ADMIN' ? {} : { internal: false }) },
      include: {
        author: { select: { id: true, name: true, role: true } },
        attachment: { select: { id: true, filename: true, mimeType: true, size: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { ...ticket, messages: messages.reverse() };
  }
  async departments(actor: Actor) {
    return this.db.supportDepartment.findMany({
      where: actor.role === 'ADMIN' ? {} : { active: true },
      select: {
        id: true,
        name: true,
        active: true,
        ...(actor.role === 'ADMIN' ? { notificationEmail: true } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }
  async saveDepartment(actor: Actor, input: unknown, id?: string) {
    const d = z
      .object({
        name: z.string().trim().min(1).max(100),
        active: z.boolean().default(true),
        notificationEmail: z.union([z.email(), z.literal('')]).default(''),
      })
      .strict()
      .parse(input);
    const result = id
      ? await this.db.supportDepartment.update({ where: { id }, data: d })
      : await this.db.supportDepartment.create({ data: d });
    await this.db.auditLog.create({
      data: { actorId: actor.id, action: 'support.department.saved', targetId: result.id },
    });
    return result;
  }
  async agents() {
    return this.db.user.findMany({
      where: { role: 'ADMIN', suspendedAt: null },
      select: { id: true, name: true },
    });
  }
  async create(actor: Actor, input: unknown) {
    const d = z
      .object({
        customerId: z.string().uuid().optional(),
        subject: z.string().trim().min(3).max(150),
        body: z.string().trim().min(1).max(20000),
        departmentId: z.string().uuid().nullable().optional(),
        serviceId: z.string().uuid().nullable().optional(),
        priority: ticketPriority.default('NORMAL'),
      })
      .strict()
      .parse(input);
    const customerId = d.customerId || actor.id;
    if (d.customerId && actor.role !== 'ADMIN')
      throw new ForbiddenException('Only staff can open tickets for another customer');
    const ticket = await serial(this.db, async (tx) => {
      const policy = supportPolicy(await tx.setting.findUnique({ where: { id: 'installation' } }));
      if (actor.role !== 'ADMIN' && !policy.ticketsEnabled)
        throw new ForbiddenException('New support tickets are temporarily disabled');
      if (
        d.customerId &&
        !(await tx.user.findFirst({ where: { id: customerId, role: 'CUSTOMER' } }))
      )
        throw new BadRequestException('Choose a customer account');
      if (
        d.departmentId &&
        !(await tx.supportDepartment.findFirst({ where: { id: d.departmentId, active: true } }))
      )
        throw new BadRequestException('Choose an enabled support department');
      if (
        d.serviceId &&
        !(await tx.service.findFirst({ where: { id: d.serviceId, userId: customerId } }))
      )
        throw new BadRequestException('Choose one of your hosting services');
      if (
        (await tx.supportTicket.count({ where: { customerId, status: { not: 'CLOSED' } } })) >=
        policy.maxOpenTickets
      )
        throw new BadRequestException('Close or resolve existing tickets before opening more');
      const ticket = await tx.supportTicket.create({
        data: {
          subject: d.subject,
          customerId,
          departmentId: d.departmentId,
          serviceId: d.serviceId,
          priority: d.priority,
          messages: { create: { authorId: actor.id, body: d.body } },
        },
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'support.ticket.created', targetId: ticket.id },
      });
      return ticket;
    });
    void this.notify(ticket.id, false).catch(() => {});
    return ticket;
  }
  async reply(actor: Actor, id: string, input: unknown, file?: TicketUpload) {
    await this.authorized(actor, id);
    const d = z
      .object({
        body: z.string().trim().min(1).max(20000),
        internal: z.preprocess((v) => v === true || v === 'true', z.boolean()).default(false),
      })
      .strict()
      .parse(input);
    if (d.internal && actor.role !== 'ADMIN')
      throw new ForbiddenException('Staff notes are private');
    let attachment:
      { filename: string; storageKey: string; mimeType: string; size: number } | undefined;
    if (file) {
      if (
        !supportPolicy(await this.db.setting.findUnique({ where: { id: 'installation' } }))
          .allowAttachments
      )
        throw new ForbiddenException('Support attachments are disabled');
      const allowed = [
        'image/png',
        'image/jpeg',
        'image/webp',
        'application/pdf',
        'application/zip',
        'application/x-zip-compressed',
        'text/plain',
      ];
      let mimeType = file.mimetype;
      if (mimeType === 'application/octet-stream' && /\.(txt|log)$/i.test(file.originalname))
        mimeType = 'text/plain';
      if (!allowed.includes(mimeType) || file.size > 5 * 1024 * 1024)
        throw new BadRequestException(
          'Attach a PNG, JPEG, WebP, PDF, ZIP, or text/log file up to 5 MiB',
        );
      attachment = {
        filename:
          basename(file.originalname)
            .replace(/[\x00-\x1f\x7f]/g, '')
            .slice(0, 200) || 'attachment',
        storageKey: randomUUID(),
        mimeType,
        size: file.size,
      };
      await writeFile(join(this.root, attachment.storageKey), file.buffer, {
        mode: 0o600,
        flag: 'wx',
      });
    }
    try {
      const message = await serial(this.db, async (tx) => {
        const ticket = await tx.supportTicket.findFirst({
          where: { id, ...(actor.role === 'ADMIN' ? {} : { customerId: actor.id }) },
        });
        if (!ticket) throw new NotFoundException('Ticket not found');
        const message = await tx.ticketMessage.create({
          data: {
            ticketId: id,
            authorId: actor.id,
            body: d.body,
            internal: d.internal,
            ...(attachment ? { attachment: { create: attachment } } : {}),
          },
          select: { id: true },
        });
        await tx.supportTicket.update({
          where: { id },
          data: d.internal
            ? { updatedAt: new Date() }
            : { status: actor.role === 'ADMIN' ? 'ANSWERED' : 'CUSTOMER_REPLY', closedAt: null },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: d.internal ? 'support.note.created' : 'support.reply.created',
            targetId: id,
          },
        });
        return message;
      });
      if (!d.internal) void this.notify(id, actor.role === 'ADMIN').catch(() => {});
      return message;
    } catch (error) {
      if (attachment) await unlink(join(this.root, attachment.storageKey)).catch(() => {});
      throw error;
    }
  }
  async update(actor: Actor, id: string, input: unknown) {
    const current = await this.authorized(actor, id);
    const d = z
      .object({
        status: ticketStatus.optional(),
        priority: ticketPriority.optional(),
        assignedToId: z.string().uuid().nullable().optional(),
        departmentId: z.string().uuid().nullable().optional(),
      })
      .strict()
      .parse(input);
    if (
      actor.role !== 'ADMIN' &&
      (Object.keys(d).some((k) => k !== 'status') || !['OPEN', 'CLOSED'].includes(d.status || ''))
    )
      throw new ForbiddenException('Customers can only close or reopen their own tickets');
    if (
      actor.role !== 'ADMIN' &&
      !supportPolicy(await this.db.setting.findUnique({ where: { id: 'installation' } }))
        .customerCloseEnabled
    )
      throw new ForbiddenException('Contact support to change ticket status');
    if (
      d.assignedToId &&
      !(await this.db.user.findFirst({
        where: { id: d.assignedToId, role: 'ADMIN', suspendedAt: null },
      }))
    )
      throw new BadRequestException('Choose an active support agent');
    if (
      d.departmentId &&
      d.departmentId !== current.departmentId &&
      !(await this.db.supportDepartment.findFirst({ where: { id: d.departmentId, active: true } }))
    )
      throw new BadRequestException('Choose an enabled department');
    const ticket = await this.db.supportTicket.update({
      where: { id },
      data: { ...d, ...(d.status ? { closedAt: d.status === 'CLOSED' ? new Date() : null } : {}) },
    });
    await this.db.auditLog.create({
      data: { actorId: actor.id, action: 'support.ticket.updated', targetId: id, details: d },
    });
    return ticket;
  }
  async attachment(actor: Actor, id: string) {
    const attachment = await this.db.ticketAttachment.findFirst({
      where: {
        id,
        message: {
          ...(actor.role === 'ADMIN' ? {} : { internal: false, ticket: { customerId: actor.id } }),
        },
      },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    return { ...attachment, path: join(this.root, attachment.storageKey) };
  }
  private async notify(id: string, toCustomer: boolean) {
    const ticket = await this.db.supportTicket.findUniqueOrThrow({
      where: { id },
      include: { customer: true, assignedTo: true, department: true },
    });
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
    if (
      !notificationPolicy(settings).ticketReplyEmails ||
      (toCustomer && (ticket.customer.notificationPreferences as any)?.ticketReplies === false)
    )
      return;
    const email = toCustomer
      ? ticket.customer.email
      : ticket.assignedTo?.email ||
        ticket.department?.notificationEmail ||
        (settings?.companyBilling as any)?.email;
    if (email)
      await this.mail.template(email, 'ticket.reply', {
        company: settings?.companyName || 'Harbor',
        subject: ticket.subject,
        link: `${process.env.APP_URL}/${toCustomer ? 'dashboard' : 'admin'}/tickets/${ticket.id}`,
      });
  }
}
