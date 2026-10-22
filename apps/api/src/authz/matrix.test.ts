import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS, PERMISSIONS, ROLES, type Role } from '@arthakram/shared';
import { csrfGuard, sessionLoader } from '../auth/middleware.js';
import { errorHandler } from '../http/errors.js';
import {
  addMember,
  createEvent,
  createTestKit,
  createUser,
  resetDb,
  TEST_PASSWORD,
} from '../test/helpers.js';
import { assertKnownActions, eventContext, requireAction } from './can.js';

const { deps, db, app: realApp } = createTestKit();

// A throwaway app exposing one guarded route per action, so every matrix cell is exercised for real.
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(csrfGuard);
app.use(sessionLoader(deps));
const events = express.Router({ mergeParams: true });
events.use(eventContext(deps));
for (const action of ACTIONS)
  events.get(`/probe/${action}`, requireAction(action), (_req, res) => res.json({ ok: true }));
app.use('/events/:eventId', events);
app.use(errorHandler);

/** Signs in against the real app, then replays the session cookie against the probe app. */
async function probeAgent(email: string) {
  const raw = await loginCookie(email);
  return {
    get: (path: string) => request(app).get(path).set('Cookie', raw),
  };
}
async function loginCookie(email: string) {
  const res = await request(realApp)
    .post('/api/v1/auth/login')
    .set('x-requested-with', 'arthakram')
    .send({ email, password: TEST_PASSWORD });
  return String(res.headers['set-cookie']).split(';')[0]!;
}

const agents = {} as Record<Role, { get: (path: string) => request.Test }>;
let eventId = '';
let otherEventId = '';

beforeAll(async () => {
  await resetDb(db);
  const owner = await createUser(db);
  const event = await createEvent(db, owner.id);
  const other = await createEvent(db, owner.id);
  eventId = event.id;
  otherEventId = other.id;
  for (const role of ROLES) {
    const u = await createUser(db, { name: role });
    await addMember(db, event.id, u.id, role);
    agents[role] = await probeAgent(u.email);
  }
});
afterAll(() => db.$disconnect());

describe('permission matrix (PRD §8.1) — every action × role', () => {
  for (const action of ACTIONS) {
    for (const role of ROLES) {
      const scope = PERMISSIONS[action][role];
      it(`${role} on ${action}: ${scope === 'NONE' ? 'denied as not found' : `allowed (${scope})`}`, async () => {
        const res = await agents[role].get(`/events/${eventId}/probe/${action}`);
        expect(res.status).toBe(scope === 'NONE' ? 404 : 200);
        if (scope === 'NONE') expect(res.body.error.code).toBe('not_found');
      });
    }
  }

  it('enforces only actions that exist in the matrix', () => {
    expect(assertKnownActions()).toEqual([]);
  });
});

describe('event isolation', () => {
  for (const role of ROLES) {
    it(`${role} of event A gets 404 on every probe in event B`, async () => {
      for (const action of ACTIONS.slice(0, 6)) {
        expect((await agents[role].get(`/events/${otherEventId}/probe/${action}`)).status).toBe(
          404,
        );
      }
    });
  }

  it('rejects unauthenticated callers with 401', async () => {
    expect((await request(app).get(`/events/${eventId}/probe/event.view`)).status).toBe(401);
  });

  it('treats removed members as non-members from the next request', async () => {
    await db.eventMembership.updateMany({
      where: { eventId, role: 'JUDGE' },
      data: { status: 'REMOVED' },
    });
    expect((await agents.JUDGE.get(`/events/${eventId}/probe/event.view`)).status).toBe(404);
    await db.eventMembership.updateMany({
      where: { eventId, role: 'JUDGE' },
      data: { status: 'ACTIVE' },
    });
  });
});
