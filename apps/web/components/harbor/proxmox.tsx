'use client';
import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Plus, MapPin, Server, RefreshCw } from 'lucide-react';
import { api, apiFetch, getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Header,
  Panel,
  Field,
  Input,
  Select,
  Modal,
  Form,
  ErrorBox,
  Loading,
  Empty,
  useData,
  type Row,
} from './shared';
const configFields = [
  ['node', 'Node name', 'pve01'],
  ['storage', 'Guest disk storage', 'local-lvm'],
  ['bridge', 'Network bridge', 'vmbr0'],
  ['templateStorage', 'Container template storage', 'local'],
  ['backupStorage', 'Backup storage', 'backup'],
  ['pool', 'Proxmox resource pool', 'hosting'],
  ['cpuModel', 'QEMU CPU model', 'x86-64-v2-AES'],
  ['nameserver', 'DNS server', '1.1.1.1'],
  ['searchdomain', 'DNS search domain', 'example.com'],
];
export function ProxmoxFields({
  config = {},
  credentials = true,
  inventory,
  locations = [],
}: {
  config?: Row;
  credentials?: boolean;
  inventory?: Row;
  locations?: Row[];
}) {
  return (
    <>
      {credentials && (
        <>
          <Field label="API token ID">
            <Input name="secret.tokenId" placeholder="harbor@pve!panel" required />
          </Field>
          <Field label="API token secret">
            <Input name="secret.tokenSecret" type="password" required autoComplete="new-password" />
          </Field>
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {configFields.map(([key, label, placeholder]) => (
          <Field key={key} label={label}>
            <Input
              name={`config.${key}`}
              placeholder={placeholder}
              defaultValue={
                config[key] ??
                (key === 'bridge' ? 'vmbr0' : key === 'cpuModel' ? 'x86-64-v2-AES' : '')
              }
              required={['node', 'storage', 'bridge', 'cpuModel'].includes(key)}
              list={`pve-${key}`}
            />
          </Field>
        ))}
        <Field label="QEMU boot disk">
          <Select name="config.disk" defaultValue={config.disk || 'scsi0'}>
            {['scsi0', 'virtio0', 'sata0'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="VLAN tag">
          <Input name="config.vlan" type="number" min={1} max={4094} defaultValue={config.vlan} />
        </Field>
        <Field label="MTU">
          <Input
            name="config.mtu"
            type="number"
            min={576}
            max={9000}
            defaultValue={config.mtu}
            placeholder="1500"
          />
        </Field>
        <Field label="Network limit (Mbps)">
          <Input
            name="config.rateMbps"
            type="number"
            min={1}
            max={100000}
            defaultValue={config.rateMbps}
            placeholder="Unlimited"
          />
        </Field>
        <Field label="Guest firewall">
          <Select name="config.firewall" defaultValue={String(config.firewall ?? true)}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </Select>
        </Field>
        <Field label="Start on host boot">
          <Select name="config.onboot" defaultValue={String(config.onboot ?? true)}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </Select>
        </Field>
      </div>
      <Field label="Location">
        <Select name="locationId" defaultValue={config.locationId || ''}>
          <option value="">No location assigned</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} · {l.city}, {l.country}
            </option>
          ))}
        </Select>
      </Field>
      <datalist id="pve-node">
        {inventory?.nodes?.map((n: Row) => (
          <option key={n.node} value={n.node} />
        ))}
      </datalist>
      {['storage', 'backupStorage', 'templateStorage'].map((key) => (
        <datalist key={key} id={`pve-${key}`}>
          {inventory?.storages?.map((s: Row) => (
            <option key={s.storage} value={s.storage}>
              {s.content}
            </option>
          ))}
        </datalist>
      ))}
      <datalist id="pve-bridge">
        {inventory?.networks
          ?.filter((n: Row) => n.type === 'bridge' || n.type === 'OVSBridge')
          .map((n: Row) => (
            <option key={n.iface} value={n.iface} />
          ))}
      </datalist>
      <datalist id="pve-pool">
        {inventory?.pools?.map((p: Row) => (
          <option key={p.poolid} value={p.poolid} />
        ))}
      </datalist>
    </>
  );
}
function connectionData(f: FormData) {
  const config: Row = {},
    secret: Row = {};
  for (const [key, value] of f.entries()) {
    if (key.startsWith('config.') && value !== '') config[key.slice(7)] = value;
    if (key.startsWith('secret.') && value !== '') secret[key.slice(7)] = value;
  }
  return {
    name: f.get('name'),
    url: f.get('url'),
    locationId: f.get('locationId') || null,
    config,
    ...(Object.keys(secret).length ? { secret } : {}),
  };
}
export function ProxmoxWorkspace() {
  const nodes = useData<Row[]>('/nodes'),
    locations = useData<Row[]>('/locations');
  const [tab, setTab] = useState('nodes'),
    [edit, setEdit] = useState<Row | null>(null),
    [location, setLocation] = useState<Row | null>(null);
  const connections = nodes.data?.filter((n) => n.provider === 'proxmox') || [];
  return (
    <>
      <Header
        eyebrow="Infrastructure"
        title="Proxmox"
        description="Connect clusters, assign nodes to locations, and configure VM and container hosting."
        action={
          <Button onClick={() => setEdit({})}>
            <Plus className="size-4" />
            Connect cluster
          </Button>
        }
      />
      <div className="mb-6 flex min-w-0 flex-wrap gap-2">
        <Button variant={tab === 'nodes' ? 'secondary' : 'ghost'} onClick={() => setTab('nodes')}>
          Nodes & connections
        </Button>
        <Button
          variant={tab === 'locations' ? 'secondary' : 'ghost'}
          onClick={() => setTab('locations')}
        >
          Locations
        </Button>
        <Button asChild variant="ghost">
          <Link href="/admin/products">VPS plans</Link>
        </Button>
      </div>
      {nodes.error ? (
        <ErrorBox error={nodes.error} />
      ) : !nodes.data ? (
        <Loading />
      ) : tab === 'nodes' ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {connections.length ? (
            connections.map((n) => (
              <Panel key={n.id}>
                <div className="flex items-start gap-3">
                  <Server className="mt-1 size-5" />
                  <div className="flex-1">
                    <h2 className="font-semibold">{n.name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {n.config.node} ·{' '}
                      {n.location
                        ? `${n.location.city}, ${n.location.country}`
                        : 'No location assigned'}
                    </p>
                  </div>
                  <Badge variant="outline">{n.status}</Badge>
                </div>
                <p className="my-4 truncate font-mono text-xs text-muted-foreground">{n.url}</p>
                <div className="grid grid-cols-3 gap-3 border-y py-4 text-xs">
                  <span>
                    {n.config.storage}
                    <small className="mt-1 block text-muted-foreground">Disk storage</small>
                  </span>
                  <span>
                    {n.config.bridge}
                    <small className="mt-1 block text-muted-foreground">Bridge</small>
                  </span>
                  <span>
                    {n.allocations}
                    <small className="mt-1 block text-muted-foreground">IP allocations</small>
                  </span>
                </div>
                <Button className="mt-4" variant="outline" onClick={() => setEdit(n)}>
                  Manage Proxmox
                </Button>
              </Panel>
            ))
          ) : (
            <Empty
              icon={Server}
              title="Connect a Proxmox cluster"
              description="Add an API token and initial node. Discover storage and templates after connecting."
            />
          )}
        </div>
      ) : (
        <>
          <Button className="mb-5" variant="outline" onClick={() => setLocation({})}>
            <MapPin className="size-4" />
            Add location
          </Button>
          <div className="grid gap-4 md:grid-cols-2">
            {locations.data?.map((l) => (
              <Panel key={l.id}>
                <h2 className="font-semibold">{l.name}</h2>
                <p className="my-2 text-sm text-muted-foreground">
                  {l.city}, {l.country} · {l._count.connections} connections
                </p>
                <p className="mb-4 text-xs text-muted-foreground">{l.description}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setLocation(l)}>
                    Edit location
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={l._count.connections > 0}
                    onClick={() =>
                      void apiFetch(`/locations/${l.id}`, { method: 'DELETE' })
                        .then(() => locations.mutate())
                        .catch((e) => toast.error(getErrorMessage(e)))
                    }
                  >
                    Delete
                  </Button>
                </div>
              </Panel>
            ))}
          </div>
        </>
      )}
      {edit && (
        <ProxmoxManager
          node={edit}
          locations={locations.data || []}
          close={() => setEdit(null)}
          saved={() => nodes.mutate()}
        />
      )}
      {location && (
        <Modal
          title={location.id ? 'Edit location' : 'Add location'}
          close={() => setLocation(null)}
        >
          <Form
            submit="Save location"
            onSubmit={async (f) => {
              const data = Object.fromEntries(f);
              if (location.id) await api.patch(`/locations/${location.id}`, data);
              else await api.post('/locations', data);
              await locations.mutate();
              setLocation(null);
              toast.success('Location saved');
            }}
          >
            {[
              ['name', 'Location name'],
              ['city', 'City'],
              ['country', 'Country code'],
              ['description', 'Description'],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <Input
                  name={key}
                  defaultValue={location[key]}
                  required={key !== 'description'}
                  maxLength={key === 'country' ? 2 : undefined}
                  placeholder={key === 'country' ? 'DE' : undefined}
                />
              </Field>
            ))}
          </Form>
        </Modal>
      )}
    </>
  );
}
export function ProxmoxManager({
  node,
  locations,
  close,
  saved,
}: {
  node: Row;
  locations: Row[];
  close: () => void;
  saved: () => unknown;
}) {
  const [tab, setTab] = useState('settings'),
    [clone, setClone] = useState(false),
    [discoverNode, setDiscoverNode] = useState(node.config?.node || ''),
    [storage, setStorage] = useState(node.config?.templateStorage || '');
  const inventory = useData<Row>(
    node.id
      ? `/nodes/${node.id}/proxmox${discoverNode ? `?node=${encodeURIComponent(discoverNode)}${storage ? `&storage=${encodeURIComponent(storage)}` : ''}` : ''}`
      : null,
  );
  const ips = useData<Row[]>(node.id ? `/nodes/${node.id}/resources` : null);
  return (
    <Modal
      title={node.id ? `Manage ${node.name}` : 'Connect Proxmox cluster'}
      description="Settings apply to new orders. Existing services retain their original node and network placement."
      close={close}
    >
      {node.id && (
        <div className="mb-5 flex flex-wrap gap-2">
          {['settings', 'inventory', 'ip pools'].map((t) => (
            <Button
              key={t}
              size="sm"
              variant={tab === t ? 'secondary' : 'ghost'}
              onClick={() => setTab(t)}
              className="capitalize"
            >
              {t}
            </Button>
          ))}
        </div>
      )}
      {tab === 'settings' && (
        <Form
          submit={clone ? 'Add cluster node' : 'Save connection'}
          close={close}
          onSubmit={async (f) => {
            const data = connectionData(f);
            if (!node.id) await api.post('/nodes', { ...data, provider: 'proxmox' });
            else if (clone)
              await api.post(`/nodes/${node.id}/cluster-nodes`, {
                name: data.name,
                locationId: data.locationId,
                config: data.config,
              });
            else await api.patch(`/nodes/${node.id}`, data);
            await saved();
            toast.success(clone ? 'Node added' : 'Connection saved');
            close();
          }}
        >
          {node.id && (
            <label className="flex items-center gap-2 rounded-lg border p-3 text-xs">
              <input type="checkbox" checked={clone} onChange={(e) => setClone(e.target.checked)} />
              Add another node using this cluster’s credentials
            </label>
          )}
          <Field label="Connection name">
            <Input name="name" defaultValue={node.name} required />
          </Field>
          {!clone && (
            <Field label="Endpoint URL">
              <Input
                name="url"
                type="url"
                defaultValue={node.url}
                placeholder="https://pve.example.com:8006"
                required
              />
            </Field>
          )}
          <ProxmoxFields
            config={{ ...node.config, locationId: node.locationId }}
            credentials={!node.id}
            inventory={inventory.data}
            locations={locations}
          />
          {node.id && !clone && (
            <>
              <p className="text-xs text-muted-foreground">
                Leave credentials blank to keep the existing API token.
              </p>
              <Field label="Replacement API token ID">
                <Input name="secret.tokenId" />
              </Field>
              <Field label="Replacement API token secret">
                <Input name="secret.tokenSecret" type="password" autoComplete="new-password" />
              </Field>
            </>
          )}
        </Form>
      )}
      {tab === 'inventory' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Discover node">
              <Select
                value={discoverNode}
                onChange={(e) => {
                  setDiscoverNode(e.target.value);
                  setStorage('');
                }}
              >
                {inventory.data?.nodes?.map((n: Row) => (
                  <option key={n.node} value={n.node}>
                    {n.node} · {n.status}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Template storage">
              <Select value={storage} onChange={(e) => setStorage(e.target.value)}>
                <option value="">Choose storage</option>
                {inventory.data?.storages?.map((s: Row) => (
                  <option key={s.storage} value={s.storage}>
                    {s.storage}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button variant="outline" onClick={() => void inventory.mutate()}>
            <RefreshCw className="size-4" />
            Refresh inventory
          </Button>
          {inventory.error ? (
            <ErrorBox error={inventory.error} retry={inventory.mutate} />
          ) : !inventory.data ? (
            <Loading />
          ) : (
            <>
              {inventory.data.warnings?.map((w: string) => (
                <p key={w} className="text-xs text-amber-400">
                  {w}
                </p>
              ))}
              {[
                ['Storage', 'storages'],
                ['Networks', 'networks'],
                ['QEMU virtual machines', 'qemu'],
                ['LXC containers', 'containers'],
                ['Container templates', 'templates'],
              ].map(([label, key]) => (
                <div key={key}>
                  <h3 className="mb-2 text-sm font-semibold">{label}</h3>
                  <div className="max-h-48 overflow-auto rounded-lg border">
                    {inventory.data![key].length ? (
                      inventory.data![key].map((r: Row, i: number) => (
                        <div key={i} className="border-b p-3 text-xs last:border-0">
                          <span className="font-mono">
                            {r.storage || r.iface || r.volid || r.vmid}
                          </span>
                          <span className="ml-3 text-muted-foreground">
                            {r.name || r.content || r.type || r.status}
                            {r.template ? ' · template' : ''}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="p-3 text-xs text-muted-foreground">No entries returned.</p>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {tab === 'ip pools' && (
        <div className="space-y-5">
          <p className="text-xs leading-6 text-muted-foreground">
            Add a range of public IPv4 addresses you control. Gateway, network, and broadcast
            addresses are excluded. Reserved addresses cannot be deleted.
          </p>
          <div className="max-h-56 overflow-auto rounded-lg border">
            {ips.data?.map((ip) => (
              <div
                key={ip.id}
                className="flex items-center justify-between gap-2 border-b p-3 text-xs last:border-0"
              >
                <div>
                  <p className="font-mono">{ip.value}</p>
                  <p className="mt-1 text-muted-foreground">
                    {ip.config.pool || 'Default pool'} · gateway {ip.config.gateway} ·{' '}
                    {ip.serviceId ? 'Reserved' : 'Available'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!ip.serviceId}
                  onClick={() =>
                    void apiFetch(`/nodes/${node.id}/resources/${ip.id}`, { method: 'DELETE' })
                      .then(() => ips.mutate())
                      .catch((e) => toast.error(getErrorMessage(e)))
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <Form
            submit="Add IP pool"
            onSubmit={async (f) => {
              const r = await api.post<Row>(`/nodes/${node.id}/ip-pools`, Object.fromEntries(f));
              toast.success(`${r.count} addresses added`);
              await ips.mutate();
              await saved();
            }}
          >
            <Field label="IP pool name">
              <Input name="pool" placeholder="public-v4" required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ['start', 'First IPv4 address'],
                ['end', 'Last IPv4 address'],
                ['prefix', 'CIDR prefix'],
                ['gateway', 'IPv4 gateway'],
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input
                    name={key}
                    type={key === 'prefix' ? 'number' : 'text'}
                    min={key === 'prefix' ? 1 : undefined}
                    max={key === 'prefix' ? 32 : undefined}
                    required
                  />
                </Field>
              ))}
            </div>
          </Form>
        </div>
      )}
    </Modal>
  );
}
export function ProxmoxPlanFields({
  connection,
  defaults = {},
}: {
  connection: Row;
  defaults?: Row;
}) {
  const [type, setType] = useState(defaults.vmType || 'qemu');
  const inventory = useData<Row>(
    `/nodes/${connection.id}/proxmox${connection.config.templateStorage ? `?storage=${encodeURIComponent(connection.config.templateStorage)}` : ''}`,
  );
  const ips = useData<Row[]>(`/nodes/${connection.id}/resources`);
  return (
    <>
      <Field label="Virtualization type">
        <Select name="vmType" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="qemu">QEMU / KVM virtual machine</option>
          <option value="lxc">LXC container (unprivileged)</option>
        </Select>
      </Field>
      <Field
        label={type === 'qemu' ? 'Cloud-init template ID' : 'LXC OS template volume'}
        hint={
          type === 'qemu'
            ? 'Use a cloud-init enabled VM template on this node.'
            : 'Use a downloaded template from storage supporting CT templates.'
        }
      >
        <Input
          key={type}
          name="template"
          defaultValue={defaults.templateId}
          required
          list="pve-plan-templates"
          placeholder={type === 'qemu' ? '9000' : 'local:vztmpl/debian-13-standard.tar.zst'}
        />
      </Field>
      <datalist id="pve-plan-templates">
        {(type === 'qemu'
          ? inventory.data?.qemu?.filter((v: Row) => v.template)
          : inventory.data?.templates
        )?.map((t: Row) => (
          <option key={t.vmid || t.volid} value={t.vmid || t.volid}>
            {t.name || t.volid}
          </option>
        ))}
      </datalist>
      <Field
        label="IP pool"
        hint="Leave empty to allocate from any available pool on this connection."
      >
        <Input name="ipPool" list="pve-ip-pools" defaultValue={defaults.ipPool} />
      </Field>
      <datalist id="pve-ip-pools">
        {Array.from(new Set(ips.data?.map((ip) => ip.config.pool).filter(Boolean))).map((pool) => (
          <option key={String(pool)} value={String(pool)} />
        ))}
      </datalist>
      {type === 'lxc' && (
        <Field label="Container swap (MB)">
          <Input name="swapMb" type="number" min={0} defaultValue={defaults.swapMb ?? 512} />
        </Field>
      )}
      {inventory.error && (
        <p className="text-xs text-muted-foreground">
          Inventory unavailable. You can enter the exact template identifier manually.
        </p>
      )}
    </>
  );
}
