import { readFile, writeFile, realpath } from 'node:fs/promises';
import { relative, resolve, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { validateManifest } from '../packages/sdk/src';
const root = resolve(process.env.HARBOR_SOURCE_DIR || resolve(import.meta.dirname, '..'));
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
try {
  const extensions = await db.extension.findMany({ where: { enabled: true, builtin: false } });
  const imports = ["import type {HarborFrontendModule} from '@harbor/sdk';"];
  const entries = [];
  const sources: string[] = [];
  let i = 0;
  for (const e of extensions) {
    const manifest = validateManifest(e.manifest);
    if (!manifest.frontendEntry || !e.directory) continue;
    const base = await realpath(e.directory);
    const entry = await realpath(join(base, manifest.frontendEntry));
    if (relative(base, entry).startsWith('..')) throw new Error('Unsafe frontend entry');
    sources.push(
      `@source ${JSON.stringify(relative(join(root, 'apps/web/app'), resolve(entry, '..')).replaceAll('\\', '/'))};`,
    );
    const path = relative(join(root, 'apps/web/lib'), entry).replaceAll('\\', '/');
    imports.push(
      `import * as extension${i} from ${JSON.stringify(path.replace(/\.(tsx|ts|jsx|js)$/, ''))};`,
    );
    entries.push(`${JSON.stringify(e.id)}:extension${i++} as HarborFrontendModule`);
  }
  await writeFile(
    join(root, 'apps/web/lib/extensions.generated.ts'),
    `// Generated extension registry.\n${imports.join('\n')}\nexport const frontendModules:Record<string,HarborFrontendModule>={${entries.join(',')}};\n`,
  );
  await writeFile(join(root, 'apps/web/app/extensions.generated.css'), sources.join('\n') + '\n');
  console.log(`Registered ${i} frontend extension modules.`);
} finally {
  await db.$disconnect();
}
