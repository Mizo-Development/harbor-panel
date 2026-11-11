import { access, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
try {
  await access('.env');
} catch {
  let contents = await readFile('.env.example', 'utf8');
  contents = contents
    .replace('ENCRYPTION_KEY=\n', `ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`)
    .replace('SETUP_TOKEN=\n', `SETUP_TOKEN=${randomBytes(32).toString('hex')}\n`);
  await writeFile('.env', contents, { mode: 0o600 });
}
for (const args of [
  ['node_modules/prisma/build/index.js', 'generate'],
  ['--env-file=.env', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'],
])
  await new Promise((ok, fail) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('error', fail);
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error('Development setup failed'))));
  });
console.log('Development database is ready. Read SETUP_TOKEN from .env for first-time setup.');
