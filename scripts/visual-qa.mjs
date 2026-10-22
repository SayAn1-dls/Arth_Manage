// Visual QA: captures key screens at desktop and mobile widths into .qa-screenshots/ (git-ignored).
// Usage: start the app (`npm run dev`), then `npm run qa:visual [-- <baseUrl>]`.
// Review the images against docs/BRAND_IMPLEMENTATION.md; never claim QA for a screen that was not captured.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const outDir = new URL('../.qa-screenshots/', import.meta.url).pathname.replace(/%20/g, ' ');
mkdirSync(outDir, { recursive: true });

const screens = [
  { name: 'home', path: '/' },
  { name: 'design-gallery', path: '/_design' },
];
const viewports = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
];

// Prefer Playwright's bundled Chromium; fall back to the locally installed Google Chrome.
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  for (const s of screens) {
    await page.goto(base + s.path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const file = `${outDir}${s.name}-${vp.label}.png`;
    await page.screenshot({ path: file, fullPage: true });
    // Cheap automated brand assertions alongside the visual review.
    const facts = await page.evaluate(() => {
      const cs = (el) => getComputedStyle(el);
      const h1 = document.querySelector('h1');
      return {
        bodyBg: cs(document.body).backgroundColor,
        bodyFont: cs(document.body).fontFamily.split(',')[0],
        h1Font: h1 ? cs(h1).fontFamily.split(',')[0] : null,
        h1Weight: h1 ? cs(h1).fontWeight : null,
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    console.log(`${s.name} @${vp.label}:`, JSON.stringify(facts), '->', file);
  }
  await page.close();
}
await browser.close();
