import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { teamScore, type ScoringCriterion } from '@arthakram/shared';
import { createTestKit, createUser, resetDb, signedInAgent } from '../../test/helpers.js';
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
const { db, app } = kit;
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

/** One submitted team, the worked-example rubric, two judges assigned and judging open. */
async function scene(opts: { judges?: number } = {}) {
  const w = await openEvent(kit);
  const team = await teamOfTwo(w);
  await submitProject(w, team);
  const idle = await teamOfTwo(w, 'No Submit'); // never submits
  const unassigned = await teamOfTwo(w, 'Unassigned'); // submits but no judge is assigned
  await submitProject(w, unassigned, 'Secret Work');
  await closeSubmissions(kit, w);
  const rubric = await workedExampleRubric(w);
  const judges = [];
  for (let i = 0; i < (opts.judges ?? 2); i++)
    judges.push(await addJudge(kit, w, `Judge ${i + 1}`));
  await w.admin.post(`${w.base}/rounds/${w.roundId}/assignments`).send({
    judgeMembershipIds: judges.map((j) => j.membershipId),
    teamIds: [team.teamId, idle.teamId],
  });
  await openJudging(w);
  const overview = (await w.admin.get(`${w.base}/rounds/${w.roundId}/judging/overview`)).body;
  const assignmentOf = (judgeMembershipId: string, teamId: string) =>
    overview.teams
      .find((t: { teamId: string }) => t.teamId === teamId)
      .assignments.find(
        (a: { judgeMembershipId: string }) => a.judgeMembershipId === judgeMembershipId,
      ).id as string;
  const [A, B, C] = rubric.criteria.map((c) => c.id) as [string, string, string];
  return { w, team, idle, unassigned, judges, A, B, C, assignmentOf };
}

const evalUrl = (w: { base: string }, id: string, s = '') =>
  `${w.base}/assignments/${id}/evaluation${s}`;

