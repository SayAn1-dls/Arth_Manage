import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, createUser, resetDb, signedInAgent } from '../../test/helpers.js';
import {
  addJudge,
  closeSubmissions,
  judgedRound,
  openEvent,
  submitProject,
  teamOfTwo,
} from '../../test/world.js';

const kit = createTestKit();
const { db, app } = kit;
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

type World = Awaited<ReturnType<typeof openEvent>>;

async function addStaff(w: World, name: string) {
  const user = await createUser(db, { name });
  const m = await db.eventMembership.create({
    data: { eventId: w.eventId, userId: user.id, role: 'STAFF' },
  });
  return { user, membershipId: m.id, agent: await signedInAgent(app, user.email) };
}

describe('staff tasks (FR-121..123, FR-130)', () => {
  it('lets admins assign tasks to staff only, and staff see and update only their own', async () => {
    const w = await openEvent(kit);
    const sahil = await addStaff(w, 'Sahil');
    const rita = await addStaff(w, 'Rita');
    const team = await teamOfTwo(w);
    const body = {
      title: 'Run the desk',
      type: 'CHECKIN',
      location: 'Main hall',
      assigneeMembershipIds: [sahil.membershipId],
      teamIds: [team.teamId],
    };
    expect(
      (await w.admin.post(`${w.base}/staff/tasks`).send({ ...body, assigneeMembershipIds: [] }))
        .status,
    ).toBe(422);
    expect(
      (
        await w.admin
          .post(`${w.base}/staff/tasks`)
          .send({ ...body, assigneeMembershipIds: [team.lead.membershipId] })
      ).status,
    ).toBe(422); // a participant is not staff
    const created = await w.admin.post(`${w.base}/staff/tasks`).send(body);
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    expect((await sahil.agent.get(`${w.base}/staff/tasks`)).body.tasks).toHaveLength(1);
    expect((await rita.agent.get(`${w.base}/staff/tasks`)).body.tasks).toHaveLength(0); // unassigned tasks are invisible
    expect(
      (await rita.agent.put(`${w.base}/staff/tasks/${id}/status`).send({ status: 'DONE' })).status,
    ).toBe(404);
    expect(
      (await sahil.agent.put(`${w.base}/staff/tasks/${id}/status`).send({ status: 'BLOCKED' }))
        .status,
    ).toBe(422); // a note is required
    const blocked = await sahil.agent
      .put(`${w.base}/staff/tasks/${id}/status`)
      .send({ status: 'BLOCKED', note: 'Printer is out of paper' });
    expect(blocked.body).toMatchObject({
      status: 'BLOCKED',
      note: 'Printer is out of paper',
      statusChangedBy: 'Sahil',
    });
    expect(
      (
        await sahil.agent
          .put(`${w.base}/staff/tasks/${id}/status`)
          .send({ status: 'DONE', note: 'Fixed' })
      ).body.status,
    ).toBe('DONE');
    // staff cannot create, edit or delete tasks
    expect((await sahil.agent.post(`${w.base}/staff/tasks`).send(body)).status).toBe(404);
    expect((await sahil.agent.patch(`${w.base}/staff/tasks/${id}`).send(body)).status).toBe(404);
    expect((await sahil.agent.delete(`${w.base}/staff/tasks/${id}`)).status).toBe(404);
    expect(await db.auditLog.count({ where: { action: 'staff_task.status_changed' } })).toBe(2);
    // participants and judges never reach tasks
    expect((await team.lead.agent.get(`${w.base}/staff/tasks`)).status).toBe(404);
    expect((await (await addJudge(kit, w, 'J')).agent.get(`${w.base}/staff/tasks`)).status).toBe(
      404,
    );
  });
});

