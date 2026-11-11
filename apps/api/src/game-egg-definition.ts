import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { appUrl } from './security';

export const PAPER_EGG_ID = 'a2339869-9e45-4e7a-b72f-4d1038abca01';
const image = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/);
const variableSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(10000).default(''),
  env_variable: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  default_value: z.union([z.string(), z.number(), z.boolean()]).transform(String),
  user_viewable: z.boolean().default(false),
  user_editable: z.boolean().default(false),
  rules: z.string().max(2000).default('nullable|string'),
  field_type: z.string().optional(),
});
const reserved = new Set([
  'SERVER_MEMORY',
  'SERVER_IP',
  'SERVER_PORT',
  'P_SERVER_UUID',
  'P_SERVER_LOCATION',
  'STARTUP',
  'TZ',
]);
const object = (v: unknown, field: string): Record<string, any> => {
  try {
    const value = typeof v === 'string' ? JSON.parse(v) : v;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch {
    throw new BadRequestException(`Egg ${field} must be a JSON object`);
  }
};
const safePath = (v: string) =>
  v.length <= 255 &&
  !v.startsWith('/') &&
  !v.includes('\\') &&
  !v.split('/').includes('..') &&
  !/[\x00-\x1f]/.test(v);
export function parseEgg(input: unknown) {
  const raw = object(input, 'definition');
  if (!['PTDL_v1', 'PTDL_v2'].includes(raw.meta?.version))
    throw new BadRequestException('Import a Pterodactyl PTDL_v1 or PTDL_v2 egg');
  const images = raw.docker_images || (raw.docker_image ? { Default: raw.docker_image } : {});
  const egg = z
    .object({
      meta: z.object({ version: z.enum(['PTDL_v1', 'PTDL_v2']) }).passthrough(),
      name: z.string().min(1).max(150),
      description: z.string().max(20000).nullable().optional(),
      author: z.string().max(255).optional(),
      startup: z.string().min(1).max(10000),
      docker_images: z
        .record(z.string(), image)
        .refine(
          (v) => Object.keys(v).length > 0 && Object.keys(v).length <= 50,
          'At least one Docker image is required',
        ),
      file_denylist: z.array(z.string().max(255)).max(100).default([]),
      features: z.array(z.string()).max(100).nullable().optional(),
      config: z.object({
        files: z.unknown(),
        startup: z.unknown(),
        stop: z.string().max(1000),
        logs: z.unknown().optional(),
      }),
      scripts: z.object({
        installation: z.object({
          script: z.string().min(1).max(500000),
          container: image,
          entrypoint: z
            .string()
            .regex(/^[a-zA-Z0-9_./-]+$/)
            .max(100),
        }),
      }),
      variables: z.array(variableSchema).max(100).default([]),
    })
    .passthrough()
    .parse({ ...raw, docker_images: images });
  const seen = new Set<string>();
  for (const v of egg.variables) {
    if (seen.has(v.env_variable) || reserved.has(v.env_variable))
      throw new BadRequestException(`Duplicate or reserved egg variable ${v.env_variable}`);
    seen.add(v.env_variable);
    rules(v.rules); // Do not silently ignore unsupported validation rules.
    if (v.default_value !== '') validateVariable(v, v.default_value);
  }
  const files = object(egg.config.files, 'config.files');
  for (const [file, config] of Object.entries(files)) {
    if (
      !safePath(file) ||
      !config ||
      !['properties', 'file', 'json', 'yaml', 'ini', 'xml'].includes(config.parser) ||
      !config.find ||
      typeof config.find !== 'object'
    )
      throw new BadRequestException(`Unsupported egg file configuration: ${file}`);
  }
  const startup = object(egg.config.startup, 'config.startup');
  if (
    startup.done !== undefined &&
    typeof startup.done !== 'string' &&
    !(Array.isArray(startup.done) && startup.done.every((v: unknown) => typeof v === 'string'))
  )
    throw new BadRequestException('Egg startup.done must be text or an array of text');
  return egg;
}
export type EggDefinition = ReturnType<typeof parseEgg>;
function rules(input: string) {
  // Laravel regex rules can themselves contain pipes. Preserve them as one rule.
  const tokens: string[] = input.match(/(?:not_regex|regex):\/(?:\\.|[^/])*\/[a-z]*|[^|]+/g) || [];
  const supported = new Set([
    'required',
    'nullable',
    'sometimes',
    'string',
    'integer',
    'numeric',
    'boolean',
    'min',
    'max',
    'between',
    'in',
    'not_in',
    'regex',
    'not_regex',
    'alpha',
    'alpha_dash',
    'alpha_num',
    'url',
    'ip',
    'digits',
    'digits_between',
    'size',
    'present',
  ]);
  for (const token of tokens) {
    if (!supported.has(token.split(':')[0]))
      throw new BadRequestException(
        `Unsupported egg validation rule: ${token}. Edit the egg rules before importing.`,
      );
    if (/^(not_regex|regex):/.test(token)) {
      const match = token.match(/^[^:]+:\/(.*)\/([imu]*)$/);
      if (!match || /\([^)]*[+*][^)]*\)[+*{]/.test(match[1]))
        throw new BadRequestException('Unsupported egg regular expression');
      try {
        new RegExp(match[1], match[2]);
      } catch {
        throw new BadRequestException('Invalid egg regular expression');
      }
    }
  }
  return tokens;
}
export function validateVariable(v: { name: string; rules: string }, value: string) {
  if (value.length > 2048 || value.includes('\0'))
    throw new BadRequestException(`${v.name} is too long or contains a null byte`);
  const tokens = rules(v.rules);
  if (value === '' && !tokens.includes('required')) return value;
  const numeric = tokens.includes('integer') || tokens.includes('numeric');
  for (const token of tokens) {
    const index = token.indexOf(':'),
      key = index < 0 ? token : token.slice(0, index),
      arg = token.slice(index + 1);
    const n = numeric ? Number(value) : value.length;
    let ok = true;
    if (key === 'required') ok = value.length > 0;
    if (key === 'integer') ok = /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value));
    if (key === 'numeric') ok = value.trim() !== '' && Number.isFinite(Number(value));
    if (key === 'boolean') ok = ['0', '1', 'true', 'false'].includes(value);
    if (key === 'min') ok = n >= Number(arg);
    if (key === 'max') ok = n <= Number(arg);
    if (key === 'size') ok = n === Number(arg);
    if (key === 'between') {
      const [min, max] = arg.split(',').map(Number);
      ok = n >= min && n <= max;
    }
    if (key === 'in') ok = arg.split(',').includes(value);
    if (key === 'not_in') ok = !arg.split(',').includes(value);
    if (key === 'alpha') ok = /^[a-zA-Z]+$/.test(value);
    if (key === 'alpha_num') ok = /^[a-zA-Z0-9]+$/.test(value);
    if (key === 'alpha_dash') ok = /^[a-zA-Z0-9_-]+$/.test(value);
    if (key === 'digits') ok = /^\d+$/.test(value) && value.length === Number(arg);
    if (key === 'digits_between') {
      const [min, max] = arg.split(',').map(Number);
      ok = /^\d+$/.test(value) && value.length >= min && value.length <= max;
    }
    if (key === 'url') {
      try {
        ok = ['http:', 'https:'].includes(new URL(value).protocol);
      } catch {
        ok = false;
      }
    }
    if (key === 'ip') ok = z.ipv4().safeParse(value).success || z.ipv6().safeParse(value).success;
    if (key === 'regex' || key === 'not_regex') {
      const match = arg.match(/^\/(.*)\/([imu]*)$/)!;
      ok = new RegExp(match[1], match[2]).test(value);
      if (key === 'not_regex') ok = !ok;
    }
    if (!ok) throw new BadRequestException(`${v.name} fails ${token}`);
  }
  return value;
}
export const gameConfigSchema = z
  .object({
    eggId: z.string().uuid().optional(),
    image: image.optional(),
    variables: z.record(z.string(), z.string().max(2048)).default({}),
  })
  .strict();
