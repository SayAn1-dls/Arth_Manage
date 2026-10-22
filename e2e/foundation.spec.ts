import { expect, test } from '@playwright/test';

test.describe('foundation smoke', () => {
  test('home page renders on Paper with brand typography and a healthy API', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('hackathon');
    await expect(page.getByText('API and database are up')).toBeVisible();

    const facts = await page.evaluate(() => {
      const h1 = getComputedStyle(document.querySelector('h1')!);
      return {
        bg: getComputedStyle(document.body).backgroundColor,
        font: h1.fontFamily,
        weight: h1.fontWeight,
      };
    });
    expect(facts.bg).toBe('rgb(255, 243, 237)'); // Paper
    expect(facts.font).toContain('Bricolage Grotesque');
    expect(facts.weight).toBe('800');
  });

  test('has no horizontal scroll on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test('API health endpoint is reachable through the dev proxy', async ({ request }) => {
    const res = await request.get('/api/v1/health');
    expect(res.ok()).toBe(true);
    expect((await res.json()).database).toBe('up');
  });
});
