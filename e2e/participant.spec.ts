import { expect, test } from '@playwright/test';
import { createOpenEvent, createVerifiedUser, signInUi } from './helpers.js';

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('slide '.repeat(200))]);

test('registration, team formation, submission and admin monitoring (AT-02, AT-03, AT-05)', async ({
  browser,
  request,
}) => {
  // Organiser sets up a published event through the API
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const org = await createVerifiedUser(request, 'Organiser Olive');
  await signInUi(admin, org.email, org.password);
  const event = await createOpenEvent(admin);

  // Participant A: finds the event link, registers and creates a team
  const aCtx = await browser.newContext();
  const a = await aCtx.newPage();
  const userA = await createVerifiedUser(request, 'Asha E2E');
  await signInUi(a, userA.email, userA.password);
  await a.goto(`/e/${event.slug}`);
  await expect(a.getByRole('heading', { level: 1, name: event.name })).toBeVisible();
  await a.getByRole('link', { name: 'Register', exact: true }).click();
  await a.getByLabel('Institution').fill('Rishihood University');
  await a.getByRole('button', { name: 'Register' }).click();
  await expect(a.getByRole('heading', { name: 'My team' })).toBeVisible();
  await a.getByLabel('Team name').fill('Quill Squad');
  await a.getByRole('button', { name: 'Create team' }).click();
  await expect(a.getByRole('heading', { name: 'Quill Squad' })).toBeVisible();
  await expect(a.getByText('Incomplete: needs 1 more')).toBeVisible();
  const code = (await a.locator('code').innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{8}$/);

  // Participant B registers and joins with the code
  const bCtx = await browser.newContext();
  const b = await bCtx.newPage();
  const userB = await createVerifiedUser(request, 'Ravi E2E');
  await signInUi(b, userB.email, userB.password);
  await b.goto(`/e/${event.slug}/register`);
  await b.getByLabel('Institution').fill('Rishihood University');
  await b.getByRole('button', { name: 'Register' }).click();
  await b.getByLabel('Join code').fill('WRONGCOD');
  await b.getByRole('button', { name: 'Find team' }).click();
  await expect(b.getByText('Code not recognised.').first()).toBeVisible();
  await b.getByLabel('Join code').fill(code);
  await b.getByRole('button', { name: 'Find team' }).click();
  await expect(b.getByRole('dialog').getByText('Led by')).toBeVisible();
  await b.getByRole('button', { name: 'Join team' }).click();
  await expect(b.getByRole('heading', { name: 'Quill Squad' })).toBeVisible();
  await expect(b.getByText('2 of 3')).toBeVisible();

  // Team A submits: a fake PDF is refused, a real one accepted
  await a.getByRole('link', { name: 'Submission' }).click();
  await a.getByLabel('Project title').fill('Fraud Radar');
  await a.getByLabel('Summary').fill('Flags suspicious UPI transactions in real time.');
  const picker = a.locator('input[type=file]');
  await picker.setInputFiles({
    name: 'deck.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('<html>not a pdf</html>'),
  });
  await expect(a.getByText(/does not look like a real PDF/)).toBeVisible();
  await picker.setInputFiles({ name: 'deck.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(a.getByRole('link', { name: /deck\.pdf/ })).toBeVisible();
  await a.getByLabel('Repository URL').fill('github.com/not-valid');
  await expect(a.getByText(/https link to a repository/).first()).toBeVisible();
  await a.getByLabel('Repository URL').fill('https://github.com/owner/fraud-radar');
  await expect(a.getByText('All changes saved')).toBeVisible();
  await a.getByRole('button', { name: 'Submit', exact: true }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(a.getByText(/Submitted version 1/)).toBeVisible();
  await expect(a.getByText('Version 1').first()).toBeVisible();

  // Teammate B sees the same submission
  await b.getByRole('link', { name: 'Submission' }).click();
  await expect(b.getByText('Submitted', { exact: true }).first()).toBeVisible();

  // Organiser monitors it and can open the submitted version
  await admin.goto(`/events/${event.id}/submissions`);
  await expect(admin.getByRole('row', { name: /Quill Squad.*Submitted/ })).toBeVisible();
  await admin.getByRole('link', { name: /Quill Squad/ }).click();
  await expect(admin.getByText('Fraud Radar')).toBeVisible();
  await expect(admin.getByRole('link', { name: /deck\.pdf/ })).toBeVisible();

  // Participants list and teams list work with URL-persisted filters
  await admin.goto(`/events/${event.id}/participants?q=ravi`);
  await expect(admin.getByRole('link', { name: 'Ravi E2E' })).toBeVisible();
  await expect(admin.getByRole('link', { name: 'Asha E2E' })).toHaveCount(0);
  await admin.reload();
  await expect(admin.getByRole('link', { name: 'Ravi E2E' })).toBeVisible();
  await admin.goto(`/events/${event.id}/teams?q=t-000`);
  await expect(admin.getByRole('link', { name: 'Quill Squad' })).toBeVisible();

  await Promise.all([adminCtx.close(), aCtx.close(), bCtx.close()]);
});
