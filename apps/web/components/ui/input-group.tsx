import type { HTMLAttributes, InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
export function InputGroup({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex h-10 items-center rounded-lg border bg-card px-3', className)}
      {...p}
    />
  );
}
export function InputGroupAddon(p: HTMLAttributes<HTMLSpanElement>) {
  return <span className="mr-2 text-muted-foreground [&>svg]:size-4" {...p} />;
}
export function InputGroupInput({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('w-full bg-transparent text-sm outline-none', className)} {...p} />;
}
