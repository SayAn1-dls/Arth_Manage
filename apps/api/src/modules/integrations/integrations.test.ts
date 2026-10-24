import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, createUser, resetDb, signedInAgent } from '../../test/helpers.js';
import { openEvent, submitProject, teamOfTwo, addJudge } from '../../test/world.js';
import { GoogleError } from '../../integrations/google.js';
import { decryptSecret, encryptSecret, parseKey } from '../../integrations/crypto.js';
import {
  enqueueSync,
  MAX_ATTEMPTS,
  recoverStuckJobs,
  runDueJobs,
  TIMING,
} from '../../integrations/queue.js';

const kit = createTestKit();
const { db, deps, google } = kit;
beforeEach(async () => {
  await resetDb(db);
  google.configured = true;
  google.spreadsheets.clear();
  google.folders.clear();
  google.files.clear();
  google.failures = [];
  google.calls = [];
});
afterAll(() => db.$disconnect());

type World = Awaited<ReturnType<typeof openEvent>>;
const url = (w: World, p = '') => `${w.base}/integrations${p}`;
const later = (ms = 10 * 60_000) => new Date(Date.now() + ms);

async function connect(w: World, opts: { drive?: boolean; code?: string } = {}) {
  const res = await w.admin
    .post(url(w, '/connect'))
    .send({ acknowledged: true, enableDrive: opts.drive ?? false });
  expect(res.status).toBe(200);
  const state = new URL(res.body.url).searchParams.get('state')!;
  const back = await w.admin.get(
    `/api/v1/integrations/google/callback?code=${opts.code ?? 'abc'}&state=${encodeURIComponent(state)}`,
  );
  expect(back.status).toBe(302);
  return back.headers.location as string;
}
async function runAll() {
  let total = 0;
  for (let i = 0; i < 5; i++) {
    const n = await runDueJobs(deps, later(24 * 3600_000));
    total += n;
    if (!n) break;
  }
  return total;
}
async function connected(opts: { drive?: boolean } = {}) {
  const w = await openEvent(kit);
  const a = await teamOfTwo(w, 'Alpha');
  await teamOfTwo(w, 'Beta');
  await submitProject(w, a);
  await connect(w, opts);
  return { w, a };
}
const tab = (key: string) => {
  const sheet = [...google.spreadsheets.values()][0]!;
  return [...sheet.tabs.values()].find((t) => t.title.toLowerCase() === key)!.rows;
};
const status = async (w: World) => (await w.admin.get(url(w))).body;

