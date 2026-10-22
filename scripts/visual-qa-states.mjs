// Visual QA of non-happy-path states: loading, API errors, empty lists, validation errors, confirmation dialogs and
// out-of-role screens. Screenshots go to .qa-screenshots/ (git-ignored) and must be viewed, not just captured.
// Usage: start the app (`npm run dev`), seed it, then `node scripts/visual-qa-states.mjs [baseUrl]`.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = fileURLToPath(new URL('../.qa-screenshots/', import.meta.url));
mkdirSync(out, { recursive: true });
const H = { 'X-Requested-With': 'arthakram' };
const PW = 'Password!2345';
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const viewports = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
];

async function ctxFor(vp, email) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  if (email) {
    const r = await context.request.post(`${base}/api/v1/auth/login`, {
      headers: H,
      data: { email, password: PW },
    });
    if (!r.ok()) throw new Error(`login failed ${email}`);
  }
  return context;
}
const shot = async (page, name, vp, full = true) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}state-${name}-${vp.label}.png`, fullPage: full });
  console.log('captured', name, vp.label);
};

for (const vp of viewports) {
  const admin = await ctxFor(vp, 'admin@arthakram.test');
  const events = (await (await admin.request.get(`${base}/api/v1/me/events`)).json()).events;
  const cup = events.find((e) => e.slug === 'case-cup-2026').eventId;

  // Loading: the dashboard request is held back
  let page = await admin.newPage();
  await page.route('**/api/v1/events/*/dashboard', async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue();
  });
  await page.goto(`${base}/events/${cup}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await shot(page, 'loading-dashboard', vp);
  await page.close();

  // Error: the dashboard and participants calls fail
  page = await admin.newPage();
  await page.route('**/api/v1/events/*/dashboard', (route) => route.abort());
  await page.goto(`${base}/events/${cup}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500); // one automatic retry, then the error shows
  await shot(page, 'error-dashboard', vp);
  await page.close();
  page = await admin.newPage();
  await page.route('**/api/v1/events/*/participants**', (route) =>
    route.fulfill({
      status: 500,
      json: { error: { code: 'internal_error', message: 'Something went wrong' } },
    }),
  );
  await page.goto(`${base}/events/${cup}/participants`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await shot(page, 'error-participants', vp);
  await page.close();

  // Empty: a brand-new event with nothing in it
  const created = await admin.request.post(`${base}/api/v1/events`, {
    headers: H,
    data: {
      name: `Empty Event ${vp.label}`,
      type: 'HACKATHON',
      mode: 'IN_PERSON',
      startsAt: new Date(Date.now() + 30 * 864e5).toISOString(),
      endsAt: new Date(Date.now() + 31 * 864e5).toISOString(),
      timeZone: 'Asia/Kolkata',
      institution: 'Rishihood University',
      contactEmail: 'org@example.test',
    },
  });
  const fresh = (await created.json()).id;
  for (const [name, path] of [
    ['participants', 'participants'],
    ['teams', 'teams'],
    ['submissions', 'submissions'],
    ['judging', 'judging'],
    ['results', 'results'],
    ['certificates', 'certificates'],
    ['feedback', 'feedback'],
    ['audit', 'audit'],
    ['people', 'people'],
  ]) {
    page = await admin.newPage();
    await page.goto(`${base}/events/${fresh}/${path}`, { waitUntil: 'networkidle' });
    await shot(page, `empty-${name}`, vp);
    await page.close();
  }

  // Confirmation dialogs
  page = await admin.newPage();
  await page.goto(`${base}/events/${cup}/certificates`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Revoke' }).first().click();
  await shot(page, 'dialog-revoke-certificate', vp, false);
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Release to recipients' })
    .click({ trial: true })
    .catch(() => {});
  await page.close();
  page = await admin.newPage();
  await page.goto(`${base}/events/${cup}/results`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Mark not ranked' }).first().click();
  await shot(page, 'dialog-not-ranked', vp, false);
  await page.close();

  // Out-of-role and unknown screens
  const asha = await ctxFor(vp, 'asha@arthakram.test');
  const ev = (await (await asha.request.get(`${base}/api/v1/me/events`)).json()).events[0].eventId;
  page = await asha.newPage();
  await page.goto(`${base}/events/${ev}/audit`, { waitUntil: 'networkidle' });
  await shot(page, 'out-of-role', vp);
  await page.goto(`${base}/events/does-not-exist/team`, { waitUntil: 'networkidle' });
  await shot(page, 'unknown-event', vp);
  await page.close();

  // Validation summary and generic sign-in error
  const anon = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  page = await anon.newPage();
  await page.goto(`${base}/register`, { waitUntil: 'networkidle' });
  await page.getByLabel('Full name').fill('X');
  await page.getByLabel('Email').fill('nope');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForTimeout(300);
  await shot(page, 'validation-register', vp);
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill('admin@arthakram.test');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'login-error', vp);
  await page.goto(`${base}/not/a/page`, { waitUntil: 'networkidle' });
  await shot(page, 'unknown-page', vp);
  await Promise.all([admin.close(), asha.close(), anon.close()]);
}
await browser.close();
