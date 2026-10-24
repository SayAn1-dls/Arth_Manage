import { expect, test } from '@playwright/test';
import { Api, newUser } from './api.js';
import { BASE, buildJudgingScenario } from './scenario.js';
import { latestEmailLink, signInUi } from './helpers.js';

test('event day: tasks, check-in on a phone, issue reporting and the organiser dashboard (AT-20, AT-21)', async ({
  playwright,
  browser,
}) => {
  test.setTimeout(150_000);
  const s = await buildJudgingScenario(playwright, { teams: ['Alpha Squad'], judges: 0 });

  // An invited staff member and a task assigned to them
  const staff = await newUser(playwright, BASE, 'Sahil Staff');
  await s.admin.post(`${s.ev}/invitations`, { email: staff.email, role: 'STAFF' });
  const staffApi = await Api.signedIn(playwright, BASE, staff.email, staff.password);
  const link = await latestEmailLink(staffApi.ctx, staff.email, 'invited');
  await staffApi.post('/invitations/accept', {
    token: new URL(link).searchParams.get('token'),
  });
  const staffMembership = (
    (await s.admin.get(`${s.ev}/members`)).members as { membershipId: string; email: string }[]
  ).find((m) => m.email === staff.email)!.membershipId;
  await s.admin.post(`${s.ev}/staff/tasks`, {
    title: 'Run the check-in desk',
    type: 'CHECKIN',
    location: 'Main hall',
    assigneeMembershipIds: [staffMembership],
    teamIds: [s.teams[0]!.id],
  });

  // Phone-sized staff session
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await signInUi(page, staff.email, staff.password);
  await page.getByRole('link', { name: /Scenario Cup/ }).click();
  await expect(page.getByText('1 task to do')).toBeVisible();
  await page.getByRole('link', { name: 'My tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Run the check-in desk' })).toBeVisible();
  await page.getByRole('button', { name: 'Blocked' }).click();
  await expect(page.getByRole('button', { name: 'Mark blocked' })).toBeDisabled(); // a note is required
  await page.getByLabel('Note for the organisers').fill('No tables set up yet');
  await page.getByRole('button', { name: 'Mark blocked' }).click();
  await expect(page.getByText('No tables set up yet')).toBeVisible();

  // Check-in: search, mark both members present, verify one ID
  await page.getByRole('link', { name: 'Check-in' }).click();
  await page.getByLabel('Find a team').fill('alpha');
  await expect(page.getByRole('heading', { name: 'Alpha Squad' })).toBeVisible();
  expect(await page.content()).not.toMatch(/@example\.test/); // no emails on the staff card
  await page.getByRole('button', { name: 'Mark present' }).first().click();
  await expect(page.getByText('Partially checked in')).toBeVisible();
  await page.getByRole('button', { name: 'Mark present' }).first().click();
  await expect(page.getByText('Checked in', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Verify ID' }).first().click();
  await page.getByLabel('Note (optional)').fill('College ID matched');
  await page.getByRole('button', { name: 'Mark verified' }).click();
  await expect(page.getByText(/ID verified by Sahil Staff: College ID matched/)).toBeVisible();

  // An urgent issue
  await page
    .getByRole('navigation', { name: 'Event' })
    .getByRole('link', { name: 'Report an issue' })
    .click();
  await page.getByLabel('What happened?').fill('Projector is dead in hall B');
  await page.getByLabel('This is urgent').check();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Projector is dead in hall B')).toBeVisible();
  await expect(page.getByText('Urgent').first()).toBeVisible();

  // The organiser's dashboard reflects all of it
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signInUi(admin, s.org.email, s.org.password);
  await admin.goto(`/events/${s.eventId}`);
  await expect(admin.getByText('1 urgent issue')).toBeVisible();
  await expect(admin.getByText('Projector is dead in hall B').first()).toBeVisible();
  await expect(admin.getByText('2/2', { exact: false }).first()).toBeVisible(); // 2 of 2 people checked in
  await admin.getByRole('link', { name: 'Open the issue queue' }).click();
  await admin.getByRole('button', { name: 'Resolve' }).click();
  await admin.getByLabel('Resolution note').fill('Swapped the projector');
  await admin.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(admin.getByText('Swapped the projector')).toBeVisible();

  await admin.goto(`/events/${s.eventId}/audit?action=checkin`);
  await expect(admin.getByText('checkin.marked').first()).toBeVisible();
  await Promise.all([ctx.close(), adminCtx.close()]);
});
