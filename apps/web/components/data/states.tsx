'use client';

import { AlertTriangle, RotateCw, ShieldAlert, WifiOff, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import type { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn('border bg-card/50', className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

export function ErrorState({
  error,
  onRetry,
  title,
  className,
}: {
  error: ApiError | Error;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const status = 'status' in error ? (error as ApiError).status : undefined;
  const Icon = status === 0 ? WifiOff : status === 403 ? ShieldAlert : AlertTriangle;
  const heading =
    title ??
    (status === 0
      ? 'Can’t reach the API'
      : status === 403
        ? 'Access denied'
        : status === 404
          ? 'Endpoint not found'
          : 'Couldn’t load this data');

  return (
    <Empty className={cn('border bg-card/50', className)} role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="text-destructive">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{heading}</EmptyTitle>
        <EmptyDescription>{error.message}</EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCw className="size-4" />
            Try again
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="h-8 w-48" />
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3', className)}
      aria-busy="true"
      aria-label="Loading"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

export function MetricGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export function FullPageState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">{children}</div>
  );
}
