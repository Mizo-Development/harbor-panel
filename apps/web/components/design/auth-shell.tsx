'use client';

import type { ReactNode } from 'react';
import { BrandIcon } from './brand-icon';
import { Anchor } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Reveal, Stagger } from '@/components/design/motion';

export type AuthShellProps = {
  companyName: string;
  title: string;
  description: string;
  children: ReactNode;
  themeToggle: ReactNode;
  footer?: ReactNode;
};

const RACK_UNITS = [
  { tag: 'edge', lit: true },
  { tag: 'compute', lit: true },
  { tag: 'compute', lit: false },
  { tag: 'storage', lit: true },
  { tag: 'dns', lit: false },
  { tag: 'web', lit: false },
  { tag: 'backup', lit: true },
  { tag: 'panel', lit: false },
];

const VENT_SLITS = Array.from({ length: 22 }, (_, i) => i);

function BrandMark({ companyName }: { companyName: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandIcon className="size-7" />
      <span className="text-sm font-semibold tracking-tight">{companyName}</span>
    </div>
  );
}

function RackMotif() {
  return (
    <div
      aria-hidden
      className="relative rounded-xl border bg-background/60 p-2 inset-surface backdrop-blur-sm"
    >
      <div className="flex items-center justify-between px-2 pt-1 pb-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
        <span>rack a</span>
        <span>8u</span>
      </div>
      <Stagger className="flex flex-col gap-1.5">
        {RACK_UNITS.map((unit, index) => (
          <Reveal
            key={`${unit.tag}-${index}`}
            className="flex h-9 items-center gap-3 rounded-md border bg-card px-3 inset-surface"
          >
            <span className="w-6 font-mono text-[10px] tabular-nums text-muted-foreground/60">
              {`U${String(index + 1).padStart(2, '0')}`}
            </span>
            <span className="w-14 font-mono text-[11px] text-muted-foreground">{unit.tag}</span>
            <span className="flex flex-1 items-center gap-1 overflow-hidden">
              {VENT_SLITS.map((slit) => (
                <span key={slit} className="h-3 w-px shrink-0 rounded-full bg-border" />
              ))}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-muted-foreground/25" />
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  unit.lit
                    ? 'bg-success shadow-[0_0_8px_var(--success)] motion-safe:animate-pulse'
                    : 'bg-muted-foreground/25',
                )}
              />
            </span>
          </Reveal>
        ))}
      </Stagger>
    </div>
  );
}

export function AuthShell({
  companyName,
  title,
  description,
  children,
  themeToggle,
  footer,
}: AuthShellProps) {
  const slug =
    companyName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') || 'harbor';

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-2">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <aside className="relative hidden overflow-hidden border-r bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_80%_70%_at_30%_40%,black,transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-32 h-96 bg-[radial-gradient(closest-side,var(--glow),transparent)]"
        />

        <div className="relative">
          <BrandMark companyName={companyName} />
        </div>

        <div className="relative flex max-w-md flex-col gap-8">
          <Reveal className="flex flex-col gap-3">
            <p className="font-mono text-xs text-muted-foreground">{`${slug}://control-plane`}</p>
            <p className="text-2xl font-semibold leading-snug tracking-tight text-balance text-foreground">
              Hosting, billing and provisioning
              <span className="text-muted-foreground"> in one control plane.</span>
            </p>
          </Reveal>
          <RackMotif />
        </div>

        <div className="relative flex items-center justify-between font-mono text-[11px] text-muted-foreground/70">
          <span>{companyName}</span>
          <span>Your infrastructure</span>
        </div>
      </aside>

      <section className="flex min-h-svh flex-col">
        <header className="flex h-16 items-center justify-between px-6 lg:justify-end lg:px-10">
          <div className="lg:hidden">
            <BrandMark companyName={companyName} />
          </div>
          {themeToggle}
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex flex-1 items-center justify-center px-6 pb-16 outline-none"
        >
          <Stagger className="flex w-full max-w-sm flex-col gap-8">
            <Reveal className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-balance text-foreground">
                {title}
              </h1>
              <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                {description}
              </p>
            </Reveal>
            <Reveal>{children}</Reveal>
            {footer ? (
              <Reveal className="border-t pt-6 text-sm text-muted-foreground">{footer}</Reveal>
            ) : null}
          </Stagger>
        </main>
      </section>
    </div>
  );
}
