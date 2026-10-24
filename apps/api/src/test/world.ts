import type { Express } from 'express';
import { createUser, signedInAgent, type TestKit } from './helpers.js';

export type Agent = Awaited<ReturnType<typeof signedInAgent>>;

export const future = (days: number) => new Date(Date.now() + days * 864e5).toISOString();
export const past = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

export const eventBody = (over: Record<string, unknown> = {}) => ({
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

export const roundBody = (over: Record<string, unknown> = {}) => ({
  name: 'Round 1',
  submissionDeadline: future(29),
  graceMinutes: 0,
  latePolicy: 'REJECT',
  rankingScope: 'OVERALL',
  requiredEvaluations: 2,
  awardPositions: 3,
  ...over,
});

export const pdfBytes = (extra = 'x') =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(extra.repeat(50))]);
export const pptxBytes = () =>
  Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('....ppt/slides/slide1.xml....'),
  ]);

/**
 * A published event with registration open, an admin, and a helper to register participants through
 * the real API. Everything goes through the HTTP layer so tests exercise the same paths as the UI.
 */
export async function openEvent(
  kit: TestKit,
  over: { event?: Record<string, unknown>; round?: Record<string, unknown> } = {},
) {
  const adminUser = await createUser(kit.db, { name: 'Owner' });
  const admin = await signedInAgent(kit.app, adminUser.email);
  const created = await admin.post('/api/v1/events').send(eventBody(over.event));
  if (created.status !== 201)
    throw new Error(`event create failed ${JSON.stringify(created.body)}`);
  const eventId = created.body.id as string;
  const slug = created.body.slug as string;
  const base = `/api/v1/events/${eventId}`;
  await admin.patch(base).send({ version: 1, teamMin: 2, teamMax: 3 });
  const round = (await admin.get(`${base}/rounds`)).body.rounds[0];
  await admin.patch(`${base}/rounds/${round.id}`).send(roundBody(over.round));
  const published = await admin.post(`${base}/publish`);
  if (published.status !== 200) throw new Error(`publish failed ${JSON.stringify(published.body)}`);
  const reg = await admin.put(`${base}/registration`).send({ status: 'OPEN' });
  if (reg.status !== 200) throw new Error(`open registration failed ${JSON.stringify(reg.body)}`);

  async function participant(name: string, opts: { register?: boolean } = {}) {
    const user = await createUser(kit.db, { name });
    const agent = await signedInAgent(kit.app, user.email);
    let membershipId = '';
    if (opts.register !== false) {
      const r = await agent
        .post(`/api/v1/public/events/${slug}/register`)
        .send({ fullName: name, institution: 'Rishihood University', phone: '9876543210' });
      if (r.status !== 201 && r.status !== 200)
        throw new Error(`register failed ${JSON.stringify(r.body)}`);
      membershipId = (
        await kit.db.eventMembership.findFirstOrThrow({ where: { eventId, userId: user.id } })
      ).id;
    }
    return { user, agent, membershipId };
  }

  /** PATCH the event with whatever the current version is, so tests do not hard-code version numbers. */
  async function patchEvent(body: Record<string, unknown>) {
    const version = (await admin.get(base)).body.version as number;
    const res = await admin.patch(base).send({ version, ...body });
    if (res.status !== 200) throw new Error(`patchEvent failed ${JSON.stringify(res.body)}`);
    return res.body;
  }

  return {
    admin,
    adminUser,
    eventId,
    slug,
    base,
    roundId: round.id as string,
    participant,
    patchEvent,
    app: kit.app as Express,
  };
}

type World = Awaited<ReturnType<typeof openEvent>>;

export function upload(agent: Agent, url: string, bytes: Buffer, filename: string) {
  return agent
    .put(url)
    .set('Content-Type', 'application/octet-stream')
    .set('X-Filename', encodeURIComponent(filename))
    .send(bytes);
}

/** A two-person team (the event minimum) created through the API. */
export async function teamOfTwo(w: World, name = 'Byte Me') {
  const lead = await w.participant(`${name} Lead`);
  const created = await lead.agent.post(`${w.base}/teams`).send({ name });
  const mate = await w.participant(`${name} Mate`);
  await mate.agent.post(`${w.base}/teams/join`).send({ code: created.body.team.joinCode });
  return { lead, mate, teamId: created.body.team.id as string };
}

/** Fills the default hackathon form with a real PDF and submits it as version 1. */
export async function submitProject(
  w: World,
  team: Awaited<ReturnType<typeof teamOfTwo>>,
  title = 'Fraud Radar',
) {
  const url = `${w.base}/rounds/${w.roundId}/submission`;
  const s = (await team.lead.agent.get(url)).body;
  const file = s.fields.find((f: { type: string }) => f.type === 'FILE');
  const repo = s.fields.find((f: { type: string }) => f.type === 'REPO_URL');
  const up = await upload(team.lead.agent, `${url}/files/${file.id}`, pdfBytes(title), 'deck.pdf');
  if (up.status !== 201) throw new Error(`upload failed ${JSON.stringify(up.body)}`);
  const draft = await team.lead.agent.put(`${url}/draft`).send({
    title,
    summary: `${title} summary`,
    version: up.body.version,
    values: { [file.id]: up.body.file.id, [repo.id]: 'https://github.com/owner/repo' },
  });
  const submitted = await team.lead.agent
    .post(`${url}/submit`)
    .send({ version: draft.body.version });
  if (submitted.status !== 201) throw new Error(`submit failed ${JSON.stringify(submitted.body)}`);
  return { fileId: up.body.file.id as string, fileFieldId: file.id as string };
}

