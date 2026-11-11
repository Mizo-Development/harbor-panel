'use client';
import { useRef, useState, useEffect } from 'react';
import { api, getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
export function VpsConsole({ serviceId, ready }: { serviceId: string; ready: boolean }) {
  const target = useRef<HTMLDivElement>(null);
  const client = useRef<import('@novnc/novnc').default | null>(null);
  const [status, setStatus] = useState('Disconnected');
  useEffect(() => () => client.current?.disconnect(), []);
  async function connect() {
    try {
      setStatus('Connecting');
      const grant = await api.post<{ path: string; password: string }>(
        `/services/${serviceId}/console`,
      );
      const { default: RFB } = await import('@novnc/novnc');
      client.current?.disconnect();
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${grant.path}`;
      const rfb = new RFB(target.current!, url, { credentials: { password: grant.password } });
      client.current = rfb;
      rfb.scaleViewport = true;
      rfb.resizeSession = true;
      rfb.addEventListener('connect', () => setStatus('Connected'));
      rfb.addEventListener('disconnect', () => setStatus('Disconnected'));
      rfb.addEventListener('securityfailure', () => {
        setStatus('Authentication failed');
        toast.error('VPS console authentication failed');
      });
    } catch (error) {
      setStatus('Disconnected');
      toast.error(getErrorMessage(error));
    }
  }
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">VPS console</h2>
          <p role="status" className="mt-1 text-xs text-muted-foreground">
            {status}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={status !== 'Connected'}
            onClick={() => client.current?.sendCtrlAltDel()}
          >
            Ctrl + Alt + Del
          </Button>
          <Button
            size="sm"
            disabled={!ready || status === 'Connecting'}
            onClick={() => void connect()}
          >
            {status === 'Connected' ? 'Reconnect' : 'Connect'}
          </Button>
        </div>
      </div>
      <div
        ref={target}
        className="h-[550px] overflow-hidden rounded-lg bg-[#101b23]"
        aria-label="Remote VPS display"
      />
    </section>
  );
}
