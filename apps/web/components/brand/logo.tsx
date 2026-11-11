import { Anchor } from 'lucide-react';

import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground',
        className,
      )}
    >
      <Anchor className="size-4" />
    </span>
  );
}

export function Logo({ name = 'Harbor', className }: { name?: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-base font-semibold tracking-tight">{name}</span>
    </span>
  );
}
