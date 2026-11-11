import { symlink as createModuleLink } from 'node:fs/promises';
import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { join, resolve, relative } from 'node:path';
import { mkdir, readFile, rm, rename, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import * as tar from 'tar';
import semver from 'semver';
import {
  validateManifest,
  type ExtensionManifest,
  type HostingProvider,
  type PaymentGateway,
  type HarborPlugin,
  type ExtensionContext,
  type HarborTheme,
} from '@harbor/sdk';
import { Db, json } from './db';
import { encrypt, decrypt } from './security';
import { DemoGameProvider } from './providers/demo-game';
import { WingsProvider } from './providers/wings';
import { ProxmoxProvider } from './providers/proxmox';
import { PleskProvider } from './providers/plesk';
import { NativeWebProvider } from './providers/native-web';
import { StripeGateway, PayPalGateway } from './gateways';
const requireExtension = createRequire(__filename);
const builtins = [
  [
    'demo-game',
    'Demo game hosting',
    'Checkout simulator only. No real server or charge.',
    'services:write',
  ],
  ['wings', 'Pterodactyl Wings', 'Minecraft and game server management', 'services:write'],
  ['proxmox', 'Proxmox VE', 'Linux virtual machines through Proxmox', 'services:write'],
  ['plesk', 'Plesk Obsidian', 'Web hosting subscriptions and service plans', 'services:write'],
  ['native-web', 'Harbor Web', 'Native Linux web hosting agent', 'services:write'],
  ['stripe', 'Stripe', 'Card payments using Stripe Checkout', 'billing:write'],
  ['paypal', 'PayPal', 'PayPal Checkout payments', 'billing:write'],
  ['manual', 'Manual payments', 'Administrator-confirmed offline payments', 'billing:write'],
  ['harbor-default', 'Harbor', 'The default premium theme for every area', 'pages:register'],
] as const;
@Injectable()
export class Extensions implements OnModuleInit {
  private logger = new Logger('Extensions');
  private providers = new Map<string, HostingProvider>();
  private gateways = new Map<string, PaymentGateway>();
  private listeners = new Map<string, Array<(data: Record<string, unknown>) => Promise<void>>>();
  private activated = new Map<string, string>();
  routes: Array<{
    extensionId: string;
    method: string;
    path: string;
    admin: boolean;
    handler: (request: any) => Promise<unknown>;
  }> = [];
  pages: Array<{ id: string; area: string; label: string; path: string; extensionId: string }> = [];
  directory = resolve(process.env.EXTENSIONS_DIR || join(process.cwd(), 'extensions'));
  constructor(@Inject(Db) private db: Db) {}
  async onModuleInit() {
    await mkdir(this.directory, { recursive: true });
    await createModuleLink(
      resolve(__dirname, '../../../node_modules'),
      join(this.directory, 'node_modules'),
      'dir',
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    for (const [id, name, description, permission] of builtins) {
      const manifest = {
        id,
        name,
        version: '0.1.0',
        sdkVersion: '^1.0.0',
        type: id === 'harbor-default' ? 'theme' : 'plugin',
        description,
        permissions: [permission],
        dependencies: {},
        ...(id === 'harbor-default' ? { areas: ['admin', 'customer', 'storefront'] } : {}),
      };
      await this.db.extension.upsert({
        where: { id },
        create: { id, manifest: json(manifest), builtin: true, enabled: true },
        update: { manifest: json(manifest) },
      });
    }
    [
      new WingsProvider(),
      new DemoGameProvider(),
      new ProxmoxProvider(),
      new PleskProvider(),
      new NativeWebProvider(),
    ].forEach((p) => this.providers.set(p.id, p));
    [new StripeGateway(), new PayPalGateway()].forEach((p) => this.gateways.set(p.id, p));
    for (const e of await this.db.extension.findMany({
      where: { enabled: true, builtin: false },
    })) {
      const manifest = validateManifest(e.manifest);
      if (manifest.type === 'theme' && e.directory) this.activated.set(e.id, e.directory);
      if (manifest.type === 'plugin' && e.directory && manifest.entry) {
        try {
          const entry = await this.safeEntry(e.directory, manifest.entry);
          const module = requireExtension(entry);
          const plugin: HarborPlugin = module.default || module;
          const context: ExtensionContext = {
            registerRoute: (r) => {
              if (!/^\/[a-z0-9-]+$/.test(r.path))
                throw new Error('Use a single namespaced route segment');
              this.routes.push({ ...r, extensionId: e.id });
            },
            registerProvider: (p) => {
              if (p.id !== e.id) throw new Error('Provider ID must match extension ID');
              this.providers.set(p.id, p);
            },
            registerGateway: (g) => {
              if (g.id !== e.id) throw new Error('Gateway ID must match extension ID');
              this.gateways.set(g.id, g);
            },
            registerPage: (p) => {
              if (!p.path.startsWith(`/extensions/${e.id}/`))
                throw new Error('Extension pages must use their namespace');
              this.pages.push({ ...p, extensionId: e.id });
            },
            on: (event, listener) => {
              const list = this.listeners.get(event) || [];
              list.push(async (payload) => {
                if ((await this.db.extension.findUnique({ where: { id: e.id } }))?.enabled)
                  await listener(payload);
              });
              this.listeners.set(event, list);
            },
            log: (message) => this.logger.log(`[${e.id}] ${message}`),
          };
          await plugin.activate(context);
          this.activated.set(e.id, e.directory);
          await this.db.extension.update({ where: { id: e.id }, data: { lastError: null } });
        } catch {
          await this.db.extension.update({
            where: { id: e.id },
            data: { lastError: 'Activation failed; inspect server logs and compatibility' },
          });
          this.logger.error(`Failed to activate ${e.id}`);
        }
      }
    }
  }
  private async safeEntry(directory: string, entry: string) {
    const root = await realpath(directory);
    const path = await realpath(join(root, entry));
    if (relative(root, path).startsWith('..'))
      throw new Error('Extension entry escapes its directory');
    return path;
  }
  async provider(id: string) {
    const extension = await this.db.extension.findUnique({ where: { id } });
    if (!extension?.enabled || extension.lastError)
      throw new ConflictException(`The ${id} provider is disabled`);
    const provider = this.providers.get(id);
    if (!provider)
      throw new ConflictException('Provider requires a backend and worker restart to activate');
    return provider;
  }
  async gateway(id: string) {
    const extension = await this.db.extension.findUnique({ where: { id } });
    if (!extension?.enabled || extension.lastError)
      throw new ConflictException('Payment gateway is disabled');
    const gateway = this.gateways.get(id);
    if (!gateway) throw new ConflictException('Payment gateway requires a restart');
    return gateway;
  }
  async configuration(id: string) {
    const e = await this.db.extension.findUnique({ where: { id } });
    return e?.config ? decrypt<Record<string, string>>(e.config) : {};
  }
  async list() {
    return (await this.db.extension.findMany({ orderBy: { createdAt: 'asc' } })).map((e) => ({
      id: e.id,
      ...(e.manifest as object),
      builtin: e.builtin,
      enabled: e.enabled,
      configured: !!e.config,
      lastError: e.lastError,
      restartRequired: !e.builtin && e.enabled && this.activated.get(e.id) !== e.directory,
      status: e.enabled ? 'enabled' : 'disabled',
    }));
  }
  async configure(id: string, secret: Record<string, string>) {
    await this.db.extension.update({ where: { id }, data: { config: encrypt(secret) } });
    return { configured: true };
  }
  async toggle(id: string, enabled: boolean) {
    const e = await this.db.extension.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Extension not found');
    if (id === 'harbor-default' && !enabled)
      throw new ConflictException('The fallback theme must remain enabled');
    if (!enabled) {
      if (await this.db.service.count({ where: { provider: id, status: { not: 'TERMINATED' } } }))
        throw new ConflictException('This provider has existing services');
      if (
        await this.db.checkout.count({
          where: {
            gateway: id,
            invoiceId: {
              in: (
                await this.db.invoice.findMany({
                  where: { status: 'UNPAID' },
                  select: { id: true },
                })
              ).map((x) => x.id),
            },
          },
        })
      )
        throw new ConflictException('This gateway has unsettled payments');
      const dependents = await this.db.extension.findMany({ where: { enabled: true } });
      if (dependents.some((x) => !!(x.manifest as any).dependencies?.[id]))
        throw new ConflictException('Another enabled extension depends on this extension');
      const settings = await this.db.setting.findUnique({ where: { id: 'installation' } });
      if (Object.values((settings?.themes as object) || {}).includes(id))
        throw new ConflictException('Choose a different theme before disabling this one');
    } else {
      const manifest = validateManifest(e.manifest);
      await this.checkDependencies(manifest);
    }
    await this.db.extension.update({ where: { id }, data: { enabled } });
    return {
      enabled,
      restartRequired: !e.builtin,
      message: !e.builtin
        ? 'Restart the API, worker, and frontend after changing custom extensions.'
        : 'Extension updated',
    };
  }
  async checkDependencies(manifest: ExtensionManifest) {
    for (const [id, range] of Object.entries(manifest.dependencies)) {
      const e = await this.db.extension.findUnique({ where: { id } });
      if (!e?.enabled || !semver.satisfies((e.manifest as any).version, range))
        throw new BadRequestException(`Missing compatible enabled dependency: ${id} ${range}`);
    }
  }
  async install(buffer: Buffer) {
    if (buffer.length > 10 * 1024 * 1024)
      throw new BadRequestException('Extension packages must be smaller than 10 MiB');
    try {
      gunzipSync(buffer, { maxOutputLength: 50 * 1024 * 1024 });
    } catch {
      throw new BadRequestException('Invalid gzip package or expanded package exceeds 50 MiB');
    }
    await mkdir(this.directory, { recursive: true });
    const stage = join(this.directory, `.stage-${randomUUID()}`);
    await mkdir(stage);
    const archive = join(stage, 'upload.tgz');
    await writeFile(archive, buffer, { mode: 0o600 });
    try {
      let bytes = 0;
      let files = 0;
      let invalid: string | undefined;
      await tar.t({
        file: archive,
        onReadEntry: (entry) => {
          bytes += entry.size;
          files++;
          if (bytes > 50 * 1024 * 1024 || files > 1000)
            invalid = 'Extension package exceeds extraction limits';
          if (!['File', 'Directory', 'OldFile'].includes(entry.type))
            invalid = 'Links and special files are prohibited';
          if (
            entry.path.startsWith('/') ||
            entry.path.includes('\\') ||
            entry.path.split('/').includes('..')
          )
            invalid = 'Unsafe package path';
        },
      });
      if (invalid) throw new BadRequestException(invalid);
      const unpack = join(stage, 'package');
      await mkdir(unpack);
      await tar.x({
        file: archive,
        cwd: unpack,
        strict: true,
        noChmod: true,
        preserveOwner: false,
      });
      const manifest = validateManifest(
        JSON.parse(await readFile(join(unpack, 'harbor.json'), 'utf8')),
      );
      await this.checkDependencies(manifest);
      const existing = await this.db.extension.findUnique({ where: { id: manifest.id } });
      if (existing?.builtin)
        throw new BadRequestException('Built-in extensions cannot be replaced');
      if (existing && !semver.gt(manifest.version, (existing.manifest as any).version))
        throw new ConflictException('Updates must have a higher semantic version');
      if (manifest.type === 'plugin') {
        if (!manifest.entry)
          throw new BadRequestException('Plugins require a bundled JavaScript entry');
        await this.safeEntry(unpack, manifest.entry);
      }
      if (manifest.frontendEntry) await this.safeEntry(unpack, manifest.frontendEntry);
      if (manifest.type === 'theme') {
        const theme = JSON.parse(await readFile(join(unpack, 'theme.json'), 'utf8'));
        validateTheme(theme);
      }
      const target = join(
        this.directory,
        `${manifest.id}-${manifest.version}-${randomUUID().slice(0, 8)}`,
      );
      await rename(unpack, target);
      if (existing?.directory)
        await writeFile(
          join(target, 'previous-release.json'),
          JSON.stringify({ directory: existing.directory, manifest: existing.manifest }),
          { mode: 0o600 },
        );
      await this.db.extension.upsert({
        where: { id: manifest.id },
        create: { id: manifest.id, manifest: json(manifest), directory: target },
        update: { manifest: json(manifest), directory: target, lastError: null },
      });
      return {
        id: manifest.id,
        version: manifest.version,
        enabled: existing?.enabled || false,
        message: existing
          ? 'Update staged. Build the frontend and restart API and worker. Previous release files are retained for rollback.'
          : 'Package validated and installed. Enable it to activate; custom code requires a restart.',
      };
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  async rollback(id: string) {
    const e = await this.db.extension.findUnique({ where: { id } });
    if (!e?.directory || e.builtin) throw new BadRequestException('No custom release to roll back');
    const previous = JSON.parse(await readFile(join(e.directory, 'previous-release.json'), 'utf8'));
    validateManifest(previous.manifest);
    const root = await realpath(this.directory);
    const target = await realpath(previous.directory);
    if (relative(root, target).startsWith('..'))
      throw new BadRequestException('Invalid rollback directory');
    await this.db.extension.update({
      where: { id },
      data: { directory: target, manifest: json(previous.manifest), lastError: null },
    });
    return {
      restartRequired: true,
      message: 'Previous release restored. Build the frontend and restart API and worker.',
    };
  }
  async themes(selection: unknown) {
    const result: Record<string, unknown> = {};
    for (const area of ['admin', 'customer', 'storefront']) {
      const id = (selection as any)?.[area] || 'harbor-default';
      if (id === 'harbor-default') {
        result[area] = { id, name: 'Harbor', tokens: { light: {}, dark: {} } };
        continue;
      }
      const e = await this.db.extension.findUnique({ where: { id } });
      if (
        !e?.enabled ||
        (e.manifest as any).type !== 'theme' ||
        !(e.manifest as any).areas?.includes(area)
      )
        throw new BadRequestException(`Theme ${id} is unavailable for ${area}`);
      const theme = JSON.parse(await readFile(join(e.directory!, 'theme.json'), 'utf8'));
      validateTheme(theme);
      result[area] = {
        id,
        name: (e.manifest as any).name,
        tokens: theme.tokens,
        layout: theme.areas?.[area],
      };
    }
    return result;
  }
  async emit(event: string, payload: Record<string, unknown>) {
    for (const listener of this.listeners.get(event) || [])
      try {
        await listener(payload);
      } catch {
        this.logger.error(`Extension listener failed for ${event}`);
      }
  }
}
export function validateTheme(theme: HarborTheme) {
  for (const mode of ['light', 'dark'] as const)
    for (const [key, value] of Object.entries(theme.tokens?.[mode] || {})) {
      if (
        !/^--[a-z0-9-]{1,48}$/.test(key) ||
        typeof value !== 'string' ||
        !/^[-#a-zA-Z0-9%.,()\s/]{1,96}$/.test(value)
      )
        throw new BadRequestException('Theme contains an unsafe design token');
    }
}
