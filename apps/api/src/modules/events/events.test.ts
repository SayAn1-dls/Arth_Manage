import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  agentFor,
  createTestKit,
  createUser,
  resetDb,
  signedInAgent,
  uniqueEmail,
} from '../../test/helpers.js';

const { app, db } = createTestKit();
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

const future = (days: number) => new Date(Date.now() + days * 864e5).toISOString();
const newEvent = (over: Record<string, unknown> = {}) => ({
  name: 'HackSonipat 2026',
  type: 'HACKATHON',
  mode: 'IN_PERSON',
  startsAt: future(30),
  endsAt: future(31),
  timeZone: 'Asia/Kolkata',
  institution: 'Rishihood University',
  contactEmail: 'team@example.test',
  ...over,
});
const roundBody = (over: Record<string, unknown> = {}) => ({
  name: 'Round 1',
  submissionDeadline: future(29),
  graceMinutes: 0,
  latePolicy: 'REJECT',
  rankingScope: 'OVERALL',
  requiredEvaluations: 2,
  awardPositions: 3,
  ...over,
});

async function world() {
  const admin = await createUser(db, { name: 'Owner' });
  const a = await signedInAgent(app, admin.email);
  const created = await a.post('/api/v1/events').send(newEvent());
  const eventId = created.body.id as string;
  const roles = {} as Record<
    'judge' | 'staff' | 'participant',
    Awaited<ReturnType<typeof signedInAgent>>
  >;
  for (const [key, role] of [
    ['judge', 'JUDGE'],
    ['staff', 'STAFF'],
    ['participant', 'PARTICIPANT'],
  ] as const) {
    const u = await createUser(db, { name: key });
    await addMember(db, eventId, u.id, role);
    roles[key] = await signedInAgent(app, u.email);
  }
  const outsider = await signedInAgent(app, (await createUser(db)).email);
  const base = `/api/v1/events/${eventId}`;
  const setDeadline = async () => {
    const round = (await a.get(`${base}/rounds`)).body.rounds[0];
    return a.patch(`${base}/rounds/${round.id}`).send(roundBody());
  };
  return { admin, a, eventId, ...roles, outsider, base, setDeadline };
}

describe('creating events', () => {
  it('any verified user can create one and becomes Core Admin with a default round, guidebook and audit entry', async () => {
    const w = await world();
    const event = (await w.a.get(w.base)).body;
    expect(event.status).toBe('DRAFT');
    expect(event.slug).toBe('hacksonipat-2026');
    const rounds = (await w.a.get(`${w.base}/rounds`)).body.rounds;
    expect(rounds).toHaveLength(1);
    expect(rounds[0].name).toBe('Round 1');
    const gb = (await w.a.get(`${w.base}/guidebook/draft`)).body;
    expect(gb.sections.map((s: { title: string }) => s.title)).toContain('Code of conduct');
    const audit = await db.auditLog.findMany({ where: { eventId: w.eventId } });
    expect(audit.map((x) => x.action)).toContain('event.created');
    const membership = await db.eventMembership.findFirstOrThrow({
      where: { eventId: w.eventId, userId: w.admin.id },
    });
    expect(membership.role).toBe('ADMIN');
  });

  it('requires sign-in, validates input and suggests a unique slug', async () => {
    expect((await agentFor(app).post('/api/v1/events').send(newEvent())).status).toBe(401);
    const w = await world();
    const bad = await w.a.post('/api/v1/events').send(newEvent({ endsAt: future(10), name: '' }));
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.fields.endsAt).toMatch(/after/i);
    expect(bad.body.error.details.fields.name).toBeDefined();
    const second = await w.a.post('/api/v1/events').send(newEvent());
    expect(second.body.slug).toBe('hacksonipat-2026-2');
    const extra = await w.a.post('/api/v1/events').send(newEvent({ ownerId: 'x' }));
    expect(extra.status).toBe(422); // unknown fields are rejected, never mass-assigned
  });
});