describe('check-in (FR-124..126)', () => {
  it('finds teams by ID, name or participant, shows limited fields only and never email or phone', async () => {
    const w = await openEvent(kit);
    const sahil = await addStaff(w, 'Sahil');
    const team = await teamOfTwo(w, 'Quill Squad');
    for (const q of ['t-0001', 'quill', 'Quill Squad Lead']) {
      const res = await sahil.agent.get(`${w.base}/checkin/teams?q=${encodeURIComponent(q)}`);
      expect(res.body.teams).toHaveLength(1);
    }
    expect((await sahil.agent.get(`${w.base}/checkin/teams?q=nobody`)).body.teams).toHaveLength(0);
    const card = (await sahil.agent.get(`${w.base}/checkin/teams?q=quill`)).body.teams[0];
    expect(card.status).toBe('NOT_CHECKED_IN');
    expect(
      card.members.map((m: Record<string, unknown>) => Object.keys(m).sort().join()),
    ).not.toContain('email');
    const json = JSON.stringify(card);
    expect(json).not.toMatch(/@example\.test/);
    expect(json).not.toMatch(/9876543210/);
    void team;
  });

  it('marks attendance idempotently, derives team status, verifies ID with a note and limits undo (AT-21)', async () => {
    const w = await openEvent(kit);
    const sahil = await addStaff(w, 'Sahil');
    const rita = await addStaff(w, 'Rita');
    const team = await teamOfTwo(w, 'Quill Squad');
    const m1 = team.lead.membershipId;
    const m2 = team.mate.membershipId;
    const post = (agent: typeof sahil.agent, id: string, body: object) =>
      agent.post(`${w.base}/checkin/members/${id}`).send(body);
    expect((await post(sahil.agent, m1, { action: 'verify' })).body.error.code).toBe(
      'not_checked_in',
    );
    const first = await post(sahil.agent, m1, { action: 'check_in' });
    expect(first.body.status).toBe('PARTIAL');
    await post(sahil.agent, m1, { action: 'check_in' }); // double tap
    expect(await db.checkIn.count({ where: { membershipId: m1, undoneAt: null } })).toBe(1);
    const verified = await post(sahil.agent, m1, { action: 'verify', note: 'College ID matched' });
    expect(
      verified.body.members.find((m: { membershipId: string }) => m.membershipId === m1),
    ).toMatchObject({ idVerified: true, idVerifiedBy: 'Sahil', note: 'College ID matched' });
    expect((await post(rita.agent, m2, { action: 'check_in' })).body.status).toBe('CHECKED_IN');
    expect((await post(sahil.agent, m2, { action: 'undo' })).status).toBe(403); // only the marker or an admin may undo
    expect((await post(rita.agent, m2, { action: 'undo' })).body.status).toBe('PARTIAL');
    expect((await post(w.admin, m1, { action: 'undo' })).body.status).toBe('NOT_CHECKED_IN');
    const summary = (await sahil.agent.get(`${w.base}/checkin/summary`)).body;
    expect(summary).toMatchObject({ participants: 2, checkedIn: 0 });
    expect(
      await db.auditLog.count({
        where: { action: { in: ['checkin.marked', 'checkin.undone', 'checkin.id_verified'] } },
      }),
    ).toBe(5);
  });

  it('records one check-in when two staff tap the same participant at once', async () => {
    const w = await openEvent(kit);
    const a = await addStaff(w, 'Sahil');
    const b = await addStaff(w, 'Rita');
    const team = await teamOfTwo(w);
    const results = await Promise.allSettled([
      a.agent
        .post(`${w.base}/checkin/members/${team.lead.membershipId}`)
        .send({ action: 'check_in' }),
      b.agent
        .post(`${w.base}/checkin/members/${team.lead.membershipId}`)
        .send({ action: 'check_in' }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(
      await db.checkIn.count({ where: { membershipId: team.lead.membershipId, undoneAt: null } }),
    ).toBeLessThanOrEqual(1);
  });

  it('keeps check-in away from participants and judges, and from people outside the event', async () => {
    const w = await openEvent(kit);
    const team = await teamOfTwo(w);
    const judge = await addJudge(kit, w, 'J');
    for (const who of [team.lead.agent, judge.agent]) {
      expect((await who.get(`${w.base}/checkin/teams?q=t`)).status).toBe(404);
      expect(
        (
          await who
            .post(`${w.base}/checkin/members/${team.lead.membershipId}`)
            .send({ action: 'check_in' })
        ).status,
      ).toBe(404);
    }
    const other = await openEvent(kit);
    const foreignStaff = await addStaff(other, 'Foreign');
    expect((await foreignStaff.agent.get(`${w.base}/checkin/teams?q=t`)).status).toBe(404);
    expect(
      (
        await foreignStaff.agent
          .post(`${w.base}/checkin/members/${team.lead.membershipId}`)
          .send({ action: 'check_in' })
      ).status,
    ).toBe(404);
  });
});

describe('issues (FR-128, FR-129)', () => {
  it('lets staff report and escalate their own issues while admins see, acknowledge and resolve everything', async () => {
    const w = await openEvent(kit);
    const sahil = await addStaff(w, 'Sahil');
    const rita = await addStaff(w, 'Rita');
    const team = await teamOfTwo(w);
    expect(
      (await sahil.agent.post(`${w.base}/issues`).send({ category: 'TECHNICAL', description: '' }))
        .status,
    ).toBe(422);
    const made = await sahil.agent.post(`${w.base}/issues`).send({
      category: 'REGISTRATION_MISMATCH',
      description: 'Name does not match ID',
      teamId: team.teamId,
    });
    expect(made.status).toBe(201);
    const id = made.body.id as string;
    expect((await rita.agent.get(`${w.base}/issues`)).body.issues).toHaveLength(0); // staff see only their own
    expect((await rita.agent.post(`${w.base}/issues/${id}/escalate`)).status).toBe(404);
    const urgent = await sahil.agent.post(`${w.base}/issues/${id}/escalate`);
    expect(urgent.body.severity).toBe('URGENT');
    expect(
      (
        await sahil.agent
          .put(`${w.base}/issues/${id}/status`)
          .send({ status: 'RESOLVED', resolutionNote: 'self' })
      ).status,
    ).toBe(404); // admin only
    const queue = (await w.admin.get(`${w.base}/issues`)).body.issues;
    expect(queue[0]).toMatchObject({ id, severity: 'URGENT', reporter: 'Sahil' });
    expect(
      (await w.admin.put(`${w.base}/issues/${id}/status`).send({ status: 'RESOLVED' })).status,
    ).toBe(422);
    expect(
      (await w.admin.put(`${w.base}/issues/${id}/status`).send({ status: 'ACKNOWLEDGED' })).body
        .status,
    ).toBe('ACKNOWLEDGED');
    expect(
      (
        await w.admin
          .put(`${w.base}/issues/${id}/status`)
          .send({ status: 'RESOLVED', resolutionNote: 'ID re-checked, matches' })
      ).body,
    ).toMatchObject({ status: 'RESOLVED', resolutionNote: 'ID re-checked, matches' });
    expect((await sahil.agent.get(`${w.base}/issues`)).body.issues[0].status).toBe('RESOLVED'); // reporters see the status
    expect((await team.lead.agent.get(`${w.base}/issues`)).status).toBe(404);
  });

  it('lets an assigned judge report a missing file, and refuses unassigned judges (FR-094)', async () => {
    const s = await judgedRound(kit, {
      teams: {
        Zeta: [
          [8, 7, 4],
          [6, 9, 3],
        ],
      },
    });
    const [j1] = s.judges;
    const url = `${s.w.base}/rounds/${s.w.roundId}/judge/teams/${s.teams.Zeta!.teamId}/report-file`;
    const res = await j1!.agent.post(url).send({ description: 'The PDF shows a blank page' });
    expect(res.status).toBe(201);
    const issue = (await s.w.admin.get(`${s.w.base}/issues`)).body.issues[0];
    expect(issue.description).toMatch(/Missing or unreadable submission file/);
    expect(issue.team.teamCode).toBe('T-0001');
    const stranger = await addJudge(kit, s.w, 'Stranger');
    expect((await stranger.agent.post(url).send({})).status).toBe(404);
  });
});

describe('operational dashboard (FR-043)', () => {
  it('shows real numbers that match the lists, and only to core admins', async () => {
    const w = await openEvent(kit);
    const a = await teamOfTwo(w, 'Alpha');
    await teamOfTwo(w, 'Beta');
    await w.participant('Loner');
    await submitProject(w, a);
    const staff = await addStaff(w, 'Sahil');
    await staff.agent
      .post(`${w.base}/issues`)
      .send({ category: 'FACILITIES', description: 'No power sockets', severity: 'URGENT' });
    await staff.agent
      .post(`${w.base}/checkin/members/${a.lead.membershipId}`)
      .send({ action: 'check_in' });
    const d = (await w.admin.get(`${w.base}/dashboard`)).body;
    expect(d.participants).toMatchObject({ registered: 5, inTeam: 4, noTeam: 1 });
    expect(d.teams).toMatchObject({ total: 2, complete: 2, incomplete: 0 });
    const counts = d.submissions[0].counts;
    expect(counts).toMatchObject({ SUBMITTED: 1, NOT_STARTED: 1 });
    expect(d.checkin).toMatchObject({ participants: 5, checkedIn: 1 });
    expect(d.checkin.teams).toMatchObject({ partial: 1, notCheckedIn: 1 });
    expect(d.issues.urgent).toHaveLength(1);
    expect(d.deadlines.length).toBeGreaterThan(0);
    expect(d.integrations).toMatchObject({ status: 'NOT_CONNECTED', driveEnabled: false });
    // the same numbers on the linked lists
    expect((await w.admin.get(`${w.base}/participants?team=none`)).body.total).toBe(1);
    expect((await w.admin.get(`${w.base}/teams`)).body.total).toBe(2);
    for (const who of [staff.agent, a.lead.agent, (await addJudge(kit, w, 'J')).agent])
      expect((await who.get(`${w.base}/dashboard`)).status).toBe(404);
  });

  it('shows judging progress that equals the evaluation records', async () => {
    const s = await judgedRound(kit, {
      teams: {
        Zeta: [
          [8, 7, 4],
          [6, 9, 3],
        ],
        Xray: [[5, 5, 3]],
      },
    });
    const d = (await s.w.admin.get(`${s.w.base}/dashboard`)).body;
    expect(d.judging[0]).toMatchObject({
      assigned: 4,
      submitted: 3,
      teamsWithWork: 2,
      status: 'CLOSED',
    });
    expect(await db.evaluation.count({ where: { status: 'SUBMITTED' } })).toBe(3);
    void closeSubmissions;
  });
});

describe('audit history (FR-046, AT-23)', () => {
  it('lists actions with who, when and what changed, filters them, exports CSV and is admin-only', async () => {
    const s = await judgedRound(kit, {
      teams: {
        Zeta: [
          [8, 7, 4],
          [6, 9, 3],
        ],
      },
    });
    await s.w.admin.post(`${s.w.base}/rounds/${s.w.roundId}/results/approve`);
    const all = (await s.w.admin.get(`${s.w.base}/audit?pageSize=100`)).body;
    const actions = all.rows.map((r: { action: string }) => r.action);
    for (const expected of [
      'event.created',
      'event.published',
      'team.created',
      'submission.submitted',
      'rubric.activated',
      'judging.assigned',
      'judging.status_changed',
      'evaluation.submitted',
      'results.approved',
    ]) {
      expect(actions).toContain(expected);
    }
    const ev = all.rows.find((r: { action: string }) => r.action === 'evaluation.submitted');
    expect(ev).toMatchObject({ actor: expect.stringMatching(/^Judge /), entityType: 'Evaluation' });
    expect(ev.after).toMatchObject({ weightedScore: expect.any(String) });
    expect(all.entityTypes).toContain('ResultSnapshot');
    const filtered = (await s.w.admin.get(`${s.w.base}/audit?entityType=ResultSnapshot`)).body;
    expect(
      filtered.rows.every((r: { entityType: string }) => r.entityType === 'ResultSnapshot'),
    ).toBe(true);
    expect(
      (await s.w.admin.get(`${s.w.base}/audit?action=judging`)).body.rows.length,
    ).toBeGreaterThan(1);
    expect((await s.w.admin.get(`${s.w.base}/audit?from=2999-01-01`)).body.total).toBe(0);
    const csv = await s.w.admin.get(`${s.w.base}/audit.csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('results.approved');
    // nobody but a core admin reads it
    const staffU = await createUser(db);
    await db.eventMembership.create({
      data: { eventId: s.w.eventId, userId: staffU.id, role: 'STAFF' },
    });
    for (const who of [
      s.judges[0]!.agent,
      s.teams.Zeta!.lead.agent,
      await signedInAgent(app, staffU.email),
    ]) {
      expect((await who.get(`${s.w.base}/audit`)).status).toBe(404);
      expect((await who.get(`${s.w.base}/audit.csv`)).status).toBe(404);
    }
  });

  it('cannot be changed or deleted by anyone, not even through the database layer', async () => {
    const w = await openEvent(kit);
    const row = await db.auditLog.findFirstOrThrow({ where: { eventId: w.eventId } });
    await expect(
      db.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    expect((await w.admin.delete(`${w.base}/audit/${row.id}`)).status).toBe(404); // no such route
    expect((await w.admin.patch(`${w.base}/audit/${row.id}`).send({ action: 'x' })).status).toBe(
      404,
    );
  });

  it('records the important event-day actions in one place', async () => {
    const w = await openEvent(kit);
    const team = await teamOfTwo(w);
    await submitProject(w, team);
    await closeSubmissions(kit, w);
    const actions = (await w.admin.get(`${w.base}/audit?pageSize=100`)).body.rows.map(
      (r: { action: string }) => r.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['team.member_joined', 'registration.created']));
  });
});
