// DEVELOPMENT SEED DATA — clearly fake accounts and a demo event. Idempotent. Refuses to run in production.
import { loadEnvFile } from 'node:process';
import { hashPassword } from '../src/auth/crypto.js';
import { createDb } from '../src/db/client.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed a production database');
}
try {
  loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* variables may come from the environment */
}

export const DEV_PASSWORD = 'Password!2345';

export const SEED_ACCOUNTS = [
  { key: 'admin', email: 'admin@arthakram.test', name: 'Aarav Admin', role: 'ADMIN' },
  { key: 'judge1', email: 'judge1@arthakram.test', name: 'Jaya Judge', role: 'JUDGE' },
  { key: 'judge2', email: 'judge2@arthakram.test', name: 'Jai Judge', role: 'JUDGE' },
  { key: 'staff', email: 'staff@arthakram.test', name: 'Sahil Staff', role: 'STAFF' },
  { key: 'asha', email: 'asha@arthakram.test', name: 'Asha Kumari', role: 'PARTICIPANT' },
  { key: 'ravi', email: 'ravi@arthakram.test', name: 'Ravi Rao', role: 'PARTICIPANT' },
] as const;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const db = createDb(databaseUrl);

async function seedStructure(eventId: string, adminId: string) {
  // Round 1 with a deadline (the demo event is already published, so it needs one).
  await db.round.upsert({
    where: { eventId_order: { eventId, order: 1 } },
    update: {},
    create: {
      eventId,
      order: 1,
      name: 'Round 1',
      opensAt: new Date('2027-02-14T05:00:00Z'),
      submissionDeadline: new Date('2027-02-15T12:30:00Z'), // 18:00 IST
      judgingDeadline: new Date('2027-02-15T16:30:00Z'),
      requiredEvaluations: 2,
    },
  });
  for (const [i, name] of ['Fintech', 'Climate'].entries()) {
    await db.track.upsert({
      where: { eventId_name: { eventId, name } },
      update: {},
      create: {
        eventId,
        name,
        order: i,
        description:
          name === 'Fintech' ? 'Payments, credit and inclusion' : 'Energy, mobility and resilience',
      },
    });
  }
  const fintech = await db.track.findUniqueOrThrow({
    where: { eventId_name: { eventId, name: 'Fintech' } },
  });
  await db.problemStatement.upsert({
    where: { eventId_title: { eventId, title: 'Detect UPI fraud in real time' } },
    update: {},
    create: {
      eventId,
      trackId: fintech.id,
      title: 'Detect UPI fraud in real time',
      description:
        'Design a system that flags **suspicious UPI transactions** without blocking honest users.',
    },
  });
  const sections = [
    'Overview',
    'Eligibility',
    'Schedule',
    'Submission requirements',
    'Judging criteria',
    'Code of conduct',
  ].map((title, i) => ({
    id: `s${i + 1}`,
    title,
    hidden: false,
    body:
      title === 'Overview'
        ? '## Welcome to HackSonipat\n\nTwo days to build something **useful**. Teams of 2 to 4.'
        : `Details for ${title.toLowerCase()} will be shared by the organisers.`,
  }));
  await db.guidebook.upsert({
    where: { eventId },
    update: {},
    create: { eventId, sections, updatedById: adminId },
  });
  await db.guidebookVersion.upsert({
    where: { eventId_versionNo: { eventId, versionNo: 1 } },
    update: {},
    create: {
      eventId,
      versionNo: 1,
      sections,
      changeNote: 'Seeded demo guidebook',
      publishedById: adminId,
    },
  });
  if ((await db.announcement.count({ where: { eventId } })) === 0) {
    await db.announcement.createMany({
      data: [
        {
          eventId,
          authorId: adminId,
          audience: 'EVERYONE',
          title: 'Welcome to HackSonipat 2026',
          body: 'Registration is open. Read the guidebook and form your team.',
        },
        {
          eventId,
          authorId: adminId,
          audience: 'JUDGES',
          title: 'Judge briefing',
          body: 'Judging opens after the submission deadline. Your assigned teams will appear in your workspace.',
        },
      ],
    });
  }
}

async function main() {
  const passwordHash = await hashPassword(DEV_PASSWORD);
  const users: Record<string, string> = {};
  for (const a of SEED_ACCOUNTS) {
    const u = await db.user.upsert({
      where: { email: a.email },
      update: { name: a.name, passwordHash, emailVerifiedAt: new Date() },
      create: { email: a.email, name: a.name, passwordHash, emailVerifiedAt: new Date() },
    });
    users[a.key] = u.id;
  }

  const event = await db.event.upsert({
    where: { slug: 'hacksonipat-2026' },
    update: {},
    create: {
      slug: 'hacksonipat-2026',
      name: 'HackSonipat 2026',
      type: 'HACKATHON',
      mode: 'IN_PERSON',
      startsAt: new Date('2027-02-14T04:30:00Z'),
      endsAt: new Date('2027-02-15T12:30:00Z'),
      timeZone: 'Asia/Kolkata',
      institution: 'Rishihood University',
      contactEmail: 'arthakram@rishihood.edu.in',
      venue: 'Rishihood University, Sonipat',
      description: 'Demo event created by the development seed.',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      registrationStatus: 'OPEN',
      teamMin: 2,
      teamMax: 4,
      ownerId: users.admin!,
    },
  });

  for (const a of SEED_ACCOUNTS) {
    await db.eventMembership.upsert({
      where: { eventId_userId: { eventId: event.id, userId: users[a.key]! } },
      update: { role: a.role, status: 'ACTIVE' },
      create: { eventId: event.id, userId: users[a.key]!, role: a.role },
    });
  }
  await seedStructure(event.id, users.admin!);
  console.log(
    `Seeded ${SEED_ACCOUNTS.length} dev accounts (password "${DEV_PASSWORD}") and event ${event.slug}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
