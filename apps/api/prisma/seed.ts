// DEVELOPMENT SEED DATA — clearly fake accounts and a demo event. Idempotent. Refuses to run in production.
import { loadEnvFile } from 'node:process';
import { hashPassword } from '../src/auth/crypto.js';
import { createDb } from '../src/db/client.js';
import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  DEFAULT_FEEDBACK,
  defaultSubmissionFields,
  RUBRIC_TEMPLATES,
  judgeScore,
} from '@arthakram/shared';
import { LocalDiskStorage } from '../src/storage/provider.js';

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
    // Submissions open now so the demo is usable today; the dates are development data only.
    update: { opensAt: new Date('2026-10-01T00:00:00Z') },
    create: {
      eventId,
      order: 1,
      name: 'Round 1',
      opensAt: new Date('2026-10-01T00:00:00Z'),
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

async function seedParticipants(eventId: string, users: Record<string, string>) {
  const round = await db.round.findUniqueOrThrow({
    where: { eventId_order: { eventId, order: 1 } },
  });
  if ((await db.submissionFormField.count({ where: { roundId: round.id } })) === 0) {
    await db.submissionFormField.createMany({
      data: defaultSubmissionFields('HACKATHON').map((f, i) => ({
        roundId: round.id,
        order: i,
        ...f,
      })),
    });
  }
  const people = [
    { key: 'asha', fullName: 'Asha Kumari', institution: 'Rishihood University' },
    { key: 'ravi', fullName: 'Ravi Rao', institution: 'Rishihood University' },
  ];
  const memberships: Record<string, string> = {};
  for (const p of people) {
    const m = await db.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId, userId: users[p.key]! } },
    });
    memberships[p.key] = m.id;
    await db.registration.upsert({
      where: { membershipId: m.id },
      update: {},
      create: {
        eventId,
        membershipId: m.id,
        fullName: p.fullName,
        institution: p.institution,
        phone: '9876543210',
        certificateName: p.fullName,
        declarationsAcceptedAt: new Date(),
      },
    });
  }
  // Asha leads "Byte Me" (join code HACK2026 so the demo can show joining); Ravi is registered but not yet in a team.
  if (!(await db.team.findFirst({ where: { eventId, name: 'Byte Me' } }))) {
    await db.$transaction(async (tx) => {
      const seq = (
        await tx.event.update({ where: { id: eventId }, data: { teamCodeSeq: { increment: 1 } } })
      ).teamCodeSeq;
      const team = await tx.team.create({
        data: {
          eventId,
          name: 'Byte Me',
          teamCode: `T-${String(seq).padStart(4, '0')}`,
          joinCode: 'HACK2026',
        },
      });
      await tx.teamMember.create({
        data: { teamId: team.id, eventId, membershipId: memberships.asha!, role: 'LEADER' },
      });
    });
  }
}

/** A one-page real PDF so the judge workspace has something to open. */
async function demoPdf(title: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText(title, { x: 56, y: 760, size: 28, font });
  page.drawText('Demo deck created by the development seed.', {
    x: 56,
    y: 720,
    size: 12,
    font: await doc.embedFont(StandardFonts.Helvetica),
  });
  return Buffer.from(await doc.save());
}

/**
 * "Case Cup 2026": an event whose submission window has closed and whose judging is open, so the judge
 * workspace, assignments and results can be seen without waiting for deadlines. Development data only.
 */
