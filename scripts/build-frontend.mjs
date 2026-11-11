import { cp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const destination = process.env.FRONTEND_RELEASES_DIR || '/data/frontend';
const id = randomUUID();
const stage = join(destination, `.build-${id}`);
await mkdir(stage, { recursive: true });
async function run(command, args, env = {}) {
  await new Promise((ok, fail) => {
    const child = spawn(command, args, {
      cwd: stage,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? ok() : fail(new Error(`Build failed (${code}); active frontend unchanged`)),
    );
  });
}
try {
  await mkdir(join(stage, 'apps'), { recursive: true });
  await cp(join(root, 'apps/web'), join(stage, 'apps/web'), {
    recursive: true,
    filter: (path) =>
      !path.split('/').some((p) => ['node_modules', '.next'].includes(p)) &&
      !path.endsWith('.tsbuildinfo'),
  });
  await cp(join(root, 'packages'), join(stage, 'packages'), { recursive: true });
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.base.json'])
    await cp(join(root, file), join(stage, file));
  await symlink(join(root, 'node_modules'), join(stage, 'node_modules'), 'dir');
  await run(
    process.execPath,
    [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'scripts/generate-extensions.ts')],
    { HARBOR_SOURCE_DIR: stage },
  );
  await run(
    process.execPath,
    [join(root, 'node_modules/next/dist/bin/next'), 'build', 'apps/web', '--webpack'],
    { NODE_ENV: 'production' },
  );
  const release = join(destination, 'releases', id);
  await mkdir(resolve(release, '..'), { recursive: true });
  await cp(join(stage, 'apps/web/.next/standalone'), release, { recursive: true });
  await cp(join(stage, 'apps/web/.next/static'), join(release, 'apps/web/.next/static'), {
    recursive: true,
  });
  try {
    await rename(join(release, 'node_modules'), join(release, '.traced-node_modules'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await symlink(join(root, 'node_modules'), join(release, 'node_modules'), 'dir');
  const buildHash = createHash('sha256')
    .update(await readFile(join(root, 'package-lock.json')))
    .digest('hex');
  const previous = await readFile(join(destination, 'current.json'), 'utf8').catch(() => null);
  if (previous) await writeFile(join(destination, 'previous.json'), previous);
  await writeFile(
    join(destination, 'current.json.tmp'),
    JSON.stringify({ releaseId: id, buildHash, createdAt: new Date().toISOString() }),
  );
  await rename(join(destination, 'current.json.tmp'), join(destination, 'current.json'));
  console.log('Frontend release staged. Restart the web service to activate it.');
} finally {
  await rm(stage, { recursive: true, force: true });
}
