import {
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticator } from 'otplib';
import { Db } from './db';
import { decrypt, digest, encrypt, hashPassword, token, verifyPassword } from './security';
import { Mailer } from './mailer';
import { accessPolicy, notificationPolicy } from './settings-policy';
import { serial } from './transactions';
import { appUrl } from './security';
import { ApiKeys } from './api-keys';
export const passwordSchema = z.string().min(12).max(200);
export const emailSchema = z.string().trim().email().toLowerCase().max(254);
export const safeUser = {
  id: true,
  email: true,
  name: true,
  billingAddress: true,
  taxExempt: true,
  role: true,
  totpEnabled: true,
  createdAt: true,
  suspendedAt: true,
  emailVerifiedAt: true,
  autoPayWallet: true,
  notificationPreferences: true,
} as const;
export type Actor = {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'CUSTOMER';
  totpEnabled: boolean;
  apiKeyId?: string;
};
export type AuthRequest = Request & { actor?: Actor };
@Injectable()
export class Auth {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Mailer) private mail: Mailer,
    @Inject(ApiKeys) private apiKeys: ApiKeys,
  ) {}
  async actor(req: Request): Promise<Actor | null> {
    if (req.headers?.authorization) return this.apiKeys.authenticate(req);
    const raw = req.cookies?.harbor_session;
    if (typeof raw !== 'string' || raw.length !== 64) return null;
    const session = await this.db.session.findUnique({
      where: { id: digest(raw) },
      include: { user: { select: safeUser } },
    });
    return session && session.expiresAt > new Date() && !session.user.suspendedAt
      ? session.user
      : null;
  }
  async require(req: Request, admin = false) {
    const user = await this.actor(req);
    if (!user) throw new UnauthorizedException('Please sign in to continue');
    (req as any).harborActorId = user.id;
    if (admin && user.role !== 'ADMIN')
      throw new ForbiddenException('Administrator access required');
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } }),
      policy = accessPolicy(settings);
    if (user.role === 'CUSTOMER' && policy.maintenanceEnabled && req.path !== '/api/v1/auth/me')
      throw new ServiceUnavailableException(
        policy.maintenanceMessage || 'Scheduled maintenance in progress',
      );
    if (
      user.role === 'ADMIN' &&
      policy.requireStaffTwoFactor &&
      !user.totpEnabled &&
      !['/api/v1/auth/me', '/api/v1/profile'].includes(req.path) &&
      !req.path.startsWith('/api/v1/auth/totp/')
    )
      throw new ForbiddenException(
        'Enable two-factor authentication in your account to access staff tools',
      );
    return user;
  }
  async session(userId: string, res: Response) {
    const raw = token();
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
    const expires = new Date(Date.now() + accessPolicy(settings).sessionHours * 3600000);
    await this.db.session.create({ data: { id: digest(raw), userId, expiresAt: expires } });
    this.sessionCookie(raw, expires, res);
  }
  private sessionCookie(raw: string, expires: Date, res: Response) {
    res.cookie('harbor_session', raw, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || new URL(appUrl()).protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      expires,
    });
  }
  async login(input: unknown, res: Response, req?: Request) {
    const data = z
      .object({
        email: emailSchema,
        password: z.string().max(200),
        totp: z.string().length(6).optional(),
      })
      .parse(input);
    const user = await this.db.user.findUnique({ where: { email: data.email } });
    // Equalize password hashing cost when an account does not exist.
    const valid = await verifyPassword(
      data.password,
      user?.passwordHash ?? `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`,
    );
    if (!user || !valid) throw new UnauthorizedException('Invalid email or password');
    if (user.suspendedAt)
      throw new ForbiddenException('Your account is suspended. Contact support.');
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
    if (user.role === 'CUSTOMER' && accessPolicy(settings).maintenanceEnabled)
      throw new ServiceUnavailableException(
        accessPolicy(settings).maintenanceMessage || 'Scheduled maintenance in progress',
      );
    if (
      user.totpEnabled &&
      (!data.totp || !authenticator.check(data.totp, decrypt<string>(user.totpSecret!)))
    )
      throw new UnauthorizedException('A valid authenticator code is required');
    const now = new Date(),
      ip = req?.ip?.slice(0, 100) || null,
      userAgent = req?.get('user-agent')?.slice(0, 500) || null;
    const raw = token(),
      expires = new Date(Date.now() + accessPolicy(settings).sessionHours * 3600000);
    await this.db.$transaction(async (tx) => {
      const matched = await tx.user.updateMany({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
          email: user.email,
          totpEnabled: user.totpEnabled,
          totpSecret: user.totpSecret,
          suspendedAt: null,
        },
        data: { lastLoginAt: now, lastLoginIp: ip, lastLoginUserAgent: userAgent },
      });
      if (!matched.count)
        throw new UnauthorizedException('Account credentials changed. Please sign in again.');
      await tx.session.create({ data: { id: digest(raw), userId: user.id, expiresAt: expires } });
      await tx.auditLog.create({
        data: { actorId: user.id, action: 'auth.login', details: { ip, userAgent } },
      });
    });
    this.sessionCookie(raw, expires, res);
    if (
      notificationPolicy(settings).loginEmails &&
      (user.notificationPreferences as any)?.loginAlerts !== false
    )
      await this.mail
        .template(user.email, 'auth.login', {
          company: settings?.companyName || 'Harbor',
          name: user.name,
          ip: ip || 'Unknown',
          time: now.toISOString(),
          link: `${appUrl()}/forgot-password`,
        })
        .catch(() => {});
    return this.db.user.findUnique({ where: { id: user.id }, select: safeUser });
  }
  async register(input: unknown, res: Response) {
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
    if (
      !settings?.storefrontEnabled ||
      !accessPolicy(settings).registrationEnabled ||
      accessPolicy(settings).maintenanceEnabled
    )
      throw new ForbiddenException('Public registration is unavailable');
    const data = z
      .object({
        email: emailSchema,
        name: z.string().trim().min(1).max(100),
        password: passwordSchema,
      })
      .parse(input);
    const domains = accessPolicy(settings).registrationDomains;
    if (domains.length && !domains.includes(data.email.split('@')[1]))
      throw new ForbiddenException('Registration is restricted to approved email domains');
    const user = await this.db.user.create({
      data: { name: data.name, email: data.email, passwordHash: await hashPassword(data.password) },
      select: safeUser,
    });
    await this.session(user.id, res);
    if (accessPolicy(settings).requireVerifiedEmail)
      await this.requestVerification(user).catch(() => {});
    return user;
  }
  async logout(req: Request, res: Response) {
    const raw = req.cookies?.harbor_session;
    if (raw) await this.db.session.deleteMany({ where: { id: digest(raw) } });
    res.clearCookie('harbor_session', { path: '/' });
    return { signedOut: true };
  }
  async resetRequest(input: unknown) {
    const { email } = z.object({ email: emailSchema }).parse(input);
    const user = await this.db.user.findUnique({ where: { email } });
    if (user) {
      const raw = token();
      await this.db.resetToken.create({
        data: { id: digest(raw), userId: user.id, expiresAt: new Date(Date.now() + 30 * 60000) },
      });
      const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
      await this.mail
        .template(email, 'auth.reset', {
          company: settings?.companyName || 'Harbor',
          link: `${appUrl()}/reset-password?token=${raw}`,
        })
        .catch(() => false);
    }
    return { message: 'If the account exists, password reset instructions have been sent.' };
  }
  async resetPassword(input: unknown) {
    const data = z.object({ token: z.string().length(64), password: passwordSchema }).parse(input);
    const hash = await hashPassword(data.password);
    await this.db.$transaction(async (tx) => {
      const entry = await tx.resetToken.findUnique({ where: { id: digest(data.token) } });
      if (!entry || entry.expiresAt < new Date())
        throw new UnauthorizedException('Reset link is invalid or expired');
      await tx.resetToken.delete({ where: { id: entry.id } });
      await tx.user.update({
        where: { id: entry.userId },
        data: { passwordHash: hash, passwordChangedAt: new Date() },
      });
      await tx.resetToken.deleteMany({ where: { userId: entry.userId } });
      await tx.session.deleteMany({ where: { userId: entry.userId } });
      await tx.apiKey.updateMany({
        where: { userId: entry.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { message: 'Password changed. Please sign in.' };
  }
  async totpStart(actor: Actor, password: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (user.totpEnabled)
      throw new ConflictException('Two-factor authentication is already enabled');
    if (!(await verifyPassword(password, user.passwordHash)))
      throw new UnauthorizedException('Invalid password');
    const secret = authenticator.generateSecret();
    await serial(this.db, async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { totpSecret: encrypt(secret) } });
      await tx.apiKey.updateMany({
        where: { userId: actor.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
    return {
      secret,
      uri: authenticator.keyuri(actor.email, settings?.companyName || 'Harbor', secret),
    };
  }
  async totpConfirm(actor: Actor, code: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!user.totpSecret || !authenticator.check(code, decrypt<string>(user.totpSecret)))
      throw new UnauthorizedException('Invalid authenticator code');
    await serial(this.db, async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { totpEnabled: true } });
      await tx.apiKey.updateMany({
        where: { userId: actor.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { enabled: true };
  }
  async requestVerification(actor: { id: string }) {
    const raw = token();
    const user = await serial(this.db, async (tx) => {
      const current = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
      if (current.emailVerifiedAt) return null;
      if (
        await tx.verificationToken.count({
          where: { userId: current.id, createdAt: { gt: new Date(Date.now() - 60000) } },
        })
      )
        throw new ConflictException('Wait a minute before requesting another verification email');
      await tx.verificationToken.deleteMany({ where: { userId: current.id } });
      await tx.verificationToken.create({
        data: {
          id: digest(raw),
          userId: current.id,
          email: current.email,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      return current;
    });
    if (!user) return { verified: true };
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
    const accepted = await this.mail
      .template(user.email, 'auth.verify', {
        company: settings?.companyName || 'Harbor',
        link: `${appUrl()}/verify-email?token=${raw}`,
      })
      .catch(() => false);
    return {
      verified: false,
      accepted,
      message: accepted
        ? 'Verification email submitted. Check your inbox.'
        : 'Email delivery is not configured. Contact support.',
    };
  }
  async verifyEmail(input: unknown) {
    const d = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(input);
    return serial(this.db, async (tx) => {
      const entry = await tx.verificationToken.findUnique({
        where: { id: digest(d.token) },
        include: { user: true },
      });
      if (
        !entry ||
        entry.expiresAt <= new Date() ||
        entry.email !== entry.user.email ||
        entry.user.suspendedAt
      )
        throw new UnauthorizedException('Verification link is invalid or expired');
      await tx.user.update({ where: { id: entry.userId }, data: { emailVerifiedAt: new Date() } });
      await tx.verificationToken.deleteMany({ where: { userId: entry.userId } });
      await tx.auditLog.create({ data: { actorId: entry.userId, action: 'auth.email.verified' } });
      return { verified: true };
    });
  }
}
