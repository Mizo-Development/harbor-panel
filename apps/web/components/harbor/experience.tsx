'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Info,
  CheckCircle2,
  TriangleAlert,
  X,
  ShieldCheck,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { api, getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/design/auth-shell';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';
import { Brand, ErrorBox, type Row } from './shared';
export function Announcement({
  settings,
  area,
}: {
  settings: Row;
  area: 'storefront' | 'customer';
}) {
  const a = settings.experience?.announcement,
    [dismissed, setDismissed] = useState('');
  const key = JSON.stringify(a || {});
  useEffect(() => {
    try {
      if (sessionStorage.getItem('harbor-announcement') === key) setDismissed(key);
    } catch {}
  }, [key]);
  if (!a?.enabled || !a.text || !['all', area].includes(a.scope) || dismissed === key) return null;
  const Icon = a.tone === 'warning' ? TriangleAlert : a.tone === 'success' ? CheckCircle2 : Info;
  return (
    <div
      role="status"
      className={cn(
        'mb-6 flex items-start gap-3 rounded-xl border p-4 text-xs leading-6',
        a.tone === 'warning'
          ? 'border-amber-500/25 bg-amber-500/5'
          : a.tone === 'success'
            ? 'border-emerald-500/25 bg-emerald-500/5'
            : 'bg-muted/30',
      )}
    >
      <Icon className="mt-1 size-4 shrink-0 text-muted-foreground" />
      <p className="flex-1 whitespace-pre-wrap">{a.text}</p>
      <button
        type="button"
        aria-label="Dismiss announcement"
        className="rounded p-1 text-muted-foreground hover:bg-muted"
        onClick={() => {
          setDismissed(key);
          try {
            sessionStorage.setItem('harbor-announcement', key);
          } catch {}
        }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
export function Maintenance({ settings }: { settings: Row }) {
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-16">
      <div className="max-w-lg text-center">
        <Brand name={settings.companyName} />
        <span className="mx-auto mb-5 mt-12 flex size-12 items-center justify-center rounded-xl border bg-muted/30">
          <ShieldCheck className="size-5 text-muted-foreground" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Scheduled maintenance</h1>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
          {settings.access?.maintenanceMessage}
        </p>
        {settings.experience?.links?.statusUrl && (
          <Button asChild variant="outline" className="mt-6">
            <a href={settings.experience.links.statusUrl} target="_blank" rel="noreferrer">
              View status page <ArrowRight className="size-4" />
            </a>
          </Button>
        )}
        <Link
          className="mt-8 block text-xs text-muted-foreground underline underline-offset-4"
          href="/login"
        >
          Administrator sign in
        </Link>
      </div>
    </main>
  );
}
export function VerifyEmail({ settings }: { settings: Row }) {
  const search = useSearchParams(),
    { mutate } = useSWRConfig(),
    [done, setDone] = useState(false),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  return (
    <AuthShell
      companyName={settings.companyName}
      title={done ? 'Email verified' : 'Verify your email'}
      description={
        done
          ? 'You can now place hosting orders.'
          : 'Confirm the email address linked to your account.'
      }
      themeToggle={<ThemeToggle />}
    >
      {done ? (
        <Button asChild>
          <Link href="/dashboard">
            Continue to dashboard <ArrowRight className="size-4" />
          </Link>
        </Button>
      ) : (
        <div className="space-y-5">
          {!!error && <ErrorBox error={error} />}
          <Button
            disabled={busy || !search.get('token')}
            className="w-full"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.post('/auth/verification/confirm', { token: search.get('token') });
                await mutate('/auth/me');
                await mutate('/profile');
                setDone(true);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Confirm email address
          </Button>
          <p className="text-xs leading-6 text-muted-foreground">
            Verification links expire after 24 hours. Request a new link from your Account page if
            needed.
          </p>
          <Link href="/login" className="text-xs underline underline-offset-4">
            Return to sign in
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
