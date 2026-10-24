import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { agentFor, createTestKit, createUser, resetDb, signedInAgent } from '../../test/helpers.js';
import { addJudge, judgedRound } from '../../test/world.js';

const kit = createTestKit();
const { db, app } = kit;
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

const T74 = [
  [8, 7, 4],
  [6, 9, 3],
]; // J1 = 76, J2 = 72 -> T = 74 (the PRD worked example)
const T100 = [
  [10, 10, 5],
  [10, 10, 5],
];
const T53 = [
  [5, 5, 3],
  [5, 5, 3],
];

type Scene = Awaited<ReturnType<typeof judgedRound>>;
const base = (s: Scene, suffix = '') => `${s.w.base}/rounds/${s.w.roundId}/results${suffix}`;
const review = async (s: Scene) => (await s.w.admin.get(base(s, '/review'))).body;

describe('result review (FR-032, FR-149..151)', () => {
  it('computes T from the evaluations, ranks with standard competition ranking and shows the per-judge breakdown', async () => {
    const s = await judgedRound(kit, { teams: { Zeta: T100, Xray: T74, Wolf: T53 } });
    const r = await review(s);
    const byName = Object.fromEntries(r.results.map((x: { name: string }) => [x.name, x]));
    expect(r.results.map((x: { name: string; rank: number }) => `${x.rank}:${x.name}`)).toEqual([
      '1:Zeta',
      '2:Xray',
      '3:Wolf',
    ]);
    expect(byName.Xray.score).toBe('74.0000');
    expect(
      byName.Xray.breakdown.map((b: { weightedScore: string }) => b.weightedScore).sort(),
    ).toEqual(['72.0000', '76.0000']);
    expect(byName.Zeta.score).toBe('100.0000');
    expect(r.canApprove).toBe(true);
  });

  it('flags a tie inside the award positions and blocks approval until it is resolved with a reason (AT-16)', async () => {
    const s = await judgedRound(kit, { teams: { Zeta: T100, Xray: T74, Yank: T74, Wolf: T53 } });
    const r = await review(s);
    expect(
      r.results
        .filter((x: { tied: boolean }) => x.tied)
        .map((x: { name: string; rank: number }) => `${x.name}@${x.rank}`)
        .sort(),
    ).toEqual(['Xray@2', 'Yank@2']);
    expect(r.results.find((x: { name: string }) => x.name === 'Wolf').rank).toBe(4); // standard competition ranking
    expect(r.checklist.unresolvedTies).toHaveLength(1);
    expect(r.canApprove).toBe(false);
    const blocked = await s.w.admin.post(base(s, '/approve'));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/1 tie\(s\) inside the award positions/);

    const ids = ['Xray', 'Yank'].map((n) => s.teams[n]!.teamId);
    expect(
      (
        await s.w.admin
          .put(base(s, '/ties'))
          .send({ group: 'Overall', rank: 2, teamIds: ids, mode: 'SHARE', reason: 'short' })
      ).status,
    ).toBe(422);
    // only genuinely tied teams can be resolved together
    expect(
      (
        await s.w.admin.put(base(s, '/ties')).send({
          group: 'Overall',
          rank: 1,
          teamIds: [s.teams.Zeta!.teamId, ids[0]!],
          mode: 'SHARE',
          reason: 'Not actually tied at all',
        })
      ).status,
    ).toBe(422);
    const order = [ids[1]!, ids[0]!];
    expect(
      (
        await s.w.admin.put(base(s, '/ties')).send({
          group: 'Overall',
          rank: 2,
          teamIds: ids,
          mode: 'ORDER',
          order,
          reason: 'Judges preferred Yank in a live pitch',
        })
      ).status,
    ).toBe(200);
    const after = await review(s);
    expect(after.results.map((x: { name: string; rank: number }) => `${x.rank}:${x.name}`)).toEqual(
      ['1:Zeta', '2:Yank', '3:Xray', '4:Wolf'],
    );
    expect(after.canApprove).toBe(true);
  });

  it('lets tied teams share a position when the organiser decides so', async () => {
    const s = await judgedRound(kit, { teams: { Zeta: T100, Xray: T74, Yank: T74 } });
    const ids = ['Xray', 'Yank'].map((n) => s.teams[n]!.teamId);
    await s.w.admin.put(base(s, '/ties')).send({
      group: 'Overall',
      rank: 2,
      teamIds: ids,
      mode: 'SHARE',
      reason: 'Genuinely level, share second place',
    });
    const approve = await s.w.admin.post(base(s, '/approve'));
    expect(approve.status).toBe(201);
    const snap = await db.resultSnapshot.findFirstOrThrow();
    const entries = snap.entries as { name: string; rank: number; tied: boolean }[];
    expect(entries.map((e) => `${e.rank}:${e.name}`).sort()).toEqual([
      '1:Zeta',
      '2:Xray',
      '2:Yank',
    ]);
    expect(JSON.stringify(snap.tieDecisions)).toContain('Genuinely level');
  });

  it('requires judging to be closed and every team to have counted evaluations, or an exclusion with a reason (FR-031, FR-149)', async () => {
    const s = await judgedRound(kit, { teams: { Zeta: T100, Xray: T74 }, closeJudging: false });
    const open = await s.w.admin.post(base(s, '/approve'));
    expect(open.body.error.message).toMatch(/Judging must be closed/);
    await s.w.admin.put(`${s.w.base}/rounds/${s.w.roundId}/judging`).send({ status: 'CLOSED' });
    // a team where one judge never scored: pending assignment blocks approval
    const late = await judgedRound(kit, {
      teams: { Zeta: [T100[0]!] },
      required: 2,
      closeJudging: true,
    });
    const r = await review(late);
    expect(r.checklist.missing).toEqual([
      expect.objectContaining({ name: 'Zeta', counted: 1, required: 2, pending: 1 }),
    ]);
    expect((await late.w.admin.post(base(late, '/approve'))).body.error.message).toMatch(
      /lack counted evaluations/,
    );
    // excluding the missing assignment with a reason leaves 1 counted evaluation: approvable, flagged incomplete
    const pending = (await late.overview()).teams[0].assignments.find(
      (a: { evaluation: unknown }) => !a.evaluation,
    ).id as string;
    await late.w.admin
      .post(`${late.w.base}/assignments/${pending}/exclude`)
      .send({ reason: 'Judge fell ill on the day' });
    const fixed = await review(late);
    expect(fixed.canApprove).toBe(true);
    expect(fixed.results[0]).toMatchObject({ counted: 1, complete: false, score: '100.0000' });
    expect(fixed.results[0].excluded[0].reason).toBe('Judge fell ill on the day');
  });

  it('can mark a team Not ranked with a reason, and never ranks disqualified teams or teams that did not submit', async () => {
    const s = await judgedRound(kit, { teams: { Zeta: T100, Xray: T74, Wolf: T53 } });
    await s.w.admin
      .post(`${s.w.base}/teams/${s.teams.Wolf!.teamId}/disqualify`)
      .send({ reason: 'Plagiarised project' });
    const idle = await (await import('../../test/world.js')).teamOfTwo(s.w, 'Idle Ones'); // never submitted
    void idle;
    const r = await review(s);
    const wolf = r.results.find((x: { name: string }) => x.name === 'Wolf');
    expect(wolf).toMatchObject({ state: 'DISQUALIFIED', rank: null, score: null });
    expect(r.results.find((x: { name: string }) => x.name === 'Idle Ones')).toMatchObject({
      state: 'DID_NOT_SUBMIT',
      rank: null,
    });
    await s.w.admin
      .put(base(s, '/not-ranked'))
      .send({ teamId: s.teams.Xray!.teamId, reason: 'Withdrew before final presentation' });
    const after = await review(s);
    expect(after.results.find((x: { name: string }) => x.name === 'Xray')).toMatchObject({
      state: 'NOT_RANKED',
      rank: null,
    });
    expect(after.results.find((x: { name: string }) => x.name === 'Zeta').rank).toBe(1);
  });
});

