'use client';

import useSWR, { type SWRConfiguration } from 'swr';

import { apiFetch, type ApiError } from '@/lib/api';
import type {
  DashboardData,
  Extension,
  InfraNode,
  Invoice,
  Product,
  Service,
  ServiceStatus,
  Settings,
  SetupStatus,
  User,
} from '@/lib/types';

const fetcher = (path: string) => apiFetch<unknown>(path);

function useApi<T>(path: string | null, config?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(path, fetcher as (path: string) => Promise<T>, config);
}

const TRANSITIONAL: ServiceStatus[] = ['starting', 'stopping', 'provisioning'];

export function useAuth() {
  const { data, error, isLoading, mutate } = useApi<User>('/auth/me', {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });
  return { user: data, error, isLoading, mutate };
}

export const useSetupStatus = () => useApi<SetupStatus>('/setup', { revalidateOnFocus: false });

export const useDashboard = () => useApi<DashboardData>('/dashboard');

/** Polls while any service is changing state so power actions reflect real backend status. */
export const useServices = () =>
  useApi<Service[]>('/services', {
    refreshInterval: (latest) =>
      latest?.some((service) => TRANSITIONAL.includes(service.status)) ? 3000 : 0,
  });

export const useProducts = () =>
  useApi<Product[]>('/catalog/products', { revalidateOnFocus: false });

export const useInvoices = () => useApi<Invoice[]>('/invoices');

export const useNodes = () => useApi<InfraNode[]>('/nodes', { refreshInterval: 30_000 });

export const useExtensions = () => useApi<Extension[]>('/extensions');

export const useSettings = () => useApi<Settings>('/settings', { revalidateOnFocus: false,refreshInterval:30000 });
