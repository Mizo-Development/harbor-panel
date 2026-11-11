import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseEgg,
  eggEnvironment,
  validateVariable,
  resolvePaper,
  paperInstall,
  PAPER_EGG_ID,
} from '../apps/api/src/game-egg-definition';
import { createRequire } from 'node:module';
const { GameEggs } = createRequire(import.meta.url)('../apps/api/dist/game-eggs.js');
import { wingsSettings, wingsProcess, wingsInstall } from '../apps/api/src/providers/wings';
const official = () => JSON.parse(readFileSync('apps/api/assets/eggs/paper.json', 'utf8'));
test('official Pterodactyl Paper v2 imports startup, image list, scripts and validation', () => {
  const egg = parseEgg(official());
  const env = eggEnvironment(egg, { MINECRAFT_VERSION: 'latest', BUILD_NUMBER: '244' });
  assert.equal(env.SERVER_JARFILE, 'server.jar');
  assert.equal(env.BUILD_NUMBER, '244');
  assert(Object.values(egg.docker_images).includes('ghcr.io/ptero-eggs/yolks:java_25'));
  assert.throws(() => eggEnvironment(egg, { SERVER_JARFILE: '../evil.jar' }));
  assert.throws(() => eggEnvironment(egg, { SERVER_PORT: '1' }));
});
test('v1 images normalize and invalid or unsupported egg fields fail before saving', () => {
  const raw = official();
  raw.meta.version = 'PTDL_v1';
  raw.docker_image = Object.values(raw.docker_images)[0];
  delete raw.docker_images;
  assert.equal(Object.keys(parseEgg(raw).docker_images)[0], 'Default');
  raw.variables[0].rules = 'required|custom_unimplemented';
  assert.throws(() => parseEgg(raw), /Unsupported egg validation/);
  const path = official();
  path.config.files = JSON.stringify({ '../host': { parser: 'file', find: {} } });
  assert.throws(() => parseEgg(path));
  const reserved = official();
  reserved.variables[0].env_variable = 'SERVER_PORT';
  assert.throws(() => parseEgg(reserved));
  const duplicate = official();
  duplicate.variables.push(duplicate.variables[0]);
  assert.throws(() => parseEgg(duplicate));
});
test('variable rules preserve regex pipes and enforce numeric, enum and URL constraints', () => {
  assert.equal(
    validateVariable({ name: 'Choice', rules: 'required|regex:/^(one|two)$/' }, 'two'),
    'two',
  );
  assert.throws(() =>
    validateVariable({ name: 'Choice', rules: 'required|regex:/^(one|two)$/' }, 'three'),
  );
  for (const [rules, value] of [
    ['required|integer|min:1|max:10', '11'],
    ['required|in:a,b', 'c'],
    ['required|url', 'invalid'],
    ['required|string|max:3', 'toolong'],
    ['required|boolean', 'yes'],
  ])
    assert.throws(() => validateVariable({ name: 'Test', rules }, value));
  assert.equal(
    validateVariable({ name: 'Limit', rules: 'required|integer|min:1|max:10' }, '8'),
    '8',
  );
});
const sha = 'b'.repeat(64),
  url = `https://fill-data.papermc.io/v1/objects/${sha}/paper.jar`;
