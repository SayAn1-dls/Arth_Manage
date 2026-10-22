import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { JOIN_CODE_ALPHABET } from '@arthakram/shared';
import { agentFor, createTestKit, createUser, resetDb, signedInAgent } from '../../test/helpers.js';
import { openEvent } from '../../test/world.js';

const kit = createTestKit();
const { db, app } = kit;
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

describe('registration (AT-02)', () => {
  it('requires sign-in, a verified open event and ticked declarations, then creates one participant registration', async () => {
    const w = await openEvent(kit);
    await w.patchEvent({ declarations: ['I am a current student'] });
    expect(
      (await agentFor(app).post(`/api/v1/public/events/${w.slug}/register`).send({})).status,
    ).toBe(401);

    const user = await createUser(db, { name: 'Asha' });
    const asha = await signedInAgent(app, user.email);
    const bad = await asha
      .post(`/api/v1/public/events/${w.slug}/register`)
      .send({ fullName: 'Asha', institution: 'RU', declarations: [false] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.fields.declarations).toBeDefined();
    expect(await db.eventMembership.count({ where: { userId: user.id } })).toBe(0); // nothing saved on failure

    const ok = await asha.post(`/api/v1/public/events/${w.slug}/register`).send({
      fullName: 'Asha Kumari',
      institution: 'RU',
      phone: '+919876543210',
      declarations: [true],
    });
    expect(ok.status).toBe(201);
    const reg = await db.registration.findFirstOrThrow({ where: { eventId: w.eventId } });
    expect(reg.certificateName).toBe('Asha Kumari'); // defaults to the full name
    // Double click / second tab: one registration, same outcome (AT-02N)
    const again = await asha
      .post(`/api/v1/public/events/${w.slug}/register`)
      .send({ fullName: 'Asha Kumari', institution: 'RU', declarations: [true] });
    expect(again.status).toBe(200);
    expect(again.body.alreadyRegistered).toBe(true);
    expect(await db.registration.count({ where: { eventId: w.eventId } })).toBe(1);
    const mail = await db.outboxEmail.findFirst({
      where: { toEmail: user.email, subject: { contains: 'registered' } },
    });
    expect(mail).not.toBeNull();
  });

  it('validates phone and custom fields, and blocks registration when closed', async () => {
    const w = await openEvent(kit);
    const field = await w.admin
      .post(`${w.base}/registration-fields`)
      .send({ label: 'T-shirt size', type: 'SELECT', options: ['S', 'M', 'L'], required: true });
    expect(field.status).toBe(201);
    const user = await createUser(db);
    const a = await signedInAgent(app, user.email);
    const bad = await a
      .post(`/api/v1/public/events/${w.slug}/register`)
      .send({ fullName: 'A B', institution: 'RU', phone: '12', answers: {} });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.fields.phone).toBeDefined();
    const missing = await a
      .post(`/api/v1/public/events/${w.slug}/register`)
      .send({ fullName: 'A B', institution: 'RU', answers: {} });
    expect(missing.body.error.details.fields[`answers.${field.body.id}`]).toBe(
      'T-shirt size is required',
    );
    const wrongOption = await a
      .post(`/api/v1/public/events/${w.slug}/register`)
      .send({ fullName: 'A B', institution: 'RU', answers: { [field.body.id]: 'XXL' } });
    expect(wrongOption.status).toBe(422);
    await w.admin.put(`${w.base}/registration`).send({ status: 'CLOSED' });
    const closed = await a
      .post(`/api/v1/public/events/${w.slug}/register`)
      .send({ fullName: 'A B', institution: 'RU', answers: { [field.body.id]: 'M' } });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('registration_closed');
  });

  it('allows one role per event: a judge cannot also register; removed participants cannot return', async () => {
    const w = await openEvent(kit);
    const judge = await createUser(db);
    await db.eventMembership.create({
      data: { eventId: w.eventId, userId: judge.id, role: 'JUDGE' },
    });
    const j = await signedInAgent(app, judge.email);
    const res = await j
      .post(`/api/v1/public/events/${w.slug}/register`)
      .send({ fullName: 'Judge J', institution: 'RU' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already a judge/);

    const p = await w.participant('Removed Person');
    await w.admin
      .post(`${w.base}/participants/${p.membershipId}/remove`)
      .send({ reason: 'Duplicate account' });
    const back = await p.agent
      .post(`/api/v1/public/events/${w.slug}/register`)
      .send({ fullName: 'Removed Person', institution: 'RU' });
    expect(back.status).toBe(403);
    expect((await p.agent.get(w.base)).status).toBe(404); // access denied from the next request
  });

  it('turns every registrant into a solo team when the maximum team size is 1', async () => {
    const w = await openEvent(kit);
    await w.patchEvent({ teamMin: 1, teamMax: 1 });
    const p = await w.participant('Solo Sam');
    const team = (await p.agent.get(`${w.base}/my-team`)).body.team;
    expect(team.name).toBe('Solo Sam');
    expect(team.size).toBe(1);
    expect(team.complete).toBe(true);
  });
});

describe('teams (AT-03)', () => {
  it('creates a team with an immutable ID and a join code from the unambiguous alphabet; the creator leads', async () => {
    const w = await openEvent(kit);
    const asha = await w.participant('Asha');
    const res = await asha.agent.post(`${w.base}/teams`).send({ name: 'Byte Me' });
    expect(res.status).toBe(201);
    expect(res.body.team.teamCode).toBe('T-0001');
    expect(res.body.team.joinCode).toMatch(new RegExp(`^[${JOIN_CODE_ALPHABET}]{8}$`));
    expect(res.body.team.members[0].role).toBe('LEADER');
    expect(res.body.team.complete).toBe(false); // 1 of min 2
    const second = await (
      await w.participant('Meena')
    ).agent
      .post(`${w.base}/teams`)
      .send({ name: 'BYTE ME' });
    expect(second.status).toBe(422); // case-insensitive uniqueness
    expect(
      (await asha.agent.post(`${w.base}/teams`).send({ name: 'Other Team' })).body.error.code,
    ).toBe('already_in_team');
  });

  it('joins by code, shows a preview, enforces the maximum and the one-team rule (AT-03N1, AT-03N3)', async () => {
    const w = await openEvent(kit);
    const lead = await w.participant('Lead');
    const code = (await lead.agent.post(`${w.base}/teams`).send({ name: 'Team One' })).body.team
      .joinCode as string;
    const ravi = await w.participant('Ravi');
    const preview = await ravi.agent.post(`${w.base}/teams/join/preview`).send({ code });
    expect(preview.body).toMatchObject({
      name: 'Team One',
      leaderName: 'Lead',
      size: 1,
      max: 3,
      full: false,
    });
    expect((await ravi.agent.post(`${w.base}/teams/join`).send({ code })).status).toBe(200);
    const meena = await w.participant('Meena');
    expect((await meena.agent.post(`${w.base}/teams/join`).send({ code })).status).toBe(200);
    // team is now 3/3
    const late = await w.participant('Late');
    const full = await late.agent.post(`${w.base}/teams/join`).send({ code });
    expect(full.status).toBe(409);
    expect(full.body.error.message).toMatch(/Team One is full \(3\/3\)/);
    expect(await db.teamMember.count({ where: { membershipId: late.membershipId } })).toBe(0);
    // a member of a team cannot join another
    const other = await (
      await w.participant('Other Lead')
    ).agent
      .post(`${w.base}/teams`)
      .send({ name: 'Team Two' });
    const blocked = await ravi.agent
      .post(`${w.base}/teams/join`)
      .send({ code: other.body.team.joinCode });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/already in Team One/);
  });

  it('lets exactly one of two simultaneous joins take the last slot (AT-03N2)', async () => {
    const w = await openEvent(kit);
    const lead = await w.participant('Lead');
    const code = (await lead.agent.post(`${w.base}/teams`).send({ name: 'Race Team' })).body.team
      .joinCode as string;
    const p2 = await w.participant('P2');
    await p2.agent.post(`${w.base}/teams/join`).send({ code }); // 2/3
    const a = await w.participant('Kiran');
    const b = await w.participant('Meena2');
    const results = await Promise.all([
      a.agent.post(`${w.base}/teams/join`).send({ code }),
      b.agent.post(`${w.base}/teams/join`).send({ code }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const team = await db.team.findFirstOrThrow({ where: { name: 'Race Team' } });
    expect(await db.teamMember.count({ where: { teamId: team.id, leftAt: null } })).toBe(3);
  });

  it('rejects unknown codes and blocks after ten failed attempts in ten minutes', async () => {
    const w = await openEvent(kit);
    const p = await w.participant('Guesser');
    for (let i = 0; i < 10; i++) {
      const r = await p.agent.post(`${w.base}/teams/join/preview`).send({ code: 'NOSUCHCD' });
      expect(r.status).toBe(422);
      expect(r.body.error.message).toBe('Code not recognised.');
    }
    const blocked = await p.agent.post(`${w.base}/teams/join/preview`).send({ code: 'NOSUCHCD' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toMatch(/Try again in 10 minutes/);
  });

  it('keeps one active team per participant per event in the database, even when the API is bypassed', async () => {
    const w = await openEvent(kit);
    const a = await w.participant('A');
    const b = await w.participant('B');
    await a.agent.post(`${w.base}/teams`).send({ name: 'Alpha' });
    const bTeam = await b.agent.post(`${w.base}/teams`).send({ name: 'Beta' });
    await expect(
      db.teamMember.create({
        data: {
          teamId: bTeam.body.team.id,
          eventId: w.eventId,
          membershipId: a.membershipId,
          role: 'MEMBER',
        },
      }),
    ).rejects.toThrow(/team_member_one_active_team|duplicate key|Unique/i);
  });

  it('refuses a team member whose membership belongs to another event (composite foreign key)', async () => {
    const w = await openEvent(kit);
    const w2 = await openEvent(kit);
    const a = await w.participant('A');
    const team2 = await (
      await w2.participant('B')
    ).agent
      .post(`${w2.base}/teams`)
      .send({ name: 'Beta' });
    await expect(
      db.teamMember.create({
        data: {
          teamId: team2.body.team.id,
          eventId: w2.eventId,
          membershipId: a.membershipId,
          role: 'MEMBER',
        },
      }),
    ).rejects.toThrow();
  });

  it('manages the team: regenerate code, transfer leadership, remove members, leave, dissolve, never reuse codes', async () => {
    const w = await openEvent(kit);
    const lead = await w.participant('Lead');
    const created = await lead.agent.post(`${w.base}/teams`).send({ name: 'Managed' });
    const oldCode = created.body.team.joinCode as string;
    const regen = await lead.agent.post(`${w.base}/my-team/regenerate-code`);
    expect(regen.body.team.joinCode).not.toBe(oldCode);
    const ravi = await w.participant('Ravi');
    expect((await ravi.agent.post(`${w.base}/teams/join`).send({ code: oldCode })).status).toBe(
      422,
    ); // old code is dead
    expect(
      (await ravi.agent.post(`${w.base}/teams/join`).send({ code: regen.body.team.joinCode }))
        .status,
    ).toBe(200);

    // the leader cannot leave while others remain; members cannot manage the team
    expect((await lead.agent.post(`${w.base}/my-team/leave`)).body.error.code).toBe(
      'leader_must_transfer',
    );
    expect((await ravi.agent.post(`${w.base}/my-team/regenerate-code`)).status).toBe(403);
    expect(
      (
        await lead.agent
          .post(`${w.base}/my-team/transfer`)
          .send({ membershipId: ravi.membershipId })
      ).status,
    ).toBe(200);
    expect((await lead.agent.post(`${w.base}/my-team/leave`)).body.dissolved).toBe(false);
    expect((await lead.agent.get(`${w.base}/my-team`)).body.team).toBeNull();
    // the last member leaving dissolves the team and frees its name; the next team gets a new ID
    expect((await ravi.agent.post(`${w.base}/my-team/leave`)).body.dissolved).toBe(true);
    const again = await lead.agent.post(`${w.base}/teams`).send({ name: 'Managed' });
    expect(again.status).toBe(201);
    expect(again.body.team.teamCode).toBe('T-0002');
  });

  it('shows teammate emails to teammates and admins only, and locks self-service once registration closes', async () => {
    const w = await openEvent(kit);
    const lead = await w.participant('Lead');
    const code = (await lead.agent.post(`${w.base}/teams`).send({ name: 'Private Team' })).body.team
      .joinCode as string;
    const ravi = await w.participant('Ravi');
    await ravi.agent.post(`${w.base}/teams/join`).send({ code });
    const mine = (await ravi.agent.get(`${w.base}/my-team`)).body.team;
    expect(mine.members.every((m: { email?: string }) => typeof m.email === 'string')).toBe(true);
    const outsider = await w.participant('Outsider');
    const preview = await outsider.agent.post(`${w.base}/teams/join/preview`).send({ code });
    expect(JSON.stringify(preview.body)).not.toContain('@');
    // participants cannot read other teams or admin lists
    const teamId = mine.id as string;
    expect((await outsider.agent.get(`${w.base}/teams/${teamId}`)).status).toBe(404);
    expect((await outsider.agent.get(`${w.base}/teams`)).status).toBe(404);
    expect((await outsider.agent.get(`${w.base}/participants`)).status).toBe(404);

    await w.admin.put(`${w.base}/registration`).send({ status: 'CLOSED' });
    const closed = await lead.agent.post(`${w.base}/my-team/regenerate-code`);
    expect(closed.status).toBe(409);
    expect(closed.body.error.message).toMatch(/Contact the organisers/);
    expect((await ravi.agent.post(`${w.base}/my-team/leave`)).status).toBe(409);
    expect((await lead.agent.get(`${w.base}/my-team`)).body.team.joinCode).toBeUndefined();
  });

  it('keeps track and problem choices valid and event-scoped, and blocks deleting a track teams use', async () => {
    const w = await openEvent(kit);
    const t1 = (await w.admin.post(`${w.base}/tracks`).send({ name: 'Fintech' })).body;
    const t2 = (await w.admin.post(`${w.base}/tracks`).send({ name: 'Climate' })).body;
    const p1 = (
      await w.admin
        .post(`${w.base}/problems`)
        .send({ title: 'UPI', description: 'x', trackId: t1.id })
    ).body;
    const lead = await w.participant('Lead');
    const team = (await lead.agent.post(`${w.base}/teams`).send({ name: 'Choosers' })).body.team;
    const ok = await lead.agent
      .patch(`${w.base}/my-team`)
      .send({ version: team.version, trackId: t1.id, problemId: p1.id });
    expect(ok.status).toBe(200);
    const mismatch = await lead.agent
      .patch(`${w.base}/my-team`)
      .send({ version: ok.body.team.version, trackId: t2.id });
    expect(mismatch.status).toBe(422); // the chosen problem belongs to a different track
    const stale = await lead.agent
      .patch(`${w.base}/my-team`)
      .send({ version: team.version, trackId: null });
    expect(stale.status).toBe(409);
    expect((await w.admin.delete(`${w.base}/tracks/${t1.id}`)).body.error.code).toBe(
      'track_in_use',
    );
    expect((await w.admin.delete(`${w.base}/problems/${p1.id}`)).body.error.code).toBe(
      'problem_in_use',
    );
    // team size cannot drop below an existing team
    const code = ok.body.team.joinCode as string;
    await (await w.participant('Ravi')).agent.post(`${w.base}/teams/join`).send({ code });
    await (await w.participant('Meena')).agent.post(`${w.base}/teams/join`).send({ code });
    const version = (await w.admin.get(w.base)).body.version;
    const shrink = await w.admin.patch(w.base).send({ version, teamMax: 2 });
    expect(shrink.body.error.code).toBe('teams_exceed_max');
  });
});

describe('admin people and team management (FR-016..020)', () => {
  it('corrects records with audit, removes participants, searches and filters teams and participants', async () => {
    const w = await openEvent(kit);
    const lead = await w.participant('Asha Kumari');
    await lead.agent.post(`${w.base}/teams`).send({ name: 'Byte Me' });
    await w.participant('Lonely Lee');

    const list = await w.admin.get(`${w.base}/participants?q=lonely`);
    expect(list.body.rows).toHaveLength(1);
    expect(list.body.rows[0].status).toBe('Registered');
    expect(
      (await w.admin.get(`${w.base}/participants?team=in`)).body.rows.map(
        (r: { name: string }) => r.name,
      ),
    ).toEqual(['Asha Kumari']);
    expect((await w.admin.get(`${w.base}/teams?q=t-000`)).body.rows).toHaveLength(1); // partial, case-insensitive team ID
    expect((await w.admin.get(`${w.base}/teams?q=asha`)).body.rows).toHaveLength(1);
    expect((await w.admin.get(`${w.base}/teams?complete=yes`)).body.rows).toHaveLength(0); // 1 of min 2
    expect((await w.admin.get(`${w.base}/teams?complete=no`)).body.rows).toHaveLength(1);

    const detail = (await w.admin.get(`${w.base}/participants/${lead.membershipId}`)).body;
    const fix = await w.admin
      .patch(`${w.base}/participants/${lead.membershipId}`)
      .send({ version: detail.registration.version, institution: 'Rishihood University, Sonipat' });
    expect(fix.status).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { eventId: w.eventId, action: 'participant.corrected' },
    });
    expect(audit.before).toEqual({ institution: 'Rishihood University' });
    expect(audit.after).toEqual({ institution: 'Rishihood University, Sonipat' });

    // a leader with other members must hand over before removal
    const ravi = await w.participant('Ravi');
    const team = (await lead.agent.get(`${w.base}/my-team`)).body.team;
    await ravi.agent.post(`${w.base}/teams/join`).send({ code: team.joinCode });
    const blocked = await w.admin
      .post(`${w.base}/participants/${lead.membershipId}/remove`)
      .send({ reason: 'Left college' });
    expect(blocked.status).toBe(409);
    expect(
      (
        await w.admin
          .post(`${w.base}/participants/${ravi.membershipId}/remove`)
          .send({ reason: 'Left college' })
      ).status,
    ).toBe(200);
    expect((await w.admin.get(`${w.base}/participants?status=Removed`)).body.rows).toHaveLength(1);
  });

  it('adds, removes and re-leads members as admin without ever exceeding the maximum, and disqualifies with a reason', async () => {
    const w = await openEvent(kit);
    const [a, b, c, d] = [
      await w.participant('A One'),
      await w.participant('B Two'),
      await w.participant('C Three'),
      await w.participant('D Four'),
    ];
    const team = (
      await w.admin.post(`${w.base}/teams`).send({
        name: 'Admin Made',
        leaderMembershipId: a.membershipId,
        memberMembershipIds: [b.membershipId],
      })
    ).body;
    expect(team.size).toBe(2);
    expect(
      (
        await w.admin
          .post(`${w.base}/teams/${team.id}/members`)
          .send({ membershipId: c.membershipId })
      ).status,
    ).toBe(200);
    const full = await w.admin
      .post(`${w.base}/teams/${team.id}/members`)
      .send({ membershipId: d.membershipId });
    expect(full.body.error.code).toBe('team_full');
    const other = (await d.agent.post(`${w.base}/teams`).send({ name: 'Elsewhere' })).body.team;
    const dup = await w.admin
      .post(`${w.base}/teams/${team.id}/members`)
      .send({ membershipId: d.membershipId });
    expect(dup.status).toBe(409); // full takes precedence; free a slot then retry for the one-team rule
    await w.admin.delete(`${w.base}/teams/${team.id}/members/${c.membershipId}`);
    const alreadyIn = await w.admin
      .post(`${w.base}/teams/${team.id}/members`)
      .send({ membershipId: d.membershipId });
    expect(alreadyIn.body.error.code).toBe('already_in_team');
    expect(alreadyIn.body.error.message).toContain(other.teamCode);
    expect(
      (
        await w.admin
          .post(`${w.base}/teams/${team.id}/leader`)
          .send({ membershipId: b.membershipId })
      ).status,
    ).toBe(200);
    expect(
      (await w.admin.post(`${w.base}/teams/${team.id}/disqualify`).send({ reason: 'x' })).status,
    ).toBe(422); // reason too short
    const dq = await w.admin
      .post(`${w.base}/teams/${team.id}/disqualify`)
      .send({ reason: 'Plagiarised project' });
    expect(dq.body.status).toBe('DISQUALIFIED');
    expect(
      (await w.admin.post(`${w.base}/teams/${team.id}/reinstate`).send({ reason: 'Appeal upheld' }))
        .body.status,
    ).toBe('ACTIVE');
    const history = (await w.admin.get(`${w.base}/teams/${team.id}`)).body.history.map(
      (h: { action: string }) => h.action,
    );
    expect(history).toEqual(expect.arrayContaining(['team.disqualified', 'team.reinstated']));
  });

  it('exports CSV for admins only, with formula injection neutralised', async () => {
    const w = await openEvent(kit);
    await w.participant('=HYPERLINK("http://evil","x")');
    const csv = await w.admin.get(`${w.base}/exports/participants.csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(
      (await (await w.participant('Nosy')).agent.get(`${w.base}/exports/participants.csv`)).status,
    ).toBe(404);
    expect(
      await db.auditLog.count({ where: { eventId: w.eventId, action: 'export.participants' } }),
    ).toBe(1);
  });

  it('lets a participant edit their profile while open and only phone and certificate name afterwards (AT-04)', async () => {
    const w = await openEvent(kit);
    const asha = await w.participant('Asha K');
    const me = (await asha.agent.get(`${w.base}/registration/me`)).body;
    expect(me.editable).toBe('all');
    const ok = await asha.agent
      .patch(`${w.base}/registration/me`)
      .send({ version: me.registration.version, certificateName: 'Asha Kumari' });
    expect(ok.status).toBe(200);
    await w.admin.put(`${w.base}/registration`).send({ status: 'CLOSED' });
    const closed = (await asha.agent.get(`${w.base}/registration/me`)).body;
    expect(closed.editable).toBe('phone_and_certificate_name');
    const blocked = await asha.agent
      .patch(`${w.base}/registration/me`)
      .send({ version: closed.registration.version, institution: 'Elsewhere' });
    expect(blocked.status).toBe(422);
    const phone = await asha.agent
      .patch(`${w.base}/registration/me`)
      .send({ version: closed.registration.version, phone: '+919000000001' });
    expect(phone.status).toBe(200);
    const stale = await asha.agent
      .patch(`${w.base}/registration/me`)
      .send({ version: closed.registration.version, phone: '+919000000002' });
    expect(stale.status).toBe(409);
  });
});

describe('invitations and members', () => {
  it('invites a judge by email, accepts only for the matching account, and enforces one role per event', async () => {
    const w = await openEvent(kit);
    const judge = await createUser(db, { name: 'Jaya' });
    const inv = await w.admin
      .post(`${w.base}/invitations`)
      .send({ email: judge.email, role: 'JUDGE' });
    expect(inv.status).toBe(201);
    const mail = await db.outboxEmail.findFirstOrThrow({ where: { toEmail: judge.email } });
    const token = new URL(mail.link!).searchParams.get('token')!;
    const wrong = await signedInAgent(app, (await createUser(db)).email);
    expect((await wrong.post('/api/v1/invitations/accept').send({ token })).status).toBe(403);
    const jaya = await signedInAgent(app, judge.email);
    const accepted = await jaya.post('/api/v1/invitations/accept').send({ token });
    expect(accepted.body.role).toBe('JUDGE');
    expect((await jaya.post('/api/v1/invitations/accept').send({ token })).status).toBe(400); // single use
    expect((await jaya.get(w.base)).status).toBe(200);
    // already a judge here: a second invitation as staff is rejected naming the existing role
    const again = await w.admin
      .post(`${w.base}/invitations`)
      .send({ email: judge.email, role: 'STAFF' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already a judge/);
    // judges cannot invite or list members
    expect(
      (await jaya.post(`${w.base}/invitations`).send({ email: 'x@y.test', role: 'JUDGE' })).status,
    ).toBe(404);
    expect((await jaya.get(`${w.base}/members`)).status).toBe(404);
  });

  it('protects the owner and the last admin, and removal denies access from the next request', async () => {
    const w = await openEvent(kit);
    const staff = await createUser(db);
    const m = await db.eventMembership.create({
      data: { eventId: w.eventId, userId: staff.id, role: 'STAFF' },
    });
    const s = await signedInAgent(app, staff.email);
    expect((await s.get(w.base)).status).toBe(200);
    expect((await w.admin.delete(`${w.base}/members/${m.id}`)).status).toBe(204);
    expect((await s.get(w.base)).status).toBe(404);
    const owner = await db.eventMembership.findFirstOrThrow({
      where: { eventId: w.eventId, userId: w.adminUser.id },
    });
    expect((await w.admin.delete(`${w.base}/members/${owner.id}`)).body.error.code).toBe('owner');
  });
});
