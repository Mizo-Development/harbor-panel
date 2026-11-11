'use client';

import type { ReactNode } from 'react';

import { ErrorState, TableSkeleton } from '@/components/data/states';
import type { ApiError } from '@/lib/api';

export interface QueryResult<T> {
  data: T | undefined;
  error: ApiError | undefined;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
}

/**
 * Renders the loading, error, empty and loaded states of an API query.
 * Cached data stays visible while a background revalidation fails.
 */
export function Query<T>({
  result,
  skeleton,
  isEmpty,
  empty,
  children,
}: {
  result: QueryResult<T>;
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { data, error, mutate } = result;

  if (data === undefined || data === null) {
    if (error) return <ErrorState error={error} onRetry={() => void mutate()} />;
    return <>{skeleton ?? <TableSkeleton />}</>;
  }

  if (isEmpty?.(data)) return <>{empty}</>;

  return <>{children(data)}</>;
}
