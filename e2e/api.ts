import type { APIRequestContext, Playwright } from '@playwright/test';
import { latestEmailLink } from './helpers.js';

const CSRF = { 'X-Requested-With': 'arthakram' };
export const future = (days: number) => new Date(Date.now() + days * 864e5).toISOString();

/** A signed-in API client with its own cookie jar, for setting up scenarios quickly and realistically. */
export class Api {
  constructor(readonly ctx: APIRequestContext) {}

  static async signedIn(playwright: Playwright, baseURL: string, email: string, password: string) {
    const ctx = await playwright.request.newContext({ baseURL, ignoreHTTPSErrors: true });
    const res = await ctx.post('/api/v1/auth/login', { headers: CSRF, data: { email, password } });
    if (!res.ok()) throw new Error(`login failed for ${email}: ${res.status()}`);
    return new Api(ctx);
  }

  private async call<T>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    data?: unknown,
  ): Promise<T> {
    const res = await this.ctx[method](`/api/v1${path}`, { headers: CSRF, data });
    if (!res.ok())
      throw new Error(`${method.toUpperCase()} ${path} -> ${res.status()} ${await res.text()}`);
    return (res.status() === 204 ? undefined : await res.json()) as T;
  }
  get = <T = any>(p: string) => this.call<T>('get', p); // eslint-disable-line @typescript-eslint/no-explicit-any
  post = <T = any>(p: string, d?: unknown) => this.call<T>('post', p, d); // eslint-disable-line @typescript-eslint/no-explicit-any
  put = <T = any>(p: string, d?: unknown) => this.call<T>('put', p, d); // eslint-disable-line @typescript-eslint/no-explicit-any
  patch = <T = any>(p: string, d?: unknown) => this.call<T>('patch', p, d); // eslint-disable-line @typescript-eslint/no-explicit-any

  /** Raw-body upload used for submission files. */
  async upload(path: string, bytes: Buffer, filename: string) {
    const res = await this.ctx.put(`/api/v1${path}`, {
      headers: {
        ...CSRF,
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(filename),
      },
      data: bytes,
    });
    if (!res.ok()) throw new Error(`upload -> ${res.status()} ${await res.text()}`);
    return res.json();
  }
}

/** Registers and verifies a user through the public API; returns their credentials. */
export async function newUser(playwright: Playwright, baseURL: string, name: string) {
  const anon = await playwright.request.newContext({ baseURL, ignoreHTTPSErrors: true });
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const password = 'A-long-passphrase-1';
  await anon.post('/api/v1/auth/register', { headers: CSRF, data: { name, email, password } });
  const token = new URL(await latestEmailLink(anon, email)).searchParams.get('token');
  await anon.post('/api/v1/auth/verify-email', { headers: CSRF, data: { token } });
  return { email, password, name };
}

export const pdf = (label: string) =>
  Buffer.from(
    `%PDF-1.4\n% ${label}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`,
  );
