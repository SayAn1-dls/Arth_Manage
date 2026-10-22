import { healthResponseSchema, type HealthResponse } from '@arthakram/shared';

/** Minimal typed fetch helper; grows into the full client (CSRF header, idempotency keys) in Phase 1. */
async function getJson<T>(path: string, parse: (data: unknown) => T): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { credentials: 'include' });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok && res.status !== 503) throw new Error(`Request failed (${res.status})`);
  return parse(body);
}

export const api = {
  health: (): Promise<HealthResponse> => getJson('/health', (d) => healthResponseSchema.parse(d)),
};
