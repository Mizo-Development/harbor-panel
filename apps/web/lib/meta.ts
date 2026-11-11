import { Boxes, Cloud, Gamepad2, Globe, Server, type LucideIcon } from 'lucide-react';

import type { NodeKind, ServiceKind } from '@/lib/types';

export const KIND_META: Record<ServiceKind, { label: string; plural: string; icon: LucideIcon }> = {
  game: { label: 'Game server', plural: 'Game servers', icon: Gamepad2 },
  vps: { label: 'VPS', plural: 'VPS', icon: Server },
  web: { label: 'Web hosting', plural: 'Web hosting', icon: Globe },
};

export const NODE_KIND_META: Record<
  NodeKind,
  { label: string; description: string; icon: LucideIcon; secretLabel: string }
> = {
  wings: {
    label: 'Wings',
    description: 'Game server daemon',
    icon: Gamepad2,
    secretLabel: 'Daemon token',
  },
  proxmox: {
    label: 'Proxmox',
    description: 'Virtual machine cluster',
    icon: Boxes,
    secretLabel: 'API token secret',
  },
  plesk: {
    label: 'Plesk',
    description: 'Managed web hosting panel',
    icon: Globe,
    secretLabel: 'Plesk API key',
  },
  'native-web': {
    label: 'Native web',
    description: 'Harbor-managed web server',
    icon: Cloud,
    secretLabel: 'Agent token',
  },
};

export const NODE_KINDS = Object.keys(NODE_KIND_META) as NodeKind[];

export function isNodeKind(value: string): value is NodeKind {
  return value in NODE_KIND_META;
}

export const CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'JPY',
  'BRL',
  'INR',
] as const;
