import { afterAll, afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createTestKit, resetDb } from '../../test/helpers.js';
import {
  openEvent,
  teamOfTwo,
  submitProject,
  addJudge,
  closeSubmissions,
  workedExampleRubric,
  openJudging,
} from '../../test/world.js';
import { aiReading } from './insights.js';
const kit = createTestKit();
const { db } = kit;
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
async function world() {
  const w = await openEvent(kit),
    team = await teamOfTwo(w),
    judge = await addJudge(kit, w, 'Reviewer One'),
    other = await addJudge(kit, w, 'Reviewer Two');
  await submitProject(w, team);
  await closeSubmissions(kit, w);
  await workedExampleRubric(w);
  await w.admin
    .post(`${w.base}/rounds/${w.roundId}/assignments`)
    .send({ judgeMembershipIds: [judge.membershipId, other.membershipId], teamIds: [team.teamId] });
  await openJudging(w);
  const assignment = await db.judgeAssignment.findFirstOrThrow({
    where: { teamId: team.teamId, judgeMembershipId: judge.membershipId },
  });
  return { w, team, judge, other, assignment, url: `${w.base}/assignments/${assignment.id}/memo` };
}
describe('judge reading and personal tools', () => {
  it('isolates scratchpad from other judges, admins, participants and evaluation DTOs', async () => {
    const { w, team, judge, other, url } = await world();
    expect((await judge.agent.get(url)).body).toMatchObject({
      scratchpad: '',
      starred: false,
      version: 0,
    });
    const saved = await judge.agent
      .put(url)
      .send({ scratchpad: 'Only I can read this reasoning', starred: true, version: 0 });
    expect(saved.status).toBe(200);
    for (const agent of [w.admin, other.agent, team.lead.agent]) {
      expect((await agent.get(url)).status).toBe(404);
      expect((await agent.put(url).send({ scratchpad: 'Intrusion', version: 1 })).status).toBe(404);
    }
    const adminView = await w.admin.get(`${w.base}/rounds/${w.roundId}/evaluations`);
    expect(JSON.stringify(adminView.body)).not.toContain('Only I can read');
  });
  it('prevents stale scratchpad overwrites and filters own starred teams', async () => {
    const { w, team, judge, other, url } = await world();
    await judge.agent.put(url).send({ starred: true, scratchpad: 'Keep', version: 0 });
    expect((await judge.agent.put(url).send({ scratchpad: 'Stale tab', version: 0 })).status).toBe(
      409,
    );
    expect(
      (await judge.agent.get(`${w.base}/rounds/${w.roundId}/judge/teams?starred=1`)).body.rows.map(
        (r: { teamId: string }) => r.teamId,
      ),
    ).toEqual([team.teamId]);
    expect(
      (await other.agent.get(`${w.base}/rounds/${w.roundId}/judge/teams?starred=1`)).body.rows,
    ).toHaveLength(0);
  });
  it('does not leak notes across events or leave access after unassignment', async () => {
    const { w, judge, assignment, url } = await world();
    await judge.agent.put(url).send({ scratchpad: 'Before removal', version: 0 });
    const event = await openEvent(kit);
    expect((await event.admin.get(`${event.base}/assignments/${assignment.id}/memo`)).status).toBe(
      404,
    );
    await db.judgeAssignment.update({
      where: { id: assignment.id },
      data: { status: 'UNASSIGNED' },
    });
    expect((await judge.agent.get(url)).status).toBe(404);
    expect((await judge.agent.get(`${w.base}/judge/practice`)).status).toBe(200);
  });
  it('publishes briefing with optimistic locking and validates glossary track scope', async () => {
    const { w, judge, team } = await world();
    const url = `${w.base}/judge/briefing`;
    const input = {
      body: 'Read the rubric',
      examples: 'Fictional team: 8/10 for execution',
      contact: 'Use Ask Admin',
      version: 0,
    };
    expect((await judge.agent.put(url).send(input)).status).toBe(404);
    expect((await w.admin.put(url).send(input)).status).toBe(200);
    expect((await w.admin.put(url).send(input)).status).toBe(409);
    expect((await judge.agent.get(url)).body.briefing.body).toBe('Read the rubric');
    expect((await team.lead.agent.get(url)).status).toBe(404);
    const track = await db.track.create({ data: { eventId: w.eventId, name: 'Health' } });
    expect(
      (
        await w.admin.put(`${w.base}/judge/glossary`).send({
          terms: [
            {
              term: 'FHIR',
              definition: 'Fast Healthcare Interoperability Resources',
              trackId: track.id,
            },
          ],
        })
      ).status,
    ).toBe(200);
    expect((await judge.agent.get(url)).body.glossary[0].term).toBe('FHIR');
    expect(
      (
        await w.admin.put(`${w.base}/judge/glossary`).send({
          terms: [{ term: 'UPI', definition: 'Payment interface', trackId: 'foreign-track' }],
        })
      ).status,
    ).toBe(422);
  });
  it('opens the practice team before judging with no persisted evaluations', async () => {
    const w = await openEvent(kit),
      judge = await addJudge(kit, w, 'Early judge');
    const before = await db.evaluation.count();
    const demo = await judge.agent.get(`${w.base}/judge/practice`);
    expect(demo.status).toBe(200);
    expect(demo.body.title).toContain('Practice');
    expect(demo.body.criteria.length).toBeGreaterThan(0);
    expect(await db.evaluation.count()).toBe(before);
    expect(
      (
        await judge.agent
          .put(`${w.base}/assignments/practice/evaluation`)
          .send({ scores: { execution: 10 }, version: 0 })
      ).status,
    ).toBe(404);
  });
  it('lets judges contact the organiser through the existing private helpdesk', async () => {
    const { w, judge } = await world();
    const ticket = await judge.agent
      .post(`${w.base}/workspace/tickets`)
      .send({ subject: 'Rubric clarification', body: 'Does execution include testing?' });
    expect(ticket.status).toBe(201);
    expect((await w.admin.get(`${w.base}/workspace/tickets`)).body.tickets[0].subject).toBe(
      'Rubric clarification',
    );
  });
  it('returns version-bound reading evidence, actual file health and no fabricated AI output', async () => {
    const { w, team, judge, other } = await world();
    const fetchMock = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/readme')
              ? {
                  encoding: 'base64',
                  size: 50,
                  content: Buffer.from('# Setup\nRun npm install\n# Limitations').toString(
                    'base64',
                  ),
                }
              : {
                  language: 'TypeScript',
                  description: 'A project',
                  pushed_at: '2026-10-27T12:00:00Z',
                },
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const url = `${w.base}/rounds/${w.roundId}/judge/teams/${team.teamId}/insight`;
    const response = await judge.agent.get(url);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      versionNo: 1,
      ai: null,
      aiConfigured: false,
      files: [{ available: true }],
      repo: { reachable: true, language: 'TypeScript' },
    });
    expect(response.body.repo.readmeHighlights).toContain('# Setup');
    expect((await other.agent.get(url)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const stranger = await addJudge(kit, w, 'Unassigned');
    expect((await stranger.agent.get(url)).status).toBe(404);
  });
  it('exports only the current judge’s evaluations as PDF', async () => {
    const { w, judge, other, assignment } = await world();
    await db.evaluation.create({
      data: {
        eventId: w.eventId,
        assignmentId: assignment.id,
        teamComment: 'My feedback',
        privateNote: 'My note',
      },
    });
    const one = await judge.agent.get(`${w.base}/judge/export.pdf`);
    expect(one.status).toBe(200);
    expect(one.headers['content-type']).toContain('application/pdf');
    const two = await other.agent.get(`${w.base}/judge/export.pdf`);
    expect(two.status).toBe(200);
    expect(one.body.length).toBeGreaterThan(two.body.length);
    expect((await w.admin.get(`${w.base}/judge/export.pdf`)).status).toBe(404);
  });
  it('validates structured AI output and sends no evaluation scores or private notes', async () => {
    let payload: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: RequestInit) => {
        payload = JSON.parse(String(opts.body));
        const content = {
          summary: 'A source-based summary',
          techStack: ['TypeScript'],
          readmeHighlights: ['Simulated sensor feed'],
        };
        return new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: JSON.stringify(content) }],
              },
            ],
          }),
        );
      }),
    );
    const result = await aiReading(
      {
        ...kit.deps.env,
        JUDGE_AI_ENABLED: true,
        OPENAI_API_KEY: 'fake-test-only',
        JUDGE_SUMMARY_MODEL: 'test-model',
      },
      {
        title: 'RiverWatch',
        summary: 'Demo project',
        readme: 'Simulated sensor feed',
        language: 'TypeScript',
      },
    );
    expect(result?.techStack).toEqual(['TypeScript']);
    expect(payload.store).toBe(false);
    expect(String(payload.input)).not.toContain('weightedScore');
    expect(String(payload.input)).not.toContain('scratchpad');
  });
});
