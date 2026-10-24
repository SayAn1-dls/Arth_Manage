/**
 * Exercises the REAL Google REST client and the sync queue over HTTP against a LOCAL STAND-IN (googleStub.ts).
 * This is not a test of Google. It proves the request shapes, encoding, error mapping and queue behaviour agree
 * with the documented contracts; real-service verification is a manual step (docs/DEPLOYMENT.md section 5).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, resetDb } from '../test/helpers.js';
import { openEvent, submitProject, teamOfTwo } from '../test/world.js';
import { createGoogleProvider, GoogleError } from './google.js';
import { GoogleStub } from './googleStub.js';
import { runDueJobs, sealToken } from './queue.js';

const kit = createTestKit();
const { db, deps } = kit;
let stub: GoogleStub;
beforeAll(async () => {
  stub = await new GoogleStub().start();
});
afterAll(async () => {
  await stub.stop();
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb(db);
  stub.sheets.clear();
  stub.folders.clear();
  stub.files.clear();
  stub.revoked.clear();
  stub.failNext = [];
  stub.log = [];
  deps.google = createGoogleProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://localhost:5173/api/v1/integrations/google/callback',
    encryptionKeyOk: true,
    endpoints: stub.endpoints,
  });
});

const later = () => new Date(Date.now() + 24 * 3600_000);

async function connectedEvent(drive = false) {
  const w = await openEvent(kit);
  const a = await teamOfTwo(w, 'Alpha\'s "Squad"');
  await teamOfTwo(w, 'Beta');
  await submitProject(w, a);
  const admin = await db.user.findFirstOrThrow({ where: { id: w.adminUser.id } });
  const conn = await db.integrationConnection.create({
    data: {
      eventId: w.eventId,
      googleEmail: 'organiser@example.test',
      connectedById: admin.id,
      refreshTokenEnc: sealToken(deps, 'rt-live'),
      acknowledgedAt: new Date(),
      driveEnabled: drive,
    },
  });
  await db.syncJob.create({ data: { eventId: w.eventId, connectionId: conn.id, kind: 'SHEETS' } });
  if (drive)
    await db.syncJob.create({
      data: { eventId: w.eventId, connectionId: conn.id, kind: 'DRIVE_MIRROR' },
    });
  return { w, conn };
}
const tabRows = (title: string) =>
  [...[...stub.sheets.values()][0]!.tabs.values()].find((t) => t.title === title)!.values;

describe('Google REST client against a local stand-in (not real Google)', () => {
  it('builds the consent URL and exchanges a code for a refresh token and the account email', async () => {
    const url = new URL(deps.google.authUrl('state-1', false));
    expect(url.origin + url.pathname).toBe(`${stub.base}/o/oauth2/v2/auth`);
    expect(url.searchParams.get('scope')).toBe(
      'openid email https://www.googleapis.com/auth/drive.file',
    );
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(await deps.google.exchangeCode('abc')).toEqual({
      refreshToken: 'rt-abc',
      email: 'organiser@example.test',
    });
    await expect(deps.google.exchangeCode('bad')).rejects.toBeInstanceOf(GoogleError);
  });

  it('creates the spreadsheet and fills three tabs, including a team name with quotes', async () => {
    const { w } = await connectedEvent();
    expect(await runDueJobs(deps, later())).toBe(1);
    const sheet = [...stub.sheets.values()][0]!;
    expect(sheet.title).toBe(
      `${(await db.event.findUniqueOrThrow({ where: { id: w.eventId } })).name} – Participants & Teams`,
    );
    expect([...sheet.tabs.values()].map((t) => t.title)).toEqual([
      'Participants',
      'Teams',
      'Submissions',
    ]);
    expect(tabRows('Participants')).toHaveLength(3 + 4); // two banner rows, header, four people
    expect(tabRows('Teams')[3]![1]).toBe('Alpha\'s "Squad"');
    expect([...sheet.tabs.values()].every((t) => t.frozen === 3)).toBe(true);
    const job = await db.syncJob.findFirstOrThrow();
    expect(job).toMatchObject({ status: 'SUCCEEDED' });
    expect((await db.integrationConnection.findFirstOrThrow()).spreadsheetUrl).toMatch(
      /docs\.google\.com\/spreadsheets/,
    );
  });

  it('updates in place: a changed record rewrites the tab and never adds a second row or tab', async () => {
    const { w, conn } = await connectedEvent();
    await runDueJobs(deps, later());
    const before = tabRows('Participants').length;
    const reg = await db.registration.findFirstOrThrow({
      where: { eventId: w.eventId, fullName: { contains: 'Beta Lead' } },
    });
    await db.registration.update({
      where: { id: reg.id },
      data: { fullName: 'Beta Lead Renamed' },
    });
    await db.syncJob.create({
      data: { eventId: w.eventId, connectionId: conn.id, kind: 'SHEETS' },
    });
    await runDueJobs(deps, later());
    expect(tabRows('Participants')).toHaveLength(before);
    const names = tabRows('Participants').map((r) => r[1]); // the Full name column
    expect(names).toContain('Beta Lead Renamed');
    expect(names).not.toContain('Beta Lead');
    expect(stub.sheets.size).toBe(1);
    expect([...stub.sheets.values()][0]!.tabs.size).toBe(3);
  });

  it('recreates a tab the organiser deleted, and reports a rename-proof match by id', async () => {
    const { w, conn } = await connectedEvent();
    await runDueJobs(deps, later());
    const sheet = [...stub.sheets.values()][0]!;
    const [id1, id2] = [...sheet.tabs.keys()] as [number, number];
    sheet.tabs.get(id1)!.title = 'People (renamed by organiser)'; // renamed: matched by id, not duplicated
    sheet.tabs.delete(id2); // deleted: recreated
    await db.syncJob.create({
      data: { eventId: w.eventId, connectionId: conn.id, kind: 'SHEETS' },
    });
    await runDueJobs(deps, later());
    const titles = [...sheet.tabs.values()].map((t) => t.title);
    expect(titles).toContain('People (renamed by organiser)');
    expect(titles.filter((t) => t === 'Participants')).toHaveLength(0);
    expect(titles).toContain('Teams');
    expect(sheet.tabs.size).toBe(3);
  });

  it('maps Google errors to plain messages, retries rate limits, and pauses on revoked access', async () => {
    const { conn } = await connectedEvent();
    stub.failNext.push({ match: 'values', status: 429 });
    await runDueJobs(deps, later());
    let job = await db.syncJob.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(job).toMatchObject({
      status: 'QUEUED',
      attempt: 1,
      error: 'Google is limiting requests; retrying automatically.',
    });
    expect((await db.integrationConnection.findFirstOrThrow()).lastSuccessAt).toBeNull();
    await runDueJobs(deps, later()); // the retry succeeds and rewrites everything
    job = await db.syncJob.findFirstOrThrow();
    expect(job.status).toBe('SUCCEEDED');
    expect((await db.integrationConnection.findFirstOrThrow()).lastSuccessAt).not.toBeNull();

    stub.revoked.add('rt-live'); // the organiser removed the app in their Google account
    await db.syncJob.create({
      data: { eventId: conn.eventId, connectionId: conn.id, kind: 'SHEETS' },
    });
    await runDueJobs(deps, later());
    const c = await db.integrationConnection.findFirstOrThrow();
    expect(c.status).toBe('NEEDS_REAUTH');
    expect(c.lastError).toBe('Google access was removed. Reconnect to resume syncing.');
    expect(c.lastErrorDetail).toContain('invalid_grant');
    expect((await db.syncJob.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })).status).toBe(
      'FAILED',
    );
  });

  it('reports a deleted spreadsheet as not found', async () => {
    const { w, conn } = await connectedEvent();
    await runDueJobs(deps, later());
    stub.sheets.clear();
    await db.syncJob.create({
      data: { eventId: w.eventId, connectionId: conn.id, kind: 'SHEETS' },
    });
    await runDueJobs(deps, later());
    expect((await db.integrationConnection.findFirstOrThrow()).lastError).toBe(
      "The spreadsheet can't be found. Create a new one or reconnect.",
    );
  });

  it('mirrors files into Event > Round > Team folders over multipart upload, once', async () => {
    const { w } = await connectedEvent(true);
    await runDueJobs(deps, later());
    const names = [...stub.folders.values()].map((f) => f.name);
    expect(names).toContain(
      `${(await db.event.findUniqueOrThrow({ where: { id: w.eventId } })).name} (${(await db.event.findUniqueOrThrow({ where: { id: w.eventId } })).slug})`,
    );
    expect(names.some((n) => /^T-\d+ – Alpha's -Squad-$/.test(n) || /^T-\d+ – Alpha/.test(n))).toBe(
      true,
    );
    const files = [...stub.files.values()];
    expect(files.map((f) => f.name).sort()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^v1 .*deck\.pdf$/), 'v1 links.txt']),
    );
    const deck = files.find((f) => f.name.endsWith('deck.pdf'))!;
    expect(deck.bytes).toBeGreaterThan(50);
    expect(deck.mime).toBe('application/pdf');
    const count = files.length;
    const conn = await db.integrationConnection.findFirstOrThrow();
    await db.syncJob.create({
      data: { eventId: w.eventId, connectionId: conn.id, kind: 'DRIVE_MIRROR' },
    });
    await runDueJobs(deps, later());
    expect(stub.files.size).toBe(count);
  });
});