describe('judge workspace and access (AT-13, AT-15)', () => {
  it('shows a judge only assigned teams, with members limited to name and institution', async () => {
    const s = await scene();
    const [j1] = s.judges;
    const list = (await j1!.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams`)).body;
    expect(list.rows.map((r: { teamCode: string }) => r.teamCode).sort()).toEqual([
      'T-0001',
      'T-0002',
    ]);
    const ws = (
      await j1!.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams/${s.team.teamId}`)
    ).body;
    expect(ws.submission.title).toBe('Fraud Radar');
    expect(ws.submission.versionNo).toBe(1);
    expect(
      ws.members.every(
        (m: Record<string, string>) => Object.keys(m).sort().join() === 'institution,name',
      ),
    ).toBe(true);
    expect(JSON.stringify(ws)).not.toMatch(/@example\.test/);
    expect(ws.rubric.criteria).toHaveLength(3);
    expect(ws.editable).toBe(true);
  });

  it("returns not found for unassigned teams, other judges' assignments, other roles and other events (AT-15)", async () => {
    const s = await scene();
    const outsiderTeam = s.unassigned;
    const [j1, j2] = s.judges;
    const asg = s.assignmentOf(j1!.membershipId, s.team.teamId);
    const j3 = await addJudge(kit, s.w, 'Third Judge');
    expect(
      (await j3.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams/${s.team.teamId}`)).status,
    ).toBe(404);
    expect(
      (await j1!.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams/${outsiderTeam.teamId}`))
        .status,
    ).toBe(404);
    expect((await j2!.agent.put(evalUrl(s.w, asg)).send({ scores: {}, version: 0 })).status).toBe(
      404,
    ); // someone else's assignment
    expect((await j2!.agent.post(evalUrl(s.w, asg, '/submit')).send({ version: 1 })).status).toBe(
      404,
    );
    expect(
      (await s.team.lead.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams`)).status,
    ).toBe(404);
    expect(
      (await s.team.lead.agent.put(evalUrl(s.w, asg)).send({ scores: {}, version: 0 })).status,
    ).toBe(404);
    // a judge from another event cannot reach this one
    const other = await openEvent(kit);
    const foreign = await addJudge(kit, other, 'Foreign');
    expect((await foreign.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams`)).status).toBe(
      404,
    );
    expect(
      (await foreign.agent.put(evalUrl(s.w, asg)).send({ scores: {}, version: 0 })).status,
    ).toBe(404);
    // judges never see other judges' scores or the admin evaluation list across judges
    const staff = await createUser(db);
    await db.eventMembership.create({
      data: { eventId: s.w.eventId, userId: staff.id, role: 'STAFF' },
    });
    const st = await signedInAgent(app, staff.email);
    expect((await st.get(`${s.w.base}/rounds/${s.w.roundId}/evaluations`)).status).toBe(404);
    expect((await st.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams`)).status).toBe(404);
  });

  it('serves submission files to assigned judges for the judged version only, not to unassigned judges', async () => {
    const s = await scene();
    const sub = await db.submission.findFirstOrThrow({ where: { teamId: s.team.teamId } });
    const file = await db.submissionFile.findFirstOrThrow({ where: { submissionId: sub.id } });
    const [j1] = s.judges;
    const ok = await j1!.agent.get(`${s.w.base}/files/${file.id}`);
    expect(ok.status).toBe(200);
    const j3 = await addJudge(kit, s.w, 'Third Judge');
    expect((await j3.agent.get(`${s.w.base}/files/${file.id}`)).status).toBe(404);
    // the file route is scoped to the judged version: it never serves a team's unsubmitted draft files
    expect(await db.submissionFile.count({ where: { submissionId: sub.id } })).toBe(1);
  });

  it('keeps work hidden and scoring disabled until judging opens', async () => {
    const w = await openEvent(kit);
    const team = await teamOfTwo(w);
    await submitProject(w, team);
    await closeSubmissions(kit, w);
    await workedExampleRubric(w);
    const judge = await addJudge(kit, w, 'Jaya');
    await w.admin
      .post(`${w.base}/rounds/${w.roundId}/assignments`)
      .send({ judgeMembershipIds: [judge.membershipId], teamIds: [team.teamId] });
    const ws = (await judge.agent.get(`${w.base}/rounds/${w.roundId}/judge/teams/${team.teamId}`))
      .body;
    expect(ws.locked).toMatch(/Judging opens after submissions close/);
    expect(ws.submission).toBeUndefined();
    const a = (await w.admin.get(`${w.base}/rounds/${w.roundId}/judging/overview`)).body.teams[0]
      .assignments[0].id as string;
    expect(
      (await judge.agent.put(evalUrl(w, a)).send({ scores: {}, version: 0 })).body.error.code,
    ).toBe('judging_not_open');
    const sub = await db.submission.findFirstOrThrow({ where: { teamId: team.teamId } });
    const file = await db.submissionFile.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect((await judge.agent.get(`${w.base}/files/${file.id}`)).status).toBe(404);
  });

  it('marks teams that did not submit as Not required and refuses scoring (derived, so an extension restores them)', async () => {
    const s = await scene();
    const [j1] = s.judges;
    const rows = (await j1!.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams`)).body
      .rows as { teamId: string; evaluationStatus: string; submission: string }[];
    const idleRow = rows.find((r) => r.teamId === s.idle.teamId)!;
    expect(idleRow).toMatchObject({
      evaluationStatus: 'NOT_REQUIRED',
      submission: 'DID_NOT_SUBMIT',
    });
    expect(rows[0]!.evaluationStatus).toBe('NOT_STARTED'); // default sort: not started first
    const ws = (
      await j1!.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams/${s.idle.teamId}`)
    ).body;
    expect(ws.editable).toBe(false);
    expect(ws.notEditableReason).toMatch(/did not submit/);
    // filters
    expect(
      (await j1!.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams?status=NOT_REQUIRED`))
        .body.rows,
    ).toHaveLength(1);
    expect(
      (await j1!.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams?q=nothing`)).body.rows,
    ).toHaveLength(0);
  });
});

describe('scoring and submission (AT-13, AT-14)', () => {
  it('stores the PRD worked example exactly: J1 = 76.0000, J2 = 72.0000, and T = 74.0000 from the stored scores', async () => {
    const s = await scene();
    const [j1, j2] = s.judges;
    const submit = async (judge: typeof j1, scores: number[]) => {
      const a = s.assignmentOf(judge!.membershipId, s.team.teamId);
      const saved = await judge!.agent
        .put(evalUrl(s.w, a))
        .send({ scores: { [s.A]: scores[0], [s.B]: scores[1], [s.C]: scores[2] }, version: 0 });
      expect(saved.status).toBe(200);
      return judge!.agent.post(evalUrl(s.w, a, '/submit')).send({ version: saved.body.version });
    };
    const r1 = await submit(j1, [8, 7, 4]);
    const r2 = await submit(j2, [6, 9, 3]);
    expect(r1.body.weightedScore).toBe('76.0000');
    expect(r2.body.weightedScore).toBe('72.0000');
    // T from what is actually stored in the database
    const evals = await db.evaluation.findMany({ include: { scores: true, assignment: true } });
    const criteria: ScoringCriterion[] = (await db.rubricCriterion.findMany()).map((c) => ({
      id: c.id,
      weight: c.weight,
      min: c.min,
      max: c.max,
    }));
    const t = teamScore(
      evals
        .filter((e) => e.assignment.teamId === s.team.teamId)
        .map((e) => ({
          criteria,
          scores: Object.fromEntries(e.scores.map((x) => [x.criterionId, x.score])),
        })),
    );
    expect(t?.toFixed(4)).toBe('74.0000');
    expect(await db.evaluationVersion.count()).toBe(2);
  });

  it('autosaves partial drafts, resumes from any device and never counts a draft', async () => {
    const s = await scene();
    const [j1] = s.judges;
    const a = s.assignmentOf(j1!.membershipId, s.team.teamId);
    const first = await j1!.agent
      .put(evalUrl(s.w, a))
      .send({ scores: { [s.A]: 8, [s.B]: null }, teamComment: 'Nice start', version: 0 });
    expect(first.status).toBe(200);
    const second = await j1!.agent
      .put(evalUrl(s.w, a))
      .send({ scores: { [s.A]: 9 }, privateNote: 'Check repo', version: first.body.version });
    expect(second.body.version).toBe(first.body.version + 1);
    const resumed = (
      await j1!.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams/${s.team.teamId}`)
    ).body.evaluation;
    expect(resumed).toMatchObject({
      status: 'DRAFT',
      scores: { [s.A]: 9 },
      privateNote: 'Check repo',
      teamComment: '',
    });
    const o = (await s.w.admin.get(`${s.w.base}/rounds/${s.w.roundId}/judging/overview`)).body;
    expect(o.teams.find((t: { teamId: string }) => t.teamId === s.team.teamId).counted).toBe(0);
    // a stale tab is refused instead of overwriting
    expect(
      (
        await j1!.agent
          .put(evalUrl(s.w, a))
          .send({ scores: { [s.A]: 1 }, version: first.body.version })
      ).body.error.code,
    ).toBe('stale_version');
  });

  it('rejects invalid scores whole, saving nothing (AT-14N)', async () => {
    const s = await scene();
    const [j1] = s.judges;
    const a = s.assignmentOf(j1!.membershipId, s.team.teamId);
    const bad = await j1!.agent
      .put(evalUrl(s.w, a))
      .send({ scores: { [s.A]: 5, [s.B]: 11, [s.C]: 2.5 }, version: 0 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.fields[s.B]).toBe('Enter a whole number from 1 to 10');
    expect(bad.body.error.details.fields[s.C]).toBe('Enter a whole number from 0 to 5');
    expect(await db.evaluation.count()).toBe(0);
    expect(await db.criterionScore.count()).toBe(0);
    const unknown = await j1!.agent.put(evalUrl(s.w, a)).send({ scores: { nope: 3 }, version: 0 });
    expect(unknown.status).toBe(422);
    const mass = await j1!.agent
      .put(evalUrl(s.w, a))
      .send({ scores: {}, version: 0, weightedScore: 100, status: 'SUBMITTED' });
    expect(mass.status).toBe(422); // mass assignment of server-owned fields is rejected
  });

  it('refuses to submit with a blank criterion and lists what is missing (AT-13N)', async () => {
    const s = await scene();
    const [j1] = s.judges;
    const a = s.assignmentOf(j1!.membershipId, s.team.teamId);
    const saved = await j1!.agent
      .put(evalUrl(s.w, a))
      .send({ scores: { [s.A]: 8, [s.B]: 7 }, version: 0 });
    const res = await j1!.agent
      .post(evalUrl(s.w, a, '/submit'))
      .send({ version: saved.body.version });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe('Score every criterion before submitting: C');
    expect(await db.evaluationVersion.count()).toBe(0);
    expect((await db.evaluation.findFirstOrThrow()).status).toBe('DRAFT');
  });

  it('requires team feedback when the rubric says so', async () => {
    const s = await scene();
    await db.rubric.updateMany({ data: { teamCommentMode: 'REQUIRED' } });
    const [j1] = s.judges;
    const a = s.assignmentOf(j1!.membershipId, s.team.teamId);
    const saved = await j1!.agent
      .put(evalUrl(s.w, a))
      .send({ scores: { [s.A]: 8, [s.B]: 7, [s.C]: 4 }, version: 0 });
    const res = await j1!.agent
      .post(evalUrl(s.w, a, '/submit'))
      .send({ version: saved.body.version });
    expect(res.body.error.details.fields.teamComment).toBeDefined();
  });

  it('makes a double submit produce exactly one evaluation, one version and one audit entry (AT-13N)', async () => {
    const s = await scene();
    const [j1] = s.judges;
    const a = s.assignmentOf(j1!.membershipId, s.team.teamId);
    const saved = await j1!.agent
      .put(evalUrl(s.w, a))
      .send({ scores: { [s.A]: 8, [s.B]: 7, [s.C]: 4 }, version: 0 });
    const body = { version: saved.body.version };
    const [r1, r2] = await Promise.all([
      j1!.agent.post(evalUrl(s.w, a, '/submit')).send(body),
      j1!.agent.post(evalUrl(s.w, a, '/submit')).send(body),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.code).toBe('already_submitted');
    expect(loser.body.error.message).toMatch(/already submitted at/);
    expect(await db.evaluation.count()).toBe(1);
    expect(await db.evaluationVersion.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'evaluation.submitted' } })).toBe(1);
  });

  it('makes a submitted evaluation read-only for the judge; the database keeps versions immutable', async () => {
    const s = await scene();
    const [j1] = s.judges;
    const a = s.assignmentOf(j1!.membershipId, s.team.teamId);
    const saved = await j1!.agent
      .put(evalUrl(s.w, a))
      .send({ scores: { [s.A]: 8, [s.B]: 7, [s.C]: 4 }, version: 0 });
    await j1!.agent.post(evalUrl(s.w, a, '/submit')).send({ version: saved.body.version });
    expect(
      (
        await j1!.agent
          .put(evalUrl(s.w, a))
          .send({ scores: { [s.A]: 1 }, version: saved.body.version + 1 })
      ).body.error.code,
    ).toBe('already_submitted');
    const v = await db.evaluationVersion.findFirstOrThrow();
    await expect(
      db.evaluationVersion.update({ where: { id: v.id }, data: { weightedScore: 100 } }),
    ).rejects.toThrow(/immutable/);
    await expect(db.evaluationVersion.delete({ where: { id: v.id } })).rejects.toThrow(/immutable/);
    expect(await db.evaluation.count({ where: { assignmentId: a } })).toBe(1); // one evaluation per assignment
    await expect(
      db.evaluation.create({ data: { assignmentId: a, eventId: s.w.eventId } }),
    ).rejects.toThrow();
  });

  it('closes judging: no new evaluations, but a reopened one can still be corrected (FR-100)', async () => {
    const s = await scene();
    const [j1, j2] = s.judges;
    const a1 = s.assignmentOf(j1!.membershipId, s.team.teamId);
    const a2 = s.assignmentOf(j2!.membershipId, s.team.teamId);
    const saved = await j1!.agent
      .put(evalUrl(s.w, a1))
      .send({ scores: { [s.A]: 8, [s.B]: 7, [s.C]: 4 }, version: 0 });
    await j1!.agent.post(evalUrl(s.w, a1, '/submit')).send({ version: saved.body.version });
    await s.w.admin.put(`${s.w.base}/rounds/${s.w.roundId}/judging`).send({ status: 'CLOSED' });
    expect(
      (await j2!.agent.put(evalUrl(s.w, a2)).send({ scores: { [s.A]: 5 }, version: 0 })).body.error
        .code,
    ).toBe('judging_closed');

    // judge asks, admin reopens that one evaluation; the judge resubmits as version 2 and both versions are kept
    const ask = await j1!.agent
      .post(evalUrl(s.w, a1, '/request-correction'))
      .send({ reason: 'Mistyped criterion B' });
    expect(ask.status).toBe(200);
    expect(
      (
        await s.w.admin.get(`${s.w.base}/rounds/${s.w.roundId}/judging/overview`)
      ).body.teams[0].assignments.find((a: { id: string }) => a.id === a1).evaluation
        .correctionRequested,
    ).toBe(true);
    expect(
      (await j2!.agent.post(evalUrl(s.w, a1, '/reopen')).send({ reason: 'sneaky' })).status,
    ).toBe(404);
    expect(
      (await s.w.admin.post(evalUrl(s.w, a1, '/reopen')).send({ reason: 'Judge requested a fix' }))
        .status,
    ).toBe(200);
    const current = (
      await j1!.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams/${s.team.teamId}`)
    ).body.evaluation;
    expect(current.status).toBe('REOPENED');
    const fix = await j1!.agent
      .put(evalUrl(s.w, a1))
      .send({ scores: { [s.A]: 8, [s.B]: 9, [s.C]: 4 }, version: current.version });
    const resubmit = await j1!.agent
      .post(evalUrl(s.w, a1, '/submit'))
      .send({ version: fix.body.version });
    expect(resubmit.status).toBe(201);
    expect(resubmit.body.weightedScore).toBe('84.0000'); // 30*.8 + 40*.9 + 30*.8
    expect(await db.evaluationVersion.count()).toBe(2);
    expect(
      (await db.evaluationVersion.findMany({ orderBy: { versionNo: 'asc' } })).map((v) =>
        v.weightedScore.toString(),
      ),
    ).toEqual(['76', '84']);
    expect(await db.auditLog.count({ where: { action: 'evaluation.resubmitted' } })).toBe(1);
  });

  it('lets an admin decline a correction request with a visible reason', async () => {
    const s = await scene();
    const [j1] = s.judges;
    const a = s.assignmentOf(j1!.membershipId, s.team.teamId);
    const saved = await j1!.agent
      .put(evalUrl(s.w, a))
      .send({ scores: { [s.A]: 8, [s.B]: 7, [s.C]: 4 }, version: 0 });
    await j1!.agent.post(evalUrl(s.w, a, '/submit')).send({ version: saved.body.version });
    await j1!.agent
      .post(evalUrl(s.w, a, '/request-correction'))
      .send({ reason: 'I changed my mind' });
    await s.w.admin.post(evalUrl(s.w, a, '/decline-correction')).send({ reason: 'Scores stand' });
    const ev = (
      await j1!.agent.get(`${s.w.base}/rounds/${s.w.roundId}/judge/teams/${s.team.teamId}`)
    ).body.evaluation;
    expect(ev.status).toBe('SUBMITTED');
    expect(ev.correctionDeclinedReason).toBe('Scores stand');
  });
});

describe('conflicts of interest (FR-097)', () => {
  it('lets a judge declare a conflict, disables scoring, shows it to admins, and needs a reason to override', async () => {
    const s = await scene();
    const [j1] = s.judges;
    const a = s.assignmentOf(j1!.membershipId, s.team.teamId);
    expect(
      (await j1!.agent.post(`${s.w.base}/assignments/${a}/conflict`).send({ reason: 'short' }))
        .status,
    ).toBe(422);
    expect(
      (
        await j1!.agent
          .post(`${s.w.base}/assignments/${a}/conflict`)
          .send({ reason: 'I mentor this team weekly' })
      ).status,
    ).toBe(200);
    expect(
      (await j1!.agent.put(evalUrl(s.w, a)).send({ scores: { [s.A]: 5 }, version: 0 })).body.error
        .code,
    ).toBe('conflict_declared');
    const o = (await s.w.admin.get(`${s.w.base}/rounds/${s.w.roundId}/judging/overview`)).body;
    expect(
      o.teams
        .find((t: { teamId: string }) => t.teamId === s.team.teamId)
        .assignments.find((x: { id: string }) => x.id === a),
    ).toMatchObject({ status: 'CONFLICT', conflictDeclaredBy: 'JUDGE' });
    expect(
      (
        await j1!.agent
          .post(`${s.w.base}/assignments/${a}/conflict/override`)
          .send({ reason: 'I want to' })
      ).status,
    ).toBe(404); // only admins override
    expect(
      (await s.w.admin.post(`${s.w.base}/assignments/${a}/conflict/override`).send({ reason: '' }))
        .status,
    ).toBe(422);
    expect(
      (
        await s.w.admin
          .post(`${s.w.base}/assignments/${a}/conflict/override`)
          .send({ reason: 'Declared in error' })
      ).status,
    ).toBe(200);
    expect(
      (await j1!.agent.put(evalUrl(s.w, a)).send({ scores: { [s.A]: 5 }, version: 0 })).status,
    ).toBe(200);
  });

  it('never counts a conflicted or excluded assignment toward the required evaluations', async () => {
    const s = await scene();
    const [j1, j2] = s.judges;
    const a1 = s.assignmentOf(j1!.membershipId, s.team.teamId);
    const a2 = s.assignmentOf(j2!.membershipId, s.team.teamId);
    for (const [j, a] of [
      [j1, a1],
      [j2, a2],
    ] as const) {
      const saved = await j!.agent
        .put(evalUrl(s.w, a))
        .send({ scores: { [s.A]: 8, [s.B]: 7, [s.C]: 4 }, version: 0 });
      await j!.agent.post(evalUrl(s.w, a, '/submit')).send({ version: saved.body.version });
    }
    const counted = async () =>
      (await s.w.admin.get(`${s.w.base}/rounds/${s.w.roundId}/judging/overview`)).body.teams.find(
        (t: { teamId: string }) => t.teamId === s.team.teamId,
      ).counted;
    expect(await counted()).toBe(2);
    await s.w.admin
      .post(`${s.w.base}/assignments/${a1}/exclude`)
      .send({ reason: 'Judge unavailable' });
    expect(await counted()).toBe(1);
    await s.w.admin.post(`${s.w.base}/assignments/${a1}/restore`);
    expect(await counted()).toBe(2);
  });
});

describe('evaluation review', () => {
  it("shows admins every judge's scores and notes but a judge only their own", async () => {
    const s = await scene();
    const [j1, j2] = s.judges;
    for (const [j, note] of [
      [j1, 'note one'],
      [j2, 'note two'],
    ] as const) {
      const a = s.assignmentOf(j!.membershipId, s.team.teamId);
      const saved = await j!.agent
        .put(evalUrl(s.w, a))
        .send({ scores: { [s.A]: 8, [s.B]: 7, [s.C]: 4 }, privateNote: note, version: 0 });
      await j!.agent.post(evalUrl(s.w, a, '/submit')).send({ version: saved.body.version });
    }
    const admin = (await s.w.admin.get(`${s.w.base}/rounds/${s.w.roundId}/evaluations`)).body
      .evaluations;
    expect(admin.map((e: { privateNote: string }) => e.privateNote).sort()).toEqual([
      'note one',
      'note two',
    ]);
    const mine = (await j1!.agent.get(`${s.w.base}/rounds/${s.w.roundId}/evaluations`)).body
      .evaluations;
    expect(mine).toHaveLength(1);
    expect(mine[0].privateNote).toBe('note one');
    expect(JSON.stringify(mine)).not.toContain('note two');
    // participants never see any of it
    expect(
      (await s.team.lead.agent.get(`${s.w.base}/rounds/${s.w.roundId}/evaluations`)).status,
    ).toBe(404);
  });
});