function fakeFetch(project: any, builds: Record<string, unknown>, requests: any[] = []) {
  return (async (path: string, options: any) => {
    requests.push({ path, options });
    const suffix = path.replace('https://fill.papermc.io/v3/projects/paper', '');
    return new Response(JSON.stringify(suffix ? builds[suffix] || [] : project), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}
test('Paper latest selects highest stable version/build and fetches official checksum with contact User-Agent', async () => {
  const requests: any[] = [];
  const resolved = await resolvePaper(
    'latest',
    'latest',
    fakeFetch(
      { versions: { older: ['1.21.11'], new: ['26.3-rc-3', '26.3'] } },
      {
        '/versions/26.3/builds': [
          { id: 245, channel: 'EXPERIMENTAL', downloads: {} },
          {
            id: 244,
            channel: 'STABLE',
            downloads: { 'server:default': { url, checksums: { sha256: sha } } },
          },
        ],
      },
      requests,
    ),
  );
  assert.deepEqual(resolved, { version: '26.3', build: '244', url, sha256: sha });
  assert.match(requests[0].options.headers['User-Agent'], /Harbor\/0.1 \(http/);
  assert.equal(requests.length, 2);
});
test('Paper skips a release without stable builds and rejects missing, corrupt or unexpected downloads', async () => {
  const build = {
    id: 1,
    channel: 'STABLE',
    downloads: { 'server:default': { url, checksums: { sha256: sha } } },
  };
  const project = { versions: { new: ['26.3'], old: ['1.21.11'] } };
  assert.equal(
    (
      await resolvePaper(
        'latest',
        'latest',
        fakeFetch(project, { '/versions/1.21.11/builds': [build] }),
      )
    ).version,
    '1.21.11',
  );
  await assert.rejects(resolvePaper('1.99', 'latest', fakeFetch(project, {})));
  await assert.rejects(
    resolvePaper('26.3', '2', fakeFetch(project, { '/versions/26.3/builds': [build] })),
  );
  build.downloads['server:default'].url = 'http://localhost/private';
  await assert.rejects(
    resolvePaper('26.3', 'latest', fakeFetch(project, { '/versions/26.3/builds': [build] })),
    /invalid download/,
  );
  await assert.rejects(
    resolvePaper(
      'latest',
      'latest',
      (async () => new Response('', { status: 503 })) as typeof fetch,
    ),
    /HTTP 503/,
  );
});
test('Paper installer verifies temporary download before replacing jar and preserves existing game configuration', () => {
  const script = paperInstall({ url, sha256: sha }).script;
  assert(script.indexOf('sha256sum --check') < script.indexOf('mv .harbor-paper-download'));
  assert(script.includes("cp 'server.jar' 'server.jar.old'"));
  assert(script.includes('[ -f eula.txt ] ||'));
  assert(script.includes('[ -f server.properties ] ||'));
  assert.throws(() => paperInstall({ url, sha256: 'bad' }));
  assert.throws(() => paperInstall({ url, sha256: sha }, '../server.jar'));
});
test('Wings settings and parser configuration come from the assigned egg snapshot', () => {
  const definition = parseEgg(official());
  const s: any = {
    id: 'service',
    name: 'Example',
    plan: { cpu: 2, memoryMb: 2048, diskMb: 10240, javaVersion: '21' },
    metadata: {
      resource: { config: { ip: '203.0.113.1', port: 25575 } },
      gameRuntime: {
        eggId: 'egg-id',
        definition,
        image: 'example/game:latest',
        environment: eggEnvironment(definition, {}),
        install: { script: 'test' },
      },
    },
  };
  assert.equal(wingsSettings(s).container.image, 'example/game:latest');
  assert.equal(wingsSettings(s).egg.id, 'egg-id');
  assert(wingsSettings(s).invocation.includes('-jar server.jar'));
  assert.equal(wingsSettings(s).environment.SERVER_PORT, '25575');
  const process = wingsProcess(s);
  assert.deepEqual(process.startup.done, [')! For help, type ']);
  assert(
    process.configs[0].replace.some(
      (r: any) => r.match === 'server-port' && r.replace_with === '25575',
    ),
  );
  assert.equal(wingsInstall({ config: {} } as any, s).script, 'test');
  definition.config.stop = '^C';
  assert.deepEqual(wingsProcess(s).stop, { type: 'signal', value: 'C' });
});
test('installation snapshots persist before provisioning and retries reuse the exact same artifact', async () => {
  let writes = 0;
  const definition = parseEgg(official());
  const metadata: any = {
    gameAssignment: {
      eggId: PAPER_EGG_ID,
      name: 'Paper',
      definition,
      image: 'java',
      environment: eggEnvironment(definition, {}),
    },
  };
  const db: any = {
    service: {
      update: async ({ data }: any) => {
        writes++;
        return data;
      },
    },
  };
  const eggs = new GameEggs(db);
  const service: any = { id: 'service', metadata };
  const connection = {
    config: { paperDownloadUrl: 'https://example.com/paper.jar', paperSha256: sha },
  };
  const prepared = await eggs.prepare(service, 'op-one', connection);
  assert.equal(writes, 1);
  assert.equal(prepared.gameRuntime.operationId, 'op-one');
  service.metadata = prepared;
  const retry = await eggs.prepare(service, 'op-one', { config: {} });
  assert.deepEqual(retry, prepared);
  assert.equal(writes, 1);
  const rebuilt = await eggs.prepare(service, 'op-two', connection);
  assert.equal(rebuilt.gameRuntime.operationId, 'op-two');
  assert.equal(writes, 2);
});
