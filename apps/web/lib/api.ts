/**
 * Harbor API client.
 *
 * Every request goes to the same-origin `/api/v1` prefix. The backend answers with
 * `{ data: ... }` on success and `{ error: { message, code? } }` on failure. This helper
 * unwraps both shapes and throws an `ApiError` for anything that is not a clean success,
 * so callers can never mistake a failed request for a successful one.
 */

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  signal?: AbortSignal;
}

interface ErrorEnvelope {
  error?: { message?: string; code?: string } | null;
}

function fallbackMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Sign in again to continue.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) {
    return 'The Harbor API endpoint was not found. Check that the backend is reachable at /api/v1.';
  }
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  if (status >= 500) return 'The Harbor API reported a server error. Try again shortly.';
  return `The Harbor API returned an unexpected response (${status}).`;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const hasBody = body !== undefined;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(
      'Unable to reach the Harbor API. Check your connection and that the backend is running.',
      0,
      'network_error',
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  const envelope = (payload && typeof payload === 'object' ? payload : null) as
    (ErrorEnvelope & { data?: unknown }) | null;

  if (!response.ok || envelope?.error) {
    throw new ApiError(
      envelope?.error?.message || fallbackMessage(response.status),
      response.status,
      envelope?.error?.code,
    );
  }

  if (envelope && 'data' in envelope) return envelope.data as T;

  // A successful empty response (e.g. 204 on logout) carries no payload.
  if (!text) return undefined as T;

  throw new ApiError(
    'The Harbor API returned a response in an unexpected format.',
    response.status,
    'invalid_response',
  );
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiFetch<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'DELETE', body }),
};

export function getErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Try again.',
): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
