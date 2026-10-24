import { expect, test } from '@playwright/test';
import { buildJudgingScenario, scoreEverything } from './scenario.js';
import { signInUi } from './helpers.js';

const FULL = [10, 10, 10, 10, 10];
const MID = [8, 7, 9, 6, 8];

test('feedback and certificates: collect feedback, release judge comments, generate, release and download (AT-18, AT-22)', async ({
  playwright,
  browser,
}) => {
  test.setTimeout(240_000);
  const s = await buildJudgingScenario(playwright, {
    teams: ['Alpha Squad', 'Beta Crew'],
    judges: 1,
  });
  await scoreEverything(
    s,
    { 'Alpha Squad': [FULL], 'Beta Crew': [MID] },
    { 'Alpha Squad': ['Sharp problem framing, thin demo.'] },
  );
  await s.admin.put(`${s.ev}/rounds/${s.roundId}/judging`, { status: 'CLOSED' });
  await s.admin.post(`${s.ev}/rounds/${s.roundId}/results/approve`);
  await s.admin.post(`${s.ev}/rounds/${s.roundId}/results/publish`);

  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  await signInUi(admin, s.org.email, s.org.password);

  // Nothing is visible to participants until the organiser opens the form
  const leadCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const lead = await leadCtx.newPage();
  const alpha = s.teams[0]!.lead;
  await signInUi(lead, alpha.email, alpha.password);
  await lead.goto(`/events/${s.eventId}/feedback`);
  await expect(lead.getByRole('heading', { name: "Feedback isn't open yet" })).toBeVisible();

  // Organiser opens the participant form
  await admin.goto(`/events/${s.eventId}/feedback`);
  await expect(admin.getByRole('heading', { name: 'Participant feedback' })).toBeVisible();
  await admin
    .locator('div', { has: admin.getByRole('heading', { name: 'Participant feedback' }) })
    .getByRole('button', { name: 'Open for responses' })
    .first()
    .click();
  await expect(admin.getByText('open', { exact: true }).first()).toBeVisible();

  // Participant answers once; required questions are enforced; the answer cannot be repeated
  await lead.goto(`/events/${s.eventId}/feedback`);
  await lead.getByRole('button', { name: 'Submit feedback' }).click();
  await expect(lead.getByText('This question is required').first()).toBeVisible();
  await lead
    .getByRole('group', { name: /Overall experience/ })
    .getByText('5', { exact: true })
    .click();
  await lead
    .getByRole('group', { name: /Ease of using the platform/ })
    .getByText('4', { exact: true })
    .click();
  await lead.getByLabel('What worked well').fill('Clear rounds and fast support');
  await lead.getByRole('button', { name: 'Submit feedback' }).click();
  await expect(lead.getByText('Thank you, your feedback is in')).toBeVisible();
  await lead.reload();
  await expect(lead.getByText('Thank you, your feedback is in')).toBeVisible();

  // Organiser sees aggregated, confidential results
  await admin.reload();
  await admin.getByRole('button', { name: 'View results' }).first().click();
  await expect(admin.getByText('1 of 4 responded')).toBeVisible();
  await expect(admin.getByText('Clear rounds and fast support')).toBeVisible();
  expect(await admin.content()).not.toContain('Alpha Squad Lead');

  // Judge comments stay private until released, then appear anonymised
  await lead.goto(`/events/${s.eventId}/feedback`);
  await expect(lead.getByText('Sharp problem framing')).toHaveCount(0);
  await admin.getByRole('button', { name: 'Release comments' }).click();
  await expect(admin.getByText('Released to teams')).toBeVisible();
  await lead.reload();
  await expect(lead.getByText('Sharp problem framing, thin demo.')).toBeVisible();
  await expect(lead.getByText('Judge 1', { exact: true })).toBeVisible();
  expect(await lead.content()).not.toContain('Judge 1 ');

  // Certificates: generate, review, release
  await admin.goto(`/events/${s.eventId}/certificates`);
  await expect(
    admin.getByRole('heading', { name: 'Generate participation certificates' }),
  ).toBeVisible();
  await expect(admin.getByText(/4 people are eligible/)).toBeVisible();
  await admin.getByRole('button', { name: 'Generate certificates' }).click();
  await expect(admin.getByText(/Done: 4 generated/)).toBeVisible({ timeout: 60_000 });
  await expect(admin.getByRole('cell', { name: /Alpha Squad Lead/ }).first()).toBeVisible();

  await lead.goto(`/events/${s.eventId}/certificates`);
  await expect(lead.getByRole('heading', { name: 'No certificates yet' })).toBeVisible();

  await admin.getByRole('button', { name: 'Release to recipients' }).click();
  await expect(admin.getByRole('button', { name: 'Release now' })).toBeDisabled();
  await admin.getByLabel('I have reviewed the list and the preview').check();
  await admin.getByRole('button', { name: 'Release now' }).click();
  await expect(admin.getByText('Released 4 certificates.')).toBeVisible();

  // The participant downloads their own PDF
  await lead.reload();
  await expect(lead.getByRole('heading', { name: 'Certificate of participation' })).toBeVisible();
  const [download] = await Promise.all([
    lead.waitForEvent('download'),
    lead.getByRole('link', { name: 'Download PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/Participation-Alpha-Squad-Lead\.pdf$/);

  // A name correction goes through the organiser
  await lead.getByRole('button', { name: 'My name is wrong' }).click();
  await lead.getByLabel('Name exactly as it should appear').fill('Alpha Squad Leader');
  await lead.getByRole('button', { name: 'Send correction request' }).click();
  await expect(lead.getByText(/The organisers will review your correction/)).toBeVisible();
  await admin.reload();
  await admin.getByRole('button', { name: 'Approve and regenerate' }).click();
  await expect(admin.getByRole('cell', { name: /Alpha Squad Leader/ }).first()).toBeVisible();
  await expect(admin.getByText('v2').first()).toBeVisible();

  // Another participant never sees this certificate
  const betaCtx = await browser.newContext();
  const beta = await betaCtx.newPage();
  await signInUi(beta, s.teams[1]!.lead.email, s.teams[1]!.lead.password);
  await beta.goto(`/events/${s.eventId}/certificates`);
  await expect(beta.getByText('Alpha Squad')).toHaveCount(0);

  await Promise.all([adminCtx.close(), leadCtx.close(), betaCtx.close()]);
});
