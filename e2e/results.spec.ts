import { expect, test } from '@playwright/test';
import { buildJudgingScenario, scoreEverything } from './scenario.js';
import { signInUi } from './helpers.js';

// Hackathon template (20/20/25/20/15 over 1-10): [10,10,10,10,10] = 100; [8,7,9,6,8] = 76.5
const FULL = [10, 10, 10, 10, 10];
const MID = [8, 7, 9, 6, 8];

test('results: review, tie decision, approval, publication and what participants see (AT-16, AT-18)', async ({
  playwright,
  browser,
}) => {
  test.setTimeout(180_000);
  const s = await buildJudgingScenario(playwright, {
    teams: ['Alpha Squad', 'Beta Brigade', 'Gamma Group'],
    judges: 1,
  });
  await scoreEverything(s, { 'Alpha Squad': [FULL], 'Beta Brigade': [MID], 'Gamma Group': [MID] });

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signInUi(admin, s.org.email, s.org.password);
  await admin.goto(`/events/${s.eventId}/results`);
  await expect(admin.getByRole('heading', { name: 'Results' })).toBeVisible();
  await expect(admin.getByText('Judging is closed')).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Approve results' })).toBeDisabled();

  // Close judging (as an organiser would); the two MID teams tie for second place
  await admin.goto(`/events/${s.eventId}/judging`);
  await admin.getByRole('button', { name: 'Close judging' }).click();
  await expect(admin.getByText('Judging closed')).toBeVisible();
  await admin.goto(`/events/${s.eventId}/results`);
  await expect(
    admin.getByText('1 tie(s) inside the 3 award positions need a decision'),
  ).toBeVisible();
  await expect(admin.getByRole('row', { name: /Alpha Squad.*100\.00/ })).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Approve results' })).toBeDisabled();

  // Decide the tie with a reason, then approve
  await admin
    .getByRole('row', { name: /Beta Brigade/ })
    .getByRole('button', { name: 'Resolve tie' })
    .click();
  await admin
    .getByRole('dialog')
    .getByLabel(/Reason/)
    .fill('Judges preferred Beta in the live pitch');
  await admin.getByRole('dialog').getByRole('button', { name: 'Save decision' }).click();
  await expect(admin.getByText('Tie decision saved.')).toBeVisible();
  await admin.getByRole('button', { name: 'Approve results' }).click();
  await expect(admin.getByText(/Approved as version 1/)).toBeVisible();

  // Participants see nothing until publication
  const lead = s.teams[1]!.lead;
  const pCtx = await browser.newContext();
  const p = await pCtx.newPage();
  await signInUi(p, lead.email, lead.password);
  await p.getByRole('link', { name: /Scenario Cup/ }).click();
  await p.getByRole('link', { name: 'Results', exact: true }).click();
  await expect(p.getByText('Results will appear here once published')).toBeVisible();

  await admin.getByRole('button', { name: /Publish version 1/ }).click();
  await expect(admin.getByText(/Version 1 is now visible to participants/)).toBeVisible();
  await p.reload();
  await expect(p.getByRole('heading', { name: 'Round 1' })).toBeVisible();
  await expect(p.locator('ol li').first()).toContainText('Alpha Squad');
  await expect(p.locator('ol li').nth(1)).toContainText('Beta Brigade');
  await expect(p.getByText(/\d{2,3}\.\d{2}/)).toHaveCount(0); // no scores for participants by default

  // A later disqualification withdraws the approval; participants keep seeing version 1
  await s.admin.post(`${s.ev}/teams/${s.teams[2]!.id}/disqualify`, {
    reason: 'Rule breach found later',
  });
  await admin.reload();
  await expect(admin.getByText('The previous approval was withdrawn')).toBeVisible();
  await expect(admin.getByRole('button', { name: /Publish version/ })).toHaveCount(0);
  await p.reload();
  await expect(p.locator('ol li').first()).toContainText('Alpha Squad');

  // The audit history shows who decided what
  await admin.goto(`/events/${s.eventId}/audit?action=results`);
  await expect(admin.getByText('results.approved')).toBeVisible();
  await expect(admin.getByText('results.published')).toBeVisible();
  await expect(admin.getByText('results.invalidated')).toBeVisible();
  await Promise.all([adminCtx.close(), pCtx.close()]);
});
