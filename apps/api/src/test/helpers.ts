import request from 'supertest';
import type { Express } from 'express';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { createDb, type Db } from '../db/client.js';
import { ConsoleEmailProvider } from '../email/provider.js';
import { createApp } from '../http/app.js';
import { createRateLimiter } from '../http/rateLimit.js';
import type { Deps } from '../http/deps.js';
import { hashPassword } from '../auth/crypto.js';
import { CSRF_HEADER, CSRF_VALUE } from '../auth/middleware.js';
import type { EventRole } from '../generated/prisma/client.js';

export const TEST_PASSWORD = 'Correct-horse-9';

export interface TestKit {
  db: Db;
  deps: Deps;
  app: Express;
}

export function createTestKit(opts: { rateLimit?: boolean } = {}): TestKit {
  const env = loadEnv();
  const logger = createLogger(env);
  const db = createDb(env.DATABASE_URL);
  const deps: Deps = {
    db,
    logger,
    env,
    email: new ConsoleEmailProvider(db, logger),
    limit: createRateLimiter(opts.rateLimit ?? false),
  };
  return { db, deps, app: createApp(deps) };
}

/** Empties every table except migrations. Audit rows are removed with TRUNCATE (the trigger guards row DML only). */
export async function resetDb(db: Db): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!rows.length) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}${counter}-${Date.now() % 100000}@example.test`;
}

export async function createUser(
  db: Db,
  over: { email?: string; name?: string; verified?: boolean } = {},
) {
  return db.user.create({
    data: {
      email: over.email ?? uniqueEmail(),
      name: over.name ?? 'Test User',
      passwordHash: await hashPassword(TEST_PASSWORD),
      emailVerifiedAt: over.verified === false ? null : new Date(),
    },
  });
}

export async function createEvent(
  db: Db,
  ownerId: string,
  over: Partial<{ name: string; slug: string }> = {},
) {
  const n = ++counter;
  return db.event.create({
    data: {
      name: over.name ?? `Event ${n}`,
      slug: over.slug ?? `event-${n}-${Date.now() % 100000}`,
      type: 'HACKATHON',
      mode: 'IN_PERSON',
      startsAt: new Date(Date.now() + 7 * 864e5),
      endsAt: new Date(Date.now() + 8 * 864e5),
      institution: 'Test University',
      contactEmail: 'contact@example.test',
      ownerId,
      status: 'PUBLISHED',
    },
  });
}

export function addMember(db: Db, eventId: string, userId: string, role: EventRole) {
  return db.eventMembership.create({ data: { eventId, userId, role } });
}

/** A supertest agent that keeps cookies and sends the CSRF header on every request. */
export function agentFor(app: Express) {
  const agent = request.agent(app);
  agent.set(CSRF_HEADER, CSRF_VALUE);
  return agent;
}

export async function signedInAgent(app: Express, email: string, password = TEST_PASSWORD) {
  const agent = agentFor(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}
