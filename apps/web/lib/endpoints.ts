import { api } from '@/lib/api';
import type {
  Extension,
  InfraNode,
  NodeInput,
  OrderResult,
  ServiceActionRequest,
  ServiceActionResult,
  Settings,
  SettingsPatch,
  SetupPayload,
  User,
} from '@/lib/types';

/**
 * Mutations. Each function resolves only when the API confirms success and rejects with
 * an `ApiError` otherwise. UI code must await them and surface failures.
 */

export const login = (email: string, password: string) =>
  api.post<User>('/auth/login', { email, password });

export const logout = () => api.post<unknown>('/auth/logout');

export const submitSetup = (payload: SetupPayload) => api.post<unknown>('/setup', payload);

export const placeOrder = (input: { productId: string; domain?: string }) =>
  api.post<OrderResult>('/orders', input);

export const runServiceAction = (serviceId: string, request: ServiceActionRequest) =>
  api.post<ServiceActionResult | null | undefined>(
    `/services/${encodeURIComponent(serviceId)}/actions`,
    request,
  );

export const updateSettings = (patch: SettingsPatch) => api.patch<Settings>('/settings', patch);

export const setExtensionEnabled = (extensionId: string, enabled: boolean) =>
  api.patch<Extension>(`/extensions/${encodeURIComponent(extensionId)}`, { enabled });

export const createNode = (input: NodeInput) => api.post<InfraNode>('/nodes', input);