export function eggEnvironment(egg: EggDefinition, overrides: Record<string, string>) {
  for (const key of Object.keys(overrides))
    if (!egg.variables.some((v) => v.env_variable === key))
      throw new BadRequestException(`Unknown egg variable ${key}`);
  return Object.fromEntries(
    egg.variables.map((v) => [
      v.env_variable,
      validateVariable(v, overrides[v.env_variable] ?? v.default_value),
    ]),
  );
}
export function eggDigest(egg: unknown) {
  return createHash('sha256').update(JSON.stringify(egg)).digest('hex');
}
export function builtinPaper() {
  const egg = JSON.parse(readFileSync(join(__dirname, '../assets/eggs/paper.json'), 'utf8'));
  // The built-in egg resolves Paper through its official API in the worker and verifies its published checksum.
  egg.name = 'Paper (automatic stable releases)';
  egg.variables = egg.variables.filter((v: any) => v.env_variable !== 'DL_PATH');
  egg.variables.find((v: any) => v.env_variable === 'SERVER_JARFILE').rules =
    'required|regex:/^[a-zA-Z0-9_.-]+\\.jar$/';
  egg.scripts.installation = {
    container: 'ghcr.io/pterodactyl/installers:debian',
    entrypoint: 'bash',
    script: readFileSync(join(__dirname, '../assets/eggs/paper-auto.sh'), 'utf8'),
  };
  return parseEgg(egg);
}
export async function resolvePaper(
  version = 'latest',
  build = 'latest',
  fetcher: typeof fetch = fetch,
) {
  const headers = { 'User-Agent': `Harbor/0.1 (${appUrl()})`, Accept: 'application/json' };
  async function get(path: string) {
    const response = await fetcher(`https://fill.papermc.io/v3/projects/paper${path}`, {
      headers,
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(
        `Paper download service returned HTTP ${response.status}. Retry installation later.`,
      );
    return response.json() as Promise<any>;
  }
  const project = await get('');
  const versions = Object.values(project.versions || {})
    .flat()
    .filter((v): v is string => typeof v === 'string' && /^\d+(?:\.\d+)*$/.test(v));
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const candidates = version === 'latest' ? versions : [version];
  if (!versions.includes(candidates[0]))
    throw new BadRequestException('Unknown stable Paper Minecraft version');
  if (build !== 'latest' && !/^\d+$/.test(build))
    throw new BadRequestException('Paper build must be latest or a build number');
  for (const candidate of candidates.slice(0, 10)) {
    const builds = await get(`/versions/${encodeURIComponent(candidate)}/builds`);
    const stable = (Array.isArray(builds) ? builds : [])
      .filter((b: any) => b.channel === 'STABLE' && (build === 'latest' || String(b.id) === build))
      .sort((a: any, b: any) => b.id - a.id)[0];
    if (!stable) continue;
    const download = stable.downloads?.['server:default'];
    if (
      !download ||
      !/^https:\/\/fill-data\.papermc\.io\/[a-zA-Z0-9./_%?=&+-]+$/.test(download.url) ||
      !/^[a-f0-9]{64}$/i.test(download.checksums?.sha256 || '')
    )
      throw new Error('Paper returned an invalid download URL or SHA-256 checksum');
    return {
      version: candidate,
      build: String(stable.id),
      url: download.url as string,
      sha256: download.checksums.sha256 as string,
    };
  }
  throw new BadRequestException(
    'No stable Paper build is available for the requested version/build',
  );
}
export function paperInstall(download: { url: string; sha256: string }, jar = 'server.jar') {
  if (
    !/^https:\/\/[a-zA-Z0-9./_%?=&+-]+$/.test(download.url) ||
    !/^[a-f0-9]{64}$/i.test(download.sha256) ||
    !/^[a-zA-Z0-9_.-]+\.jar$/.test(jar)
  )
    throw new BadRequestException('Invalid Paper download metadata or jar filename');
  return {
    container_image: 'ghcr.io/pterodactyl/installers:debian',
    entrypoint: 'bash',
    script: `#!/bin/bash\nset -euo pipefail\napt-get update\napt-get install -y ca-certificates curl\ncd /mnt/server\ntrap 'rm -f .harbor-paper-download' EXIT\ncurl --fail --location --retry 3 --proto '=https' --proto-redir '=https' '${download.url}' -o .harbor-paper-download\necho '${download.sha256}  .harbor-paper-download' | sha256sum --check\nif [ -f '${jar}' ]; then cp '${jar}' '${jar}.old'; fi\nmv .harbor-paper-download '${jar}'\n[ -f server.properties ] || touch server.properties\n[ -f eula.txt ] || printf 'eula=true\\n' > eula.txt\n`,
  };
}
