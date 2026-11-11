import { Injectable, Inject, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { Db } from './db';
import { decrypt } from './security';
import { notificationTemplates, interpolate, type NotificationKey } from './notification-templates';
@Injectable()
export class Mailer {
  private logger = new Logger('Mail');
  constructor(@Inject(Db) private db: Db) {}
  async configuration() {
    const setting = await this.db.setting.findUnique({
      where: { id: 'installation' },
      select: { mailConfig: true },
    });
    if (setting?.mailConfig) {
      const c = decrypt<any>(setting.mailConfig);
      return {
        options: {
          host: c.host,
          port: c.port,
          secure: c.security === 'TLS',
          requireTLS: c.security === 'STARTTLS',
          ignoreTLS: c.security === 'PLAIN',
          ...(c.username ? { auth: { user: c.username, pass: c.password } } : {}),
        } as SMTPTransport.Options,
        from: { name: c.fromName, address: c.fromAddress },
      };
    }
    if (!process.env.SMTP_URL || !process.env.SMTP_FROM) return null;
    return {
      options: { url: process.env.SMTP_URL } as SMTPTransport.Options,
      from: process.env.SMTP_FROM,
    };
  }
  async configured() {
    return !!(await this.configuration());
  }
  async template(
    to: string,
    key: NotificationKey,
    values: Record<string, string>,
    attachments: { filename: string; content: Buffer; contentType: string }[] = [],
    messageId?: string,
  ) {
    const saved = await this.db.notificationTemplate.findUnique({ where: { key } });
    const fallback = notificationTemplates[key];
    return this.send(
      to,
      interpolate(saved?.subject || fallback.subject, values).replace(/[\r\n]/g, ' '),
      interpolate(saved?.body || fallback.body, values),
      attachments,
      messageId,
      key,
    );
  }
  async send(
    to: string,
    subject: string,
    text: string,
    attachments: { filename: string; content: Buffer; contentType: string }[] = [],
    messageId?: string,
    kind = 'transactional',
  ) {
    const configuration = await this.configuration();
    if (!configuration) {
      this.logger.warn('SMTP is not configured; notification not delivered');
      await this.db.mailLog.create({
        data: { recipient: to, subject, kind, status: 'NOT_SENT', errorCode: 'NOT_CONFIGURED' },
      });
      return false;
    }
    const transport = nodemailer.createTransport({
      ...configuration.options,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const log = await this.db.mailLog.create({
      data: { recipient: to, subject, kind, status: 'SENDING' },
    });
    try {
      const result = await transport.sendMail({
        from: configuration.from,
        to,
        subject,
        text,
        attachments,
        messageId,
      });
      await this.db.mailLog.update({
        where: { id: log.id },
        data: { status: 'SENT', messageId: result.messageId },
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      await this.db.mailLog.update({
        where: { id: log.id },
        data: {
          status:
            ['EAUTH', 'ECONNECTION', 'EDNS', 'EENVELOPE'].includes(code || '') ||
            ((error as { responseCode?: number }).responseCode || 0) >= 400
              ? 'FAILED'
              : 'UNKNOWN',
          errorCode:
            typeof code === 'string' && /^[A-Z_]{1,40}$/.test(code) ? code : 'DELIVERY_ERROR',
        },
      });
      throw Object.assign(new Error('Email delivery failed'), {
        code,
        responseCode: (error as { responseCode?: number }).responseCode,
      });
    }
    return true;
  }
}
