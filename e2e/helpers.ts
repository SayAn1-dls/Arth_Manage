import { existsSync, readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';
import { navFor } from '../apps/web/src/shell/nav.js';

/**
 * Opens a destination the way a person would: Core Admins click the domain in the sidebar, then the task
 * card on the domain's landing page ("Advanced tools" unfolded first); other roles use More (All areas).
 * Domains are looked up in the app's own navigation definitions, so the helper never drifts from them.
 */
export async function goToNav(page: Page, name: string, exact = false) {
  const match = page.url().match(/\/events\/[^/?#]+/);
  if (!match) throw new Error(`goToNav needs an event page, got ${page.url()}`);
  const main = page.getByRole('main');
  const ready = () => main.getByRole('heading', { level: 2 }).first().waitFor();
  // Core Admins have domain links in the sidebar (present in the DOM even when the sidebar is hidden).
  const isAdmin = (await page.locator('a[href$="/area/configuration"]').count()) > 0;
  const domain = isAdmin
    ? navFor('ADMIN').find(
        (g) =>
          g.id !== 'command' &&
          [...g.items, ...(g.shortcuts ?? [])].some((i) =>
            exact ? i.label === name : i.label.includes(name),
          ),
      )
    : undefined;
  await page.goto(`${match[0]}/${domain ? `area/${domain.id}` : 'areas'}`);
  await ready();
  for (const toggle of await main.locator('button[aria-expanded="false"]:visible').all())
    await toggle.click();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await main
    .getByRole('link', { name: new RegExp(exact ? `^${escaped}(,|$)` : escaped) })
    .first()
    .click();
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
