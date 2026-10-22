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
