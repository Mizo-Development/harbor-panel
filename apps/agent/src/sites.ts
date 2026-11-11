import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  readFile,
  writeFile,
  chmod,
  readdir,
  rm,
  access,
  rename,
  lstat,
} from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hostnameSchema } from '@harbor/sdk';
import * as tar from 'tar';
const exec = promisify(execFile);
export const siteSchema = z.object({
  domain: hostnameSchema,
  memoryMb: z.number().int().min(128).max(65536),
  diskMb: z.number().int().min(256).max(104857600),
});
type Site = z.infer<typeof siteSchema> & {
  id: string;
  username: string;
  createdAt: string;
  suspended: boolean;
  database?: { name: string; username: string; password: string };
};
const stateRoot = process.env.AGENT_STATE_DIR || '/var/lib/harbor-web';
const sitesRoot = process.env.AGENT_SITES_DIR || '/srv/harbor/sites';
const phpVersion = process.env.PHP_VERSION || '8.3';
export function siteId(id: string) {
  return z.string().uuid().parse(id);
}
export function unixUser(id: string) {
  return `h${siteId(id).replaceAll('-', '').slice(0, 20)}`;
}
async function command(file: string, args: string[], timeout = 30000) {
  return exec(file, args, {
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' },
  });
}
async function streamCommand(file: string, args: string[], output: string) {
  const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
  try {
    await Promise.all([
      pipeline(child.stdout, createWriteStream(output, { mode: 0o600 })),
      new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error('Backup command failed')),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function restoreDatabase(file: string, name: string) {
  const child = spawn('mariadb', [name], { stdio: ['pipe', 'ignore', 'pipe'] });
  const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
  try {
    await Promise.all([
      pipeline(createReadStream(file), child.stdin),
      new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error('Database restore failed')),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function load(id: string): Promise<Site> {
  return JSON.parse(await readFile(join(stateRoot, 'sites', `${siteId(id)}.json`), 'utf8'));
}
async function save(site: Site) {
  await mkdir(join(stateRoot, 'sites'), { recursive: true, mode: 0o700 });
  const p = join(stateRoot, 'sites', `${site.id}.json`);
  await writeFile(`${p}.tmp`, JSON.stringify(site), { mode: 0o600 });
  await rename(`${p}.tmp`, p);
}
function conf(site: Site, tls = false) {
  const root = join(sitesRoot, site.id, 'httpdocs');
  return `server {\n listen 80;\n ${tls ? `listen 443 ssl;\n ssl_certificate /etc/letsencrypt/live/${site.domain}/fullchain.pem;\n ssl_certificate_key /etc/letsencrypt/live/${site.domain}/privkey.pem;` : ''}\n server_name ${site.domain};\n root ${root};\n index index.php index.html;\n client_max_body_size 32m;\n access_log /var/log/nginx/harbor-${site.id}.access.log;\n error_log /var/log/nginx/harbor-${site.id}.error.log;\n ${site.suspended ? 'return 503;' : ''}\n location / { try_files $uri $uri/ =404; }\n location ~ \\.php$ { try_files $uri =404; include fastcgi_params; fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name; fastcgi_pass unix:/run/php/harbor-${site.id}.sock; }\n location ~ /\\.(?!well-known) { deny all; }\n}\n`;
}
async function nginx(site: Site) {
  const path = `/etc/nginx/conf.d/harbor-${site.id}.conf`;
  let old: string | undefined;
  try {
    old = await readFile(path, 'utf8');
  } catch {}
  let tls = false;
  try {
    await access(`/etc/letsencrypt/live/${site.domain}/fullchain.pem`);
    await access(`/etc/letsencrypt/live/${site.domain}/privkey.pem`);
    tls = true;
  } catch {}
  await writeFile(path, conf(site, tls));
  try {
    await command('nginx', ['-t']);
    await command('systemctl', ['reload', 'nginx']);
  } catch (error) {
    if (old !== undefined) await writeFile(path, old);
    else await rm(path, { force: true });
    throw error;
  }
}
export async function health() {
  for (const cmd of ['nginx', 'php-fpm' + phpVersion, 'mariadb', 'setquota', 'certbot'])
    await command('which', [cmd]);
  const result = await command('findmnt', ['-no', 'OPTIONS', '--target', sitesRoot]);
  const quota = /\b(usrquota|uquota)\b/.test(result.stdout);
  return {
    status: quota ? 'ready' : 'prerequisites-required',
    phpVersion,
    userQuotas: quota,
    ready: quota,
  };
}
export async function provision(id: string, input: unknown) {
  siteId(id);
  const data = siteSchema.parse(input);
  await mkdir(sitesRoot, { recursive: true, mode: 0o755 });
  try {
    const existing = await load(id);
    if (existing.domain !== data.domain) throw new Error('Service identity mismatch');
    return { id, domain: existing.domain, username: existing.username };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const name of await readdir(join(stateRoot, 'sites')).catch(() => [])) {
    const site: Site = JSON.parse(await readFile(join(stateRoot, 'sites', name), 'utf8'));
    if (site.domain === data.domain) throw new Error('Domain already exists on this node');
  }
  const checks = await health();
  if (!checks.ready)
    throw new Error('Enable filesystem user quotas on the website volume before provisioning');
  const username = unixUser(id);
  const home = join(sitesRoot, id);
  try {
    await command('id', [username]);
  } catch {
    await command('useradd', [
      '--no-log-init',
      '--user-group',
      '--home-dir',
      home,
      '--shell',
      '/usr/sbin/nologin',
      username,
    ]);
  }
  await mkdir(join(home, 'httpdocs'), { recursive: true, mode: 0o750 });
  await command('chown', ['-R', `${username}:www-data`, home]);
  await chmod(home, 0o750);
  const filesystem = (await command('findmnt', ['-no', 'TARGET', '--target', home])).stdout.trim();
  await command('setquota', [
    '-u',
    username,
    String(data.diskMb * 1024),
    String(data.diskMb * 1024),
    '0',
    '0',
    filesystem,
  ]);
  const pool = `[harbor-${id}]\nuser=${username}\ngroup=${username}\nlisten=/run/php/harbor-${id}.sock\nlisten.owner=www-data\nlisten.group=www-data\npm=ondemand\npm.max_children=${Math.max(1, Math.min(10, Math.floor(data.memoryMb / 128)))}\npm.process_idle_timeout=10s\nphp_admin_value[memory_limit]=128M\nphp_admin_value[open_basedir]=${home}:/usr/share/php\nphp_admin_value[upload_tmp_dir]=${home}/tmp\nphp_admin_value[session.save_path]=${home}/tmp\nphp_admin_value[disable_functions]=exec,passthru,shell_exec,system,proc_open,popen\n`;
  await mkdir(join(home, 'tmp'), { mode: 0o700, recursive: true });
  await command('chown', [`${username}:${username}`, join(home, 'tmp')]);
  await writeFile(`/etc/php/${phpVersion}/fpm/pool.d/harbor-${id}.conf`, pool);
  await command(`php-fpm${phpVersion}`, ['-t']);
  await command('systemctl', ['reload', `php${phpVersion}-fpm`]);
  const site: Site = {
    ...data,
    id,
    username,
    createdAt: new Date().toISOString(),
    suspended: false,
  };
  await nginx(site);
  await save(site);
  return { id, domain: site.domain, username, phpVersion };
}
export async function backups(id: string) {
  await load(id);
  const directory = join(stateRoot, 'backups', siteId(id));
  const result = [];
  for (const file of await readdir(directory).catch(() => [])) {
    if (!/^[a-f0-9-]{36}\.tgz$/.test(file)) continue;
    const info = await lstat(join(directory, file));
    if (info.isFile())
      result.push({
        id: file.slice(0, -4),
        size: info.size,
        createdAt: info.mtime.toISOString(),
        completed: true,
      });
  }
  return result;
}
export async function inspect(id: string) {
  const s = await load(id);
  const disk = await command('du', ['-sb', join(sitesRoot, id)]);
  return {
    id,
    domain: s.domain,
    status: s.suspended ? 'suspended' : 'active',
    diskUsed: Number(disk.stdout.split(/\s/)[0]),
    diskLimit: s.diskMb * 1048576,
    phpVersion,
    database: s.database ? { name: s.database.name, username: s.database.username } : null,
  };
}
export async function files(id: string, operation: string, path: string, content = '') {
  const site = await load(id);
  if (site.suspended) throw new Error('Website is suspended');
  const helper = join(__dirname, 'file-worker.js');
  return new Promise<any>((resolve, reject) => {
    const child = spawn(
      'runuser',
      [
        '-u',
        site.username,
        '--',
        process.execPath,
        helper,
        join(sitesRoot, id, 'httpdocs'),
        operation,
        path,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '',
      err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('File operation timed out'));
    }, 10000);
    child.stdout.on('data', (b) => {
      out += b;
      if (out.length > 2 * 1048576) child.kill();
    });
    child.stderr.on('data', (b) => (err += b));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(err || 'File operation failed'));
      else
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error('Invalid file operation result'));
        }
    });
    child.stdin.end(content);
  });
}
export async function database(id: string) {
  const site = await load(id);
  if (site.suspended) throw new Error('Website is suspended');
  const name = unixUser(id);
  const password = randomBytes(24).toString('hex');
  await command('mariadb', [
    '--execute',
    `CREATE DATABASE IF NOT EXISTS \`${name}\`; CREATE USER IF NOT EXISTS '${name}'@'localhost' IDENTIFIED BY '${password}'; ALTER USER '${name}'@'localhost' IDENTIFIED BY '${password}'; GRANT ALL ON \`${name}\`.* TO '${name}'@'localhost';`,
  ]);
  site.database = { name, username: name, password };
  await save(site);
  return { host: 'localhost', name, username: name, password };
}
export async function certificate(id: string, email: string) {
  const site = await load(id);
  z.email().parse(email);
  if (site.suspended) throw new Error('Website is suspended');
  await command(
    'certbot',
    [
      'certonly',
      '--webroot',
      '--webroot-path',
      join(sitesRoot, id, 'httpdocs'),
      '--non-interactive',
      '--agree-tos',
      '--email',
      email,
      '-d',
      site.domain,
    ],
    180000,
  );
  await nginx(site);
  return { issued: true };
}
export async function action(id: string, action: string, input: Record<string, unknown>) {
  const site = await load(id);
  if (action === 'suspend' || action === 'unsuspend') {
    site.suspended = action === 'suspend';
    await nginx(site);
    await save(site);
    return { completed: true };
  }
  const backupDir = join(stateRoot, 'backups', id);
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  if (action === 'backup') {
    const backupId = randomUUID();
    const backup = join(backupDir, `${backupId}.tgz`);
    const temp = join(backupDir, backupId);
    await mkdir(temp, { mode: 0o700 });
    try {
      // Archive the website as its unprivileged account; no dereferencing of symlinks.
      await command(
        'runuser',
        [
          '-u',
          site.username,
          '--',
          'tar',
          '-czf',
          join(sitesRoot, id, 'site-backup.tgz'),
          '-C',
          join(sitesRoot, id),
          'httpdocs',
        ],
        180000,
      );
      await rename(join(sitesRoot, id, 'site-backup.tgz'), join(temp, 'website.tgz'));
      if (!(await lstat(join(temp, 'website.tgz'))).isFile())
        throw new Error('Website backup must be a regular file');
      if (site.database) {
        await streamCommand(
          'mariadb-dump',
          ['--single-transaction', site.database.name],
          join(temp, 'database.sql'),
        );
      }
      await tar.c({ file: backup, gzip: true, cwd: temp }, await readdir(temp));
      await chmod(backup, 0o600);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
    return { backupId };
  }
  if (action === 'restore') {
    const backupId = z.string().uuid().parse(input.backupId);
    const archive = join(backupDir, `${backupId}.tgz`);
    await access(archive);
    const stage = join(backupDir, `restore-${randomUUID()}`);
    await mkdir(stage, { mode: 0o700 });
    try {
      let invalidOuter = false;
      await tar.t({
        file: archive,
        onReadEntry: (e) => {
          if (e.type !== 'File' || !['website.tgz', 'database.sql'].includes(e.path))
            invalidOuter = true;
        },
      });
      if (invalidOuter) throw new Error('Invalid backup archive');
      await tar.x({ file: archive, cwd: stage, strict: true });
      let unsafe = false;
      await tar.t({
        file: join(stage, 'website.tgz'),
        onReadEntry: (e) => {
          if (
            !['File', 'Directory'].includes(e.type) ||
            e.path.startsWith('/') ||
            e.path.split('/').includes('..') ||
            !e.path.startsWith('httpdocs')
          )
            unsafe = true;
        },
      });
      if (unsafe) throw new Error('Backup contains unsupported links or paths');
      // Extract as the tenant so an archive cannot change privileged host files.
      await command('chown', [
        `${site.username}:${site.username}`,
        stage,
        join(stage, 'website.tgz'),
      ]);
      await chmod(backupDir, 0o711);
      await chmod(join(stateRoot, 'backups'), 0o711);
      await chmod(stateRoot, 0o711);
      await command(
        'runuser',
        [
          '-u',
          site.username,
          '--',
          'tar',
          '--no-same-owner',
          '--no-same-permissions',
          '-xzf',
          join(stage, 'website.tgz'),
          '-C',
          join(sitesRoot, id),
        ],
        180000,
      );
      // Database restoration is deliberately separate from file extraction and uses the site's fixed database.
      if (site.database) {
        try {
          await access(join(stage, 'database.sql'));
          await restoreDatabase(join(stage, 'database.sql'), site.database.name);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
    return { restored: true };
  }
  if (action === 'terminate') {
    await rm(`/etc/nginx/conf.d/harbor-${id}.conf`, { force: true });
    await rm(`/etc/php/${phpVersion}/fpm/pool.d/harbor-${id}.conf`, { force: true });
    await command('nginx', ['-t']);
    await command('systemctl', ['reload', 'nginx']);
    await command('systemctl', ['reload', `php${phpVersion}-fpm`]);
    await command('userdel', [site.username]);
    if (site.database)
      await command('mariadb', [
        '--execute',
        `DROP DATABASE IF EXISTS \`${site.database.name}\`; DROP USER IF EXISTS '${site.database.username}'@'localhost';`,
      ]);
    await rm(join(sitesRoot, id), { recursive: true, force: true });
    await rm(join(stateRoot, 'sites', `${id}.json`));
    return { terminated: true };
  }
  throw new Error('Unsupported web hosting operation');
}
