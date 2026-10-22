// Visual QA: captures key screens at desktop and mobile widths into .qa-screenshots/ (git-ignored).
// Usage: start the app (`npm run dev`) and seed it (`npm run db:seed`), then `npm run qa:visual [-- <baseUrl> [filter]]`.
// Review the images against docs/BRAND_IMPLEMENTATION.md; never claim QA for a screen that was not captured.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const filter = process.argv[3];
const outDir = fileURLToPath(new URL('../.qa-screenshots/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const PASSWORD = 'Password!2345';
const accounts = {
  admin: 'admin@arthakram.test',
  judge1: 'judge1@arthakram.test',
  staff: 'staff@arthakram.test',
  asha: 'asha@arthakram.test',
};

// `as`: seeded account to sign in with. `{event}` in a path is replaced by the demo event id.
// Phases append screens here as features land.
const screens = [
  { name: 'home', path: '/' },
  { name: 'design-gallery', path: '/_design' },
  { name: 'login', path: '/login' },
  { name: 'register', path: '/register' },
  { name: 'forgot-password', path: '/forgot-password' },
  { name: 'my-events-admin', path: '/events', as: 'admin' },
  { name: 'event-overview-admin', path: '/events/{event}', as: 'admin' },
  { name: 'event-overview-judge', path: '/events/{event}', as: 'judge1' },
  { name: 'event-overview-staff', path: '/events/{event}', as: 'staff' },
  { name: 'event-overview-participant', path: '/events/{event}', as: 'asha' },
  ...(await import('./visual-qa.screens.mjs').then((m) => m.screens).catch(() => [])),
];
const viewports = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
];

// Prefer Playwright's bundled Chromium; fall back to the locally installed Google Chrome.
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));

async function signedInContext(vp, who, cache) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  if (who) {
    const res = await context.request.post(`${base}/api/v1/auth/login`, {
      headers: { 'X-Requested-With': 'arthakram' },
      data: { email: accounts[who], password: PASSWORD },
    });
    if (!res.ok()) throw new Error(`QA login failed for ${who}: ${res.status()}`);
    if (!cache.event) {
      const events = (await (await context.request.get(`${base}/api/v1/me/events`)).json()).events;
      cache.event = events.find((e) => e.slug === 'hacksonipat-2026')?.eventId;
    }
  }
  return context;
}

const cache = {};
for (const vp of viewports) {
  const contexts = new Map();
  for (const s of screens) {
    if (filter && !s.name.includes(filter)) continue;
    const key = s.as ?? '';
    if (!contexts.has(key)) contexts.set(key, await signedInContext(vp, s.as, cache));
    const page = await contexts.get(key).newPage();
    const path = s.path.replace('{event}', cache.event ?? '');
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (s.prepare) await s.prepare(page, cache, base);
    const file = `${outDir}${s.name}-${vp.label}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const facts = await page.evaluate(() => {
      const cs = (el) => getComputedStyle(el);
      const h1 = document.querySelector('h1');
      return {
        bodyBg: cs(document.body).backgroundColor,
        h1Font: h1 ? cs(h1).fontFamily.split(',')[0] : null,
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    console.log(`${s.name} @${vp.label}:`, JSON.stringify(facts));
    await page.close();
  }
  for (const c of contexts.values()) await c.close();
}
await browser.close();
