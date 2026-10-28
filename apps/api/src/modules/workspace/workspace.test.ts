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