async function seedCaseCup(users: Record<string, string>) {
  const slug = 'case-cup-2026';
  if (await db.event.findUnique({ where: { slug } })) return;
  const storage = new LocalDiskStorage(process.env.STORAGE_DIR ?? './.data/uploads');
  const passwordHash = await hashPassword(DEV_PASSWORD);
  const event = await db.event.create({
    data: {
      slug,
      name: 'Case Cup 2026',
      type: 'CASE_COMPETITION',
      mode: 'IN_PERSON',
      startsAt: new Date('2026-10-05T04:00:00Z'),
      endsAt: new Date('2026-10-06T12:00:00Z'),
      timeZone: 'Asia/Kolkata',
      institution: 'Rishihood University',
      contactEmail: 'arthakram@rishihood.edu.in',
      venue: 'Rishihood University, Sonipat',
      description:
        'Demo case competition: submissions closed, judging open. Created by the development seed.',
      status: 'PUBLISHED',
      publishedAt: new Date('2026-09-01T00:00:00Z'),
      registrationStatus: 'CLOSED',
      teamMin: 2,
      teamMax: 3,
      ownerId: users.admin!,
    },
  });
  const round = await db.round.create({
    data: {
      eventId: event.id,
      order: 1,
      name: 'Round 1',
      opensAt: new Date('2026-09-20T00:00:00Z'),
      submissionDeadline: new Date('2026-10-05T12:30:00Z'),
      judgingDeadline: new Date('2026-12-30T12:30:00Z'),
      requiredEvaluations: 2,
      awardPositions: 3,
      judgingStatus: 'OPEN',
    },
  });
  await db.submissionFormField.createMany({
    data: defaultSubmissionFields('CASE_COMPETITION').map((f, i) => ({
      roundId: round.id,
      order: i,
      ...f,
    })),
  });
  const field = await db.submissionFormField.findFirstOrThrow({ where: { roundId: round.id } });
  const template = RUBRIC_TEMPLATES.find((t) => t.key === 'CASE_COMPETITION')!;
  const rubric = await db.rubric.create({
    data: {
      roundId: round.id,
      name: template.name,
      sourceTemplate: template.key,
      state: 'LOCKED',
      criteria: { create: template.criteria.map((c, i) => ({ ...c, order: i })) },
    },
    include: { criteria: { orderBy: { order: 'asc' } } },
  });
  await db.guidebook.create({
    data: {
      eventId: event.id,
      updatedById: users.admin!,
      sections: [{ id: 's1', title: 'Overview', body: 'Welcome to Case Cup 2026.', hidden: false }],
    },
  });

  const mem = async (userId: string, role: 'ADMIN' | 'JUDGE' | 'STAFF' | 'PARTICIPANT') =>
    (await db.eventMembership.create({ data: { eventId: event.id, userId, role } })).id;
  await mem(users.admin!, 'ADMIN');
  const judges = [await mem(users.judge1!, 'JUDGE'), await mem(users.judge2!, 'JUDGE')];
  await mem(users.staff!, 'STAFF');

  const names = [
    'Priya Nair',
    'Kabir Shah',
    'Meera Iyer',
    'Dev Malhotra',
    'Isha Verma',
    'Arjun Das',
  ];
  const teams = [
    { name: 'Alpha Consulting', members: [0, 1] },
    { name: 'Beta Strategy', members: [2, 3] },
    { name: 'Gamma Advisory', members: [4, 5] },
  ];
  const memberships: string[] = [];
  for (const [i, n] of names.entries()) {
    const email = `cup${i + 1}@arthakram.test`;
    const u = await db.user.upsert({
      where: { email },
      update: {},
      create: { email, name: n, passwordHash, emailVerifiedAt: new Date() },
    });
    const m = await mem(u.id, 'PARTICIPANT');
    memberships.push(m);
    await db.registration.create({
      data: {
        eventId: event.id,
        membershipId: m,
        fullName: n,
        institution: 'Rishihood University',
        certificateName: n,
        declarationsAcceptedAt: new Date(),
      },
    });
  }
  const created: { id: string; name: string }[] = [];
  for (const [i, t] of teams.entries()) {
    await db.event.update({ where: { id: event.id }, data: { teamCodeSeq: { increment: 1 } } });
    const team = await db.team.create({
      data: {
        eventId: event.id,
        name: t.name,
        teamCode: `T-${String(i + 1).padStart(4, '0')}`,
        joinCode: `CUPTEAM${i + 2}`,
      },
    });
    for (const [k, idx] of t.members.entries())
      await db.teamMember.create({
        data: {
          teamId: team.id,
          eventId: event.id,
          membershipId: memberships[idx]!,
          role: k === 0 ? 'LEADER' : 'MEMBER',
        },
      });
    created.push(team);
    if (i === 2) continue; // Gamma never submits: shows "Did not submit" for judges
    const sub = await db.submission.create({
      data: {
        eventId: event.id,
        roundId: round.id,
        teamId: team.id,
        lastVersionNo: 1,
        draftTitle: `${t.name} recommendation`,
        draftSummary: 'Our recommendation for the case.',
      },
    });
    const bytes = await demoPdf(`${t.name} deck`);
    const key = `events/${event.id}/submissions/${randomUUID()}.pdf`;
    await storage.put(key, bytes);
    const file = await db.submissionFile.create({
      data: {
        eventId: event.id,
        submissionId: sub.id,
        fieldId: field.id,
        storageKey: key,
        originalName: `${t.name.replace(/ /g, '-')}-deck.pdf`,
        sizeBytes: bytes.length,
        contentType: 'application/pdf',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        uploadedByMembershipId: memberships[t.members[0]!]!,
      },
    });
    await db.submissionVersion.create({
      data: {
        submissionId: sub.id,
        eventId: event.id,
        versionNo: 1,
        title: `${t.name} recommendation`,
        summary: 'A market-entry recommendation with a phased rollout.',
        values: { [field.id]: file.id },
        submittedByMembershipId: memberships[t.members[0]!]!,
        submittedAt: new Date('2026-10-05T10:00:00Z'),
      },
    });
  }
  // Event-day demo data: a task for staff, an urgent issue and one team checked in.
  const staffMembership = await db.eventMembership.findFirstOrThrow({
    where: { eventId: event.id, role: 'STAFF' },
  });
  const task = await db.staffTask.create({
    data: {
      eventId: event.id,
      title: 'Run the check-in desk',
      type: 'CHECKIN',
      location: 'Main hall',
      createdById: users.admin!,
      dueAt: new Date('2026-10-05T03:30:00Z'),
    },
  });
  await db.staffTaskAssignee.create({
    data: { taskId: task.id, membershipId: staffMembership.id },
  });
  await db.issueReport.create({
    data: {
      eventId: event.id,
      reporterMembershipId: staffMembership.id,
      category: 'FACILITIES',
      severity: 'URGENT',
      description: 'Projector in hall B is not working.',
    },
  });
  for (const idx of [0, 1])
    await db.checkIn.create({
      data: {
        eventId: event.id,
        membershipId: memberships[idx]!,
        checkedInById: staffMembership.id,
      },
    });
  // Every team gets both judges; judge1 has already scored Alpha so progress is visible.
  for (const team of created)
    for (const judge of judges) {
      await db.judgeAssignment.create({
        data: { eventId: event.id, roundId: round.id, teamId: team.id, judgeMembershipId: judge },
      });
    }
  const crit = rubric.criteria.map((c) => ({ id: c.id, weight: c.weight, min: c.min, max: c.max }));
  const scores = Object.fromEntries(rubric.criteria.map((c, i) => [c.id, [8, 7, 9, 6, 8][i]!]));
  const j = judgeScore(crit, scores);
  const a = await db.judgeAssignment.findFirstOrThrow({
    where: { roundId: round.id, teamId: created[0]!.id, judgeMembershipId: judges[0]! },
  });
  const ev = await db.evaluation.create({
    data: {
      assignmentId: a.id,
      eventId: event.id,
      status: 'SUBMITTED',
      weightedScore: j.toFixed(4),
      submittedAt: new Date(),
      submissionCount: 1,
      teamComment: 'Strong structure and a clear recommendation.',
      privateNote: 'Check the financial assumptions.',
      scores: {
        create: Object.entries(scores).map(([criterionId, score]) => ({ criterionId, score })),
      },
    },
  });
  await db.evaluationVersion.create({
    data: {
      evaluationId: ev.id,
      versionNo: 1,
      scores,
      weightedScore: j.toFixed(4),
      criteria: rubric.criteria.map((c) => ({
        id: c.id,
        name: c.name,
        weight: c.weight,
        min: c.min,
        max: c.max,
      })),
      teamComment: ev.teamComment,
      privateNote: ev.privateNote,
    },
  });
}

