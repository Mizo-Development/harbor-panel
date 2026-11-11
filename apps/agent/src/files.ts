import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
export async function safePath(root: string, input: string, creating = false) {
  if (input.includes('\0') || input.includes('\\')) throw new Error('Invalid file path');
  const base = await realpath(root);
  const target = resolve(base, `.${input.startsWith('/') ? input : `/${input}`}`);
  if (relative(base, target).startsWith('..')) throw new Error('Path escapes website files');
  const parent = await realpath(creating ? dirname(target) : target);
  if (parent !== base && relative(base, parent).startsWith('..'))
    throw new Error('Symbolic links outside website files are prohibited');
  return target;
}
export async function listFiles(root: string, path: string) {
  const directory = await safePath(root, path);
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const st = await lstat(join(directory, entry.name));
    result.push({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      size: st.size,
      modifiedAt: st.mtime.toISOString(),
    });
  }
  return { path, entries: result };
}
export async function readContent(root: string, path: string) {
  const target = await safePath(root, path);
  const fd = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.size > 1048576)
      throw new Error('Only text files up to 1 MiB can be edited');
    return { content: await fd.readFile('utf8') };
  } finally {
    await fd.close();
  }
}
export async function writeContent(root: string, path: string, content: string) {
  const target = await safePath(root, path, true);
  if (target === (await realpath(root))) throw new Error('Choose a file');
  const fd = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
    0o640,
  );
  try {
    const stat = await fd.stat();
    if (!stat.isFile()) throw new Error('Choose a regular file');
    await fd.truncate(0);
    await fd.writeFile(content, 'utf8');
  } finally {
    await fd.close();
  }
  return { saved: true };
}
