import type { HostingService } from '@harbor/sdk';
export function gameRuntime(s?: HostingService): any {
  return s?.metadata.gameRuntime;
}
export function runtimeEnvironment(s: HostingService) {
  const r = s.metadata.resource as any;
  return {
    ...(gameRuntime(s)?.environment || { SERVER_JARFILE: 'server.jar', EULA: 'TRUE' }),
    SERVER_MEMORY: String(s.plan.memoryMb),
    SERVER_IP: String(r?.config?.ip || '0.0.0.0'),
    SERVER_PORT: String(r?.config?.port || ''),
  };
}
function replace(s: HostingService, value: unknown): any {
  const environment = runtimeEnvironment(s);
  const r = s.metadata.resource as any;
  if (Array.isArray(value)) return value.map((v) => replace(s, v));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(s, v)]));
  if (typeof value !== 'string') return value;
  return value.replace(/{{\s*([\w.-]+)\s*}}/g, (original, key) => {
    const server: Record<string, unknown> = {
      'server.build.default.ip': r?.config?.ip,
      'server.build.default.port': r?.config?.port,
      'server.build.memory': s.plan.memoryMb,
      'server.build.cpu': s.plan.cpu * 100,
      'server.build.disk': s.plan.diskMb,
      'server.uuid': s.id,
    };
    if (key.startsWith('config.'))
      return original.replace('config.docker.interface', 'config.docker.network.interface');
    if (key.startsWith('server.build.env.'))
      return environment[key.slice(17) as keyof typeof environment] ?? '';
    if (key.startsWith('env.')) return environment[key.slice(4) as keyof typeof environment] ?? '';
    if (key.startsWith('server.')) return String(server[key] ?? '');
    return environment[key as keyof typeof environment] ?? original;
  });
}
export function eggInvocation(s: HostingService) {
  return replace(s, gameRuntime(s).definition.startup);
}
export function eggProcess(s: HostingService) {
  const config = gameRuntime(s).definition.config;
  const files = typeof config.files === 'string' ? JSON.parse(config.files) : config.files;
  const startup = typeof config.startup === 'string' ? JSON.parse(config.startup) : config.startup;
  return {
    startup: {
      done: typeof startup.done === 'string' ? [startup.done] : startup.done || [],
      user_interaction: [],
      strip_ansi: !!startup.strip_ansi,
    },
    stop: config.stop.startsWith('^')
      ? { type: 'signal', value: config.stop.slice(1).toUpperCase() }
      : { type: 'command', value: config.stop },
    configs: Object.entries(files).map(([file, raw]: [string, any]) => ({
      ...raw,
      file,
      find: undefined,
      replace: Object.entries(raw.find).flatMap(([match, value]) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.entries(value).map(([if_value, replacement]) => ({
              match,
              if_value,
              replace_with: replace(s, replacement),
            }))
          : [{ match, replace_with: replace(s, value) }],
      ),
    })),
  };
}
