import type {
  HostingProvider,
  HostingService,
  ProviderConnection,
  ServiceAction,
} from '@harbor/sdk';
import { requestJson } from './http';
export class NativeWebProvider implements HostingProvider {
  id = 'native-web';
  capabilities = [
    'suspend',
    'unsuspend',
    'terminate',
    'backup',
    'restore',
    'usage',
    'files',
    'database',
    'certificate',
  ];
  call(c: ProviderConnection, path: string, method = 'GET', data?: unknown) {
    return requestJson(`${c.url}/v1${path}`, {
      method,
      signal: AbortSignal.timeout(240000),
      headers: { Authorization: `Bearer ${c.secret.token}`, 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
  }
  async health(c: ProviderConnection) {
    return this.call(c, '/health');
  }
  async provision(c: ProviderConnection, s: HostingService) {
    if (!s.domain) throw new Error('Web hosting requires a domain');
    const result = await this.call(c, `/sites/${s.id}`, 'PUT', {
      domain: s.domain,
      memoryMb: s.plan.memoryMb,
      diskMb: s.plan.diskMb,
    });
    return { externalId: s.id, metadata: result };
  }
  async inspect(c: ProviderConnection, s: HostingService) {
    return this.call(c, `/sites/${s.id}`);
  }
  async action(
    c: ProviderConnection,
    s: HostingService,
    action: ServiceAction,
    input: Record<string, unknown>,
  ) {
    return this.call(c, `/sites/${s.id}/actions`, 'POST', { action, ...input });
  }
}
