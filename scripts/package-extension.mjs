import { resolve, join } from 'node:path';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import * as tar from 'tar';
import { validateManifest } from '../packages/sdk/dist/index.js';
const folder = resolve(process.argv[2] || 'examples/plugins/hello');
const manifest = validateManifest(JSON.parse(await readFile(join(folder, 'harbor.json'), 'utf8')));
const output = resolve(process.argv[3] || `artifacts/${manifest.id}-${manifest.version}.tgz`);
await mkdir(resolve(output, '..'), { recursive: true });
await tar.c(
  { gzip: true, file: output, cwd: folder },
  (await readdir(folder)).filter(
    (n) => !['node_modules', '.git'].includes(n) && !n.endsWith('.tgz'),
  ),
);
console.log(output);
