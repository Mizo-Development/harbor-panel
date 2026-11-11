export async function requestJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    signal: init.signal ?? AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Provider request failed (${response.status})`);
  if (!text) return {} as T;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Provider returned an invalid response');
  }
}
export function pathSegment(value: unknown) {
  return encodeURIComponent(String(value));
}
