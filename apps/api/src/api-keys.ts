import {
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { authenticator } from 'otplib';
import { z } from 'zod';
import { Db, json } from './db';
import { token, digest, decrypt, safeEqual, verifyPassword, appUrl } from './security';
import { serial } from './transactions';
import { accessPolicy } from './settings-policy';
import {
  apiKeyFingerprint,
  apiScope,
  apiIpAllowed,
  normalizeCidr,
  apiScopeCatalog,
  apiRouteCatalog,
  clientScopes,
  adminScopes,
  type ApiKeyKind,
} from './api-key-policy';
import type { Actor } from './auth';
export type KeyRequest = Request & {
  harborApiActor?: Actor;
  harborApiKey?: { id: string; kind: ApiKeyKind; scopes: string[] };
  harborActorId?: string;
};
const credentials = {
  password: z.string().min(1).max(200),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
};
export const apiKeyCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(['CLIENT', 'ADMIN']).default('CLIENT'),
    scopes: z.array(z.string().max(100)).min(1).max(40),
    allowedIps: z
      .array(
        z
          .string()
          .trim()
          .max(100)
          .refine((v) => {
            try {
              normalizeCidr(v);
              return true;
            } catch {
              return false;
            }
          }, 'Use an IPv4/IPv6 address or CIDR range')
          .transform(normalizeCidr),
      )
      .max(20)
      .default([]),
    expiresInDays: z.number().int().min(1).max(365).default(90),
    ...credentials,
  })
  .strict();
