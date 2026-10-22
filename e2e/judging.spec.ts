import { expect, test } from '@playwright/test';
import { Api, future, newUser, pdf } from './api.js';
import { latestEmailLink, signInUi } from './helpers.js';

const base = 'http://localhost:5173';

test('judging: assignment, scoring with live weighted score, submit, and admin progress (AT-10, AT-13, AT-14)', async ({
  playwright,
  browser,
}) => {
  test.setTimeout(150_000);
  // ── Organiser creates and publishes an event ──
  const orgUser = await newUser(playwright, base, 'Olive Organiser');
  const admin = await Api.signedIn(playwright, base, orgUser.email, orgUser.password);
  const created = await admin.post('/events', {
    name: `Judging Cup ${Date.now()}`,
    type: 'HACKATHON',
    mode: 'IN_PERSON',
    startsAt: future(30),
    endsAt: future(31),
    timeZone: 'Asia/Kolkata',
    institution: 'Rishihood University',
    contactEmail: 'org@example.test',
  });
  const ev = `/events/${created.id}`;
  await admin.patch(ev, { version: 1, teamMin: 2, teamMax: 3 });
  const round = (await admin.get(`${ev}/rounds`)).rounds[0];
  await admin.patch(`${ev}/rounds/${round.id}`, {
    name: 'Round 1',
    submissionDeadline: future(29),
    graceMinutes: 0,
    latePolicy: 'REJECT',
    rankingScope: 'OVERALL',
    requiredEvaluations: 1,
    awardPositions: 3,
  });
  await admin.post(`${ev}/publish`);
  await admin.put(`${ev}/registration`, { status: 'OPEN' });

  // ── Two teams register and submit through the real API ──
  const teams: { id: string; name: string }[] = [];
  for (const name of ['Alpha Squad', 'Beta Brigade']) {
    const lead = await newUser(playwright, base, `${name} Lead`);
    const mate = await newUser(playwright, base, `${name} Mate`);
    const leadApi = await Api.signedIn(playwright, base, lead.email, lead.password);
    const mateApi = await Api.signedIn(playwright, base, mate.email, mate.password);
    for (const [api, who] of [
      [leadApi, lead],
      [mateApi, mate],
    ] as const)
      await api.post(`/public/events/${created.slug}/register`, {
        fullName: who.name,
        institution: 'Rishihood University',
      });
    const team = (await leadApi.post(`${ev}/teams`, { name })).team;
    await mateApi.post(`${ev}/teams/join`, { code: team.joinCode });
    const sub = await leadApi.get(`${ev}/rounds/${round.id}/submission`);
    const file = sub.fields.find((f: { type: string }) => f.type === 'FILE');
    const repo = sub.fields.find((f: { type: string }) => f.type === 'REPO_URL');
    const up = await leadApi.upload(
      `${ev}/rounds/${round.id}/submission/files/${file.id}`,
      pdf(name),
      'deck.pdf',
    );
    const draft = await leadApi.put(`${ev}/rounds/${round.id}/submission/draft`, {
      title: `${name} project`,
      summary: 'A useful thing.',
      version: up.version,
      values: { [file.id]: up.file.id, [repo.id]: 'https://github.com/owner/repo' },
    });
    await leadApi.post(`${ev}/rounds/${round.id}/submission/submit`, { version: draft.version });
    teams.push({ id: team.id, name });
  }

  // ── The deadline passes; the organiser sets up the rubric and invites a judge ──
  await admin.patch(`${ev}/rounds/${round.id}`, {
    name: 'Round 1',
    submissionDeadline: new Date(Date.now() - 60_000).toISOString(),
    graceMinutes: 0,
    latePolicy: 'REJECT',
    rankingScope: 'OVERALL',
    requiredEvaluations: 1,
    awardPositions: 3,
    reason: 'Simulating the deadline passing',
  });
  await admin.post(`${ev}/rounds/${round.id}/rubric/template`, { key: 'HACKATHON' });
  await admin.post(`${ev}/rounds/${round.id}/rubric/activate`);
  const judgeUser = await newUser(playwright, base, 'Jaya Judge');
  await admin.post(`${ev}/invitations`, { email: judgeUser.email, role: 'JUDGE' });
  const judgeApi = await Api.signedIn(playwright, base, judgeUser.email, judgeUser.password);
  const inviteLink = await latestEmailLink(judgeApi.ctx, judgeUser.email).then(async () => {
    // the most recent email to the judge is the invitation (verification came first)
    const res = await judgeApi.ctx.get(
      `/api/v1/dev/outbox?to=${encodeURIComponent(judgeUser.email)}`,
    );
    return (await res.json()).messages.find((m: { subject: string }) =>
      m.subject.includes('invited'),
    ).link as string;
  });
  await judgeApi.post('/invitations/accept', {
    token: new URL(inviteLink).searchParams.get('token'),
  });
  const members = (await admin.get(`${ev}/members`)).members as {
    membershipId: string;
    role: string;
  }[];
  const judgeMembership = members.find((m) => m.role === 'JUDGE')!.membershipId;
  await admin.post(`${ev}/rounds/${round.id}/assignments`, {
    judgeMembershipIds: [judgeMembership],
    teamIds: teams.map((t) => t.id),
  });
  await admin.put(`${ev}/rounds/${round.id}/judging`, { status: 'OPEN' });

  // ── The judge scores Alpha Squad in the browser ──
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInUi(page, judgeUser.email, judgeUser.password);
  await page.getByRole('link', { name: /Judging Cup/ }).click();
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

  // ── Another team's workspace is not reachable by URL guessing, and the organiser sees the progress ──
  const foreign = await page.request.get(`/api/v1${ev}/rounds/${round.id}/judge/teams/not-a-team`);
  expect(foreign.status()).toBe(404);
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await signInUi(adminPage, orgUser.email, orgUser.password);
  await adminPage.goto(`/events/${created.id}/judging`);
  await expect(adminPage.getByText('1 of 2 submitted')).toBeVisible();
  await expect(adminPage.getByRole('row', { name: /Alpha Squad.*Submitted/ })).toBeVisible();
  await expect(adminPage.getByText('76.50').first()).toBeVisible();
  await Promise.all([ctx.close(), adminCtx.close()]);
});
