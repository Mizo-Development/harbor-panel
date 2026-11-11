import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { randomBytes } from 'node:crypto';
import type {
  HostingProvider,
  HostingService,
  ProviderConnection,
  ServiceAction,
} from '@harbor/sdk';
const builder = new XMLBuilder({ ignoreAttributes: false, format: false });
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: false,
});
export class PleskError extends Error {
  constructor(public code: string) {
    super(`Plesk rejected the request (${code})`);
  }
}
export function parsePlesk(xml: string): any {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unexpected XML declaration');
  const result = parser.parse(xml).packet;
  if (!result) throw new Error('Invalid Plesk response');
  const inspect = (node: any) => {
    if (node && typeof node === 'object') {
      if (node.status === 'error') throw new PleskError(String(node.errcode || 'unknown'));
      Object.values(node).forEach(inspect);
    }
  };
  inspect(result);
  return result;
}
const array = (value: any): any[] => (value ? (Array.isArray(value) ? value : [value]) : []);
export class PleskProvider implements HostingProvider {
  id = 'plesk';
  capabilities = ['suspend', 'unsuspend', 'terminate', 'usage', 'panel-login'];
  async call(c: ProviderConnection, packet: Record<string, unknown>) {
    const headers: Record<string, string> = { 'Content-Type': 'text/xml' };
    if (c.secret.apiKey) headers.KEY = c.secret.apiKey;
    else {
      headers.HTTP_AUTH_LOGIN = c.secret.username;
      headers.HTTP_AUTH_PASSWD = c.secret.password;
    }
    const response = await fetch(`${c.url}/enterprise/control/agent.php`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers,
      body: builder.build({ packet: { '@_version': '1.6.9.1', ...packet } }),
    });
    if (!response.ok) throw new Error(`Plesk connection failed (${response.status})`);
    return parsePlesk(await response.text());
  }
  async health(c: ProviderConnection) {
    const result = await this.call(c, { 'service-plan': { get: { filter: {} } } });
    return {
      plans: array(result['service-plan']?.get?.result).map((r) => ({
        id: r.id,
        name: r.name || r.data?.name,
        settings: r.data,
      })),
    };
  }
  async customer(c: ProviderConnection, s: HostingService) {
    const login = `h${s.user.id.replaceAll('-', '').slice(0, 24)}`;
    const existing = await this.call(c, {
      customer: { get: { filter: { login }, dataset: { gen_info: {} } } },
    }).catch((e) => {
      if (e instanceof PleskError && e.code === '1013') return {};
      throw e;
    });
    const rows = array(existing.customer?.get?.result).filter((r) => r.id);
    if (rows[0]) return { id: String(rows[0].id), login };
    const created = await this.call(c, {
      customer: {
        add: {
          gen_info: {
            pname: s.user.name,
            login,
            passwd: randomBytes(32).toString('hex'),
            email: s.user.email,
          },
        },
      },
    });
    const id = created.customer?.add?.result?.id;
    if (!id) throw new Error('Plesk did not return a customer ID');
    return { id: String(id), login };
  }
  async find(c: ProviderConnection, s: HostingService) {
    const result = await this.call(c, {
      webspace: {
        get: {
          filter: s.externalId ? { id: s.externalId } : { name: s.domain },
          dataset: { gen_info: {}, hosting: {}, stat: {}, disk_usage: {} },
        },
      },
    }).catch((e) => {
      if (e instanceof PleskError && e.code === '1013') return {};
      throw e;
    });
    return array(result.webspace?.get?.result).find((r) => r.id) ?? null;
  }
  async provision(c: ProviderConnection, s: HostingService) {
    if (!s.domain || !s.plan.servicePlan)
      throw new Error('A domain and mapped Plesk service plan are required');
    const owner = await this.customer(c, s);
    const existing = await this.find(c, s);
    if (existing) {
      const gen = existing.data?.gen_info;
      if (String(gen?.['owner-id']) !== owner.id)
        throw new Error('Existing Plesk subscription belongs to another customer');
      return {
        externalId: String(existing.id),
        metadata: { customerId: owner.id, login: owner.login, panelUrl: c.url },
      };
    }
    const ftpLogin = `h${s.id.replaceAll('-', '').slice(0, 16)}`;
    const created = await this.call(c, {
      webspace: {
        add: {
          gen_setup: {
            name: s.domain,
            'owner-id': owner.id,
            htype: 'vrt_hst',
            ip_address: c.config.ip,
          },
          hosting: {
            vrt_hst: {
              property: [
                { name: 'ftp_login', value: ftpLogin },
                { name: 'ftp_password', value: randomBytes(24).toString('hex') },
              ],
            },
          },
          'plan-name': s.plan.servicePlan,
        },
      },
    });
    const id = created.webspace?.add?.result?.id;
    if (!id) throw new Error('Plesk did not return a subscription ID');
    return {
      externalId: String(id),
      metadata: { customerId: owner.id, login: owner.login, panelUrl: c.url },
    };
  }
  async inspect(c: ProviderConnection, s: HostingService) {
    const row = await this.find(c, s);
    if (!row) throw new Error('Plesk subscription was not found');
    return {
      id: row.id,
      domain: s.domain,
      usage: row.data?.stat,
      diskUsage: row.data?.disk_usage,
      status: row.data?.gen_info?.status,
    };
  }
  async action(c: ProviderConnection, s: HostingService, action: ServiceAction) {
    if (!s.externalId) throw new Error('Subscription has not been provisioned');
    if (action === 'terminate')
      await this.call(c, { webspace: { del: { filter: { id: s.externalId } } } });
    else if (action === 'suspend' || action === 'unsuspend')
      await this.call(c, {
        webspace: {
          set: {
            filter: { id: s.externalId },
            values: { gen_setup: { status: action === 'suspend' ? 16 : 0 } },
          },
        },
      });
    else throw new Error('Use Plesk for advanced website management');
    return { completed: true };
  }
  async login(c: ProviderConnection, s: HostingService, ip: string) {
    if (!s.metadata.login) throw new Error('Plesk customer has not been provisioned');
    const result = await this.call(c, {
      server: {
        create_session: {
          login: s.metadata.login,
          data: { user_ip: Buffer.from(ip).toString('base64'), source_server: {} },
        },
      },
    });
    const id = result.server?.create_session?.result?.id;
    if (!id) throw new Error('Plesk did not return a login session');
    return { url: `${c.url}/enterprise/rsession_init.php?PLESKSESSID=${encodeURIComponent(id)}` };
  }
}
