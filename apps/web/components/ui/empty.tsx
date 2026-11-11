import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
export function Empty({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-5 rounded-xl p-12 text-center',
        className,
      )}
      {...p}
    />
  );
}
export function EmptyHeader(p: HTMLAttributes<HTMLDivElement>) {
  return <div className="flex max-w-md flex-col items-center gap-2" {...p} />;
}
export function EmptyContent(p: HTMLAttributes<HTMLDivElement>) {
  return <div {...p} />;
}
export function EmptyMedia({
  variant,
  className,
  ...p
}: HTMLAttributes<HTMLDivElement> & { variant?: string }) {
  return (
    <div
      className={cn(
        'mb-2 flex size-11 items-center justify-center rounded-xl border bg-muted [&>svg]:size-5',
        className,
      )}
      {...p}
    />
  );
}
export function EmptyTitle(p: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className="font-semibold" {...p} />;
}
export function EmptyDescription(p: HTMLAttributes<HTMLParagraphElement>) {
  return <p className="text-sm leading-relaxed text-muted-foreground" {...p} />;
}