function keyView(k: any, user?: any) {
  const invalid = user && apiKeyFingerprint(user) !== k.credentialFingerprint;
  return {
    id: k.id,
    userId: k.userId,
    name: k.name,
    kind: k.kind,
    prefix: k.prefix,
    scopes: k.scopes,
    allowedIps: k.allowedIps,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    lastUsedIp: k.lastUsedIp,
    status: k.revokedAt
      ? 'REVOKED'
      : invalid
        ? 'CREDENTIALS_CHANGED'
        : user?.suspendedAt
          ? 'SUSPENDED'
          : k.expiresAt <= new Date()
            ? 'EXPIRED'
            : 'ACTIVE',
  };
}
@Injectable()
export class ApiKeys {
  constructor(@Inject(Db) private db: Db) {}
  async authenticate(req: KeyRequest): Promise<Actor> {
    if (req.harborApiActor) return req.harborApiActor;
    const match = /^Bearer (hbr_([ca])_[a-f0-9]{64})$/.exec(req.get('authorization') || '');
    if (!match)
      throw new UnauthorizedException('Use Authorization: Bearer with a valid Harbor API key');
    const key = await this.db.apiKey.findUnique({
      where: { tokenHash: digest(match[1]) },
      include: { user: true },
    });
    if (
      !key ||
      key.revokedAt ||
      key.expiresAt <= new Date() ||
      key.kind !== (match[2] === 'a' ? 'ADMIN' : 'CLIENT')
    )
      throw new UnauthorizedException('API key is invalid, expired or revoked');
    if (
      !safeEqual(key.credentialFingerprint, apiKeyFingerprint(key.user)) ||
      (key.kind === 'ADMIN' && key.user.role !== 'ADMIN')
    ) {
      await this.db.apiKey.updateMany({
        where: { id: key.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'Account credentials changed. Create a new API key from your dashboard.',
      );
    }
    if (key.user.suspendedAt)
      throw new ForbiddenException('API access is suspended for this account');
    if (!apiIpAllowed(req.ip, key.allowedIps))
      throw new ForbiddenException('This API key does not allow your IP address');
    req.harborApiKey = { id: key.id, kind: key.kind as ApiKeyKind, scopes: key.scopes };
    req.harborActorId = key.userId;
    const scope = apiScope(key.kind as ApiKeyKind, req.method, req.path, req.body);
    if (!scope)
      throw new ForbiddenException(
        'This endpoint is unavailable to API keys. Use a dashboard session for account security, key management, extensions and browser-only actions.',
      );
    if (scope !== '@identity' && !key.scopes.includes(scope))
      throw new ForbiddenException(`This API key requires the ${scope} permission`);
    if (
      key.kind === 'CLIENT' &&
      scope === 'profile:write' &&
      req.body &&
      Object.hasOwn(req.body, 'autoPayWallet') &&
      !key.scopes.includes('invoices:pay')
    )
      throw new ForbiddenException(
        'Changing automatic wallet payment consent also requires invoices:pay',
      );
    const settings = await this.db.setting.findUnique({ where: { id: 'installation' } }),
      policy = accessPolicy(settings);
    if (key.kind === 'CLIENT' && policy.maintenanceEnabled)
      throw new ForbiddenException(policy.maintenanceMessage);
    if (key.kind === 'ADMIN' && policy.requireStaffTwoFactor && !key.user.totpEnabled)
      throw new ForbiddenException('The API key owner must enable staff two-factor authentication');
    const touched = await this.db.apiKey.updateMany({
      where: { id: key.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { lastUsedAt: new Date(), lastUsedIp: req.ip?.slice(0, 100) || null },
    });
    if (!touched.count) throw new UnauthorizedException('API key was revoked or expired');
    return (req.harborApiActor = {
      id: key.user.id,
      name: key.user.name,
      email: key.user.email,
      role: key.kind === 'ADMIN' ? 'ADMIN' : 'CUSTOMER',
      totpEnabled: key.user.totpEnabled,
      apiKeyId: key.id,
    });
  }
  options(actor: Actor) {
    return {
      baseUrl: `${appUrl()}/api/v1`,
      docsUrl: `${appUrl()}/api/docs`,
      kinds: actor.role === 'ADMIN' ? ['CLIENT', 'ADMIN'] : ['CLIENT'],
      clientScopes: apiScopeCatalog('CLIENT'),
      adminScopes: actor.role === 'ADMIN' ? apiScopeCatalog('ADMIN') : [],
      clientRoutes: apiRouteCatalog('CLIENT'),
      adminRoutes: actor.role === 'ADMIN' ? apiRouteCatalog('ADMIN') : [],
      limits: { activeKeys: 20, requestsPerMinute: 120, maximumExpiryDays: 365 },
    };
  }
  async list(actor: Actor) {
    const owner = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    const now = new Date();
    const [active, history] = await Promise.all([
      this.db.apiKey.findMany({
        where: { userId: actor.id, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.apiKey.findMany({
        where: {
          userId: actor.id,
          OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return [...active, ...history].map((k) => keyView(k, owner));
  }
  async reauthenticate(user: any, password: string, totp?: string) {
    if (!(await verifyPassword(password, user.passwordHash)))
      throw new UnauthorizedException('Confirm your current password');
    if (user.suspendedAt) throw new ForbiddenException('Your account is suspended');
    if (
      user.totpEnabled &&
      (!totp || !user.totpSecret || !authenticator.check(totp, decrypt<string>(user.totpSecret)))
    )
      throw new UnauthorizedException('A valid authenticator code is required');
  }
  async create(actor: Actor, input: unknown) {
    const d = apiKeyCreateSchema.parse(input),
      owner = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (d.kind === 'ADMIN' && owner.role !== 'ADMIN')
      throw new ForbiddenException('Only administrators can create admin API keys');
    const permitted = Object.keys(d.kind === 'ADMIN' ? adminScopes : clientScopes);
    if (d.scopes.some((s) => !permitted.includes(s)))
      throw new ForbiddenException('Select permissions belonging to this API key type');
    await this.reauthenticate(owner, d.password, d.totp);
    return this.issue(owner, {
      ...d,
      scopes: [...new Set(d.scopes)],
      allowedIps: [...new Set(d.allowedIps)],
    });
  }
  private async issue(
    owner: any,
    d: {
      name: string;
      kind: ApiKeyKind;
      scopes: string[];
      allowedIps: string[];
      expiresInDays: number;
    },
    rotatingId?: string,
  ) {
    const raw = `hbr_${d.kind === 'ADMIN' ? 'a' : 'c'}_${token()}`,
      now = new Date();
    const key = await serial(this.db, async (tx) => {
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: owner.id } });
      if (fresh.suspendedAt || apiKeyFingerprint(fresh) !== apiKeyFingerprint(owner))
        throw new ConflictException('Account credentials changed. Confirm them again.');
      if (d.kind === 'ADMIN' && fresh.role !== 'ADMIN')
        throw new ForbiddenException('Administrator access required');
      if (
        (await tx.apiKey.count({
          where: {
            userId: owner.id,
            revokedAt: null,
            expiresAt: { gt: now },
            ...(rotatingId ? { id: { not: rotatingId } } : {}),
          },
        })) >= 20
      )
        throw new ConflictException(
          'Revoke an existing key before creating another (20 active keys maximum)',
        );
      if (rotatingId) {
        const revoked = await tx.apiKey.updateMany({
          where: { id: rotatingId, userId: owner.id, revokedAt: null },
          data: { revokedAt: now },
        });
        if (!revoked.count)
          throw new ConflictException('This API key was already revoked or rotated');
      }
      const created = await tx.apiKey.create({
        data: {
          userId: owner.id,
          name: d.name,
          kind: d.kind,
          scopes: d.scopes,
          allowedIps: d.allowedIps,
          tokenHash: digest(raw),
          prefix: raw.slice(0, 14),
          credentialFingerprint: apiKeyFingerprint(owner),
          expiresAt: new Date(now.getTime() + d.expiresInDays * 86400000),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: owner.id,
          action: rotatingId ? 'api-key.rotated' : 'api-key.created',
          targetId: created.id,
          details: {
            kind: d.kind,
            scopes: d.scopes,
            ...(rotatingId ? { previousKeyId: rotatingId } : {}),
          },
        },
      });
      return created;
    });
    return { ...keyView(key), token: raw };
  }
  async rotate(actor: Actor, id: string, input: unknown) {
    const d = z
      .object({ ...credentials, expiresInDays: z.number().int().min(1).max(365).default(90) })
      .strict()
      .parse(input);
    const old = await this.db.apiKey.findFirst({ where: { id, userId: actor.id } });
    if (!old) throw new NotFoundException('API key not found');
    if (old.revokedAt)
      throw new ConflictException('Create a new API key instead of rotating a revoked key');
    const owner = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    await this.reauthenticate(owner, d.password, d.totp);
    return this.issue(
      owner,
      {
        name: old.name,
        kind: old.kind as ApiKeyKind,
        scopes: old.scopes,
        allowedIps: old.allowedIps,
        expiresInDays: d.expiresInDays,
      },
      id,
    );
  }
  async revoke(actor: Actor, id: string, administrator = false, input: unknown = {}) {
    const reason = administrator
      ? z
          .object({ reason: z.string().trim().min(3).max(1000) })
          .strict()
          .parse(input).reason
      : undefined;
    return serial(this.db, async (tx) => {
      const key = await tx.apiKey.findFirst({
        where: { id, ...(administrator ? {} : { userId: actor.id }) },
      });
      if (!key) throw new NotFoundException('API key not found');
      if (!key.revokedAt) {
        await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: administrator ? 'api-key.staff-revoked' : 'api-key.revoked',
            targetId: id,
            details: { ownerId: key.userId, ...(reason ? { reason } : {}) },
          },
        });
      }
      return { revoked: true };
    });
  }
  async all(input: unknown) {
    const q = z
      .object({
        search: z.string().trim().max(200).default(''),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        status: z.enum(['all', 'active', 'revoked', 'expired']).default('all'),
      })
      .parse(input);
    const where: any = {
      ...(q.status === 'revoked'
        ? { revokedAt: { not: null } }
        : q.status === 'active'
          ? { revokedAt: null, expiresAt: { gt: new Date() } }
          : q.status === 'expired'
            ? { revokedAt: null, expiresAt: { lte: new Date() } }
            : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { user: { email: { contains: q.search, mode: 'insensitive' } } },
              { user: { name: { contains: q.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, keys] = await Promise.all([
      this.db.apiKey.count({ where }),
      this.db.apiKey.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * 50,
        take: 50,
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: 50,
      items: keys.map((k) => ({
        ...keyView(k, k.user),
        owner: { id: k.user.id, name: k.user.name, email: k.user.email, role: k.user.role },
      })),
    };
  }
}
