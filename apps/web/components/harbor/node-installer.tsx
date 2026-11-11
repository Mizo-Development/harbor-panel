'use client';
import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Terminal,
  Copy,
  Download,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Server,
  KeyRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal, Form, Field, Input, Select, ErrorBox, useData, date, type Row } from './shared';
const stageNames: Record<string, string> = {
  waiting: 'Waiting for your VPS',
  preflight: 'Checking the VPS',
  docker: 'Installing Docker',
  wings: 'Installing Wings',
  tls: 'Configuring TLS and firewall',
  configuration: 'Writing node configuration',
  starting: 'Starting Wings',
  verifying: 'Verifying panel connectivity',
  complete: 'Node connected',
};
async function copyCommand(command: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(command);
      return;
    } catch {}
  }
  const textarea = document.createElement('textarea');
  textarea.value = command;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Select and copy the command manually.');
}
export function NodeInstaller({
  node,
  close,
  onComplete,
}: {
  node: Row;
  close: () => void;
  onComplete: () => void;
}) {
  const history = useData<Row[]>(`/nodes/${node.id}/installations`, 3000);
  const [generated, setGenerated] = useState<Row | null>(null),
    [error, setError] = useState<unknown>(null),
    [downloading, setDownloading] = useState(false);
  const [tlsMode, setTlsMode] = useState(node.url?.startsWith('https:') ? 'auto' : 'none');
  const reduce = useReducedMotion();
  const current = history.data?.[0];
  const busy = current?.status === 'RUNNING';
  const active = current && ['WAITING', 'RUNNING', 'FAILED'].includes(current.status);
  const hostname = (() => {
    try {
      return new URL(node.url).hostname;
    } catch {
      return '';
    }
  })();
  const status = current?.status || 'NEW';
  const endpoint = generated?.instance?.endpoint || node.url;
  const configuredPort = (() => {
    try {
      return Number(new URL(node.url).port || (node.url.startsWith('https:') ? 443 : 80));
    } catch {
      return 8081;
    }
  })();
  const defaultPort =
    node.config?.wingsLayout === 'isolated-v1'
      ? configuredPort
      : [80, 443, 8080].includes(configuredPort)
        ? 8081
        : configuredPort;
  return (
    <Modal
      title="Install game node"
      description={`Set up ${node.name} on your VPS with one unique command.`}
      close={() => {
        if (current?.status === 'COMPLETE') onComplete();
        close();
      }}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl border bg-muted/20 p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background">
            <Server className="size-5 text-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{node.name}</p>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{endpoint}</p>
          </div>
          <Badge variant="outline" className="ml-auto">
            Wings
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
          {[
            [Terminal, '1. Generate'],
            [KeyRound, '2. Run on VPS'],
            [CheckCircle2, '3. Connected'],
          ].map(([Icon, label]) => {
            const I = Icon as typeof Terminal;
            return (
              <div
                key={String(label)}
                className="flex flex-col items-center gap-2 rounded-lg border p-3"
              >
                <I className="size-4" />
                {String(label)}
              </div>
            );
          })}
        </div>
        {current && (
          <div role="status" className="rounded-xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                {status === 'COMPLETE' ? (
                  <CheckCircle2 className="size-4 text-primary" />
                ) : busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Terminal className="size-4" />
                )}
                {stageNames[current.step] || current.step}
              </p>
              <Badge variant="secondary">{status.toLowerCase()}</Badge>
            </div>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              {status === 'COMPLETE'
                ? 'The panel verified Wings and registered your requested allocations. You can now connect hosting plans to this node.'
                : status === 'FAILED'
                  ? 'Fix the error shown on your VPS and rerun the downloaded script. You can also revoke this setup access and generate a new command.'
                  : status === 'EXPIRED'
                    ? 'This setup access has expired. Generate a fresh command below.'
                    : `Setup access expires ${date(current.expiresAt)}. Status updates automatically.`}
            </p>
          </div>
        )}
        {generated &&
          ['WAITING', 'RUNNING', 'FAILED'].includes(current?.status || 'WAITING') &&
          current?.id === generated.id && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-4"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <Terminal className="size-4 text-primary" />
                Run as root on the target VPS
              </div>
              <pre
                tabIndex={0}
                aria-label="Node installation command"
                className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-background p-3 font-mono text-[11px] leading-6"
              >
                {generated.command}
              </pre>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void copyCommand(generated.command)
                      .then(() => toast.success('Install command copied'))
                      .catch((e) => toast.error(getErrorMessage(e)))
                  }
                >
                  <Copy className="size-3.5" />
                  Copy command
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloading || busy}
                  onClick={async () => {
                    setDownloading(true);
                    try {
                      const response = await fetch(new URL(generated.scriptUrl).pathname, {
                        headers: { Authorization: `Bearer ${generated.token}` },
                        cache: 'no-store',
                      });
                      if (!response.ok)
                        throw new Error(
                          'This setup command is no longer available. Use the file already on your VPS or generate a new command.',
                        );
                      const blob = await response.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = generated.filename;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    } catch (e) {
                      toast.error(getErrorMessage(e));
                    } finally {
                      setDownloading(false);
                    }
                  }}
                >
                  <Download className="size-3.5" />
                  Download script
                </Button>
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                Treat this command as a credential. It is shown only now, is bound to the first VPS
                that runs it, and closes after successful setup. Keep the downloaded file to resume
                a failed run.
              </p>
            </motion.div>
          )}
        {generated?.instance && (
          <div className="space-y-2 rounded-lg border p-3 text-[11px] leading-5 text-muted-foreground">
            <p className="font-medium text-foreground">Harbor instance</p>
            <p className="break-all font-mono">Service: {generated.instance.service}</p>
            <p className="break-all font-mono">Config: {generated.instance.config}</p>
            <p>
              Daemon: {generated.instance.daemonPort} · SFTP: {generated.instance.sftpPort}
            </p>
          </div>
        )}
        {active && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await api.post(`/nodes/${node.id}/installations/${current.id}/revoke`);
                setGenerated(null);
                await history.mutate();
                toast.success('Setup access revoked');
              } catch (e) {
                toast.error(getErrorMessage(e));
              }
            }}
          >
            Revoke setup access
          </Button>
        )}
        {!busy && (
          <Form
            submit={
              generated && current?.status === 'WAITING'
                ? 'Generate replacement command'
                : 'Generate install command'
            }
            onSubmit={async (f) => {
              setError(null);
              try {
                const result = await api.post<Row>(`/nodes/${node.id}/installations`, {
                  tlsMode,
                  daemonPort: Number(f.get('daemonPort')),
                  sftpPort: Number(f.get('sftpPort')),
                  email: String(f.get('certificateEmail') || '') || undefined,
                  allocationIp: String(f.get('allocationIp') || ''),
                  portStart: Number(f.get('portStart')),
                  portEnd: Number(f.get('portEnd')),
                  addAllocations: f.get('addAllocations') === 'true',
                });
                setGenerated(result);
                onComplete();
                await history.mutate();
              } catch (e) {
                setError(e);
              }
            }}
          >
            <div className="rounded-lg border bg-muted/20 p-3 text-xs leading-6 text-muted-foreground">
              Runs as a separate Harbor instance alongside existing Wings. Choose unused daemon,
              SFTP and game ports; the original Wings service and configuration stay in place.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Harbor daemon port" hint="Updates this node's endpoint port.">
                <Input
                  name="daemonPort"
                  type="number"
                  min={1}
                  max={65535}
                  defaultValue={defaultPort}
                  required
                />
              </Field>
              <Field label="Harbor SFTP port">
                <Input
                  name="sftpPort"
                  type="number"
                  min={1024}
                  max={65535}
                  defaultValue={node.config?.sftpPort || 2023}
                  required
                />
              </Field>
            </div>
            <Field
              label="Node TLS setup"
              hint="Reuse existing certificate files for the same hostname, or use automatic HTTPS with DNS pointing at this VPS and TCP 80 free for validation."
            >
              <Select value={tlsMode} onChange={(e) => setTlsMode(e.target.value)}>
                {node.url?.startsWith('https:') ? (
                  <>
                    <option value="auto">Automatic Let's Encrypt certificate</option>
                    <option value="existing">Use existing Let's Encrypt certificate files</option>
                  </>
                ) : (
                  <option value="none">HTTP preview — no certificate</option>
                )}
              </Select>
            </Field>
            {tlsMode === 'auto' && (
              <Field label="Certificate contact email">
                <Input
                  name="certificateEmail"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="admin@example.com"
                />
              </Field>
            )}
            <Field label="Register game allocations">
              <Select name="addAllocations" defaultValue="true">
                <option value="true">Add the game IP and port range after verification</option>
                <option value="false">I'll manage allocations separately</option>
              </Select>
            </Field>
            <Field
              label="Game allocation IPv4"
              hint="Leave empty to use the node's single IPv4 DNS address. Enter your routed public IPv4 for NAT or multiple DNS records."
            >
              <Input
                name="allocationIp"
                placeholder={/^\d+\.\d+\.\d+\.\d+$/.test(hostname) ? hostname : '203.0.113.10'}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First game port">
                <Input
                  name="portStart"
                  type="number"
                  min={1024}
                  max={65535}
                  defaultValue={25575}
                  required
                />
              </Field>
              <Field label="Last game port">
                <Input
                  name="portEnd"
                  type="number"
                  min={1024}
                  max={65535}
                  defaultValue={25584}
                  required
                />
              </Field>
            </div>
            <p className="text-xs leading-6 text-muted-foreground">
              Ubuntu 22.04/24.04/26.04 or Debian 12/13, amd64/arm64, systemd and Docker-capable
              virtualization. Installs Docker, checksum-verified Wings, TLS, active UFW port rules
              and a separately named boot-enabled service, config, data directory and Docker
              network. Existing Wings installations are preserved. Provider firewalls must allow the
              daemon, SFTP and chosen game ports.
            </p>
            {node.url?.startsWith('http:') && (
              <p className="rounded-lg border p-3 text-xs leading-6 text-muted-foreground">
                This node uses HTTP for preview testing. Use HTTPS for production enrollment and
                game consoles.
              </p>
            )}
            {!!error && <ErrorBox error={error} />}
          </Form>
        )}
        <p className="flex items-start gap-2 border-t pt-4 text-[11px] leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          Revoking setup access does not uninstall a node that already received its configuration.
          Hosting plans and reviewed game installation files are managed separately.
        </p>
      </div>
    </Modal>
  );
}
