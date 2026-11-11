import { writeFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
import { createRequire } from 'node:module';
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
requireApi('@nestjs/common').Logger.overrideLogger(false);
const { createApp } = await import('../apps/api/dist/main.js');
const app = await createApp();
try {
  await app.listen(0, '127.0.0.1');
  const port = app.getHttpServer().address().port;
  const ast = await openapiTS(new URL(`http://127.0.0.1:${port}/api/docs-json`));
  await writeFile('apps/web/lib/api.generated.ts', astToString(ast));
  console.log('Generated frontend API types from the running backend.');
} finally {
  await app.close();
}
