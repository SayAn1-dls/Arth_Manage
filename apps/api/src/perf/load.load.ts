/**
 * Load profile from PRD AS-01 / §11.2: 1,000 participants, 250 teams, 50 judges, 30 staff, 3 evaluations per
 * team over a 12-criterion rubric. Builds the data directly in the test database, then times the real API.
 * Run with `npm run test:load -w @arthakram/api`; not part of the normal suite because it is slow.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { createTestKit, createUser, resetDb, signedInAgent } from '../test/helpers.js';
import { openEvent } from '../test/world.js';
import { createCertificateService } from '../modules/certificates/service.js';

const kit = createTestKit();
const { db, deps } = kit;
const P = { participants: 1000, teams: 250, judges: 50, staff: 30, evalsPerTeam: 3, criteria: 12 };
const timings: Record<string, number> = {};

async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const runs: number[] = [];
  let out!: T;
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    out = await fn();
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  timings[name] = Math.round(runs[Math.ceil(runs.length * 0.95) - 1]!); // p95 of 5 runs = the slowest
  return out;
}

let w: Awaited<ReturnType<typeof openEvent>>;
let judge: Awaited<ReturnType<typeof signedInAgent>>;

beforeAll(async () => {
  await resetDb(db);
  w = await openEvent(kit);
  const hash = (await createUser(db)).passwordHash;
  const mk = async (n: number, prefix: string) => {
    const emails = Array.from({ length: n }, (_, i) => `${prefix}${i}@load.test`);
    await db.user.createMany({
      data: emails.map((email, i) => ({
        email,
        name: `${prefix} ${i}`,
        passwordHash: hash,
        emailVerifiedAt: new Date(),
      })),
    });
    return db.user.findMany({ where: { email: { in: emails } }, orderBy: { email: 'asc' } });
  };
  const [parts, judges, staff] = await Promise.all([
    mk(P.participants, 'participant'),
    mk(P.judges, 'judge'),
    mk(P.staff, 'staff'),
  ]);
  const role = (users: { id: string }[], r: 'PARTICIPANT' | 'JUDGE' | 'STAFF') =>
    db.eventMembership.createMany({
      data: users.map((u) => ({ eventId: w.eventId, userId: u.id, role: r })),
    });
  await Promise.all([role(parts, 'PARTICIPANT'), role(judges, 'JUDGE'), role(staff, 'STAFF')]);
  const mem = await db.eventMembership.findMany({ where: { eventId: w.eventId } });
  const byUser = new Map(mem.map((m) => [m.userId, m]));

  await db.registration.createMany({
    data: parts.map((u, i) => ({
      eventId: w.eventId,
      membershipId: byUser.get(u.id)!.id,
      fullName: `Participant ${i}`,
      institution: 'Load University',
      phone: '9876543210',
      certificateName: `Participant ${i}`,
      declarationsAcceptedAt: new Date(),
    })),
  });
  await db.team.createMany({
    data: Array.from({ length: P.teams }, (_, i) => ({
      eventId: w.eventId,
      teamCode: `T-${String(i + 1).padStart(4, '0')}`,
      name: `Team ${i}`,
    })),
  });
  const teams = await db.team.findMany({
    where: { eventId: w.eventId },
    orderBy: { teamCode: 'asc' },
  });
  await db.teamMember.createMany({
    data: parts.map((u, i) => ({
      teamId: teams[i % P.teams]!.id,
      eventId: w.eventId,
      membershipId: byUser.get(u.id)!.id,
      role: i < P.teams ? ('LEADER' as const) : ('MEMBER' as const),
    })),
  });
  await db.submission.createMany({
    data: teams.map((t) => ({
      eventId: w.eventId,
      roundId: w.roundId,
      teamId: t.id,
      lastVersionNo: 1,
    })),
  });
  const subs = await db.submission.findMany({ where: { roundId: w.roundId } });
  await db.submissionVersion.createMany({
    data: subs.map((s, i) => ({
      submissionId: s.id,
      eventId: w.eventId,
      versionNo: 1,
      title: `Project ${i}`,
      summary: 'Load test project',
      values: {},
      submittedByMembershipId: mem[0]!.id,
    })),
  });

  // Rubric with 12 criteria weighted to 100, active, judging closed
  const rubric = await db.rubric.create({
    data: { roundId: w.roundId, name: 'Load rubric', state: 'ACTIVE' },
  });
  const weights = [9, 9, 9, 9, 9, 9, 9, 9, 7, 7, 7, 7];
  await db.rubricCriterion.createMany({
    data: weights.map((weight, i) => ({
      rubricId: rubric.id,
      name: `Criterion ${i + 1}`,
      weight,
      min: 1,
      max: 10,
      order: i,
    })),
  });
  const crit = await db.rubricCriterion.findMany({
    where: { rubricId: rubric.id },
    orderBy: { order: 'asc' },
  });
  await db.round.update({
    where: { id: w.roundId },
    data: { judgingStatus: 'CLOSED', requiredEvaluations: 3 },
  });
  const jm = judges.map((u) => byUser.get(u.id)!);
  await db.judgeAssignment.createMany({
    data: teams.flatMap((t, i) =>
      Array.from({ length: P.evalsPerTeam }, (_, k) => ({
        eventId: w.eventId,
        roundId: w.roundId,
        teamId: t.id,
        judgeMembershipId: jm[(i * P.evalsPerTeam + k) % jm.length]!.id,
      })),
    ),
  });
  const assigns = await db.judgeAssignment.findMany({ where: { roundId: w.roundId } });
  await db.evaluation.createMany({
    data: assigns.map((a, i) => ({
      assignmentId: a.id,
      eventId: w.eventId,
      status: 'SUBMITTED' as const,
      weightedScore: (40 + (i % 60)).toFixed(4),
      submittedAt: new Date(),
      submissionCount: 1,
    })),
  });
  const evals = await db.evaluation.findMany({ where: { eventId: w.eventId } });
  await db.criterionScore.createMany({
    data: evals.flatMap((e, i) =>
      crit.map((c, k) => ({ evaluationId: e.id, criterionId: c.id, score: 1 + ((i + k) % 10) })),
    ),
  });
  judge = await signedInAgent(kit.app, judges[0]!.email);
}, 300_000);

afterAll(async () => {
  process.stdout.write(
    `\nLoad profile p95 (ms, slowest of 5): ${JSON.stringify(timings, null, 1)}\n`,
  );
  await db.$disconnect();
});

describe('PRD §11.2 targets at the load profile', () => {
  it('admin dashboard ≤ 2 s', async () => {
    await timed('dashboard', async () =>
      expect((await w.admin.get(`${w.base}/dashboard`)).status).toBe(200),
    );
    expect(timings.dashboard).toBeLessThanOrEqual(2000);
  });

  it('participant list search and filter ≤ 1 s', async () => {
    await timed('participants list', async () =>
      expect(
        (await w.admin.get(`${w.base}/participants?q=Participant%2099&pageSize=50`)).status,
      ).toBe(200),
    );
    await timed('teams list', async () =>
      expect((await w.admin.get(`${w.base}/teams?pageSize=50`)).status).toBe(200),
    );
    expect(timings['participants list']).toBeLessThanOrEqual(1000);
    expect(timings['teams list']).toBeLessThanOrEqual(1000);
  });

  it('judge workspace list ≤ 2 s', async () => {
    await timed('judge teams', async () =>
      expect((await judge.get(`${w.base}/rounds/${w.roundId}/judge/teams`)).status).toBe(200),
    );
    expect(timings['judge teams']).toBeLessThanOrEqual(2000);
  });

  it('result calculation for 250 teams × 3 evaluations × 12 criteria ≤ 1 s', async () => {
    const res = await w.admin.get(`${w.base}/rounds/${w.roundId}/results/review`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(P.teams);
    await timed('results review', async () =>
      expect((await w.admin.get(`${w.base}/rounds/${w.roundId}/results/review`)).status).toBe(200),
    );
    expect(timings['results review']).toBeLessThanOrEqual(1000);
  });

  it('CSV exports of 1,000 participants complete quickly', async () => {
    await timed('participants csv', async () =>
      expect((await w.admin.get(`${w.base}/exports/participants.csv`)).status).toBe(200),
    );
    expect(timings['participants csv']).toBeLessThanOrEqual(3000);
  });

  it('certificate generation: 1,000 certificates well inside 10 minutes (measured on 100, extrapolated)', async () => {
    const svc = createCertificateService(deps);
    const event = await db.event.findUniqueOrThrow({ where: { id: w.eventId } });
    const sample = await db.registration.findMany({ where: { eventId: w.eventId }, take: 100 });
    const t = performance.now();
    for (const r of sample)
      await svc.render(
        event,
        {
          type: 'PARTICIPATION',
          nameSnapshot: r.certificateName,
          teamName: 'Team',
          awardText: null,
          certificateCode: 'CERT-LOAD-TEST',
          version: 1,
        },
        new Date(),
      );
    const per = (performance.now() - t) / sample.length;
    timings['certificate (each)'] = Math.round(per);
    timings['1,000 certificates (est.)'] = Math.round(per * 1000);
    expect(per * 1000).toBeLessThanOrEqual(10 * 60_000);
  }, 300_000);

  it('serves 50 concurrent dashboard requests without errors', async () => {
    const t = performance.now();
    const rs = await Promise.all(
      Array.from({ length: 50 }, () => w.admin.get(`${w.base}/dashboard`)),
    );
    timings['50 concurrent dashboards (total)'] = Math.round(performance.now() - t);
    expect(rs.every((r) => r.status === 200)).toBe(true);
  }, 120_000);
});
