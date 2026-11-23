import { afterAll, beforeEach, describe, it, expect } from 'vitest';
import {
  createTestKit,
  resetDb,
  createUser,
  addMember,
  signedInAgent,
} from '../../test/helpers.js';
import { openEvent, teamOfTwo, submitProject, addJudge } from '../../test/world.js';
import { compareLines, githubRepo } from './integrity.js';
import { calibration } from './analytics.js';
const kit = createTestKit();
const { db } = kit;
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());
describe('expanded workspace', () => {
  it('keeps participant tickets private and rejects foreign-event identifiers', async () => {
    const w = await openEvent(kit);
    const a = await w.participant('A'),
      b = await w.participant('B');
    const created = await a.agent
      .post(`${w.base}/workspace/tickets`)
      .send({ subject: 'Track question', body: 'Can we change tracks?' });
    expect(created.status).toBe(201);
    expect((await b.agent.get(`${w.base}/workspace/tickets`)).body.tickets).toHaveLength(0);
    expect(
      (
        await b.agent
          .post(`${w.base}/workspace/tickets/${created.body.id}/reply`)
          .send({ body: 'Intrusion' })
      ).status,
    ).toBe(404);
    expect((await w.admin.get(`${w.base}/workspace/tickets`)).body.tickets).toHaveLength(1);
    const other = await openEvent(kit);
    expect(
      (
        await other.admin
          .patch(`${other.base}/workspace/tickets/${created.body.id}`)
          .send({ status: 'RESOLVED' })
      ).status,
    ).toBe(404);
  });
  it('approves an exception once and applies only that team’s extension', async () => {
    const w = await openEvent(kit);
    const team = await teamOfTwo(w);
    const ticket = await team.lead.agent.post(`${w.base}/workspace/tickets`).send({
      subject: 'WiFi failed',
      body: 'Please extend our submission',
      kind: 'EXTENSION',
      roundId: w.roundId,
      minutes: 10,
    });
    expect(ticket.status).toBe(201);
    const url = `${w.base}/workspace/tickets/${ticket.body.id}/decision`;
    expect(
      (await team.lead.agent.post(url).send({ approve: true, note: 'Self approval' })).status,
    ).toBe(404);
    expect(
      (await w.admin.post(url).send({ approve: true, note: 'Approved due to WiFi' })).status,
    ).toBe(200);
    const saved = await db.submission.findUniqueOrThrow({
      where: { roundId_teamId: { roundId: w.roundId, teamId: team.teamId } },
    });
    const round = await db.round.findUniqueOrThrow({ where: { id: w.roundId } });
    expect(+saved.extensionDeadline! - +round.submissionDeadline!).toBe(600000);
    expect((await w.admin.post(url).send({ approve: true, note: 'Duplicate' })).status).toBe(409);
  });
  it('persists application decisions and queues notices for all team members', async () => {
    const w = await openEvent(kit),
      team = await teamOfTwo(w);
    expect(
      (
        await w.admin
          .post(`${w.base}/workspace/applications`)
          .send({ teamIds: [team.teamId], status: 'WAITLISTED', note: 'Seats are full' })
      ).status,
    ).toBe(200);
    expect(
      (await team.lead.agent.get(`${w.base}/workspace/application`)).body.team.applicationStatus,
    ).toBe('WAITLISTED');
    expect(await db.messageDelivery.count({ where: { eventId: w.eventId } })).toBe(2);
  });
  it('enforces shortlisting on draft writes and rejects reverse progression', async () => {
    const w = await openEvent(kit),
      team = await teamOfTwo(w);
    await submitProject(w, team);
    const next = await db.round.create({
      data: {
        eventId: w.eventId,
        order: 2,
        name: 'Final',
        submissionDeadline: new Date(Date.now() + 86400000),
      },
    });
    expect(
      (
        await w.admin
          .post(`${w.base}/workspace/shortlist`)
          .send({ fromRoundId: w.roundId, toRoundId: next.id, teamIds: [] })
      ).status,
    ).toBe(200);
    expect(
      (
        await team.lead.agent
          .put(`${w.base}/rounds/${next.id}/submission/draft`)
          .send({ title: 'Blocked', summary: 'No entry', values: {}, version: 1 })
      ).status,
    ).toBe(403);
    expect(
      (
        await w.admin
          .post(`${w.base}/workspace/shortlist`)
          .send({ fromRoundId: next.id, toRoundId: w.roundId, teamIds: [] })
      ).status,
    ).toBe(422);
  });
  it('names the author and role of every helpdesk request and reply', async () => {
    const w = await openEvent(kit),
      judge = await addJudge(kit, w, 'Jaya Judge');
    const created = await judge.agent
      .post(`${w.base}/workspace/tickets`)
      .send({ subject: 'Scoring help', body: 'How should I score?', kind: 'QUESTION' });
    expect(created.status).toBe(201);
    await w.admin
      .post(`${w.base}/workspace/tickets/${created.body.id}/reply`)
      .send({ body: 'Use the rubric ranges.' });
    await judge.agent
      .post(`${w.base}/workspace/tickets/${created.body.id}/reply`)
      .send({ body: 'Thanks.' });
    for (const viewer of [judge.agent, w.admin]) {
      const t = (await viewer.get(`${w.base}/workspace/tickets`)).body.tickets[0];
      expect(t.authorRole).toBe('JUDGE');
      expect(t.authorName).toBe('Jaya Judge');
      expect(t.messages.map((m: { authorRole: string }) => m.authorRole)).toEqual([
        'JUDGE',
        'ADMIN',
        'JUDGE',
      ]);
      expect(t.messages[0].authorName).toBe('Jaya Judge');
    }
  });
  it('sends shortlist notices once per decision and only to members of active teams', async () => {
    const w = await openEvent(kit),
      advanced = await teamOfTwo(w, 'Advanced'),
      dropped = await teamOfTwo(w, 'Dropped');
    await submitProject(w, advanced);
    const next = await db.round.create({
      data: {
        eventId: w.eventId,
        order: 2,
        name: 'Final',
        submissionDeadline: new Date(Date.now() + 86400000),
      },
    });
    await db.team.update({ where: { id: dropped.teamId }, data: { status: 'DISQUALIFIED' } });
    const decide = () =>
      w.admin
        .post(`${w.base}/workspace/shortlist`)
        .send({ fromRoundId: w.roundId, toRoundId: next.id, teamIds: [advanced.teamId] });
    expect((await decide()).status).toBe(200);
    expect((await decide()).status).toBe(200); // same decision again, e.g. a double click
    const notices = await db.messageDelivery.findMany({
      where: { eventId: w.eventId, key: { startsWith: 'shortlist:' } },
    });
    expect(notices).toHaveLength(2); // the two members of the shortlisted team, once each
    expect(notices.every((n) => n.body.includes('advanced'))).toBe(true);
  });
  it('publishes only opted-in discovery profiles and hides withdrawn profiles', async () => {
    const w = await openEvent(kit),
      a = await w.participant('A');
    const profile = {
      headline: 'Seeking designer',
      skills: 'React',
      about: 'Building a project',
      contact: 'Contact via event helpdesk',
      visible: false,
    };
    expect((await a.agent.put(`${w.base}/workspace/discovery`).send(profile)).status).toBe(200);
    expect((await w.admin.get(`${w.base}/workspace/discovery`)).body.profiles).toHaveLength(0);
    await a.agent.put(`${w.base}/workspace/discovery`).send({ ...profile, visible: true });
    expect((await w.admin.get(`${w.base}/workspace/discovery`)).body.profiles).toHaveLength(1);
  });
  it('restricts sponsors centrally and reserves access changes for owner', async () => {
    const w = await openEvent(kit);
    const user = await createUser(db);
    const member = await addMember(db, w.eventId, user.id, 'ADMIN');
    const agent = await signedInAgent(kit.app, user.email);
    const payload = { accessLevel: 'SPONSOR_VIEWER', institution: '', trackIds: [] };
    expect((await agent.put(`${w.base}/workspace/access/${member.id}`).send(payload)).status).toBe(
      403,
    );
    expect(
      (await w.admin.put(`${w.base}/workspace/access/${member.id}`).send(payload)).status,
    ).toBe(200);
    expect((await agent.get(`${w.base}/participants`)).status).toBe(404);
    expect((await agent.patch(w.base).send({ version: 1, name: 'Not allowed' })).status).toBe(404);
    expect((await agent.get(`${w.base}/workspace/report.pdf`)).status).toBe(200);
  });
  it('blocks automatic assignment to a judge from a team’s institution', async () => {
    const w = await openEvent(kit),
      team = await teamOfTwo(w);
    const a = await addJudge(kit, w, 'Judge A'),
      b = await addJudge(kit, w, 'Judge B');
    await db.eventMembership.update({
      where: { id: a.membershipId },
      data: { institution: 'Rishihood University' },
    });
    expect(
      (
        await w.admin
          .post(`${w.base}/rounds/${w.roundId}/assignments/auto-balance`)
          .send({ judgeMembershipIds: [a.membershipId, b.membershipId] })
      ).status,
    ).toBe(201);
    expect(
      await db.judgeAssignment.count({
        where: { teamId: team.teamId, judgeMembershipId: a.membershipId },
      }),
    ).toBe(0);
    expect(
      await db.judgeAssignment.count({
        where: { teamId: team.teamId, judgeMembershipId: b.membershipId },
      }),
    ).toBe(1);
  });
  it('distinguishes missing engagement signals from inactive teams', async () => {
    const w = await openEvent(kit),
      team = await teamOfTwo(w);
    expect((await w.admin.get(`${w.base}/workspace/engagement`)).body.teams[0].status).toBe(
      'UNKNOWN',
    );
    await team.lead.agent.post(`${w.base}/workspace/activity`).send({ guidebook: true });
    expect((await w.admin.get(`${w.base}/workspace/engagement`)).body.teams[0]).toMatchObject({
      status: 'ACTIVE',
      guidebookOpened: true,
    });
  });
  it('does not release private integrity notes to participants', async () => {
    const w = await openEvent(kit),
      team = await teamOfTwo(w);
    await w.admin.put(`${w.base}/workspace/reviews/${w.roundId}/${team.teamId}`).send({
      integrityNote: 'Private investigation',
      marketNote: 'Similar products exist',
      status: 'REVIEWED',
      releaseToTeam: true,
    });
    const review = (await team.lead.agent.get(`${w.base}/workspace/reviews/${w.roundId}`)).body
      .reviews[0];
    expect(review.marketNote).toBe('Similar products exist');
    expect(review.integrityNote).toBeUndefined();
  });
  it('requires minimum samples before calibration alerts', () => {
    const now = new Date();
    expect(
      calibration([
        { judgeId: 'a', score: 0, seconds: 20, at: now },
        { judgeId: 'b', score: 100, seconds: 20, at: now },
      ]).every((j) => !j.outlier),
    ).toBe(true);
  });
  it('approves a teammate replacement atomically and preserves leadership', async () => {
    const w = await openEvent(kit),
      team = await teamOfTwo(w),
      replacement = await w.participant('Replacement');
    const ticket = await team.lead.agent.post(`${w.base}/workspace/tickets`).send({
      subject: 'Leader replacement',
      body: 'Please approve this replacement',
      kind: 'TEAM_CHANGE',
      departingEmail: team.lead.user.email,
      replacementEmail: replacement.user.email,
    });
    expect(ticket.status).toBe(201);
    expect(
      (
        await w.admin
          .post(`${w.base}/workspace/tickets/${ticket.body.id}/decision`)
          .send({ approve: true, note: 'Replacement confirmed' })
      ).status,
    ).toBe(200);
    expect(
      await db.teamMember.findFirst({
        where: { teamId: team.teamId, membershipId: team.lead.membershipId, leftAt: null },
      }),
    ).toBeNull();
    expect(
      await db.teamMember.findFirst({
        where: { teamId: team.teamId, membershipId: replacement.membershipId, leftAt: null },
      }),
    ).toMatchObject({ role: 'LEADER' });
  });
  it('enforces screening after the first decision', async () => {
    const w = await openEvent(kit),
      team = await teamOfTwo(w);
    await w.admin
      .post(`${w.base}/workspace/applications`)
      .send({ teamIds: [team.teamId], status: 'REJECTED', note: 'No seats left' });
    expect(
      (
        await team.lead.agent
          .put(`${w.base}/rounds/${w.roundId}/submission/draft`)
          .send({ title: 'Not allowed', summary: 'Test', values: {}, version: 1 })
      ).status,
    ).toBe(403);
  });
  it('verifies released certificates publicly and distinguishes revoked certificates', async () => {
    const w = await openEvent(kit),
      person = await w.participant('Certificate Person');
    const cert = await db.certificate.create({
      data: {
        eventId: w.eventId,
        membershipId: person.membershipId,
        type: 'PARTICIPATION',
        certificateCode: 'CERT-TEST-1234',
        nameSnapshot: 'Certificate Person',
        status: 'RELEASED',
        pdfKey: 'unused',
        releasedAt: new Date(),
      },
    });
    const res = await person.agent.get('/api/v1/public/certificates/CERT-TEST-1234');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'RELEASED', name: 'Certificate Person' });
    expect(res.body.membershipId).toBeUndefined();
    await db.certificate.update({ where: { id: cert.id }, data: { status: 'REVOKED' } });
    expect((await person.agent.get('/api/v1/public/certificates/CERT-TEST-1234')).body.status).toBe(
      'REVOKED',
    );
  });
  it('compares substantial code lines without treating boilerplate as evidence', () => {
    const code = 'const answer = calculateSomethingImportant(inputValues);';
    expect(compareLines('import x;\n' + code, code + '\n}')).toMatchObject({
      matchedLines: 1,
      comparedLines: 1,
    });
    expect(() => githubRepo('https://localhost/private')).toThrow();
  });
});

