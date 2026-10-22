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