describe('approval, invalidation and publication (FR-034, FR-035)', () => {
  it('approves into an immutable versioned snapshot', async () => {
    const s = await judgedRound(kit, { teams: { Zeta: T100, Xray: T74 } });
    const res = await s.w.admin.post(base(s, '/approve'));
    expect(res.body.versionNo).toBe(1);
    const snap = await db.resultSnapshot.findFirstOrThrow();
    expect((snap.entries as { score: string }[]).map((e) => e.score)).toEqual([
      '100.0000',
      '74.0000',
    ]);
    await expect(
      db.resultSnapshot.update({ where: { id: snap.id }, data: { entries: [] } }),
    ).rejects.toThrow(/immutable/);
    await expect(db.resultSnapshot.delete({ where: { id: snap.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
    // status and publication bookkeeping remain updatable
    await db.resultSnapshot.update({
      where: { id: snap.id },
      data: { status: 'INVALIDATED', invalidatedReason: 'test' },
    });
    expect(await db.auditLog.count({ where: { action: 'results.approved' } })).toBe(1);
  });

  it('withdraws the approval when an evaluation is reopened, a team is disqualified or a decision changes', async () => {
    const s = await judgedRound(kit, { teams: { Zeta: T100, Xray: T74, Wolf: T53 } });
    await s.w.admin.post(base(s, '/approve'));
    expect((await review(s)).approvedVersion).toBe(1);
    // disqualification after approval
    await s.w.admin
      .post(`${s.w.base}/teams/${s.teams.Wolf!.teamId}/disqualify`)
      .send({ reason: 'Late discovery of plagiarism' });
    const r = await review(s);
    expect(r.approvedVersion).toBeNull();
    expect((await db.resultSnapshot.findFirstOrThrow()).status).toBe('INVALIDATED');
    expect(await db.auditLog.count({ where: { action: 'results.invalidated' } })).toBe(1);
    expect((await s.w.admin.post(base(s, '/publish'))).body.error.code).toBe('not_approved');
    // re-approving produces version 2; version 1 is kept
    expect((await s.w.admin.post(base(s, '/approve'))).body.versionNo).toBe(2);
    expect(await db.resultSnapshot.count()).toBe(2);
    // reopening an evaluation after approval invalidates again
    const a = s.assignmentOf(s.judges[0]!.membershipId, s.teams.Zeta!.teamId);
    await s.w.admin
      .post(`${s.w.base}/assignments/${a}/evaluation/reopen`)
      .send({ reason: 'Judge asked for a fix' });
    expect((await review(s)).approvedVersion).toBeNull();
    expect((await review(s)).canApprove).toBe(false); // reopened evaluation is pending again
  });

  it('keeps results private until published, then shows winners and only the toggled own-team details (AT-16, AT-18)', async () => {
    const s = await judgedRound(kit, {
      teams: {
        Zeta: T100,
        Xray: T74,
        Wolf: T53,
        Quill: [
          [7, 7, 3],
          [7, 7, 3],
        ],
      },
    });
    const zeta = s.teams.Zeta!.lead.agent;
    const wolf = s.teams.Wolf!.lead.agent;
    const results = (a: typeof zeta) => a.get(`${s.w.base}/results`);
    expect((await results(zeta)).body.rounds).toEqual([]); // nothing before approval or publication
    await s.w.admin.post(base(s, '/approve'));
    expect((await results(zeta)).body.rounds).toEqual([]); // approved is still private
    expect((await s.w.admin.post(base(s, '/publish'))).status).toBe(200);

    const z = (await results(zeta)).body;
    expect(
      z.rounds[0].winners.map((x: { rank: number; name: string }) => `${x.rank}:${x.name}`),
    ).toEqual(['1:Zeta', '2:Xray', '3:Quill']);
    expect(JSON.stringify(z)).not.toMatch(/\d{2,3}\.\d{4}/); // no scores by default
    expect(z.rounds[0].own).toMatchObject({ name: 'Zeta', rank: null, score: null }); // own rank is off by default
    const w = (await results(wolf)).body.rounds[0];
    expect(w.winners.map((x: { name: string }) => x.name)).not.toContain('Wolf'); // 4th place is not a winner

    await s.w.patchEvent({ showOwnRank: true, showOwnScores: true });
    const own = (await results(wolf)).body.rounds[0].own;
    expect(own).toMatchObject({ rank: 4, score: '53.0000' });
    // other teams' scores are never in a participant's payload
    expect(JSON.stringify((await results(wolf)).body)).not.toContain('74.0000');
    await s.w.patchEvent({ showWinners: false });
    expect((await results(wolf)).body.rounds[0].winners).toBeNull();
  });

  it('keeps showing the last published version until a corrected one is approved and republished', async () => {
    const s = await judgedRound(kit, { teams: { Zeta: T100, Xray: T74 } });
    const zeta = s.teams.Zeta!.lead.agent;
    await s.w.admin.post(base(s, '/approve'));
    await s.w.admin.post(base(s, '/publish'));
    await s.w.admin
      .post(`${s.w.base}/teams/${s.teams.Xray!.teamId}/disqualify`)
      .send({ reason: 'Rule breach found later' });
    expect((await review(s)).approvedVersion).toBeNull(); // approval withdrawn
    const stale = (await zeta.get(`${s.w.base}/results`)).body.rounds[0];
    expect(stale.versionNo).toBe(1); // participants still see v1
    expect(stale.updated).toBe(false);
    await s.w.admin.post(base(s, '/approve'));
    await s.w.admin.post(base(s, '/publish'));
    const fresh = (await zeta.get(`${s.w.base}/results`)).body.rounds[0];
    expect(fresh.versionNo).toBe(3 - 1);
    expect(fresh.updated).toBe(true);
    expect(fresh.winners.map((x: { name: string }) => x.name)).toEqual(['Zeta']);
    // unpublish needs a reason and hides everything again
    expect((await s.w.admin.post(base(s, '/unpublish')).send({ reason: '' })).status).toBe(422);
    expect(
      (await s.w.admin.post(base(s, '/unpublish')).send({ reason: 'Published by mistake' })).status,
    ).toBe(200);
    expect((await zeta.get(`${s.w.base}/results`)).body.rounds).toEqual([]);
  });

  it('concludes an event without a confirmation prompt once results are published', async () => {
    const s = await judgedRound(kit, { teams: { Zeta: T100, Xray: T74 } });
    await s.w.admin.post(base(s, '/approve'));
    await s.w.admin.post(base(s, '/publish'));
    expect((await s.w.admin.post(`${s.w.base}/conclude`).send({})).status).toBe(200);
  });
});

describe('who may do what with results (AT-16 permissions)', () => {
  it('shows judges, staff, non-participants and outsiders nothing, and lets only admins review, approve, publish and export', async () => {
    const s = await judgedRound(kit, { teams: { Zeta: T100, Xray: T74 } });
    await s.w.admin.post(base(s, '/approve'));
    await s.w.admin.post(base(s, '/publish'));
    const staffUser = await createUser(db);
    await db.eventMembership.create({
      data: { eventId: s.w.eventId, userId: staffUser.id, role: 'STAFF' },
    });
    const staff = await signedInAgent(app, staffUser.email);
    const outsider = await signedInAgent(app, (await createUser(db)).email);
    const participant = s.teams.Zeta!.lead.agent;
    const judge = s.judges[0]!.agent;
    for (const who of [judge, staff, outsider])
      expect((await who.get(`${s.w.base}/results`)).status).toBe(404);
    for (const who of [judge, staff, outsider, participant]) {
      expect((await who.get(base(s, '/review'))).status).toBe(404);
      expect((await who.post(base(s, '/approve'))).status).toBe(404);
      expect((await who.post(base(s, '/publish'))).status).toBe(404);
      expect((await who.post(base(s, '/unpublish')).send({ reason: 'x y z' })).status).toBe(404);
      expect((await who.put(base(s, '/ties')).send({})).status).toBe(404);
      expect((await who.get(base(s, '/export.csv'))).status).toBe(404);
    }
    expect((await agentFor(app).get(`${s.w.base}/results`)).status).toBe(401);
    // another event's admin cannot reach this round
    const other = await judgedRound(kit, { teams: { Other: T74 } });
    expect((await other.w.admin.get(base(s, '/review'))).status).toBe(404);
    expect((await other.w.admin.post(base(s, '/approve'))).status).toBe(404);
    void addJudge;
  });

  it('exports the latest snapshot as CSV for admins only, neutralising formulas, and audits it', async () => {
    const s = await judgedRound(kit, { teams: { '=cmd|calc': T100, Xray: T74 } });
    expect((await s.w.admin.get(base(s, '/export.csv'))).body.error.code).toBe('no_snapshot');
    await s.w.admin.post(base(s, '/approve'));
    const csv = await s.w.admin.get(base(s, '/export.csv'));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain("'=cmd|calc");
    expect(csv.text).toContain('100.0000');
    expect(await db.auditLog.count({ where: { action: 'export.results' } })).toBe(1);
  });
});