describe('configuration and connecting (FR-170, FR-171, FR-181)', () => {
  it('says so honestly when Google is not configured, simulates nothing and leaves CSV usable', async () => {
    const w = await openEvent(kit);
    google.configured = false;
    const s = await status(w);
    expect(s).toMatchObject({ configured: false, connection: null, jobs: [] });
    const res = await w.admin.post(url(w, '/connect')).send({ acknowledged: true });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('not_configured');
    expect((await w.admin.post(url(w, '/sync-now'))).status).toBe(409);
    expect((await w.admin.get(`${w.base}/dashboard`)).body.integrations).toMatchObject({
      status: 'NOT_CONNECTED',
      configured: false,
    });
    expect((await w.admin.get(`${w.base}/exports/participants.csv`)).status).toBe(200);
  });

  it('needs the data-responsibility confirmation, and a signed state that belongs to the same admin', async () => {
    const w = await openEvent(kit);
    expect((await w.admin.post(url(w, '/connect')).send({ acknowledged: false })).status).toBe(422);
    const ok = await w.admin.post(url(w, '/connect')).send({ acknowledged: true });
    const state = new URL(ok.body.url).searchParams.get('state')!;
    const cb = (agent: typeof w.admin, s: string) =>
      agent.get(`/api/v1/integrations/google/callback?code=abc&state=${encodeURIComponent(s)}`);
    // tampered state
    expect((await cb(w.admin, state.slice(0, -3) + 'AAA')).headers.location).toMatch(/\/events$/);
    // another signed-in user cannot complete someone else's connection
    const other = await signedInAgent(w.app, (await createUser(db)).email);
    expect((await cb(other, state)).headers.location).toMatch(/\/events$/);
    expect(await db.integrationConnection.count()).toBe(0);
    // consent denied: nothing changes
    const denied = await w.admin.get(
      `/api/v1/integrations/google/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    );
    expect(denied.headers.location).toMatch(/result=cancelled/);
    expect(await db.integrationConnection.count()).toBe(0);
    // exchange failure
    const bad = await w.admin.post(url(w, '/connect')).send({ acknowledged: true });
    const s2 = new URL(bad.body.url).searchParams.get('state')!;
    const failed = await w.admin.get(
      `/api/v1/integrations/google/callback?code=denied&state=${encodeURIComponent(s2)}`,
    );
    expect(failed.headers.location).toMatch(/result=failed/);
  });

  it('stores the Google token encrypted, never returns it, and queues the first sync', async () => {
    const w = await openEvent(kit);
    const location = await connect(w);
    expect(location).toMatch(/result=connected/);
    const conn = await db.integrationConnection.findFirstOrThrow();
    expect(conn.refreshTokenEnc).not.toContain('refresh-abc');
    expect(decryptSecret(conn.refreshTokenEnc!, parseKey(process.env.TOKEN_ENCRYPTION_KEY)!)).toBe(
      'refresh-abc',
    );
    const s = await status(w);
    expect(JSON.stringify(s)).not.toContain('refresh-abc');
    expect(JSON.stringify(s)).not.toContain(conn.refreshTokenEnc!);
    expect(s.connection).toMatchObject({
      status: 'CONNECTED',
      googleEmail: 'organiser@example.test',
    });
    expect(s.jobs).toHaveLength(1);
    expect(s.jobs[0]).toMatchObject({ kind: 'SHEETS', status: 'QUEUED' });
    expect(await db.auditLog.count({ where: { action: 'integration.connected' } })).toBe(1);
  });

  it('rejects tampered ciphertext', () => {
    const key = parseKey('cd'.repeat(32))!;
    const blob = encryptSecret('secret', key);
    expect(decryptSecret(blob, key)).toBe('secret');
    const [iv, tag, body] = blob.split('.');
    expect(() =>
      decryptSecret([iv, tag, Buffer.from('x').toString('base64')].join('.'), key),
    ).toThrow();
    expect(() => decryptSecret(blob, parseKey('ee'.repeat(32))!)).toThrow();
    expect(body).toBeTruthy();
    expect(parseKey('short')).toBeNull();
  });
});

describe('the snapshot push (FR-172..176, FR-179, FR-180)', () => {
  it('creates the spreadsheet and writes every tab with a banner; row counts equal the platform counts', async () => {
    const { w } = await connected();
    expect(await runAll()).toBe(1);
    const sheet = [...google.spreadsheets.values()][0]!;
    expect(sheet.title).toBe('HackSonipat 2026 – Participants & Teams');
    const participants = tab('participants');
    expect(participants[0]![0]).toMatch(
      /^Managed by Arthakram\. Changes here are overwritten on the next sync/,
    );
    expect(participants[1]![0]).toMatch(/^Last synced at .* \(data as of /);
    expect(participants[2]![0]).toBe('Participant ID');
    expect(participants.length - 3).toBe(4); // two teams of two
    expect(tab('teams').length - 3).toBe(2);
    const subs = tab('submissions');
    expect(subs.length - 3).toBe(1);
    expect(subs[3]).toContain('Fraud Radar');
    const s = await status(w);
    expect(s.connection).toMatchObject({
      lastResult: 'SUCCEEDED',
      spreadsheetUrl: expect.stringContaining('sheets.example.test'),
    });
    expect(s.connection.lastSuccessAt).toBeTruthy();
    expect(s.jobs[0]).toMatchObject({
      status: 'SUCCEEDED',
      summary: expect.stringContaining('3 tabs'),
    });
  });

  it('never contains scores, judge comments or feedback', async () => {
    const { w } = await connected();
    await addJudge(kit, w, 'J');
    await runAll();
    const everything = JSON.stringify(
      [...[...google.spreadsheets.values()][0]!.tabs.values()].map((t) => t.rows),
    ).toLowerCase();
    for (const word of ['score', 'comment', 'feedback', 'evaluation', 'rubric'])
      expect(everything).not.toContain(word);
  });

  it('writes identical content however many times Sync now runs, with no duplicate rows (AT-09)', async () => {
    const { w } = await connected();
    await runAll();
    const strip = (rows: string[][]) => JSON.stringify(rows.slice(2));
    const first = [strip(tab('participants')), strip(tab('teams')), strip(tab('submissions'))];
    for (let i = 0; i < 3; i++) {
      expect((await w.admin.post(url(w, '/sync-now'))).status).toBe(202);
      await runAll();
    }
    expect([strip(tab('participants')), strip(tab('teams')), strip(tab('submissions'))]).toEqual(
      first,
    );
    expect(google.spreadsheets.size).toBe(1);
  });

  it('neutralises formula-looking cells', async () => {
    const w = await openEvent(kit);
    const t = await teamOfTwo(w, '=HYPERLINK("evil")');
    void t;
    await connect(w);
    await runAll();
    const teams = tab('teams');
    expect(teams[3]![1]).toBe(`'=HYPERLINK("evil")`);
  });

  it('puts personal data only in sheets the organiser connected, and requires an admin to read status', async () => {
    const { w, a } = await connected();
    for (const agent of [a.lead.agent, (await addJudge(kit, w, 'J')).agent]) {
      expect((await agent.get(url(w))).status).toBe(404);
      expect((await agent.post(url(w, '/sync-now'))).status).toBe(404);
      expect((await agent.post(url(w, '/connect')).send({ acknowledged: true })).status).toBe(404);
      expect((await agent.post(url(w, '/disconnect'))).status).toBe(404);
      expect((await agent.put(url(w, '/drive')).send({ enabled: true })).status).toBe(404);
    }
    const stranger = await openEvent(kit);
    expect((await stranger.admin.get(url(w))).status).toBe(404);
  });
});

describe('coalescing and triggers (FR-173)', () => {
  it('turns many changes into one queued job, runs it 60 s after the latest change but within 5 minutes of the first', async () => {
    const { w } = await connected();
    await runAll();
    const t0 = new Date('2030-01-01T10:00:00Z');
    expect(await enqueueSync(deps, w.eventId, 'SHEETS', { now: t0 })).toBe('queued');
    for (let i = 1; i <= 50; i++)
      expect(
        await enqueueSync(deps, w.eventId, 'SHEETS', { now: new Date(t0.getTime() + i * 5_000) }),
      ).toBe('coalesced');
    const queued = await db.syncJob.findMany({ where: { status: 'QUEUED' } });
    expect(queued).toHaveLength(1);
    // the latest change was 250 s in; 60 s later would be 310 s, so the 5 minute cap applies
    expect(queued[0]!.runAfter.getTime()).toBe(t0.getTime() + TIMING.maxWaitMs);
    // Sync now overrides the delay
    const now = new Date(t0.getTime() + 260_000);
    await enqueueSync(deps, w.eventId, 'SHEETS', { immediate: true, now });
    expect((await db.syncJob.findFirstOrThrow({ where: { status: 'QUEUED' } })).runAfter).toEqual(
      now,
    );
  });

  it('is triggered by real changes: registration, team and check-in changes queue a job, scoring does not', async () => {
    const { w } = await connected();
    await runAll();
    const queued = () => db.syncJob.count({ where: { status: 'QUEUED', kind: 'SHEETS' } });
    const wait = async (n: number) => {
      for (let i = 0; i < 40 && (await queued()) !== n; i++)
        await new Promise((r) => setTimeout(r, 50));
      return queued();
    };
    expect(await queued()).toBe(0);
    await w.participant('Late Joiner'); // registers through the public route
    expect(await wait(1)).toBe(1);
    await runAll();
    await w.admin
      .post(`${w.base}/announcements`)
      .send({ title: 'Hello', body: 'World', audience: 'ALL' });
    await new Promise((r) => setTimeout(r, 200));
    expect(await queued()).toBe(0); // announcements do not touch the sheet
  });

  it('creates no job while disconnected, and after disconnecting stops everything and deletes the token', async () => {
    const { w } = await connected();
    expect((await w.admin.post(url(w, '/disconnect'))).status).toBe(200);
    const conn = await db.integrationConnection.findFirstOrThrow();
    expect(conn).toMatchObject({ status: 'DISCONNECTED', refreshTokenEnc: null });
    expect(await db.syncJob.count({ where: { status: 'QUEUED' } })).toBe(0);
    expect(await enqueueSync(deps, w.eventId, 'SHEETS')).toBe('skipped');
    await w.participant('After Disconnect');
    await new Promise((r) => setTimeout(r, 200));
    expect(await db.syncJob.count()).toBe(0);
    expect((await status(w)).connection).toBeNull();
    expect((await w.admin.post(url(w, '/sync-now'))).status).toBe(409);
    expect((await w.admin.post(url(w, '/disconnect'))).status).toBe(404);
  });
});

describe('failure handling, retry and truthful status (FR-175..180)', () => {
  it('retries at 1, 2, 4, 8 and 16 minutes, then fails for good with a plain message', async () => {
    const { w } = await connected();
    google.failures.push({
      on: 'createSpreadsheet',
      error: new GoogleError('QUOTA', '429 rateLimitExceeded'),
      times: 99,
    });
    const waits: number[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const job = await db.syncJob.findFirstOrThrow({ where: { status: 'QUEUED' } });
      expect(job.attempt).toBe(i);
      const start = Date.now();
      await runDueJobs(deps, later(24 * 3600_000));
      const after = await db.syncJob.findUniqueOrThrow({ where: { id: job.id } });
      if (after.status === 'QUEUED')
        waits.push(Math.round((after.runAfter.getTime() - start) / 60_000));
    }
    expect(waits).toEqual([1, 2, 4, 8]);
    const job = await db.syncJob.findFirstOrThrow({});
    expect(job).toMatchObject({
      status: 'FAILED',
      attempt: MAX_ATTEMPTS,
      error: 'Google is limiting requests; retrying automatically.',
    });
    expect(job.errorDetail).toContain('429');
    expect(await runAll()).toBe(0); // no retry loop beyond the limit
    const s = await status(w);
    expect(s.connection).toMatchObject({ lastResult: 'FAILED', lastSuccessAt: null });
    expect((await w.admin.get(`${w.base}/dashboard`)).body.integrations.status).toBe('FAILING');
  });

  it('marks the job failed when a later tab fails and never advances "last successful sync"', async () => {
    const { w } = await connected();
    await runAll();
    const before = (await status(w)).connection.lastSuccessAt as string;
    google.failures.push({
      on: 'writeTab:teams',
      error: new GoogleError('OTHER', '500 backend'),
      times: 1,
    });
    await w.admin.post(url(w, '/sync-now'));
    await runDueJobs(deps, later());
    const s = await status(w);
    expect(s.connection.lastResult).toBe('FAILED');
    expect(s.connection.lastSuccessAt).toBe(before);
    expect(s.jobs[0].status).not.toBe('SUCCEEDED'); // the newest job is not reported as a success
    // the next run rewrites the full tabs and succeeds
    await runAll();
    expect((await status(w)).connection).toMatchObject({
      lastResult: 'SUCCEEDED',
      lastError: null,
    });
  });

  it('pauses with "needs reauthorisation" when Google access is removed, and does not retry', async () => {
    const { w } = await connected();
    google.failures.push({
      on: 'createSpreadsheet',
      error: new GoogleError('TOKEN_REVOKED', 'invalid_grant'),
      times: 1,
    });
    await runAll();
    const s = await status(w);
    expect(s.connection).toMatchObject({
      status: 'NEEDS_REAUTH',
      lastError: 'Google access was removed. Reconnect to resume syncing.',
    });
    expect(s.jobs[0]).toMatchObject({ status: 'FAILED', attempt: 1 });
    expect((await w.admin.post(url(w, '/sync-now'))).body.error.code).toBe('needs_reauth');
    expect(await enqueueSync(deps, w.eventId, 'SHEETS')).toBe('skipped');
    // reconnecting resumes
    await connect(w);
    await runAll();
    expect((await status(w)).connection).toMatchObject({
      status: 'CONNECTED',
      lastResult: 'SUCCEEDED',
    });
  });

  it('recreates a deleted tab, and reports a deleted spreadsheet in plain words until a new one is created', async () => {
    const { w } = await connected();
    await runAll();
    const sheet = [...google.spreadsheets.values()][0]!;
    const ids = [...sheet.tabs.keys()];
    sheet.tabs.delete(ids[1]!); // the organiser deleted the Teams tab
    await w.admin.post(url(w, '/sync-now'));
    await runAll();
    expect(sheet.tabs.size).toBe(3);
    expect(tab('teams').length - 3).toBe(2);

    google.spreadsheets.clear(); // the spreadsheet itself is gone
    await w.admin.post(url(w, '/sync-now'));
    for (let i = 0; i < MAX_ATTEMPTS; i++) await runDueJobs(deps, later(48 * 3600_000));
    const s = await status(w);
    expect(s.connection.lastError).toBe(
      "The spreadsheet can't be found. Create a new one or reconnect.",
    );
    expect((await w.admin.post(url(w, '/new-spreadsheet'))).status).toBe(202);
    await runAll();
    expect(google.spreadsheets.size).toBe(1);
    expect((await status(w)).connection.lastResult).toBe('SUCCEEDED');
  });

  it('supersedes a failed retry with a newer queued job, and recovers jobs left running by a crash', async () => {
    const { w } = await connected();
    const job = await db.syncJob.findFirstOrThrow();
    await db.syncJob.update({
      where: { id: job.id },
      data: { status: 'RUNNING', startedAt: new Date(Date.now() - 3600_000) },
    });
    await recoverStuckJobs(deps);
    expect((await db.syncJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('QUEUED');
    // a job that fails while a newer one holds the single queued slot is closed as superseded
    const real = google.createSpreadsheet.bind(google);
    google.createSpreadsheet = async () => {
      await db.syncJob.create({
        data: { eventId: w.eventId, connectionId: job.connectionId, kind: 'SHEETS' },
      });
      throw new GoogleError('OTHER', 'boom');
    };
    await runDueJobs(deps, later());
    google.createSpreadsheet = real;
    expect(await db.syncJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'FAILED',
    });
    expect(await db.syncJob.count({ where: { status: 'QUEUED' } })).toBe(1);
  });

  it('never runs two jobs of one kind at once', async () => {
    const { w } = await connected();
    const job = await db.syncJob.findFirstOrThrow();
    await db.syncJob.update({
      where: { id: job.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    await expect(
      db.syncJob.create({
        data: {
          eventId: w.eventId,
          connectionId: job.connectionId,
          kind: 'SHEETS',
          status: 'RUNNING',
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.syncJob.createMany({
        data: [
          { eventId: w.eventId, connectionId: job.connectionId, kind: 'SHEETS' },
          { eventId: w.eventId, connectionId: job.connectionId, kind: 'SHEETS' },
        ],
      }),
    ).rejects.toThrow();
  });
});

describe('Drive archive mirror (FR-190..194)', () => {
  it('mirrors submitted files into Event > Round > Team folders, with a links file, and never twice', async () => {
    const { w } = await connected({ drive: true });
    await runAll();
    const names = [...google.folders.values()].map((f) => f.name);
    expect(names).toContain('HackSonipat 2026 (hacksonipat-2026)');
    expect(names.some((n) => n.startsWith('Round 1 – '))).toBe(true);
    expect(names.some((n) => /^T-\d+ – Alpha$/.test(n))).toBe(true);
    const files = [...google.files.values()].map((f) => f.name);
    expect(files.some((n) => /^v1 .* deck\.pdf$/.test(n))).toBe(true);
    expect(files).toContain('v1 links.txt');
    const count = google.files.size;
    await w.admin.post(url(w, '/sync-now'));
    await runAll();
    expect(google.files.size).toBe(count); // retry creates no duplicates
    expect(await db.driveMirror.count({ where: { status: 'MIRRORED' } })).toBe(count);
  });

  it('keeps old versions when a team resubmits', async () => {
    const w = await openEvent(kit);
    const a = await teamOfTwo(w, 'Twin');
    await submitProject(w, a, 'First');
    await connect(w, { drive: true });
    await runAll();
    const before = google.files.size;
    await submitProject(w, a, 'Second');
    for (
      let i = 0;
      i < 40 && !(await db.syncJob.count({ where: { kind: 'DRIVE_MIRROR', status: 'QUEUED' } }));
      i++
    )
      await new Promise((r) => setTimeout(r, 50));
    await runAll();
    const names = [...google.files.values()].map((f) => f.name);
    expect(google.files.size).toBeGreaterThan(before);
    expect(names.some((n) => n.startsWith('v1 '))).toBe(true);
    expect(names.some((n) => n.startsWith('v2 '))).toBe(true);
  });

  it('records a failed upload without harming the submission, and the next run mirrors only what is missing', async () => {
    const w = await openEvent(kit);
    const a = await teamOfTwo(w, 'Alpha');
    await submitProject(w, a);
    google.failures.push({ on: 'uploadFile', error: new GoogleError('OTHER', '500'), times: 1 });
    await connect(w, { drive: true });
    await runDueJobs(deps, later());
    expect(await db.driveMirror.count({ where: { status: 'FAILED' } })).toBe(1);
    expect((await w.admin.get(`${w.base}/rounds/${w.roundId}/submissions`)).status).toBe(200);
    await runAll();
    expect(await db.driveMirror.count({ where: { status: 'FAILED' } })).toBe(0);
    expect(google.files.size).toBe(2); // the deck and links.txt, each once
  });

  it('does nothing unless the organiser enabled mirroring, and honours turning it off', async () => {
    const { w } = await connected();
    expect(await enqueueSync(deps, w.eventId, 'DRIVE_MIRROR')).toBe('skipped');
    await runAll();
    expect(google.files.size).toBe(0);
    expect((await w.admin.put(url(w, '/drive')).send({ enabled: true })).body.driveEnabled).toBe(
      true,
    );
    await runAll();
    expect(google.files.size).toBeGreaterThan(0);
    await w.admin.put(url(w, '/drive')).send({ enabled: false });
    expect(await db.syncJob.count({ where: { kind: 'DRIVE_MIRROR', status: 'QUEUED' } })).toBe(0);
  });
});
