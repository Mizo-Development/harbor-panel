import type {
  HostingProvider,
  HostingService,
  ProviderConnection,
  ServiceAction,
} from '@harbor/sdk';
/** Explicit simulator for checkout testing. Never starts processes or contacts hosting systems. */
export class DemoGameProvider implements HostingProvider {
  id = 'demo-game';
  capabilities = ['start', 'stop', 'restart', 'usage', 'suspend', 'unsuspend', 'terminate'];
  async health(_connection: ProviderConnection) {
    return {
      ready: true,
      mode: 'demo',
      message: 'Local checkout simulator. No real hosting capacity.',
    };
  }
  async provision(_connection: ProviderConnection, s: HostingService) {
    return { externalId: `demo-${s.id}`, metadata: { isDemo: true, powerState: 'stopped' } };
  }
  async inspect(_connection: ProviderConnection, s: HostingService) {
    return {
      isDemo: true,
      powerState: s.metadata.powerState || 'stopped',
      message: 'Simulated service. No Minecraft process is running.',
    };
  }
  async action(_connection: ProviderConnection, _s: HostingService, action: ServiceAction) {
    if (!this.capabilities.includes(action))
      throw new Error('This action is unavailable in demo mode');
    return {
      isDemo: true,
      metadata: {
        isDemo: true,
        powerState: action === 'start' || action === 'restart' ? 'running' : 'stopped',
      },
      message: 'Demo state updated. No real server was controlled.',
    };
  }
}
