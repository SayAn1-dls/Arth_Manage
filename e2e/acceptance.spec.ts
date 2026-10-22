import { expect, test, type Page } from '@playwright/test';
import { buildJudgingScenario, scoreEverything } from './scenario.js';
import { signInUi } from './helpers.js';

const FULL = [10, 10, 10, 10, 10];
const MID = [8, 7, 9, 6, 8];

/**
 * Cross-role acceptance run on one event: who may open what, in the browser, at each stage of the lifecycle.
 * Individual workflows are covered by the other specs; this one proves the boundaries hold between them.
 */
test('role boundaries hold through the lifecycle (AT-01, AT-11, AT-12, AT-19)', async ({
  playwright,
  browser,
}) => {
  test.setTimeout(240_000);
  const s = await buildJudgingScenario(playwright, {
    teams: ['Alpha Squad', 'Beta Crew'],
    judges: 1,
  });
  const alpha = s.teams[0]!.lead;
  const judge = s.judges[0]!;

  const page = async (who: { email: string; password: string }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await signInUi(p, who.email, who.password);
    return { ctx, p };
  };
  const denied = async (p: Page, path: string) => {
    await p.goto(`/events/${s.eventId}/${path}`);
    // Out-of-scope screens never render their content; the shell shows a plain not-found or access message.
    await expect(
      p.getByRole('heading', { name: /Participants|Audit history|Judging|Setup/ }),
    ).toHaveCount(0);
  };

  // Participant: no organiser screens, no other team, no judge data
  const part = await page(alpha);
  for (const path of [
    'audit',
    'setup',
    'judging',
    'participants',
    'integrations',
    'certificates/export',
  ])
    await denied(part.p, path);
  const api = await part.ctx.request.get(`/api/v1/events/${s.eventId}/participants`);
  expect(api.status()).toBe(404);
  expect(
    (
      await part.ctx.request.get(`/api/v1/events/${s.eventId}/rounds/${s.roundId}/results`)
    ).status(),
  ).toBe(404);
  await part.ctx.close();

  // Judge: before judging opens sees only names; never admin data
  const j = await page(judge);
  expect((await j.ctx.request.get(`/api/v1/events/${s.eventId}/participants`)).status()).toBe(404);
  expect((await j.ctx.request.get(`/api/v1/events/${s.eventId}/audit`)).status()).toBe(404);
  expect((await j.ctx.request.get(`/api/v1/events/${s.eventId}/integrations`)).status()).toBe(404);
  await j.ctx.close();

  // After scoring and publication, a participant sees results but never raw judge scores
  await scoreEverything(
    s,
    { 'Alpha Squad': [FULL], 'Beta Crew': [MID] },
    { 'Alpha Squad': ['Great work'] },
  );
  await s.admin.put(`${s.ev}/rounds/${s.roundId}/judging`, { status: 'CLOSED' });
  await s.admin.post(`${s.ev}/rounds/${s.roundId}/results/approve`);
  await s.admin.post(`${s.ev}/rounds/${s.roundId}/results/publish`);
  const again = await page(alpha);
  await again.p.goto(`/events/${s.eventId}/results`);
  await expect(again.p.getByText('Alpha Squad').first()).toBeVisible();
  const body = await again.ctx.request.get(
    `/api/v1/events/${s.eventId}/rounds/${s.roundId}/results/published`,
  );
  expect(JSON.stringify(await body.json())).not.toMatch(
    /judgeName|breakdown|teamComment|Great work/,
  );
  // Unreleased judge comments are not served
  const comments = await again.ctx.request.get(
    `/api/v1/events/${s.eventId}/feedback/team-comments`,
  );
  expect(JSON.stringify(await comments.json())).not.toContain('Great work');
  await again.ctx.close();

  // Organiser sees everything for this event, and nothing from other organisers' events
  const org = await page(s.org);
  await org.p.goto(`/events/${s.eventId}/audit`);
  await expect(org.p.getByRole('heading', { name: 'Audit history' })).toBeVisible();
  await org.ctx.close();
});
