import type { APIRequestContext, Page } from '@playwright/test';

export const DEV_PASSWORD = 'Password!2345';
export const ACCOUNTS = {
  admin: 'admin@arthakram.test',
  judge1: 'judge1@arthakram.test',
  judge2: 'judge2@arthakram.test',
  staff: 'staff@arthakram.test',
  asha: 'asha@arthakram.test',
  ravi: 'ravi@arthakram.test',
} as const;

export async function signInUi(page: Page, email: string, password = DEV_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/events/);
}

/** Reads the most recent link emailed to an address from the development outbox. */
export async function latestEmailLink(request: APIRequestContext, to: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`/api/v1/dev/outbox?to=${encodeURIComponent(to)}`);
    const link = (await res.json()).messages?.[0]?.link as string | undefined;
    if (link) return link;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email for ${to}`);
}

/** Creates a verified account through the public API (register, read the emailed link, verify). */
export async function createVerifiedUser(request: APIRequestContext, name = 'E2E Organiser') {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const password = 'A-long-passphrase-1';
  const headers = { 'X-Requested-With': 'arthakram' };
  await request.post('/api/v1/auth/register', { headers, data: { name, email, password } });
  const token = new URL(await latestEmailLink(request, email)).searchParams.get('token');
  await request.post('/api/v1/auth/verify-email', { headers, data: { token } });
  return { email, password };
}