/** Closes the submission window by moving the deadline into the past (what time passing would do). */
export async function closeSubmissions(kit: TestKit, w: World) {
  await kit.db.round.update({
    where: { id: w.roundId },
    data: { submissionDeadline: new Date(Date.now() - 60_000) },
  });
}

export async function addJudge(kit: TestKit, w: World, name: string) {
  const user = await createUser(kit.db, { name });
  const membership = await kit.db.eventMembership.create({
    data: { eventId: w.eventId, userId: user.id, role: 'JUDGE' },
  });
  return { user, membershipId: membership.id, agent: await signedInAgent(kit.app, user.email) };
}

/** The PRD E.1 worked-example rubric: weights 30/40/30 over ranges 1-10, 1-10 and 0-5. */
export async function workedExampleRubric(w: World) {
  const put = await w.admin.put(`${w.base}/rounds/${w.roundId}/rubric`).send({
    name: 'Worked example',
    teamCommentMode: 'OPTIONAL',
    criteria: [
      { name: 'A', description: 'Criterion A', weight: 30, min: 1, max: 10 },
      { name: 'B', description: 'Criterion B', weight: 40, min: 1, max: 10 },
      { name: 'C', description: 'Criterion C', weight: 30, min: 0, max: 5 },
    ],
  });
  if (put.status !== 200) throw new Error(`rubric failed ${JSON.stringify(put.body)}`);
  const act = await w.admin.post(`${w.base}/rounds/${w.roundId}/rubric/activate`);
  if (act.status !== 200) throw new Error(`activate failed ${JSON.stringify(act.body)}`);
  return act.body.rubric as { criteria: { id: string; name: string }[] };
}

export async function openJudging(w: World) {
  const res = await w.admin.put(`${w.base}/rounds/${w.roundId}/judging`).send({ status: 'OPEN' });
  if (res.status !== 200) throw new Error(`open judging failed ${JSON.stringify(res.body)}`);
}

/**
 * A closed-judging round with the worked-example rubric: each listed team submits, every judge scores every
 * team, then judging is closed. `scores[teamName]` is one [A, B, C] triple per judge.
 */
export async function judgedRound(
  kit: TestKit,
  spec: {
    teams: Record<string, number[][]>;
    required?: number;
    judges?: number;
    closeJudging?: boolean;
  },
) {
  const w = await openEvent(kit);
  if (spec.required) {
    const round = await kit.db.round.findUniqueOrThrow({ where: { id: w.roundId } });
    await kit.db.round.update({
      where: { id: round.id },
      data: { requiredEvaluations: spec.required },
    });
  }
  const teams: Record<string, Awaited<ReturnType<typeof teamOfTwo>>> = {};
  for (const name of Object.keys(spec.teams)) {
    teams[name] = await teamOfTwo(w, name);
    await submitProject(w, teams[name]!, `${name} project`);
  }
  await closeSubmissions(kit, w);
  const rubric = await workedExampleRubric(w);
  const judges: Awaited<ReturnType<typeof addJudge>>[] = [];
  for (let i = 0; i < (spec.judges ?? 2); i++)
    judges.push(await addJudge(kit, w, `Judge ${i + 1}`));
  await w.admin.post(`${w.base}/rounds/${w.roundId}/assignments`).send({
    judgeMembershipIds: judges.map((j) => j.membershipId),
    teamIds: Object.values(teams).map((t) => t.teamId),
  });
  await openJudging(w);
  const [A, B, C] = rubric.criteria.map((c) => c.id) as [string, string, string];
  const overview = async () =>
    (await w.admin.get(`${w.base}/rounds/${w.roundId}/judging/overview`)).body;
  const o = await overview();
  const assignmentOf = (judgeMembershipId: string, teamId: string) =>
    o.teams
      .find((t: { teamId: string }) => t.teamId === teamId)
      .assignments.find(
        (a: { judgeMembershipId: string }) => a.judgeMembershipId === judgeMembershipId,
      ).id as string;
  const evaluate = async (judgeIdx: number, teamName: string, triple: number[]) => {
    const judge = judges[judgeIdx]!;
    const a = assignmentOf(judge.membershipId, teams[teamName]!.teamId);
    const saved = await judge.agent
      .put(`${w.base}/assignments/${a}/evaluation`)
      .send({ scores: { [A]: triple[0], [B]: triple[1], [C]: triple[2] }, version: 0 });
    const res = await judge.agent
      .post(`${w.base}/assignments/${a}/evaluation/submit`)
      .send({ version: saved.body.version });
    if (res.status !== 201) throw new Error(`submit failed ${JSON.stringify(res.body)}`);
    return a;
  };
  for (const [name, perJudge] of Object.entries(spec.teams))
    for (const [i, triple] of perJudge.entries()) await evaluate(i, name, triple);
  if (spec.closeJudging !== false)
    await w.admin.put(`${w.base}/rounds/${w.roundId}/judging`).send({ status: 'CLOSED' });
  return { w, teams, judges, A, B, C, evaluate, assignmentOf, overview };
}
