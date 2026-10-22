import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  agentFor,
  createTestKit,
  createUser,
  resetDb,
  signedInAgent,
  TEST_PASSWORD,
  uniqueEmail,
} from '../test/helpers.js';
import { hashPassword, verifyPassword } from './crypto.js';
import { sha256 } from './crypto.js';

const { app, db } = createTestKit();
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

async function lastLink(to: string) {
  const msg = await db.outboxEmail.findFirst({
    where: { toEmail: to },
    orderBy: { createdAt: 'desc' },
  });
  return msg?.link ?? '';
}
const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

describe('password hashing', () => {
  it('uses a salted slow hash and verifies correctly', async () => {
    const a = await hashPassword('same-password-1');
    const b = await hashPassword('same-password-1');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('same-password-1', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
  });
});

describe('registration and verification', () => {
  it('registers, blocks sign-in until verified, then verifies once only', async () => {
    const email = uniqueEmail('new');
    const agent = agentFor(app);
    const reg = await agent
      .post('/api/v1/auth/register')
      .send({ name: 'Asha', email, password: TEST_PASSWORD });
    expect(reg.status).toBe(202);

    const early = await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('email_not_verified');

    const token = tokenOf(await lastLink(email));
    expect((await agent.post('/api/v1/auth/verify-email').send({ token })).status).toBe(200);
    const reuse = await agent.post('/api/v1/auth/verify-email').send({ token });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('link_expired');

    expect(
      (await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD })).status,
    ).toBe(200);
  });

  it('never stores the password or raw tokens in plain text', async () => {
    const email = uniqueEmail('hash');
    await agentFor(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Hash', email, password: TEST_PASSWORD });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).not.toContain(TEST_PASSWORD);
    const raw = tokenOf(await lastLink(email));
    const rows = await db.authToken.findMany();
    expect(rows.some((r) => r.tokenHash === raw)).toBe(false);
    expect(rows.some((r) => r.tokenHash === sha256(raw))).toBe(true);
  });

  it('rejects weak passwords and invalid email with field errors, saving nothing', async () => {
    const res = await agentFor(app)
      .post('/api/v1/auth/register')
      .send({ name: 'X', email: 'nope', password: 'short' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.details.fields)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
    expect(await db.user.count()).toBe(0);
  });

  it('rejects unknown fields (mass assignment) and does not reveal existing accounts', async () => {
    const existing = await createUser(db);
    const bad = await agentFor(app)
      .post('/api/v1/auth/register')
      .send({ name: 'A', email: uniqueEmail(), password: TEST_PASSWORD, isAdmin: true });
    expect(bad.status).toBe(422);
    const dup = await agentFor(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Dup', email: existing.email, password: TEST_PASSWORD });
    expect(dup.status).toBe(202); // same response as a fresh sign-up
    expect(await db.user.count()).toBe(1);
  });
});

describe('sign-in, sessions and sign-out', () => {
  it('signs in, sets an HTTP-only cookie, serves /me and signs out server-side', async () => {
    const user = await createUser(db);
    const agent = agentFor(app);
    const res = await agent
      .post('/api/v1/auth/login')
      .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect((await agent.get('/api/v1/me')).body.email).toBe(user.email);

    const raw = /ak_session=([^;]+)/.exec(cookie)![1]!;
    expect((await agent.post('/api/v1/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/v1/me')).status).toBe(401);
    // the old cookie value no longer works even if replayed
    expect((await request(app).get('/api/v1/me').set('Cookie', `ak_session=${raw}`)).status).toBe(
      401,
    );
  });

  it('uses the same generic message for unknown email and wrong password', async () => {
    const user = await createUser(db);
    const a = await agentFor(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrong-password-1' });
    const b = await agentFor(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.test', password: 'wrong-password-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('locks sign-in after 5 failures even with the right password', async () => {
    const user = await createUser(db);
    const agent = agentFor(app);
    for (let i = 0; i < 5; i++) {
      await agent
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'wrong-password-1' });
    }
    const locked = await agent
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('account_locked');
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.test', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });

  it('rejects unauthenticated access to protected routes', async () => {
    expect((await agentFor(app).get('/api/v1/me/events')).status).toBe(401);
  });
});

describe('password reset', () => {
  it('resets with a single-use link, signs out other sessions and accepts the new password', async () => {
    const user = await createUser(db);
    const old = await signedInAgent(app, user.email);
    const agent = agentFor(app);
    expect(
      (await agent.post('/api/v1/auth/forgot-password').send({ email: user.email })).status,
    ).toBe(202);
    const token = tokenOf(await lastLink(user.email));
    const newPassword = 'Brand-new-pass-77';
    expect(
      (await agent.post('/api/v1/auth/reset-password').send({ token, password: newPassword }))
        .status,
    ).toBe(200);
    expect(
      (await agent.post('/api/v1/auth/reset-password').send({ token, password: newPassword }))
        .status,
    ).toBe(400);
    expect((await old.get('/api/v1/me')).status).toBe(401);
    expect(
      (
        await agentFor(app)
          .post('/api/v1/auth/login')
          .send({ email: user.email, password: newPassword })
      ).status,
    ).toBe(200);
  });

  it('treats an expired link as expired and answers unknown emails identically', async () => {
    const user = await createUser(db);
    await agentFor(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const token = tokenOf(await lastLink(user.email));
    await db.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await agentFor(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'Another-pass-123' });
    expect(res.status).toBe(400);
    expect(
      (
        await agentFor(app)
          .post('/api/v1/auth/forgot-password')
          .send({ email: 'ghost@example.test' })
      ).status,
    ).toBe(202);
  });
});

describe('rate limiting', () => {
  it('limits repeated sign-in attempts from one address', async () => {
    const kit = createTestKit({ rateLimit: true });
    const agent = agentFor(kit.app);
    let last = 0;
    for (let i = 0; i < 25; i++) {
      last = (
        await agent
          .post('/api/v1/auth/login')
          .send({ email: 'x@example.test', password: 'whatever-1234' })
      ).status;
    }
    expect(last).toBe(429);
    await kit.db.$disconnect();
  });
});
