import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, createUser, resetDb, signedInAgent } from '../../test/helpers.js';
import { addJudge, judgedRound, openEvent } from '../../test/world.js';

const kit = createTestKit();
const { db, app } = kit;
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

const T74 = [
  [8, 7, 4],
  [6, 9, 3],
];
const forms = (w: { base: string }, s = '') => `${w.base}/feedback${s}`;

describe('feedback forms (FR-210..215)', () => {
  it('creates the two default forms: confidential for participants, identified for judges', async () => {
    const w = await openEvent(kit);
    const res = (await w.admin.get(forms(w, '/forms'))).body.forms;
    const p = res.find((f: { audience: string }) => f.audience === 'PARTICIPANT');
    const j = res.find((f: { audience: string }) => f.audience === 'JUDGE');
    expect(p).toMatchObject({ confidential: true, state: 'DRAFT' });
    expect(p.questions).toHaveLength(7);
    expect(
      p.questions
        .filter((q: { required: boolean }) => q.required)
        .map((q: { text: string }) => q.text),
    ).toEqual(['Overall experience', 'Ease of using the platform']);
    expect(j).toMatchObject({ confidential: false });
    expect(j.questions).toHaveLength(5);
    expect((await (await w.participant('P')).agent.get(forms(w, '/forms'))).status).toBe(404); // forms admin is admin-only
  });

  it('is unavailable until opened, validates answers, accepts one response and refuses duplicates (AT-17)', async () => {
    const w = await openEvent(kit);
    const asha = await w.participant('Asha');
    expect((await asha.agent.get(forms(w, '/mine'))).body).toMatchObject({
      open: false,
      available: false,
      submitted: false,
    });
    expect(
      (await asha.agent.post(forms(w, '/responses')).send({ answers: { q1: 5, q3: 4 } })).body.error
        .code,
    ).toBe('feedback_not_open');
    await w.admin.post(forms(w, '/forms/PARTICIPANT/state')).send({ state: 'OPEN' });
    const mine = (await asha.agent.get(forms(w, '/mine'))).body;
    expect(mine.open).toBe(true);
    expect(mine.confidential).toBe(true);
    expect(mine.questions).toHaveLength(7);

    const bad = await asha.agent
      .post(forms(w, '/responses'))
      .send({ answers: { q1: 6, q7: 'Perhaps' } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.fields).toMatchObject({
      q1: 'Choose a rating from 1 to 5',
      q3: 'This question is required',
      q7: 'Choose one of the options',
    });
    expect(await db.feedbackResponse.count()).toBe(0);
    const ok = await asha.agent
      .post(forms(w, '/responses'))
      .send({ answers: { q1: 5, q3: 4, q5: 'Loved the guidebook' } });
    expect(ok.status).toBe(201);
    const dup = await asha.agent.post(forms(w, '/responses')).send({ answers: { q1: 1, q3: 1 } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/already submitted/);
    expect(await db.feedbackResponse.count()).toBe(1);
    expect((await asha.agent.get(forms(w, '/mine'))).body).toMatchObject({
      submitted: true,
      questions: [],
    });
  });

  it('records exactly one response when the same person submits twice at once', async () => {
    const w = await openEvent(kit);
    const asha = await w.participant('Asha');
    await w.admin.post(forms(w, '/forms/PARTICIPANT/state')).send({ state: 'OPEN' });
    const body = { answers: { q1: 5, q3: 4 } };
    const [a, b] = await Promise.all([
      asha.agent.post(forms(w, '/responses')).send(body),
      asha.agent.post(forms(w, '/responses')).send(body),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await db.feedbackResponse.count()).toBe(1);
  });

  it('closes manually or by time, and only eligible people can answer their own form', async () => {
    const w = await openEvent(kit);
    const asha = await w.participant('Asha');
    const judge = await addJudge(kit, w, 'Jaya');
    await w.admin.post(forms(w, '/forms/PARTICIPANT/state')).send({ state: 'OPEN' });
    await w.admin.post(forms(w, '/forms/JUDGE/state')).send({ state: 'OPEN' });
    // a judge answers the judge form, never the participant one
    expect((await judge.agent.get(forms(w, '/mine'))).body.audience).toBe('JUDGE');
    expect(
      (await judge.agent.post(forms(w, '/responses')).send({ answers: { q2: 4, q3: 4 } })).status,
    ).toBe(201);
    // a removed participant is not eligible
    const gone = await w.participant('Gone');
    await w.admin
      .post(`${w.base}/participants/${gone.membershipId}/remove`)
      .send({ reason: 'Left college' });
    expect(
      (await gone.agent.post(forms(w, '/responses')).send({ answers: { q1: 5, q3: 5 } })).status,
    ).toBe(404);
    // staff and outsiders cannot respond at all
    const staffU = await createUser(db);
    await db.eventMembership.create({
      data: { eventId: w.eventId, userId: staffU.id, role: 'STAFF' },
    });
    expect((await (await signedInAgent(app, staffU.email)).get(forms(w, '/mine'))).status).toBe(
      404,
    );
    expect(
      (await (await signedInAgent(app, (await createUser(db)).email)).get(forms(w, '/mine')))
        .status,
    ).toBe(404);
    // time-based close
    await db.feedbackForm.updateMany({
      where: { eventId: w.eventId, audience: 'PARTICIPANT' },
      data: { closeAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await asha.agent.post(forms(w, '/responses')).send({ answers: { q1: 5, q3: 5 } })).body.error
        .code,
    ).toBe('feedback_closed');
    await db.feedbackForm.updateMany({
      where: { eventId: w.eventId, audience: 'PARTICIPANT' },
      data: { closeAt: null },
    });
    await w.admin.post(forms(w, '/forms/PARTICIPANT/state')).send({ state: 'CLOSED' });
    expect(
      (await asha.agent.post(forms(w, '/responses')).send({ answers: { q1: 5, q3: 5 } })).body.error
        .message,
    ).toBe('Feedback has closed');
  });

  it('keeps question integrity once responses exist (FR-210)', async () => {
    const w = await openEvent(kit);
    const asha = await w.participant('Asha');
    await w.admin.post(forms(w, '/forms/PARTICIPANT/state')).send({ state: 'OPEN' });
    await asha.agent.post(forms(w, '/responses')).send({ answers: { q1: 5, q3: 4 } });
    const f = (await w.admin.get(forms(w, '/forms'))).body.forms.find(
      (x: { audience: string }) => x.audience === 'PARTICIPANT',
    );
    const put = (over: object) =>
      w.admin
        .put(forms(w, '/forms/PARTICIPANT'))
        .send({ questions: f.questions, confidential: f.confidential, ...over });
    expect((await put({ questions: f.questions.slice(1) })).body.error.code).toBe('form_locked');
    expect(
      (
        await put({
          questions: f.questions.map((q: { id: string }) =>
            q.id === 'q1' ? { ...q, type: 'LONG_TEXT' } : q,
          ),
        })
      ).body.error.code,
    ).toBe('form_locked');
    expect((await put({ confidential: false })).body.error.code).toBe('form_locked');
    expect(
      (
        await put({
          questions: [
            ...f.questions,
            { id: 'q8', type: 'SHORT_TEXT', text: 'New and mandatory', required: true },
          ],
        })
      ).body.error.code,
    ).toBe('form_locked');
    const rewording = await put({
      questions: [
        ...f.questions.map((q: { id: string; text: string }) =>
          q.id === 'q5' ? { ...q, text: 'What went well?' } : q,
        ),
        { id: 'q8', type: 'SHORT_TEXT', text: 'Anything else?', required: false },
      ],
    });
    expect(rewording.status).toBe(200);
    expect(await db.auditLog.count({ where: { action: 'feedback_form.updated' } })).toBe(1);
    const tooMany = await w.admin
      .put(forms(w, '/forms/JUDGE'))
      .send({
        confidential: false,
        questions: Array.from({ length: 16 }, (_, i) => ({
          id: `x${i}`,
          type: 'SHORT_TEXT',
          text: `Q${i}`,
          required: false,
        })),
      });
    expect(tooMany.status).toBe(422);
  });
});

describe('reviewing feedback (FR-213..215)', () => {
  it('shows response rate, averages and distributions, hides identity for confidential forms and exports CSV', async () => {
    const w = await openEvent(kit);
    const people = [
      await w.participant('Asha Kumari'),
      await w.participant('Ravi Rao'),
      await w.participant('Meena Iyer'),
    ];
    await w.admin.post(forms(w, '/forms/PARTICIPANT/state')).send({ state: 'OPEN' });
    await people[0]!.agent
      .post(forms(w, '/responses'))
      .send({ answers: { q1: 5, q3: 4, q5: 'Great mentors', q7: 'Yes' } });
    await people[1]!.agent
      .post(forms(w, '/responses'))
      .send({ answers: { q1: 3, q3: 4, q7: 'Maybe' } });
    const r = (await w.admin.get(forms(w, '/results/PARTICIPANT'))).body;
    expect(r).toMatchObject({ eligible: 3, responses: 2, confidential: true });
    expect(r.rate).toBeCloseTo(2 / 3, 5);
    const q1 = r.questions.find((q: { id: string }) => q.id === 'q1');
    expect(q1).toMatchObject({ average: 4, distribution: [0, 0, 1, 0, 1] });
    expect(r.questions.find((q: { id: string }) => q.id === 'q7').counts).toMatchObject({
      Yes: 1,
      Maybe: 1,
      No: 0,
    });
    expect(r.questions.find((q: { id: string }) => q.id === 'q5').answers).toEqual([
      'Great mentors',
    ]);
    expect(JSON.stringify(r)).not.toMatch(/Asha|Ravi|@example\.test/); // no identity anywhere in a confidential view
    const csv = await w.admin.get(forms(w, '/results/PARTICIPANT/export.csv'));
    expect(csv.text).toContain('Respondent 1');
    expect(csv.text).not.toMatch(/Asha|Ravi|@example\.test/);
    expect(csv.text).toContain('Great mentors');
    expect(await db.auditLog.count({ where: { action: 'export.feedback' } })).toBe(1);
  });

  it('handles an empty form and an identified judge form, and shows responses to no one but core admins (FR-215)', async () => {
    const w = await openEvent(kit);
    expect((await w.admin.get(forms(w, '/results/PARTICIPANT'))).body).toMatchObject({
      responses: 0,
      rate: 0,
    });
    const judge = await addJudge(kit, w, 'Jaya Judge');
    await w.admin.post(forms(w, '/forms/JUDGE/state')).send({ state: 'OPEN' });
    await judge.agent.post(forms(w, '/responses')).send({ answers: { q2: 5, q3: 3 } });
    expect(await db.feedbackResponse.count()).toBe(1);
    const csv = await w.admin.get(forms(w, '/results/JUDGE/export.csv'));
    expect(csv.text).toContain('Jaya Judge'); // identified form
    // nobody else may read responses, not even the respondent
    const asha = await w.participant('Asha');
    for (const who of [judge.agent, asha.agent]) {
      expect((await who.get(forms(w, '/results/JUDGE'))).status).toBe(404);
      expect((await who.get(forms(w, '/results/JUDGE/export.csv'))).status).toBe(404);
    }
  });
});

describe('releasing judge comments (FR-216)', () => {
  async function commentScene() {
    const s = await judgedRound(kit, { teams: { Zeta: T74, Xray: [[5, 5, 3], [5, 5, 3]] } });
    // each judge leaves a team comment and a private note (re-submission of the comment via reopen is not needed: set directly)
    await db.evaluation.updateMany({
      data: { teamComment: 'Clear structure', privateNote: 'SECRET NOTE' },
    });
    return s;
  }
  const url = (s: Awaited<ReturnType<typeof commentScene>>, suffix = '') =>
    `${s.w.base}/rounds/${s.w.roundId}/comments${suffix}`;

  it('refuses to release before results are published, then shows each team only its own comments as Judge 1, Judge 2', async () => {
    const s = await commentScene();
    expect((await s.w.admin.post(url(s, '/release'))).body.error.code).toBe(
      'results_not_published',
    );
    await s.w.admin.post(`${s.w.base}/rounds/${s.w.roundId}/results/approve`);
    await s.w.admin.post(`${s.w.base}/rounds/${s.w.roundId}/results/publish`);
    const zeta = s.teams.Zeta!.lead.agent;
    expect((await zeta.get(`${s.w.base}/feedback/team-comments`)).body.rounds).toEqual([]); // not released yet
    expect((await s.w.admin.post(url(s, '/release'))).status).toBe(200);
    const mine = (await zeta.get(`${s.w.base}/feedback/team-comments`)).body;
    expect(mine.rounds[0].comments).toEqual([
      { label: 'Judge 1', comment: 'Clear structure' },
      { label: 'Judge 2', comment: 'Clear structure' },
    ]);
    const json = JSON.stringify(mine);
    expect(json).not.toMatch(/SECRET NOTE|Judge 1 Mate|@example\.test/);
    expect(json).not.toContain(s.judges[0]!.user.name === 'Judge 1' ? 'Judge 1 ' : 'zzz'); // no judge names, only labels
    // admins can hide one comment with a reason; the hidden one disappears for the team
    const comments = (await s.w.admin.get(url(s))).body.comments as {
      evaluationId: string;
      teamName: string;
    }[];
    const target = comments.find((c) => c.teamName === 'Zeta')!;
    expect(
      (
        await s.w.admin
          .put(`${s.w.base}/evaluations/${target.evaluationId}/comment-visibility`)
          .send({ hidden: true })
      ).status,
    ).toBe(422);
    expect(
      (
        await s.w.admin
          .put(`${s.w.base}/evaluations/${target.evaluationId}/comment-visibility`)
          .send({ hidden: true, reason: 'Names a participant' })
      ).status,
    ).toBe(200);
    expect(
      (await zeta.get(`${s.w.base}/feedback/team-comments`)).body.rounds[0].comments,
    ).toHaveLength(1);
    // the other team never sees Zeta's comments
    const xray = (await s.teams.Xray!.lead.agent.get(`${s.w.base}/feedback/team-comments`)).body
      .rounds[0].comments;
    expect(xray).toHaveLength(2);
    // withdrawing hides everything again
    await s.w.admin.post(url(s, '/withdraw'));
    expect((await zeta.get(`${s.w.base}/feedback/team-comments`)).body.rounds).toEqual([]);
  });

  it("keeps comment administration and other teams' comments away from everyone else", async () => {
    const s = await commentScene();
    await s.w.admin.post(`${s.w.base}/rounds/${s.w.roundId}/results/approve`);
    await s.w.admin.post(`${s.w.base}/rounds/${s.w.roundId}/results/publish`);
    for (const who of [s.teams.Zeta!.lead.agent, s.judges[0]!.agent]) {
      expect((await who.get(url(s))).status).toBe(404);
      expect((await who.post(url(s, '/release'))).status).toBe(404);
    }
    expect((await s.judges[0]!.agent.get(`${s.w.base}/feedback/team-comments`)).status).toBe(404);
  });
});