/** Both feedback forms open, and one participant response so the organiser's results screen has content. */
async function seedFeedback(eventId: string, ravi: string) {
  for (const audience of ['PARTICIPANT', 'JUDGE'] as const) {
    await db.feedbackForm.upsert({
      where: { eventId_audience: { eventId, audience } },
      update: {},
      create: {
        eventId,
        audience,
        state: 'OPEN',
        confidential: DEFAULT_FEEDBACK[audience].confidential,
        questions: DEFAULT_FEEDBACK[audience].questions,
      },
    });
  }
  const form = await db.feedbackForm.findUniqueOrThrow({
    where: { eventId_audience: { eventId, audience: 'PARTICIPANT' } },
  });
  const m = await db.eventMembership.findUniqueOrThrow({
    where: { eventId_userId: { eventId, userId: ravi } },
  });
  await db.feedbackResponse.upsert({
    where: { formId_respondentMembershipId: { formId: form.id, respondentMembershipId: m.id } },
    update: {},
    create: {
      formId: form.id,
      respondentMembershipId: m.id,
      answers: { q1: 5, q2: 4, q3: 4, q5: 'Clear guidebook and quick answers', q7: 'Yes' },
    },
  });
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
  await seedParticipants(event.id, users);
  await seedFeedback(event.id, users.ravi!);
  await seedCaseCup(users);
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
