import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, resetDb } from '../../test/helpers.js';
import {
  addJudge,
  closeSubmissions,
  openEvent,
  openJudging,
  submitProject,
  teamOfTwo,
  workedExampleRubric,
} from '../../test/world.js';

const kit = createTestKit();
const { db } = kit;
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

type World = Awaited<ReturnType<typeof openEvent>>;
const rubricUrl = (w: World, s = '') => `${w.base}/rounds/${w.roundId}/rubric${s}`;

describe('rubrics (FR-140..145, AT-11, AT-12)', () => {
  it('copies a template into a draft that activates without edits; edits never touch the template', async () => {
    const w = await openEvent(kit);
    const tpl = await w.admin.post(rubricUrl(w, '/template')).send({ key: 'HACKATHON' });
    expect(tpl.status).toBe(201);
    expect(tpl.body.rubric.criteria.map((c: { weight: number }) => c.weight)).toEqual([
      20, 20, 25, 20, 15,
    ]);
    expect(tpl.body.rubric.problems).toEqual([]);
    expect(tpl.body.rubric.state).toBe('DRAFT');
    expect((await w.admin.post(rubricUrl(w, '/activate'))).body.rubric.state).toBe('ACTIVE');
    const rubric = (await w.admin.get(rubricUrl(w))).body.rubric;
    expect(rubric.state).toBe('ACTIVE');
    expect(
      (await w.admin.get(`${w.base}/rounds/${w.roundId}/templates`)).body.templates,
    ).toHaveLength(2);
  });

  it('blocks activation with a specific message and enforces criterion limits (AT-12)', async () => {
    const w = await openEvent(kit);
    const body = (criteria: unknown[]) => ({
      name: 'Custom',
      teamCommentMode: 'OPTIONAL',
      criteria,
    });
    const draft = await w.admin.put(rubricUrl(w)).send(
      body([
        { name: 'A', description: '', weight: 50, min: 1, max: 10 },
        { name: 'B', description: '', weight: 45, min: 1, max: 10 },
      ]),
    );
    expect(draft.status).toBe(200); // drafts may be saved invalid
    const act = await w.admin.post(rubricUrl(w, '/activate'));
    expect(act.status).toBe(409);
    expect(act.body.error.message).toBe('Weights total 95%. They must total 100% to activate');
    const badRange = await w.admin
      .put(rubricUrl(w))
      .send(body([{ name: 'A', description: '', weight: 100, min: 1, max: 1 }]));
    expect(badRange.status).toBe(422);
    expect(badRange.body.error.details.fields['criteria.0.max']).toMatch(/above 1/);
    const badMin = await w.admin
      .put(rubricUrl(w))
      .send(body([{ name: 'A', description: '', weight: 100, min: 2, max: 10 }]));
    expect(badMin.body.error.details.fields['criteria.0.min']).toBe(
      'The lowest score must be 0 or 1',
    );
    expect((await w.admin.post(rubricUrl(w, '/activate'))).status).toBe(409);
    const thirteen = await w.admin.put(rubricUrl(w)).send(
      body(
        Array.from({ length: 13 }, (_, i) => ({
          name: `C${i}`,
          description: '',
          weight: 1,
          min: 1,
          max: 10,
        })),
      ),
    );
    expect(thirteen.status).toBe(422);
    const dup = await w.admin.put(rubricUrl(w)).send(
      body([
        { name: 'A', description: '', weight: 50, min: 1, max: 10 },
        { name: 'a', description: '', weight: 50, min: 1, max: 10 },
      ]),
    );
    expect(dup.body.rubric.problems.join('|')).toMatch(/used more than once/);
  });

  it('is admin-only to edit; a judge sees the rubric only when assigned and active', async () => {
    const w = await openEvent(kit);
    const judge = await addJudge(kit, w, 'Jaya');
    expect(
      (
        await judge.agent
          .put(rubricUrl(w))
          .send({ name: 'x', teamCommentMode: 'OFF', criteria: [] })
      ).status,
    ).toBe(404);
    expect(
      (await judge.agent.post(rubricUrl(w, '/template')).send({ key: 'HACKATHON' })).status,
    ).toBe(404);
    await w.admin.post(rubricUrl(w, '/template')).send({ key: 'HACKATHON' });
    await w.admin.post(rubricUrl(w, '/activate'));
    expect((await judge.agent.get(rubricUrl(w))).status).toBe(404); // not assigned in this round
  });

  it('locks at the first submitted evaluation and unlock reopens evaluations, keeping unchanged scores (FR-153)', async () => {
    const w = await openEvent(kit);
    const team = await teamOfTwo(w);
    await submitProject(w, team);
    await closeSubmissions(kit, w);
    const rubric = await workedExampleRubric(w);
    const judge = await addJudge(kit, w, 'Jaya');
    await w.admin
      .post(`${w.base}/rounds/${w.roundId}/assignments`)
      .send({ judgeMembershipIds: [judge.membershipId], teamIds: [team.teamId] });
    await openJudging(w);
    const a = (await w.admin.get(`${w.base}/rounds/${w.roundId}/judging/overview`)).body.teams[0]
      .assignments[0].id as string;
    const [A, B, C] = rubric.criteria.map((c) => c.id);
    const url = `${w.base}/assignments/${a}/evaluation`;
    const saved = await judge.agent
      .put(url)
      .send({ scores: { [A!]: 8, [B!]: 7, [C!]: 4 }, version: 0 });
    await judge.agent.post(`${url}/submit`).send({ version: saved.body.version });
    expect((await w.admin.get(rubricUrl(w))).body.rubric.state).toBe('LOCKED');
    expect(
      (await w.admin.put(rubricUrl(w)).send({ name: 'x', teamCommentMode: 'OFF', criteria: [] }))
        .status,
    ).toBe(409);
    // descriptions stay editable while locked and change no score
    expect(
      (await w.admin.patch(rubricUrl(w, `/criteria/${A}`)).send({ description: 'Clearer wording' }))
        .status,
    ).toBe(200);

    expect((await w.admin.post(rubricUrl(w, '/unlock')).send({ reason: 'x' })).status).toBe(422);
    const unlock = await w.admin
      .post(rubricUrl(w, '/unlock'))
      .send({ reason: 'Weight needs fixing' });
    expect(unlock.body.reopened).toBe(1);
    expect(unlock.body.rubric.state).toBe('DRAFT');
    // change only criterion C's range: A and B scores stay pre-filled, C's score is cleared
    const crit = unlock.body.rubric.criteria as {
      id: string;
      name: string;
      description: string;
      weight: number;
      min: number;
      max: number;
    }[];
    await w.admin.put(rubricUrl(w)).send({
      name: 'Worked example',
      teamCommentMode: 'OPTIONAL',
      criteria: crit.map((c) => (c.name === 'C' ? { ...c, max: 10 } : c)),
    });
    await w.admin.post(rubricUrl(w, '/activate'));
    const ws = (await judge.agent.get(`${w.base}/rounds/${w.roundId}/judge/teams/${team.teamId}`))
      .body;
    expect(ws.evaluation.status).toBe('REOPENED');
    expect(ws.evaluation.scores[A!]).toBe(8);
    expect(ws.evaluation.scores[B!]).toBe(7);
    expect(ws.evaluation.scores[C!]).toBeUndefined();
    expect(ws.editable).toBe(true);
  });
});

