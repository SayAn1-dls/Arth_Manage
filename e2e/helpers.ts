import { existsSync, readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';

/** Opens a sidebar destination, expanding collapsed groups first when the link is not currently shown. */
export async function goToNav(page: Page, name: string, exact = false) {
  const nav = page.getByRole('navigation', { name: 'Event' });
  const link = nav.getByRole('link', { name, exact });
  await nav.waitFor(); // the layout renders a spinner first
  const menu = nav.getByRole('button', { name: /^Menu/ }); // folded menu on small screens
  if ((await menu.isVisible()) && (await menu.getAttribute('aria-expanded')) === 'false')
    await menu.click();
  // Role queries skip hidden elements; the Menu button itself is handled above.
  const collapsed = nav.getByRole('button', { expanded: false }).filter({ hasNotText: /^Menu/ });
  while (!(await link.isVisible()) && (await collapsed.count()) > 0)
    await collapsed.first().click();
  await link.click();
}

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

/**
 * Reads the most recent link emailed to an address. Development reads the dev outbox; a staging run with real
 * SMTP sets E2E_MAIL_FILE to the capture file written by scripts/staging/smtp-sink.mjs.
 */
export async function latestEmailLink(
  request: APIRequestContext,
  to: string,
  subjectIncludes = '',
): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const file = process.env.E2E_MAIL_FILE;
    if (file) {
      const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
      const mine = lines
        .map((l) => JSON.parse(l) as { to: string; subject: string; text: string })
        .filter(
          (m) => m.to.toLowerCase() === to.toLowerCase() && m.subject.includes(subjectIncludes),
        );
      const link = /https?:\/\/\S+/.exec(mine.at(-1)?.text ?? '')?.[0];
      if (link) return link;
    } else {
      const res = await request.get(`/api/v1/dev/outbox?to=${encodeURIComponent(to)}`);
      const messages = ((await res.json()).messages ?? []) as { link?: string; subject: string }[];
      const link = messages.find((m) => m.subject.includes(subjectIncludes))?.link;
      if (link) return link;
    }
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

export const CSRF = { 'X-Requested-With': 'arthakram' };
const future = (days: number) => new Date(Date.now() + days * 864e5).toISOString();

/** Creates a published event with registration open through the API, as the signed-in admin page. */
export async function createOpenEvent(
  page: Page,
  opts: { teamMin?: number; teamMax?: number } = {},
) {
  const api = page.request;
  const name = `E2E Cup ${Date.now()}`;
  const created = await (
    await api.post('/api/v1/events', {
      headers: CSRF,
      data: {
        name,
        type: 'HACKATHON',
        mode: 'IN_PERSON',
        startsAt: future(30),
        endsAt: future(31),
        timeZone: 'Asia/Kolkata',
        institution: 'Rishihood University',
        contactEmail: 'org@example.test',
      },
    })
  ).json();
  const base = `/api/v1/events/${created.id}`;
  await api.patch(base, {
    headers: CSRF,
    data: { version: 1, teamMin: opts.teamMin ?? 2, teamMax: opts.teamMax ?? 3 },
  });
  const rounds = (await (await api.get(`${base}/rounds`)).json()).rounds;
  await api.patch(`${base}/rounds/${rounds[0].id}`, {
    headers: CSRF,
    data: {
      name: 'Round 1',
      submissionDeadline: future(29),
      graceMinutes: 0,
      latePolicy: 'REJECT',
      rankingScope: 'OVERALL',
      requiredEvaluations: 2,
      awardPositions: 3,
    },
  });
  await api.post(`${base}/publish`, { headers: CSRF });
  await api.put(`${base}/registration`, { headers: CSRF, data: { status: 'OPEN' } });
  return {
    id: created.id as string,
    slug: created.slug as string,
    name,
    roundId: rounds[0].id as string,
  };
}
