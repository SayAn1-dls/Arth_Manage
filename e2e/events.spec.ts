import { expect, test } from '@playwright/test';
import { ACCOUNTS, createVerifiedUser, goToNav, signInUi } from './helpers.js';

test.describe('event setup and guidebook', () => {
  test('admin creates, configures and publishes an event with a guidebook and announcement (AT-01)', async ({
    page,
    request,
  }) => {
    const { email, password } = await createVerifiedUser(request);
    await signInUi(page, email, password);

    await page.getByRole('link', { name: 'Create event' }).click();
    const name = `Case Cup ${Date.now()}`;
    await page.getByLabel('Event name').fill(name);
    await page.getByLabel('Starts').fill('2030-03-01T09:00');
    await page.getByLabel('Ends').fill('2030-03-02T18:00');
    await page.getByLabel('Contact email').fill('organisers@example.test');
    await page.getByRole('button', { name: 'Create event' }).click();

    // Publishing is blocked until a submission deadline exists (AT-01N)
    await expect(page.getByRole('heading', { name: 'Setup' })).toBeVisible();
    await expect(page.getByText('Missing: Round 1 submission deadline')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish event' })).toBeDisabled();

    await page.getByRole('link', { name: 'Rounds and deadlines' }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Submission deadline').fill('2030-03-02T12:00');
    await page.getByRole('button', { name: 'Save round' }).click();
    await expect(page.getByText(/2 Mar 2030, 12:00 IST/)).toBeVisible();

    await page.getByRole('link', { name: 'Setup' }).click();
    await expect(page.getByText('Everything required is set')).toBeVisible();
    await page.getByRole('button', { name: 'Publish event' }).click();
    await expect(page.getByText('Public link:')).toBeVisible();
    await page.getByRole('button', { name: 'Open registration' }).click();
    await expect(page.getByText('Registration open').first()).toBeVisible();

    await goToNav(page, 'Guidebook');
    await page.getByLabel('Content').fill('## Rules\n\nBe **kind**. Submit before the deadline.');
    await expect(page.getByRole('heading', { name: 'Rules' })).toBeVisible(); // live preview
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Publish version 1/ })
      .click();
    await expect(page.getByText(/Latest published: version 1/)).toBeVisible();

    await page.getByRole('link', { name: 'Announcements' }).click();
    await expect(
      page.getByText('Nothing posted yet.').or(page.getByText('No announcements yet')),
    ).toBeVisible();
    await page.getByLabel('Title').fill('Doors open at 9');
    await page.getByLabel('Message').fill('Bring your ID card.');
    await page.getByRole('button', { name: 'Post announcement' }).click();
    await expect(page.getByRole('heading', { name: 'Doors open at 9' })).toBeVisible();

    // The public page works without signing in
    const slug = page.url().includes('/events/') ? await page.evaluate(() => '') : '';
    void slug;
    await page.getByRole('link', { name: 'Setup' }).click();
    const publicLink = page.getByRole('link', { name: /^\/e\// });
    const href = await publicLink.getAttribute('href');
    await page.context().clearCookies();
    await page.goto(href!);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Registration is open')).toBeVisible();
  });

  test('participants and judges see published content but no admin screens', async ({ page }) => {
    await signInUi(page, ACCOUNTS.asha);
    await page.getByRole('link', { name: 'HackSonipat 2026' }).click();
    await expect(page.getByRole('link', { name: 'Setup' })).toHaveCount(0);
    await goToNav(page, 'Guidebook');
    await expect(page.getByRole('heading', { name: 'Welcome to HackSonipat' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible();
    await page.getByRole('link', { name: 'Announcements' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to HackSonipat 2026' })).toBeVisible();
    await expect(page.getByText('Judge briefing')).toHaveCount(0); // judge-only announcement is hidden
  });

  test('the downloaded guidebook PDF is a real PDF', async ({ page }) => {
    await signInUi(page, ACCOUNTS.asha);
    await page.getByRole('link', { name: 'HackSonipat 2026' }).click();
    const id = new URL(page.url()).pathname.split('/')[2];
    const res = await page.request.get(`/api/v1/events/${id}/guidebook/pdf`);
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