describe('Support & requests inbox', () => {
  it('shows organisers the real outcome of an extension before deciding, then who decided', async () => {
    const w = await openEvent(kit);
    const t = await teamOfTwo(w, 'Alpha');
    const created = await t.lead.agent.post(`${w.base}/workspace/tickets`).send({
      subject: 'Laptop died',
      body: 'We need a little more time',
      kind: 'EXTENSION',
      roundId: w.roundId,
      minutes: 30,
    });
    expect(created.status).toBe(201);
    const before = (await w.admin.get(`${w.base}/workspace/tickets`)).body;
    const ticket = before.tickets[0];
    expect(ticket).toMatchObject({
      teamName: 'Alpha',
      roundId: w.roundId,
      assigneeName: null,
      decidedBy: null,
    });
    expect(before.assignees.map((a: { role: string }) => a.role)).toContain('ADMIN');
    const proposed = new Date(ticket.proposedCutoff).getTime();
    const decided = await w.admin
      .post(`${w.base}/workspace/tickets/${ticket.id}/decision`)
      .send({ approve: true, note: 'Approved for 30 minutes' });
    expect(decided.status).toBe(200);
    const sub = await kit.db.submission.findFirstOrThrow({
      where: { roundId: w.roundId, teamId: t.teamId },
    });
    // the preview and the decision use the same arithmetic (allowing for the seconds between the two calls)
    expect(Math.abs(sub.extensionDeadline!.getTime() - proposed)).toBeLessThan(60_000);
    const after = (await w.admin.get(`${w.base}/workspace/tickets`)).body.tickets[0];
    expect(after.status).toBe('APPROVED');
    expect(after.decidedBy).toBe('Owner');
    expect(after.activity.map((a: { action: string }) => a.action)).toEqual([
      'helpdesk.created',
      'exception.decided',
    ]);
    // the participant sees their own request and decision, but not the organisers' audit trail
    const own = (await t.lead.agent.get(`${w.base}/workspace/tickets`)).body;
    expect(own.tickets).toHaveLength(1);
    expect(own.tickets[0].activity).toBeUndefined();
    expect(own.tickets[0].decidedBy).toBeUndefined();
    expect(own.assignees).toEqual([]);
    expect((await t.mate.agent.get(`${w.base}/workspace/tickets`)).body.tickets).toHaveLength(0);
  });
});

