export const isolatedWingsLayout = 'isolated-v1';
export function wingsInstanceLayout(id: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
    throw new Error('A UUID is required for an isolated Wings instance');
  const compact = id.replaceAll('-', '').toLowerCase(),
    name = `harbor-wings-${id}`;
  return {
    name,
    service: `${name}.service`,
    config: `/etc/harbor/wings/${id}.yml`,
    binary: `/usr/local/lib/harbor/wings/${id}/wings`,
    root: `/var/lib/harbor/wings/${id}`,
    logs: `/var/log/harbor/wings/${id}`,
    runtime: `/run/harbor-wings/${id}`,
    temporary: `/tmp/harbor-wings-${id}`,
    username: `hbr_${compact.slice(0, 20)}`,
    network: `harbor_wings_${id}`,
    bridge: `hb${compact.slice(0, 12)}`,
  };
}
