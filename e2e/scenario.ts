import type { Playwright } from '@playwright/test';
import { Api, future, newUser, pdf } from './api.js';

export const BASE = 'http://localhost:5173';

export interface Scenario {
  admin: Api;
  org: { email: string; password: string; name: string };
  eventId: string;
  slug: string;
  ev: string;
  roundId: string;
  teams: { id: string; name: string; lead: { email: string; password: string; api: Api } }[];
  judges: { email: string; password: string; membershipId: string; api: Api }[];
}

/**
 * A realistic starting point built entirely through the public API: a published event, teams that registered
 * and submitted, the submission deadline passed, an active template rubric and judges who accepted invitations.
 * Judging is left closed so each spec decides what happens next.
 */
export async function buildJudgingScenario(
  playwright: Playwright,
  opts: { teams: string[]; judges: number; required?: number },
): Promise<Scenario> {
  const org = await newUser(playwright, BASE, 'Olive Organiser');
  const admin = await Api.signedIn(playwright, BASE, org.email, org.password);
  const created = await admin.post('/events', {
    name: `Scenario Cup ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'HACKATHON',
    mode: 'IN_PERSON',
    startsAt: future(30),
    endsAt: future(31),
    timeZone: 'Asia/Kolkata',
    institution: 'Rishihood University',
    contactEmail: 'org@example.test',
  });
  const ev = `/events/${created.id}`;
  await admin.patch(ev, { version: 1, teamMin: 2, teamMax: 3 });
  const round = (await admin.get(`${ev}/rounds`)).rounds[0];
  const roundBody = {
    name: 'Round 1',
    graceMinutes: 0,
    latePolicy: 'REJECT',
    rankingScope: 'OVERALL',
    requiredEvaluations: opts.required ?? 1,
    awardPositions: 3,
  };
  await admin.patch(`${ev}/rounds/${round.id}`, { ...roundBody, submissionDeadline: future(29) });
  await admin.post(`${ev}/publish`);
  await admin.put(`${ev}/registration`, { status: 'OPEN' });

  const teams: Scenario['teams'] = [];
  for (const name of opts.teams) {
    const lead = await newUser(playwright, BASE, `${name} Lead`);
    const mate = await newUser(playwright, BASE, `${name} Mate`);
    const leadApi = await Api.signedIn(playwright, BASE, lead.email, lead.password);
    const mateApi = await Api.signedIn(playwright, BASE, mate.email, mate.password);
    for (const [api, who] of [
      [leadApi, lead],
      [mateApi, mate],
    ] as const)
      await api.post(`/public/events/${created.slug}/register`, {
        fullName: who.name,
        institution: 'Rishihood University',
      });
    const team = (await leadApi.post(`${ev}/teams`, { name })).team;
    await mateApi.post(`${ev}/teams/join`, { code: team.joinCode });
    const sub = await leadApi.get(`${ev}/rounds/${round.id}/submission`);
    const file = sub.fields.find((f: { type: string }) => f.type === 'FILE');
    const repo = sub.fields.find((f: { type: string }) => f.type === 'REPO_URL');
    const up = await leadApi.upload(
      `${ev}/rounds/${round.id}/submission/files/${file.id}`,
      pdf(name),
      'deck.pdf',
    );
    const draft = await leadApi.put(`${ev}/rounds/${round.id}/submission/draft`, {
      title: `${name} project`,
      summary: 'A useful thing.',
      version: up.version,
      values: { [file.id]: up.file.id, [repo.id]: 'https://github.com/owner/repo' },
    });
    await leadApi.post(`${ev}/rounds/${round.id}/submission/submit`, { version: draft.version });
    teams.push({
      id: team.id,
      name,
      lead: { email: lead.email, password: lead.password, api: leadApi },
    });
  }

  await admin.patch(`${ev}/rounds/${round.id}`, {
    ...roundBody,
    submissionDeadline: new Date(Date.now() - 60_000).toISOString(),
    reason: 'Simulating the deadline passing',
  });
  await admin.post(`${ev}/rounds/${round.id}/rubric/template`, { key: 'HACKATHON' });
  await admin.post(`${ev}/rounds/${round.id}/rubric/activate`);

  const judges: Scenario['judges'] = [];
  for (let i = 0; i < opts.judges; i++) {
    const u = await newUser(playwright, BASE, `Judge ${i + 1}`);
    await admin.post(`${ev}/invitations`, { email: u.email, role: 'JUDGE' });
    const api = await Api.signedIn(playwright, BASE, u.email, u.password);
    const mail = (
      await (await api.ctx.get(`/api/v1/dev/outbox?to=${encodeURIComponent(u.email)}`)).json()
    ).messages.find((m: { subject: string }) => m.subject.includes('invited'));
    await api.post('/invitations/accept', { token: new URL(mail.link).searchParams.get('token') });
    judges.push({ ...u, membershipId: '', api });
  }
  const members = (await admin.get(`${ev}/members`)).members as {
    membershipId: string;
    role: string;
    email: string;
  }[];
  for (const j of judges) j.membershipId = members.find((m) => m.email === j.email)!.membershipId;
  return {
    admin,
    org,
    eventId: created.id,
    slug: created.slug,
    ev,
    roundId: round.id,
    teams,
    judges,
  };
}

/** Assigns every judge to every team, opens judging and has each judge submit the given scores per team. */
export async function scoreEverything(s: Scenario, scores: Record<string, number[][]>) {
  const { admin, ev, roundId } = s;
  await admin.post(`${ev}/rounds/${roundId}/assignments`, {
    judgeMembershipIds: s.judges.map((j) => j.membershipId),
    teamIds: s.teams.map((t) => t.id),
  });
  await admin.put(`${ev}/rounds/${roundId}/judging`, { status: 'OPEN' });
  const rubric = (await admin.get(`${ev}/rounds/${roundId}/rubric`)).rubric as {
    criteria: { id: string }[];
  };
  const overview = await admin.get(`${ev}/rounds/${roundId}/judging/overview`);
  for (const team of s.teams) {
    for (const [i, judge] of s.judges.entries()) {
      const triple = scores[team.name]?.[i];
      if (!triple) continue;
      const a = overview.teams
        .find((t: { teamId: string }) => t.teamId === team.id)
        .assignments.find(
          (x: { judgeMembershipId: string }) => x.judgeMembershipId === judge.membershipId,
        ).id;
      const saved = await judge.api.put(`${ev}/assignments/${a}/evaluation`, {
        scores: Object.fromEntries(rubric.criteria.map((c, k) => [c.id, triple[k]])),
        version: 0,
      });
      await judge.api.post(`${ev}/assignments/${a}/evaluation/submit`, { version: saved.version });
    }
  }
}
