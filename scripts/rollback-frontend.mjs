import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.env.FRONTEND_RELEASES_DIR || '/data/frontend';
const previous = await readFile(join(root, 'previous.json'), 'utf8');
const parsed = JSON.parse(previous);
if (!/^[a-f0-9-]{36}$/.test(parsed.releaseId)) throw new Error('Invalid previous release');
await writeFile(join(root, 'current.json.tmp'), previous);
await rename(join(root, 'current.json.tmp'), join(root, 'current.json'));
console.log('Previous frontend selected. Restart the web service.');
