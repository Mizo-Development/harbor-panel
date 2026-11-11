import createClient from 'openapi-fetch';
import type { paths } from './api.generated';
import { ApiError } from './api';
export const client = createClient<paths>({ credentials: 'same-origin' });
export type LoginInput = NonNullable<
  paths['/api/v1/auth/login']['post']['requestBody']
>['content']['application/json'];
export async function signIn(body: LoginInput) {
  const { data, error, response } = await client.POST('/api/v1/auth/login', { body });
  if (!response.ok || !data)
    throw new ApiError((error as any)?.error?.message || 'Unable to sign in', response.status);
  return data.data;
}
