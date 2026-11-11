'use client';
import { Anchor } from 'lucide-react';
import { useSettings } from '@/lib/hooks';
import { cn } from '@/lib/utils';
export function BrandIcon({ className }: { className?: string }) {
  const { data } = useSettings();
  const logo = (data as any)?.logoUrl;
  return logo ? (
    <img src={logo} alt="" className={cn('size-8 shrink-0 rounded-md object-contain', className)} />
  ) : (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground',
        className,
      )}
    >
      <Anchor className="size-4" aria-hidden />
    </span>
  );
}
