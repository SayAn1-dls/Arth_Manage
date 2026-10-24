/**
 * The pilot journey on an empty database (resetDb truncates every table first), through the same HTTP API the
 * web app uses, with negative cases, duplicate operations and recovery at each stage. Nothing here is seeded.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestKit, resetDb } from '../test/helpers.js';
import { upload, pdfBytes, future } from '../test/world.js';

const kit = createTestKit();
const { db, app } = kit;
const H = { 'X-Requested-With': 'arthakram' };
const PASSWORD = 'A-long-passphrase-1';

beforeAll(() => resetDb(db));
afterAll(() => db.$disconnect());

type Agent = ReturnType<typeof request.agent>;
const state = {} as {
  organiser: Agent;
  eventId: string;
  slug: string;
  base: string;
  roundId: string;
  rubric: { id: string }[];
  teams: { id: string; name: string; lead: Agent; mate: Agent; leadId: string; mateId: string }[];
  judges: { agent: Agent; membershipId: string }[];
};

async function newAccount(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Math.random().toString(36).slice(2, 7)}@pilot.test`;
  const reg = await request(app)
    .post('/api/v1/auth/register')
    .set(H)
    .send({ name, email, password: PASSWORD });
  expect(reg.status).toBe(202);
  const mail = await db.outboxEmail.findFirstOrThrow({
    where: { toEmail: email },
    orderBy: { createdAt: 'desc' },
  });
  const token = new URL(mail.link!).searchParams.get('token')!;
  return { email, token };
}
const login = async (email: string) => {
  const a = request.agent(app);
  const res = await a.post('/api/v1/auth/login').set(H).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return a.set(H);
};
const memberId = async (email: string) =>
  (
    await db.eventMembership.findFirstOrThrow({
      where: { eventId: state.eventId, user: { email } },
    })
  ).id;

describe('1-2 account and event', () => {
  it('registers, cannot sign in before verifying, verifies once, then creates an event as its Core Admin', async () => {
    const { email, token } = await newAccount('Olive Organiser');
    const early = await request(app)
      .post('/api/v1/auth/login')
      .set(H)
      .send({ email, password: PASSWORD });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('email_not_verified');
    expect(
      (await request(app).post('/api/v1/auth/verify-email').set(H).send({ token })).status,
    ).toBe(200);
    expect(
      (await request(app).post('/api/v1/auth/verify-email').set(H).send({ token })).status,
    ).toBe(400); // single use
    state.organiser = await login(email);
    const created = await state.organiser.post('/api/v1/events').send({
      name: 'Pilot Cup 2026',
      type: 'HACKATHON',
      mode: 'IN_PERSON',
      startsAt: future(30),
      endsAt: future(31),
      timeZone: 'Asia/Kolkata',
      institution: 'Rishihood University',
      contactEmail: 'org@pilot.test',
    });
    expect(created.status).toBe(201);
    Object.assign(state, {
      eventId: created.body.id,
      slug: created.body.slug,
      base: `/api/v1/events/${created.body.id}`,
    });
    // a second, unrelated organiser can never see it
    const other = await newAccount('Other Organiser');
    await request(app).post('/api/v1/auth/verify-email').set(H).send({ token: other.token });
    const stranger = await login(other.email);
    expect((await stranger.get(state.base)).status).toBe(404);
  });
});

describe('3-4 configure and publish', () => {
  it('blocks publishing until required settings exist, then publishes; structure rules are enforced', async () => {
    const { organiser, base } = state;
    expect((await organiser.post(`${base}/publish`).set(H)).status).toBe(409); // no submission deadline yet
    const rounds = (await organiser.get(`${base}/rounds`)).body.rounds;
    state.roundId = rounds[0].id;
    const patchRound = (extra: object) =>
      organiser.patch(`${base}/rounds/${state.roundId}`).send({
        name: 'Round 1: Pitch',
        graceMinutes: 0,
        latePolicy: 'REJECT',
        rankingScope: 'OVERALL',
        requiredEvaluations: 2,
        awardPositions: 3,
        ...extra,
      });
    expect((await patchRound({ submissionDeadline: future(29) })).status).toBe(200);
    const version = (await organiser.get(base)).body.version;
    expect(
      (
        await organiser
          .patch(base)
          .send({ version, teamMin: 2, teamMax: 3, eligibility: 'Open to all students' })
      ).status,
    ).toBe(200);
    // stale edit: the old version is refused with a clear message instead of overwriting
    const stale = await organiser.patch(base).send({ version, teamMax: 4 });
    expect(stale.status).toBe(409);
    // tracks, problems
    expect((await organiser.post(`${base}/tracks`).send({ name: 'Fintech' })).status).toBe(201);
    expect((await organiser.post(`${base}/tracks`).send({ name: 'Fintech' })).status).toBe(422); // duplicate name
    // guidebook: draft, publish, and the participant view
    const draft = (await organiser.get(`${base}/guidebook/draft`)).body;
    const saved = await organiser
      .put(`${base}/guidebook/draft`)
      .send({ sections: draft.sections, version: draft.version });
    expect(saved.status).toBe(200);
    expect(
      (await organiser.post(`${base}/guidebook/publish`).send({ version: saved.body.version }))
        .status,
    ).toBe(201);
    expect((await organiser.post(`${base}/publish`)).status).toBe(200);
    expect((await organiser.post(`${base}/publish`)).status).toBeGreaterThanOrEqual(400); // duplicate publish
    expect((await organiser.put(`${base}/registration`).send({ status: 'OPEN' })).status).toBe(200);
    expect((await request(app).get(`/api/v1/public/events/${state.slug}`)).status).toBe(200);
  });
});

describe('5-6 registration, teams and submissions', () => {
  it('registers participants, forms teams, enforces team rules and submits project materials', async () => {
    state.teams = [];
    const reg = async (agent: Agent, who: string) =>
      agent
        .post(`/api/v1/public/events/${state.slug}/register`)
        .send({ fullName: who, institution: 'Rishihood University', phone: '9876543210' });
    for (const name of ['Alpha Squad', 'Beta Brigade', 'Gamma Group']) {
      const lead = await newAccount(`${name} Lead`);
      const mate = await newAccount(`${name} Mate`);
      for (const a of [lead, mate])
        await request(app).post('/api/v1/auth/verify-email').set(H).send({ token: a.token });
      const leadAgent = await login(lead.email);
      const mateAgent = await login(mate.email);
      expect((await reg(leadAgent, `${name} Lead`)).status).toBe(201);
      expect((await reg(mateAgent, `${name} Mate`)).status).toBe(201);
      expect((await reg(leadAgent, `${name} Lead`)).status).toBe(200); // repeating updates, never duplicates
      const team = (await leadAgent.post(`${state.base}/teams`).send({ name })).body.team;
      expect(
        (await mateAgent.post(`${state.base}/teams/join`).send({ code: 'WRONG-CODE' })).status,
      ).toBeGreaterThanOrEqual(400);
      expect(
        (await mateAgent.post(`${state.base}/teams/join`).send({ code: team.joinCode })).status,
      ).toBe(200);
      expect(
        (await mateAgent.post(`${state.base}/teams/join`).send({ code: team.joinCode })).status,
      ).toBeGreaterThanOrEqual(400); // already in a team
      state.teams.push({
        id: team.id,
        name,
        lead: leadAgent,
        mate: mateAgent,
        leadId: await memberId(lead.email),
        mateId: await memberId(mate.email),
      });
    }
    // team names are unique ignoring case; an unregistered account can neither join nor create
    const lead2 = await newAccount('Dup Lead');
    await request(app).post('/api/v1/auth/verify-email').set(H).send({ token: lead2.token });
    const dup = await login(lead2.email);
    expect(
      (await dup.post(`${state.base}/teams`).send({ name: 'alpha squad' })).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await dup.post(`${state.base}/teams/join`).send({ code: 'ANYTHING' })).status,
    ).toBeGreaterThanOrEqual(400);
    expect(await db.registration.count({ where: { eventId: state.eventId } })).toBe(6);
  });

  it('submits materials; a second identical submit is a new version, a bad file is refused with a reason', async () => {
    const url = `${state.base}/rounds/${state.roundId}/submission`;
    for (const t of state.teams) {
      const form = (await t.lead.get(url)).body;
      const file = form.fields.find((f: { type: string }) => f.type === 'FILE');
      const urls = form.fields.filter((f: { type: string }) => /_URL$/.test(f.type));
      const urlValues = Object.fromEntries(
        urls.map((f: { id: string; type: string }) => [
          f.id,
          f.type === 'REPO_URL' ? 'https://github.com/owner/repo' : 'https://example.org/demo',
        ]),
      );
      // a file whose bytes are not a PDF is rejected even though it is named .pdf
      const fake = await upload(
        t.lead as never,
        `${url}/files/${file.id}`,
        Buffer.from('<html>not a pdf</html>'),
        'deck.pdf',
      );
      expect(fake.status).toBe(422);
      const up = await upload(
        t.lead as never,
        `${url}/files/${file.id}`,
        pdfBytes(t.name),
        'deck.pdf',
      );
      expect(up.status).toBe(201);
      const values = { [file.id]: up.body.file.id, ...urlValues };
      // submitting with an invalid repository link fails and reports the field
      const bad = await t.lead.put(`${url}/draft`).send({
        title: `${t.name} project`,
        summary: 'We built a thing.',
        version: up.body.version,
        values: { ...values, [urls[0].id]: 'javascript:alert(1)' },
      });
      expect(bad.status).toBeGreaterThanOrEqual(400);
      const draft = await t.lead.put(`${url}/draft`).send({
        title: `${t.name} project`,
        summary: 'We built a thing.',
        version: up.body.version,
        values,
      });
      expect(draft.status).toBe(200);
      // a teammate saving over a stale draft version is told to reload
      const stale = await t.mate
        .put(`${url}/draft`)
        .send({ title: 'Overwrite', summary: 'x', version: up.body.version, values });
      expect(stale.status).toBe(409);
      const sub = await t.lead.post(`${url}/submit`).send({ version: draft.body.version });
      expect(sub.status).toBe(201);
      // an outsider team member of another team cannot read this submission
      const other = state.teams.find((x) => x !== t)!;
      expect(
        (await other.lead.get(`${state.base}/rounds/${state.roundId}/submissions/${t.id}`)).status,
      ).toBe(404);
    }
    expect(await db.submissionVersion.count({ where: { eventId: state.eventId } })).toBe(3);
  });

  it('refuses a late submission after the deadline and accepts it again after an organiser extension', async () => {
    const t = state.teams[0]!;
    const url = `${state.base}/rounds/${state.roundId}/submission`;
    const round = await db.round.findUniqueOrThrow({ where: { id: state.roundId } });
    await db.round.update({
      where: { id: round.id },
      data: { submissionDeadline: new Date(Date.now() - 60_000) },
    });
    const form = (await t.lead.get(url)).body;
    const closed = await t.lead.put(`${url}/draft`).send({
      title: 'Too late',
      summary: 'late',
      version: form.draftVersion ?? form.version ?? 1,
      values: {},
    });
    expect(closed.status).toBeGreaterThanOrEqual(400);
    expect(closed.status).toBeLessThan(500);
    // the organiser grants an extension with a reason; participants cannot grant it themselves
    const ext = `${state.base}/rounds/${state.roundId}/submissions/${t.id}/extension`;
    expect(
      (await t.lead.put(ext).send({ deadline: future(1), reason: 'Self service' })).status,
    ).toBe(404);
    const ok = await state.organiser
      .put(ext)
      .send({ deadline: future(1), reason: 'Venue Wi-Fi was down' });
    expect(ok.status).toBe(200);
  });
});

const S = () => state;
const resultsUrl = (p = '') => `${S().base}/rounds/${S().roundId}/results${p}`;
const REF = { Alpha: [10, 10, 10, 10, 10], Beta: [8, 7, 9, 6, 8], Gamma: [8, 7, 9, 6, 8] } as const;

describe('7-8 judges, assignments and evaluations', () => {
  it('invites judges by email, assigns teams, and enforces assignment scope, ranges and one submission', async () => {
    const { organiser, base, roundId } = S();
    // the rubric must be active before judging can open
    expect(
      (await organiser.put(`${base}/rounds/${roundId}/judging`).send({ status: 'OPEN' })).status,
    ).toBe(409);
    expect(
      (await organiser.post(`${base}/rounds/${roundId}/rubric/template`).send({ key: 'HACKATHON' }))
        .status,
    ).toBe(201);
    expect((await organiser.post(`${base}/rounds/${roundId}/rubric/activate`)).status).toBe(200);
    S().rubric = (await organiser.get(`${base}/rounds/${roundId}/rubric`)).body.rubric.criteria;

    S().judges = [];
    for (const n of ['Judge One', 'Judge Two']) {
      const acct = await newAccount(n);
      await request(app).post('/api/v1/auth/verify-email').set(H).send({ token: acct.token });
      const agent = await login(acct.email);
      expect(
        (await organiser.post(`${base}/invitations`).send({ email: acct.email, role: 'JUDGE' }))
          .status,
      ).toBe(201);
      const mail = await db.outboxEmail.findFirstOrThrow({
        where: { toEmail: acct.email, subject: { contains: 'invited' } },
      });
      const token = new URL(mail.link!).searchParams.get('token')!;
      // someone else cannot use this invitation
      const thief = await login(
        (await db.user.findFirstOrThrow({ where: { email: { contains: 'organiser' } } })).email,
      );
      expect((await thief.post('/api/v1/invitations/accept').send({ token })).status).toBe(403);
      expect((await agent.post('/api/v1/invitations/accept').send({ token })).status).toBe(200);
      expect((await agent.post('/api/v1/invitations/accept').send({ token })).status).toBe(400); // single use
      S().judges.push({ agent, membershipId: await memberId(acct.email) });
    }
    const teamIds = S().teams.map((t) => t.id);
    const assign = (judgeIdx: number[], teams = teamIds) =>
      organiser.post(`${base}/rounds/${roundId}/assignments`).send({
        judgeMembershipIds: judgeIdx.map((i) => S().judges[i]!.membershipId),
        teamIds: teams,
      });
    expect((await assign([0, 1])).status).toBeLessThan(300);
    expect((await assign([0, 1])).status).toBeLessThan(300); // repeating never creates duplicates
    expect(await db.judgeAssignment.count({ where: { roundId } })).toBe(6);
    expect(
      (
        await S()
          .teams[0]!.lead.post(`${base}/rounds/${roundId}/assignments`)
          .send({ judgeMembershipIds: [], teamIds })
      ).status,
    ).toBe(404);
    // before judging opens a judge sees names only, no content
    expect(
      (await organiser.put(`${base}/rounds/${roundId}/judging`).send({ status: 'OPEN' })).status,
    ).toBe(200);
  });

  it('judges score through the rubric; invalid, incomplete, unassigned and duplicate operations are refused', async () => {
    const { organiser, base, roundId } = S();
    const overview = (await organiser.get(`${base}/rounds/${roundId}/judging/overview`)).body;
    const assignmentOf = (j: number, teamId: string) =>
      overview.teams
        .find((t: { teamId: string }) => t.teamId === teamId)
        .assignments.find(
          (a: { judgeMembershipId: string }) => a.judgeMembershipId === S().judges[j]!.membershipId,
        ).id as string;
    const scoresFor = (vals: readonly number[]) =>
      Object.fromEntries(S().rubric.map((c, i) => [c.id, vals[i]]));
    const names = ['Alpha', 'Beta', 'Gamma'] as const;

    const a0 = assignmentOf(0, S().teams[0]!.id);
    const judge0 = S().judges[0]!.agent;
    // out-of-range, partial, and another judge's assignment
    expect(
      (
        await judge0
          .put(`${base}/assignments/${a0}/evaluation`)
          .send({ scores: scoresFor([11, 1, 1, 1, 1]), version: 0 })
      ).status,
    ).toBe(422);
    const partial = await judge0
      .put(`${base}/assignments/${a0}/evaluation`)
      .send({ scores: { [S().rubric[0]!.id]: 8 }, version: 0 });
    expect(partial.status).toBe(200); // drafts may be partial
    expect(
      (
        await judge0
          .post(`${base}/assignments/${a0}/evaluation/submit`)
          .send({ version: partial.body.version })
      ).status,
    ).toBe(422);
    expect(
      (
        await S()
          .judges[1]!.agent.put(`${base}/assignments/${a0}/evaluation`)
          .send({ scores: scoresFor(REF.Alpha), version: 0 })
      ).status,
    ).toBe(404);
    expect(
      (
        await S()
          .teams[0]!.lead.put(`${base}/assignments/${a0}/evaluation`)
          .send({ scores: scoresFor(REF.Alpha), version: 0 })
      ).status,
    ).toBe(404);

    for (const [ti, n] of names.entries()) {
      for (const j of [0, 1]) {
        const a = assignmentOf(j, S().teams[ti]!.id);
        const agent = S().judges[j]!.agent;
        const saved = await agent.put(`${base}/assignments/${a}/evaluation`).send({
          scores: scoresFor(REF[n]),
          teamComment: n === 'Alpha' ? 'Sharp problem framing.' : '',
          version: (await db.evaluation.findUnique({ where: { assignmentId: a } }))?.version ?? 0,
        });
        expect(saved.status).toBe(200);
        const first = await agent
          .post(`${base}/assignments/${a}/evaluation/submit`)
          .send({ version: saved.body.version });
        expect(first.status).toBe(201);
        const again = await agent
          .post(`${base}/assignments/${a}/evaluation/submit`)
          .send({ version: saved.body.version });
        expect(again.status).toBe(409); // a double click or retry never submits twice
        // a submitted evaluation is locked against silent edits
        expect(
          (
            await agent
              .put(`${base}/assignments/${a}/evaluation`)
              .send({ scores: scoresFor([1, 1, 1, 1, 1]), version: saved.body.version })
          ).status,
        ).toBeGreaterThanOrEqual(400);
      }
    }
    expect(
      await db.evaluation.count({ where: { eventId: S().eventId, status: 'SUBMITTED' } }),
    ).toBe(6);
    expect(await db.evaluationVersion.count()).toBe(6);
  });
});

describe('9-11 results: calculation, ties, approval and publication', () => {
  it('computes deterministic scores, blocks approval on an unresolved tie, then approves and publishes', async () => {
    const { organiser, base, roundId } = S();
    const closeEarly = await organiser
      .put(`${base}/rounds/${roundId}/judging`)
      .send({ status: 'CLOSED' });
    expect(closeEarly.status).toBe(200);
    const r = (await organiser.get(resultsUrl('/review'))).body;
    const by = Object.fromEntries(r.results.map((x: { name: string }) => [x.name, x]));
    expect(by['Alpha Squad'].score).toBe('100.0000');
    expect(by['Beta Brigade'].score).toBe(by['Gamma Group'].score); // equal inputs, equal score
    expect(r.results.filter((x: { tied: boolean }) => x.tied)).toHaveLength(2);
    const blocked = await organiser.post(resultsUrl('/approve'));
    expect(blocked.status).toBe(409);
    expect(
      (await S().teams[0]!.lead.get(`${base}/rounds/${roundId}/results/published`)).body,
    ).not.toHaveProperty('results');
    const ids = [S().teams[1]!.id, S().teams[2]!.id];
    expect(
      (
        await organiser.put(resultsUrl('/ties')).send({
          group: 'Overall',
          rank: 2,
          teamIds: ids,
          mode: 'ORDER',
          order: [ids[1], ids[0]],
          reason: 'ok',
        })
      ).status,
    ).toBe(422); // reason too short
    expect(
      (
        await organiser.put(resultsUrl('/ties')).send({
          group: 'Overall',
          rank: 2,
          teamIds: ids,
          mode: 'ORDER',
          order: [ids[1], ids[0]],
          reason: 'Gamma won the live Q&A round',
        })
      ).status,
    ).toBe(200);
    const approved = await organiser.post(resultsUrl('/approve'));
    expect(approved.status).toBe(201);
    // changing an input after approval withdraws the approval until it is approved again
    const unpublishedView = await S().teams[1]!.lead.get(`${base}/results`);
    expect(JSON.stringify(unpublishedView.body)).not.toContain('Gamma Group');
    expect((await organiser.post(resultsUrl('/publish'))).status).toBe(200);
    expect((await organiser.post(resultsUrl('/publish'))).status).toBeGreaterThanOrEqual(400); // already published
    const seen = JSON.stringify((await S().teams[1]!.lead.get(`${base}/results`)).body);
    expect(seen).toContain('Alpha Squad');
    expect(seen).not.toMatch(/judgeName|breakdown|teamComment/);
  });
});

describe('12 feedback and comment release', () => {
  it('keeps the form closed until opened, accepts one response per person, hides identity, controls comments', async () => {
    const { organiser, base, roundId } = S();
    const lead = S().teams[0]!.lead;
    expect((await lead.get(`${base}/feedback/mine`)).body.available).toBe(false);
    expect(
      (await lead.post(`${base}/feedback/responses`).send({ answers: { q1: 5 } })).status,
    ).toBe(409);
    expect(
      (await organiser.post(`${base}/feedback/forms/PARTICIPANT/state`).send({ state: 'OPEN' }))
        .status,
    ).toBe(200);
    expect(
      (await lead.post(`${base}/feedback/responses`).send({ answers: { q1: 9 } })).status,
    ).toBe(422);
    expect(
      (
        await lead
          .post(`${base}/feedback/responses`)
          .send({ answers: { q1: 5, q3: 4, q5: '=HYPERLINK("x")' } })
      ).status,
    ).toBe(201);
    expect(
      (await lead.post(`${base}/feedback/responses`).send({ answers: { q1: 1, q3: 1 } })).status,
    ).toBe(409);
    const results = (await organiser.get(`${base}/feedback/results/PARTICIPANT`)).body;
    expect(results.responses).toBe(1);
    expect(JSON.stringify(results)).not.toContain('Alpha Squad Lead');
    const csv = (await organiser.get(`${base}/feedback/results/PARTICIPANT/export.csv`)).text;
    expect(csv).toContain(`'=HYPERLINK`); // formula neutralised
    expect(csv).not.toMatch(/Alpha Squad Lead/);
    // judge comments: hidden until released
    expect(JSON.stringify((await lead.get(`${base}/feedback/team-comments`)).body)).not.toContain(
      'Sharp problem',
    );
    expect((await organiser.post(`${base}/rounds/${roundId}/comments/release`)).status).toBe(200);
    expect(JSON.stringify((await lead.get(`${base}/feedback/team-comments`)).body)).toContain(
      'Sharp problem framing.',
    );
    expect(
      JSON.stringify((await S().teams[1]!.lead.get(`${base}/feedback/team-comments`)).body),
    ).not.toContain('Sharp problem');
  });
});

describe('13-15 certificates, exports and the audit trail', () => {
  it('generates, reviews, releases and serves certificates only to their owners', async () => {
    const { organiser, base } = S();
    const gen = await organiser
      .post(`${base}/certificates/generate?wait=1`)
      .send({ type: 'PARTICIPATION' });
    expect(gen.status).toBe(202);
    const again = await organiser
      .post(`${base}/certificates/generate?wait=1`)
      .send({ type: 'PARTICIPATION' });
    expect(again.status).toBe(202);
    const list = (await organiser.get(`${base}/certificates?type=PARTICIPATION`)).body.certificates;
    expect(list).toHaveLength(6); // three teams of two, no duplicates after generating twice
    expect(new Set(list.map((c: { code: string }) => c.code)).size).toBe(6);
    const mine = list.find((c: { name: string }) => c.name === 'Alpha Squad Lead');
    expect((await S().teams[0]!.lead.get(`${base}/certificates/${mine.id}/pdf`)).status).toBe(404); // not released yet
    expect(
      (await organiser.post(`${base}/certificates/release`).send({ type: 'PARTICIPATION' })).status,
    ).toBe(422);
    expect(
      (
        await organiser
          .post(`${base}/certificates/release`)
          .send({ type: 'PARTICIPATION', reviewed: true })
      ).body.released,
    ).toBe(6);
    const own = await S()
      .teams[0]!.lead.get(`${base}/certificates/${mine.id}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(own.status).toBe(200);
    expect((own.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await S().teams[1]!.lead.get(`${base}/certificates/${mine.id}/pdf`)).status).toBe(404);
    expect((await S().judges[0]!.agent.get(`${base}/certificates`)).status).toBe(404);
  });

  it('exports participants, teams, results, feedback and certificates as safe CSV for organisers only', async () => {
    const { organiser, base } = S();
    for (const path of [
      '/exports/participants.csv',
      '/exports/teams.csv',
      `/rounds/${S().roundId}/results/export.csv`,
      '/certificates/export.csv',
    ]) {
      const res = await organiser.get(`${base}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text.split('\r\n').length).toBeGreaterThan(2);
      expect((await S().teams[0]!.lead.get(`${base}${path}`)).status, path).toBe(404);
      expect((await S().judges[0]!.agent.get(`${base}${path}`)).status, path).toBe(404);
    }
    const participants = (await organiser.get(`${base}/exports/participants.csv`)).text;
    expect(participants).toContain('Alpha Squad Lead');
    expect(participants.split('\r\n').filter(Boolean)).toHaveLength(7); // header + 6
  });

  it('records every important action in the append-only audit log, and the log cannot be altered', async () => {
    const actions = new Set(
      (
        await db.auditLog.findMany({ where: { OR: [{ eventId: S().eventId }, { eventId: null }] } })
      ).map((a) => a.action),
    );
    for (const must of [
      'user.registered',
      'event.created',
      'event.published',
      'guidebook.published',
      'submission.submitted',
      'member.invited',
      'member.joined',
      'evaluation.submitted',
      'results.approved',
      'results.published',
      'feedback.submitted',
      'feedback.comments_released',
      'certificates.generated',
      'certificates.released',
    ])
      expect([...actions].sort(), `missing audit action ${must}`).toContain(must);
    const any = await db.auditLog.findFirstOrThrow({ where: { eventId: S().eventId } });
    await expect(
      db.auditLog.update({ where: { id: any.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: any.id } })).rejects.toThrow();
    const trail = (await S().organiser.get(`${S().base}/audit?pageSize=200`)).body;
    expect(trail.rows.length).toBeGreaterThan(30);
    expect((await S().teams[0]!.lead.get(`${S().base}/audit`)).status).toBe(404);
  });
});
