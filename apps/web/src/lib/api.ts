import {
  healthResponseSchema,
  type HealthResponse,
  type MeResponse,
  type MyEvent,
} from '@arthakram/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Field name -> message, from server-side validation (422). */
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Every non-GET request carries the CSRF header the API requires (see api/src/auth/middleware.ts). */
export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-Requested-With': 'arthakram' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (
      data as {
        error?: { code?: string; message?: string; details?: { fields?: Record<string, string> } };
      } | null
    )?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'error',
      err?.message ?? 'Something went wrong',
      err?.details?.fields,
    );
  }
  return data as T;
}

export const api = {
  health: async (): Promise<HealthResponse> => {
    const res = await fetch('/api/v1/health');
    return healthResponseSchema.parse(await res.json());
  },
  me: async (): Promise<MeResponse | null> => {
    try {
      return await request<MeResponse>('GET', '/me');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },
  myEvents: () => request<{ events: MyEvent[] }>('GET', '/me/events').then((r) => r.events),
  register: (input: { name: string; email: string; password: string }) =>
    request<{ message: string }>('POST', '/auth/register', input),
  verifyEmail: (token: string) =>
    request<{ message: string }>('POST', '/auth/verify-email', { token }),
  resendVerification: (email: string) =>
    request<{ message: string }>('POST', '/auth/resend-verification', { email }),
  login: (input: { email: string; password: string }) =>
    request<MeResponse>('POST', '/auth/login', input),
  logout: () => request<void>('POST', '/auth/logout'),
  forgotPassword: (email: string) =>
    request<{ message: string }>('POST', '/auth/forgot-password', { email }),
  resetPassword: (input: { token: string; password: string }) =>
    request<{ message: string }>('POST', '/auth/reset-password', input),
};