describe('event access and editing', () => {
  it('only members see the event; only Core Admins edit; outsiders get 404', async () => {
    const w = await world();
    expect((await w.participant.get(w.base)).status).toBe(200);
    expect((await w.outsider.get(w.base)).status).toBe(404);
    for (const who of [w.judge, w.staff, w.participant, w.outsider]) {
      const res = await who.patch(w.base).send({ version: 1, name: 'Hijacked' });
      expect(res.status).toBe(404);
    }
    expect((await w.a.get(w.base)).body.name).toBe('HackSonipat 2026');
  });

  it('audits before/after and rejects stale versions naming the last editor', async () => {
    const w = await world();
    const ok = await w.a.patch(w.base).send({ version: 1, venue: 'Main hall' });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(2);
    const entry = await db.auditLog.findFirstOrThrow({
      where: { eventId: w.eventId, action: 'event.updated' },
    });
    expect(entry.after).toEqual({ venue: 'Main hall' });
    const stale = await w.a.patch(w.base).send({ version: 1, venue: 'Other hall' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toMatch(/changed by Owner/);
    expect((await w.a.get(w.base)).body.venue).toBe('Main hall');
  });

  it('validates team size, declarations and dates', async () => {
    const w = await world();
    const sizes = await w.a.patch(w.base).send({ version: 1, teamMin: 5, teamMax: 2 });
    expect(sizes.status).toBe(422);
    expect(sizes.body.error.details.fields.teamMax).toBeDefined();
    const decl = await w.a
      .patch(w.base)
      .send({ version: 1, declarations: ['1', '2', '3', '4', '5', '6'] });
    expect(decl.status).toBe(422);
    expect(decl.body.error.details.fields.declarations).toBeDefined();
    expect((await w.a.patch(w.base).send({ version: 1, teamMax: 11 })).status).toBe(422);
  });

  it('locks the slug after publication and confirms date changes once people have registered', async () => {
    const w = await world();
    await w.setDeadline();
    expect((await w.a.post(`${w.base}/publish`)).status).toBe(200);
    const slug = await w.a.patch(w.base).send({ version: 2, slug: 'changed-link' });
    expect(slug.status).toBe(422);
    const dates = await w.a
      .patch(w.base)
      .send({ version: 2, startsAt: future(40), endsAt: future(41) });
    expect(dates.status).toBe(409);
    expect(dates.body.error.code).toBe('confirm_date_change');
    const confirmed = await w.a
      .patch(w.base)
      .send({ version: 2, startsAt: future(40), endsAt: future(41), confirmDateChange: true });
    expect(confirmed.status).toBe(200);
  });
});

describe('publication lifecycle', () => {
  it('blocks publishing until a round has a submission deadline, listing what is missing (AT-01N)', async () => {
    const w = await world();
    const blocked = await w.a.post(`${w.base}/publish`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain('Round 1 submission deadline');
    expect((await w.a.get(w.base)).body.status).toBe('DRAFT');
  });

  it('publishes (AT-01), audits it, warns about an unpublished guidebook and exposes the public page', async () => {
    const w = await world();
    expect((await agentFor(app).get('/api/v1/public/events/hacksonipat-2026')).status).toBe(404); // draft is invisible
    await w.setDeadline();
    const res = await w.a.post(`${w.base}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.event.status).toBe('PUBLISHED');
    expect(res.body.warnings.join(' ')).toMatch(/guidebook/);
    expect(
      (await db.auditLog.findMany({ where: { eventId: w.eventId, action: 'event.published' } }))
        .length,
    ).toBe(1);
    const pub = await agentFor(app).get('/api/v1/public/events/hacksonipat-2026');
    expect(pub.status).toBe(200);
    expect(pub.body.event.name).toBe('HackSonipat 2026');
    expect(JSON.stringify(pub.body)).not.toContain('ownerId');
  });

  it('opens registration only on a published event and refuses to unpublish once people registered', async () => {
    const w = await world();
    expect((await w.a.put(`${w.base}/registration`).send({ status: 'OPEN' })).status).toBe(409);
    await w.setDeadline();
    await w.a.post(`${w.base}/publish`);
    const open = await w.a.put(`${w.base}/registration`).send({ status: 'OPEN' });
    expect(open.body.registrationStatus).toBe('OPEN');
    expect((await w.a.post(`${w.base}/unpublish`)).status).toBe(409); // the seeded participant counts as registered
  });

  it('concludes with confirmation and archives only for the owner after seven days; archived events are read-only for co-admins', async () => {
    const w = await world();
    await w.setDeadline();
    await w.a.post(`${w.base}/publish`);
    expect((await w.a.post(`${w.base}/conclude`).send({})).status).toBe(409);
    expect(
      (await w.a.post(`${w.base}/conclude`).send({ confirmWithoutResults: true })).status,
    ).toBe(200);
    expect((await w.a.post(`${w.base}/archive`)).body.error.code).toBe('too_early');
    await db.event.update({
      where: { id: w.eventId },
      data: { concludedAt: new Date(Date.now() - 8 * 864e5) },
    });
    const coAdmin = await createUser(db);
    await addMember(db, w.eventId, coAdmin.id, 'ADMIN');
    const co = await signedInAgent(app, coAdmin.email);
    expect((await co.post(`${w.base}/archive`)).status).toBe(403); // owner only
    expect((await w.a.post(`${w.base}/archive`)).status).toBe(200);
    const blocked = await co.patch(w.base).send({ version: 99, venue: 'x' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('event_archived');
  });
});

describe('tracks, problems and rounds', () => {
  it('manages tracks with unique names and an event-scoped problem selection', async () => {
    const w = await world();
    const t = await w.a.post(`${w.base}/tracks`).send({ name: 'Fintech' });
    expect(t.status).toBe(201);
    expect((await w.a.post(`${w.base}/tracks`).send({ name: 'Fintech' })).status).toBe(422);
    const p = await w.a
      .post(`${w.base}/problems`)
      .send({ title: 'UPI fraud', description: 'Detect it', trackId: t.body.id });
    expect(p.status).toBe(201);
    // a track from another event cannot be attached (cross-event integrity)
    const other = await (
      await signedInAgent(app, (await createUser(db)).email)
    )
      .post('/api/v1/events')
      .send(newEvent({ name: 'Other' }));
    const foreign = await db.track.create({ data: { eventId: other.body.id, name: 'Foreign' } });
    const bad = await w.a
      .post(`${w.base}/problems`)
      .send({ title: 'X', description: 'Y', trackId: foreign.id });
    expect(bad.status).toBe(422);
    expect((await w.participant.get(`${w.base}/tracks`)).body.tracks).toHaveLength(1);
    expect((await w.participant.post(`${w.base}/tracks`).send({ name: 'Nope' })).status).toBe(404);
    expect((await w.a.delete(`${w.base}/tracks/${t.body.id}`)).status).toBe(204);
  });

  it('enforces round date order, keeps at least one round and cannot touch another event round', async () => {
    const w = await world();
    const bad = await w.a.post(`${w.base}/rounds`).send(
      roundBody({
        name: 'Final',
        opensAt: future(5),
        submissionDeadline: future(4),
        judgingDeadline: future(3),
        graceMinutes: 90,
        rankingScope: 'PER_TRACK',
        requiredEvaluations: 9,
      }),
    );
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.details.fields)).toEqual(
      expect.arrayContaining(['opensAt', 'graceMinutes', 'requiredEvaluations']),
    );
    const good = await w.a.post(`${w.base}/rounds`).send(
      roundBody({
        name: 'Final',
        opensAt: future(1),
        submissionDeadline: future(4),
        judgingDeadline: future(6),
        graceMinutes: 10,
        latePolicy: 'ACCEPT_AND_FLAG',
        rankingScope: 'PER_TRACK',
        requiredEvaluations: 3,
      }),
    );
    expect(good.status).toBe(201);
    expect(good.body.order).toBe(2);
    const rounds = (await w.a.get(`${w.base}/rounds`)).body.rounds;
    expect((await w.a.delete(`${w.base}/rounds/${rounds[1].id}`)).status).toBe(204);
    expect((await w.a.delete(`${w.base}/rounds/${rounds[0].id}`)).body.error.code).toBe(
      'last_round',
    );
    const otherEvent = await (
      await signedInAgent(app, (await createUser(db)).email)
    )
      .post('/api/v1/events')
      .send(newEvent({ name: 'Elsewhere' }));
    const foreign = await db.round.findFirstOrThrow({ where: { eventId: otherEvent.body.id } });
    expect((await w.a.patch(`${w.base}/rounds/${foreign.id}`).send(roundBody())).status).toBe(404);
  });
});

describe('guidebook', () => {
  it('keeps drafts admin-only, publishes numbered versions and serves participants the latest', async () => {
    const w = await world();
    expect((await w.participant.get(`${w.base}/guidebook/draft`)).status).toBe(404);
    expect((await w.participant.get(`${w.base}/guidebook`)).body.published).toBe(false);

    const draft = (await w.a.get(`${w.base}/guidebook/draft`)).body;
    const sections = draft.sections.map(
      (s: { id: string; title: string; body: string; hidden: boolean }, i: number) => ({
        ...s,
        body: i === 0 ? '## Welcome\n\nBuild something **great**.' : s.body,
        hidden: s.title === 'Prizes',
      }),
    );
    const saved = await w.a
      .put(`${w.base}/guidebook/draft`)
      .send({ sections, version: draft.version });
    expect(saved.status).toBe(200);
    // an old tab saving with the previous version is rejected, never silently overwriting
    const stale = await w.a
      .put(`${w.base}/guidebook/draft`)
      .send({ sections, version: draft.version });
    expect(stale.status).toBe(409);
    expect((await w.participant.get(`${w.base}/guidebook`)).body.published).toBe(false); // edits are invisible until Publish

    const pub = await w.a
      .post(`${w.base}/guidebook/publish`)
      .send({ version: saved.body.version, changeNote: 'First version' });
    expect(pub.status).toBe(201);
    expect(pub.body.versionNo).toBe(1);
    const seen = (await w.participant.get(`${w.base}/guidebook`)).body;
    expect(seen.published).toBe(true);
    expect(seen.sections.map((s: { title: string }) => s.title)).not.toContain('Prizes');
    expect((await w.judge.get(`${w.base}/guidebook`)).status).toBe(200);
    expect((await w.outsider.get(`${w.base}/guidebook`)).status).toBe(404);
    expect(
      (await w.participant.post(`${w.base}/guidebook/publish`).send({ version: 1 })).status,
    ).toBe(404);

    await w.a.put(`${w.base}/guidebook/draft`).send({ sections, version: saved.body.version });
    expect((await w.participant.get(`${w.base}/guidebook`)).body.versionNo).toBe(1); // still the published one
  });

  it('exports the published guidebook as a PDF and the draft only for admins', async () => {
    const w = await world();
    expect((await w.participant.get(`${w.base}/guidebook/pdf`)).status).toBe(409); // nothing published yet
    const draft = (await w.a.get(`${w.base}/guidebook/draft`)).body;
    const sections = draft.sections.map((s: { body: string }, i: number) => ({
      ...s,
      body: i === 0 ? '## Hello\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |' : s.body,
    }));
    const saved = await w.a
      .put(`${w.base}/guidebook/draft`)
      .send({ sections, version: draft.version });
    await w.a.post(`${w.base}/guidebook/publish`).send({ version: saved.body.version });
    const pdf = await w.participant
      .get(`${w.base}/guidebook/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await w.participant.get(`${w.base}/guidebook/pdf?draft=1`)).status).toBe(404);
    expect((await w.a.get(`${w.base}/guidebook/pdf?draft=1`)).status).toBe(200);
  });
});

describe('announcements', () => {
  it('shows each role only its audiences and keeps writing for admins', async () => {
    const w = await world();
    for (const [audience, title] of [
      ['EVERYONE', 'All'],
      ['PARTICIPANTS', 'For teams'],
      ['JUDGES', 'For judges'],
      ['STAFF', 'For staff'],
    ] as const) {
      expect(
        (await w.a.post(`${w.base}/announcements`).send({ audience, title, body: 'Hello' })).status,
      ).toBe(201);
    }
    const titles = async (agent: typeof w.a) =>
      (await agent.get(`${w.base}/announcements`)).body.announcements
        .map((a: { title: string }) => a.title)
        .sort();
    expect(await titles(w.participant)).toEqual(['All', 'For teams']);
    expect(await titles(w.judge)).toEqual(['All', 'For judges']);
    expect(await titles(w.staff)).toEqual(['All', 'For staff']);
    expect(await titles(w.a)).toHaveLength(4);
    expect(
      (
        await w.judge
          .post(`${w.base}/announcements`)
          .send({ audience: 'EVERYONE', title: 'x', body: 'y' })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.a
          .post(`${w.base}/announcements`)
          .send({ audience: 'EVERYONE', title: '', body: '' })
      ).status,
    ).toBe(422);
    const id = (await w.a.get(`${w.base}/announcements`)).body.announcements[0].id;
    const edited = await w.a
      .patch(`${w.base}/announcements/${id}`)
      .send({ audience: 'EVERYONE', title: 'Edited', body: 'Changed' });
    expect(edited.status).toBe(200);
    expect(
      (await w.participant.get(`${w.base}/announcements`)).body.announcements.some(
        (a: { edited: boolean }) => a.edited,
      ),
    ).toBe(true);
    expect((await w.a.delete(`${w.base}/announcements/${id}`)).status).toBe(204);
  });
});

describe('my events', () => {
  it('lists the same user with different roles in different events', async () => {
    const w = await world();
    const other = await (
      await signedInAgent(app, (await createUser(db)).email)
    )
      .post('/api/v1/events')
      .send(newEvent({ name: 'Case Cup' }));
    const user = await createUser(db, { email: uniqueEmail('multi') });
    await addMember(db, w.eventId, user.id, 'JUDGE');
    await addMember(db, other.body.id, user.id, 'PARTICIPANT');
    const agent = await signedInAgent(app, user.email);
    const events = (await agent.get('/api/v1/me/events')).body.events as {
      name: string;
      role: string;
    }[];
    expect(events.map((e) => `${e.name}:${e.role}`).sort()).toEqual([
      'Case Cup:PARTICIPANT',
      'HackSonipat 2026:JUDGE',
    ]);
    // permissions never carry across events: the judge role in A grants nothing in B
    expect(
      (await agent.patch(`/api/v1/events/${other.body.id}`).send({ version: 1, name: 'x' })).status,
    ).toBe(404);
  });
});
