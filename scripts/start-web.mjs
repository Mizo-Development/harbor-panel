import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const releases = process.env.FRONTEND_RELEASES_DIR || '/data/frontend';
let entry = join(root, 'apps/web/.next/standalone/apps/web/server.js');
try {
  const active = JSON.parse(await readFile(join(releases, 'current.json'), 'utf8'));
  if (!/^[a-f0-9-]{36}$/.test(active.releaseId)) throw new Error('Invalid frontend release ID');
  const currentHash = createHash('sha256')
    .update(await readFile(join(root, 'package-lock.json')))
    .digest('hex');
  if (active.buildHash === currentHash)
    entry = join(releases, 'releases', active.releaseId, 'apps/web/server.js');
  else
    console.warn('Using bundled frontend: rebuild custom extensions for this application version.');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const child = spawn(process.execPath, [entry], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code || 0));
