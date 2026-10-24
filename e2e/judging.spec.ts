import { expect, test } from '@playwright/test';
import { buildJudgingScenario } from './scenario.js';
import { signInUi } from './helpers.js';

test('judging: assignment, scoring with live weighted score, submit, and admin progress (AT-10, AT-13, AT-14)', async ({
  playwright,
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await buildJudgingScenario(playwright, {
    teams: ['Alpha Squad', 'Beta Brigade'],
    judges: 1,
  });
  const judge = s.judges[0]!;
  await s.admin.post(`${s.ev}/rounds/${s.roundId}/assignments`, {
    judgeMembershipIds: [judge.membershipId],
    teamIds: s.teams.map((t) => t.id),
  });
  await s.admin.put(`${s.ev}/rounds/${s.roundId}/judging`, { status: 'OPEN' });

  // The judge scores Alpha Squad in the browser
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInUi(page, judge.email, judge.password);
  await page.getByRole('link', { name: /Scenario Cup/ }).click();
  await expect(page.getByText('2 teams left to evaluate')).toBeVisible();
  await page.getByRole('link', { name: 'My teams' }).click();
  await expect(page.getByRole('heading', { name: 'Round 1' })).toBeVisible();
  await page.getByRole('link', { name: 'Alpha Squad' }).click();
  await expect(page.getByRole('heading', { name: 'Alpha Squad project' })).toBeVisible();
  await expect(page.locator('iframe[title*="deck.pdf"]')).toBeVisible();
  await expect(
    page.getByText('Weighted score appears when all 5 criteria are scored'),
  ).toBeVisible();

  const scores = [8, 7, 9, 6, 8]; // 20/20/25/20/15 weights over 1-10 -> 16 + 14 + 22.5 + 12 + 12 = 76.5
  const inputs = page.locator('input[type=number]');
  await expect(inputs).toHaveCount(5);
  await inputs.nth(0).fill('11');
  await expect(page.getByText('Weighted score appears')).toBeVisible();
  for (const [i, v] of scores.entries()) await inputs.nth(i).fill(String(v));
  await expect(page.getByText('Weighted score: 76.50 / 100')).toBeVisible();
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });

  await page.getByLabel('Feedback for the team (optional)').fill('Strong problem framing.');
  await page.getByRole('button', { name: 'Submit evaluation' }).click();
  await expect(page.getByRole('dialog').getByText('76.50')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit evaluation' }).click();
  await expect(page.getByText('Submitted. Weighted score 76.50')).toBeVisible();
  await expect(page.locator('input[type=number]').first()).toBeDisabled(); // read-only after submit

  // Guessing another team's workspace URL returns nothing, and the organiser sees the progress
  const foreign = await page.request.get(
    `/api/v1${s.ev}/rounds/${s.roundId}/judge/teams/not-a-team`,
  );
  expect(foreign.status()).toBe(404);
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await signInUi(adminPage, s.org.email, s.org.password);
  await adminPage.goto(`/events/${s.eventId}/judging`);
  await expect(adminPage.getByText('1 of 2 submitted')).toBeVisible();
  await expect(adminPage.getByRole('row', { name: /Alpha Squad.*Submitted/ })).toBeVisible();
  await expect(adminPage.getByText('76.50').first()).toBeVisible();
  await Promise.all([ctx.close(), adminCtx.close()]);
});