describe('judging status and assignments (FR-026..031)', () => {
  it('opens judging only with an active rubric after the deadline and grace; cannot reset once scoring began', async () => {
    const w = await openEvent(kit, { round: { graceMinutes: 30 } });
    const put = (status: string) =>
      w.admin.put(`${w.base}/rounds/${w.roundId}/judging`).send({ status });
    expect((await put('OPEN')).body.error.code).toBe('rubric_not_active');
    await w.admin.post(rubricUrl(w, '/template')).send({ key: 'HACKATHON' });
    await w.admin.post(rubricUrl(w, '/activate'));
    expect((await put('OPEN')).body.error.code).toBe('submissions_open');
    await kit.db.round.update({
      where: { id: w.roundId },
      data: { submissionDeadline: new Date(Date.now() - 10 * 60_000) },
    }); // inside grace
    expect((await put('OPEN')).body.error.code).toBe('submissions_open');
    await kit.db.round.update({
      where: { id: w.roundId },
      data: { submissionDeadline: new Date(Date.now() - 31 * 60_000) },
    });
    expect((await put('OPEN')).status).toBe(200);
    expect((await put('CLOSED')).status).toBe(200);
    expect(
      (await w.admin.get(`${w.base}/rounds/${w.roundId}/judging/overview`)).body.round
        .judgingStatus,
    ).toBe('CLOSED');
    expect(
      (
        await (
          await addJudge(kit, w, 'J')
        ).agent
          .put(`${w.base}/rounds/${w.roundId}/judging`)
          .send({ status: 'OPEN' })
      ).status,
    ).toBe(404);
  });

  it('assigns judges in bulk, ignores duplicates, skips disqualified teams and rejects people who are not judges (AT-10)', async () => {
    const w = await openEvent(kit);
    const t1 = await teamOfTwo(w, 'Alpha');
    const t2 = await teamOfTwo(w, 'Beta');
    const j1 = await addJudge(kit, w, 'J1');
    const j2 = await addJudge(kit, w, 'J2');
    await w.admin
      .post(`${w.base}/teams/${t2.teamId}/disqualify`)
      .send({ reason: 'Plagiarised project' });
    const bulk = await w.admin.post(`${w.base}/rounds/${w.roundId}/assignments`).send({
      judgeMembershipIds: [j1.membershipId, j2.membershipId],
      teamIds: [t1.teamId, t2.teamId],
    });
    expect(bulk.body).toMatchObject({
      created: 2,
      alreadyAssigned: 0,
      skippedDisqualified: ['T-0002'],
    });
    const again = await w.admin
      .post(`${w.base}/rounds/${w.roundId}/assignments`)
      .send({ judgeMembershipIds: [j1.membershipId], teamIds: [t1.teamId] });
    expect(again.body).toMatchObject({ created: 0, alreadyAssigned: 1 });
    const notJudge = await w.admin
      .post(`${w.base}/rounds/${w.roundId}/assignments`)
      .send({ judgeMembershipIds: [t1.lead.membershipId], teamIds: [t1.teamId] });
    expect(notJudge.status).toBe(422);
    // the database itself refuses a non-judge assignment
    await expect(
      kit.db.judgeAssignment.create({
        data: {
          eventId: w.eventId,
          roundId: w.roundId,
          teamId: t1.teamId,
          judgeMembershipId: t1.lead.membershipId,
        },
      }),
    ).rejects.toThrow(/only a judge/);
    expect(
      (
        await j1.agent
          .post(`${w.base}/rounds/${w.roundId}/assignments`)
          .send({ judgeMembershipIds: [j1.membershipId], teamIds: [t1.teamId] })
      ).status,
    ).toBe(404);
  });

  it('auto-balances so every team reaches the required count with even load', async () => {
    const w = await openEvent(kit, { round: { requiredEvaluations: 2 } });
    const teams = [
      await teamOfTwo(w, 'T One'),
      await teamOfTwo(w, 'T Two'),
      await teamOfTwo(w, 'T Three'),
    ];
    const judges = [
      await addJudge(kit, w, 'J1'),
      await addJudge(kit, w, 'J2'),
      await addJudge(kit, w, 'J3'),
    ];
    const res = await w.admin
      .post(`${w.base}/rounds/${w.roundId}/assignments/auto-balance`)
      .send({ judgeMembershipIds: judges.map((j) => j.membershipId) });
    expect(res.body.created).toBe(6);
    const overview = (await w.admin.get(`${w.base}/rounds/${w.roundId}/judging/overview`)).body;
    expect(
      overview.teams.every((t: { assignments: unknown[] }) => t.assignments.length === 2),
    ).toBe(true);
    expect(overview.judges.map((j: { assigned: number }) => j.assigned)).toEqual([2, 2, 2]);
    void teams;
    expect(
      (
        await w.admin
          .post(`${w.base}/rounds/${w.roundId}/assignments/auto-balance`)
          .send({ judgeMembershipIds: [judges[0]!.membershipId] })
      ).body.error.code,
    ).toBe('not_enough_judges');
  });

  it('keeps a submitted evaluation but stops counting it when a judge is unassigned, and restores it on re-assignment (FR-155)', async () => {
    const w = await openEvent(kit);
    const team = await teamOfTwo(w);
    await submitProject(w, team);
    await closeSubmissions(kit, w);
    const rubric = await workedExampleRubric(w);
    const judge = await addJudge(kit, w, 'Jaya');
    await w.admin
      .post(`${w.base}/rounds/${w.roundId}/assignments`)
      .send({ judgeMembershipIds: [judge.membershipId], teamIds: [team.teamId] });
    await openJudging(w);
    const overview = async () =>
      (await w.admin.get(`${w.base}/rounds/${w.roundId}/judging/overview`)).body;
    const a = (await overview()).teams[0].assignments[0].id as string;
    const [A, B, C] = rubric.criteria.map((c) => c.id);
    const saved = await judge.agent
      .put(`${w.base}/assignments/${a}/evaluation`)
      .send({ scores: { [A!]: 5, [B!]: 5, [C!]: 3 }, version: 0 });
    await judge.agent
      .post(`${w.base}/assignments/${a}/evaluation/submit`)
      .send({ version: saved.body.version });
    expect((await overview()).teams[0].counted).toBe(1);
    const noConfirm = await w.admin.delete(`${w.base}/assignments/${a}`);
    expect(noConfirm.body.error.code).toBe('confirm_required');
    expect((await w.admin.delete(`${w.base}/assignments/${a}?confirm=1`)).status).toBe(204);
    const after = await overview();
    expect(after.teams[0].counted).toBe(0);
    expect(after.teams[0].assignments[0].status).toBe('UNASSIGNED');
    expect(after.missing).toHaveLength(1);
    expect(
      (await judge.agent.get(`${w.base}/rounds/${w.roundId}/judge/teams/${team.teamId}`)).status,
    ).toBe(404); // access removed
    await w.admin
      .post(`${w.base}/rounds/${w.roundId}/assignments`)
      .send({ judgeMembershipIds: [judge.membershipId], teamIds: [team.teamId] });
    expect((await overview()).teams[0].counted).toBe(1); // the same evaluation counts again
    expect(await kit.db.evaluation.count()).toBe(1);
  });

  it('highlights judges with no progress in the final hour and lists missing evaluations', async () => {
    const w = await openEvent(kit);
    const team = await teamOfTwo(w);
    await submitProject(w, team);
    await kit.db.round.update({
      where: { id: w.roundId },
      data: {
        submissionDeadline: new Date(Date.now() - 60_000),
        judgingDeadline: new Date(Date.now() + 20 * 60_000),
      },
    });
    const judge = await addJudge(kit, w, 'Jaya');
    await w.admin
      .post(`${w.base}/rounds/${w.roundId}/assignments`)
      .send({ judgeMembershipIds: [judge.membershipId], teamIds: [team.teamId] });
    const o = (await w.admin.get(`${w.base}/rounds/${w.roundId}/judging/overview`)).body;
    expect(o.judgesAtRisk).toEqual([judge.membershipId]);
    expect(o.missing).toEqual([
      expect.objectContaining({ teamCode: 'T-0001', counted: 0, required: 2, shortfall: 2 }),
    ]);
  });
});