describe('Communication safeguards', () => {
  it('previews the exact recipient count, never sends the same message twice, and groups history', async () => {
    const w = await openEvent(kit);
    await teamOfTwo(w, 'Alpha');
    await teamOfTwo(w, 'Beta');
    await w.participant('Solo Sam');
    const judge = await addJudge(kit, w, 'Judge J');

    const everyone = await w.admin
      .post(`${w.base}/workspace/audience-preview`)
      .send({ channel: 'announcement', audience: 'EVERYONE' });
    expect(everyone.body).toEqual({ channel: 'announcement', recipients: 7 }); // 5 participants, admin, judge
    const judges = await w.admin
      .post(`${w.base}/workspace/audience-preview`)
      .send({ channel: 'announcement', audience: 'JUDGES' });
    expect(judges.body.recipients).toBe(1);

    const preview = await w.admin
      .post(`${w.base}/workspace/audience-preview`)
      .send({ channel: 'email' });
    expect(preview.body).toEqual({ channel: 'email', recipients: 5 });

    const requestId = '6f1c2f8e-6a1f-4a8e-9a55-2d3b6c7d8e9f';
    const first = await w.admin
      .post(`${w.base}/workspace/broadcast`)
      .send({ subject: 'Venue change', body: 'We moved to Hall B.', requestId });
    expect(first.body).toEqual({ queued: 5, recipients: 5, duplicate: false });
    const again = await w.admin
      .post(`${w.base}/workspace/broadcast`)
      .send({ subject: 'Venue change', body: 'We moved to Hall B.', requestId });
    expect(again.body).toMatchObject({ queued: 0, duplicate: true });
    expect(await kit.db.messageDelivery.count({ where: { eventId: w.eventId } })).toBe(5);

    const summary = (await w.admin.get(`${w.base}/workspace/deliveries/summary`)).body;
    expect(summary.sends).toEqual([
      expect.objectContaining({
        key: `broadcast:${requestId}`,
        subject: 'Venue change',
        source: 'broadcast',
        counts: { QUEUED: 5 },
      }),
    ]);
    for (const who of [judge.agent])
      expect(
        (
          await who
            .post(`${w.base}/workspace/audience-preview`)
            .send({ channel: 'announcement', audience: 'EVERYONE' })
        ).status,
      ).toBe(404);
  });
});
