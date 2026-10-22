import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEvent, createTestKit, createUser, resetDb, signedInAgent } from '../test/helpers.js';
import { openEvent, teamOfTwo } from '../test/world.js';

const kit = createTestKit();
const { db, app } = kit;
beforeAll(() => resetDb(db));
afterAll(() => db.$disconnect());

/** Every event-scoped route declared in the modules, read from source so a new route is covered automatically. */
const FILES: [string, RegExp][] = [
  ['modules/events/routes.ts', /scoped\.(get|post|put|patch|delete)\(\s*'([^']+)'/g],
  ...[
    'events/structure',
    'events/guidebook',
    'events/announcements',
    'people/routes',
    'teams/routes',
    'submissions/routes',
    'judging/routes',
    'results/routes',
    'staff/routes',
    'ops/routes',
    'feedback/routes',
    'certificates/routes',
    'integrations/routes',
  ].map((f): [string, RegExp] => [
    `modules/${f}${f.includes('/') && !f.endsWith('routes') ? '.ts' : '.ts'}`,
    /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g,
  ]),
];

const routes: { method: string; path: string }[] = [];
for (const [file, re] of FILES) {
  let text: string;
  try {
    text = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');
  } catch {
    continue; // a module whose routes live in another file name
  }
  for (const m of text.matchAll(re)) routes.push({ method: m[1]!, path: m[2]! });
}
const concrete = (p: string) => p.replace(/:[A-Za-z]+/g, 'x');

describe('route coverage', () => {
  it('found a substantial set of routes to probe', () => {
    expect(routes.length).toBeGreaterThan(120);
  });
});

describe('every event route is protected (OWASP A01/A07)', () => {
  let eventId = '';
  let outsider: Awaited<ReturnType<typeof signedInAgent>>;
  beforeAll(async () => {
    const owner = await createUser(db);
    eventId = (await createEvent(db, owner.id)).id;
    outsider = await signedInAgent(app, (await createUser(db)).email);
  });
  const hit = (agent: request.Agent | null, method: string, path: string, csrf: boolean) => {
    const t = (agent ?? request(app))[method as 'get'](
      `/api/v1/events/${eventId}${concrete(path)}`,
    );
    if (csrf) t.set('X-Requested-With', 'arthakram');
    return method === 'get' ? t : t.send({});
  };

  it('answers 401 to anonymous callers on every route', async () => {
    const bad: string[] = [];
    for (const r of routes) {
      const res = await hit(null, r.method, r.path, true);
      if (res.status !== 401) bad.push(`${r.method.toUpperCase()} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('answers 404 to a signed-in user who is not a member, so event existence is not revealed', async () => {
    const bad: string[] = [];
    for (const r of routes) {
      const res = await hit(outsider, r.method, r.path, true);
      if (res.status !== 404) bad.push(`${r.method.toUpperCase()} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('rejects every state-changing request that lacks the CSRF header', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => x.method !== 'get')) {
      const res = await hit(null, r.method, r.path, false);
      if (res.status !== 403 || res.body?.error?.code !== 'csrf')
        bad.push(`${r.method.toUpperCase()} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('transport and response hygiene', () => {
  it('sends hardening headers, hides the framework and forbids sniffing and framing by others', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBeDefined();
  });

  it('never leaks stack traces or internals for malformed, oversized or unknown requests', async () => {
    const malformed = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'arthakram')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(malformed.body)).not.toMatch(
      /at .*\.(ts|js):\d+|node_modules|SyntaxError/,
    );
    const huge = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'arthakram')
      .send({ email: 'a@b.test', password: 'x'.repeat(2_000_000) });
    expect(huge.status).toBe(413);
    const unknown = await request(app).get('/api/v1/definitely/not/here');
    expect(unknown.status).toBe(404);
    expect(JSON.stringify(unknown.body)).not.toMatch(/node_modules|\.ts:/);
  });

  it('sets session cookies HttpOnly and SameSite=Lax', async () => {
    const user = await createUser(db);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'arthakram')
      .send({ email: user.email, password: 'Correct-horse-9' });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/ak_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});

describe('input handling', () => {
  it('rejects unknown fields instead of silently accepting them (mass assignment)', async () => {
    const w = await openEvent(kit);
    const res = await w.admin
      .patch(w.base)
      .send({ version: 1, ownerId: 'someone-else', status: 'ARCHIVED', name: 'Renamed' });
    expect(res.status).toBe(422);
    expect((await db.event.findUniqueOrThrow({ where: { id: w.eventId } })).status).toBe(
      'PUBLISHED',
    );
  });

  it('keeps uploaded names from escaping storage and download headers from being injected', async () => {
    const w = await openEvent(kit);
    const t = await teamOfTwo(w, 'Alpha');
    const sub = (await t.lead.agent.get(`${w.base}/rounds/${w.roundId}/submission`)).body;
    const file = sub.fields.find((f: { type: string }) => f.type === 'FILE');
    const evil = '../../etc/pass"wd\r\nX-Evil: 1.pdf';
    const up = await t.lead.agent
      .put(`${w.base}/rounds/${w.roundId}/submission/files/${file.id}`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Filename', encodeURIComponent(evil))
      .send(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('x'.repeat(100))]));
    expect(up.status).toBe(201);
    const stored = await db.submissionFile.findFirstOrThrow({});
    expect(stored.storageKey).not.toContain('..');
    expect(stored.storageKey).not.toContain('passwd');
    const dl = await t.lead.agent.get(`${w.base}/files/${stored.id}`);
    expect(dl.headers['x-evil']).toBeUndefined();
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
  });
});
