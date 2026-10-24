import { expect, test } from '@playwright/test';
import { ACCOUNTS, latestEmailLink, signInUi } from './helpers.js';

test.describe('authentication', () => {
  test('register, verify by emailed link, sign in, see empty My events, sign out', async ({
    page,
    request,
  }) => {
    const email = `e2e-${Date.now()}@example.test`;
    await page.goto('/register');
    await page.getByLabel('Full name').fill('E2E Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('A-long-passphrase-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(`We sent a confirmation link to ${email}`)).toBeVisible();

    const link = await latestEmailLink(request, email);
    await page.goto(new URL(link).pathname + new URL(link).search);
    await expect(page.getByText('Email verified. You can sign in now.')).toBeVisible();

    await signInUi(page, email, 'A-long-passphrase-1');
    await expect(page.getByRole('heading', { name: 'My events' })).toBeVisible();
    await expect(page.getByText('No events yet')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/events');
    await expect(page).toHaveURL(/\/login/); // route guard after logout
  });

  test('wrong password shows a generic error and a validation summary shows field errors', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(ACCOUNTS.admin);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Email or password is incorrect')).toBeVisible();

    await page.goto('/register');
    await page.getByLabel('Full name').fill('X');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert').getByText('Please fix the following')).toBeVisible();
  });

  test('forgot and reset password end to end', async ({ page, request }) => {
    const email = `e2e-reset-${Date.now()}@example.test`;
    // create and verify an account through the API-backed UI quickly
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Reset Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('A-long-passphrase-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    const verify = new URL(await latestEmailLink(request, email));
    await page.goto(verify.pathname + verify.search);
    await expect(page.getByText('Email verified.')).toBeVisible();

    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText('a reset link is on its way')).toBeVisible();
    const reset = new URL(await latestEmailLink(request, email));
    await page.goto(reset.pathname + reset.search);
    await page.getByLabel('New password').fill('Totally-new-pass-2');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText('Password updated')).toBeVisible();
    await signInUi(page, email, 'Totally-new-pass-2');
  });

  test('seeded admin sees their event with a role badge', async ({ page }) => {
    await signInUi(page, ACCOUNTS.admin);
    await expect(page.getByRole('link', { name: 'HackSonipat 2026' })).toBeVisible();
    await page.getByRole('link', { name: 'HackSonipat 2026' }).click();
    await expect(page.getByText('Core admin').first()).toBeVisible();
  });
});
