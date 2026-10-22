import type { Db } from '../db/client.js';

export const TABS = [
  { key: 'participants', title: 'Participants' },
  { key: 'teams', title: 'Teams' },
  { key: 'submissions', title: 'Submissions' },
] as const;
export type TabKey = (typeof TABS)[number]['key'];

/** Values are written RAW (never evaluated); a leading formula character is still neutralised, as in CSV. */
const cell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

const stamp = (d: Date | null | undefined) => (d ? d.toISOString() : '');
const yes = (b: boolean) => (b ? 'Yes' : 'No');

export function banner(platform: string, syncedAt: Date, dataAsOf: Date): string[][] {
  return [
    [
      `Managed by ${platform}. Changes here are overwritten on the next sync. Add your own tabs for notes.`,
    ],
    [`Last synced at ${syncedAt.toISOString()} (data as of ${dataAsOf.toISOString()})`],
  ];
}

/** Scores, judge comments and feedback are never included, so sharing the sheet cannot leak evaluations (PRD F.1). */
export async function buildTab(db: Db, eventId: string, key: TabKey): Promise<string[][]> {
  if (key === 'participants') return participants(db, eventId);
  if (key === 'teams') return teams(db, eventId);
  return submissions(db, eventId);
}

async function participants(db: Db, eventId: string): Promise<string[][]> {
  const [regs, defs, members, checkins] = await Promise.all([
    db.registration.findMany({
      where: { eventId },
      include: { membership: { include: { user: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.registrationFieldDef.findMany({ where: { eventId }, orderBy: { order: 'asc' } }),
    db.teamMember.findMany({
      where: { eventId, leftAt: null, team: { status: { not: 'DISSOLVED' } } },
      include: { team: true },
    }),
    db.checkIn.findMany({ where: { eventId, undoneAt: null } }),
  ]);
  const head = [
    'Participant ID',
    'Full name',
    'Email',
    'Phone',
    'Institution',
    'Course',
    'Year',
    'Name on certificate',
    'Team ID',
    'Team name',
    'Team role',
    'Registration status',
    'Registered at',
    'Check-in status',
    ...defs.map((d) => d.label),
    'Last updated',
  ];
  const rows = regs.map((r) => {
    const m = members.find((x) => x.membershipId === r.membershipId);
    const answers = r.answers as Record<string, unknown>;
    return [
      r.membershipId,
      r.fullName,
      r.membership.user.email,
      r.phone ?? '',
      r.institution,
      r.course ?? '',
      r.yearOfStudy ?? '',
      r.certificateName,
      m?.team.teamCode ?? '',
      m?.team.name ?? '',
      m ? (m.role === 'LEADER' ? 'Leader' : 'Member') : '',
      r.status === 'ACTIVE' ? 'Active' : 'Withdrawn',
      stamp(r.createdAt),
      checkins.some((c) => c.membershipId === r.membershipId) ? 'Checked in' : 'Not checked in',
      ...defs.map((d) => {
        const v = answers[d.id];
        return Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
      }),
      stamp(r.updatedAt),
    ].map(cell);
  });
  return [head, ...rows];
}

async function teams(db: Db, eventId: string): Promise<string[][]> {
  const [teamRows, rounds, event, checkins] = await Promise.all([
    db.team.findMany({
      where: { eventId, status: { not: 'DISSOLVED' } },
      include: {
        track: true,
        problem: true,
        members: {
          where: { leftAt: null },
          include: { membership: { include: { user: true, registration: true } } },
        },
        submissions: true,
      },
      orderBy: { teamCode: 'asc' },
    }),
    db.round.findMany({ where: { eventId }, orderBy: { order: 'asc' } }),
    db.event.findUniqueOrThrow({ where: { id: eventId } }),
    db.checkIn.findMany({ where: { eventId, undoneAt: null } }),
  ]);
  const head = [
    'Team ID',
    'Team name',
    'Leader name',
    'Leader email',
    'Member count',
    'Members',
    'Complete',
    'Track',
    'Problem statement',
    ...rounds.flatMap((r) => [`${r.name}: submission`, `${r.name}: submitted at`]),
    'Disqualified',
    'Check-in status',
    'Last updated',
  ];
  const rows = await Promise.all(
    teamRows.map(async (t) => {
      const leader = t.members.find((m) => m.role === 'LEADER');
      const name = (m: (typeof t.members)[number]) =>
        m.membership.registration?.fullName ?? m.membership.user.name;
      const present = t.members.filter((m) =>
        checkins.some((c) => c.membershipId === m.membershipId),
      ).length;
      const versions = await db.submissionVersion.findMany({
        where: { submissionId: { in: t.submissions.map((s) => s.id) } },
        orderBy: { versionNo: 'desc' },
      });
      return [
        t.teamCode,
        t.name,
        leader ? name(leader) : '',
        leader?.membership.user.email ?? '',
        String(t.members.length),
        t.members.map(name).join('; '),
        yes(t.members.length >= event.teamMin),
        t.track?.name ?? '',
        t.problem?.title ?? '',
        ...rounds.flatMap((r) => {
          const sub = t.submissions.find((s) => s.roundId === r.id);
          const last = sub && versions.find((v) => v.submissionId === sub.id);
          return [last ? 'Submitted' : 'Not submitted', stamp(last?.submittedAt)];
        }),
        yes(t.status === 'DISQUALIFIED'),
        !t.members.length
          ? 'Not checked in'
          : present === t.members.length
            ? 'Checked in'
            : present
              ? 'Partially checked in'
              : 'Not checked in',
        stamp(t.createdAt),
      ].map(cell);
    }),
  );
  return [head, ...rows];
}

async function submissions(db: Db, eventId: string): Promise<string[][]> {
  const versions = await db.submissionVersion.findMany({
    where: { eventId },
    include: { submission: { include: { team: true, round: true } } },
    orderBy: [{ submittedAt: 'asc' }],
  });
  const fields = await db.submissionFormField.findMany({
    where: { round: { eventId }, type: { in: ['REPO_URL', 'VIDEO_URL', 'LIVE_URL', 'OTHER_URL'] } },
    orderBy: { order: 'asc' },
  });
  const linkLabels = [...new Set(fields.map((f) => f.label))];
  const head = [
    'Team ID',
    'Team name',
    'Round',
    'Version',
    'Status',
    'Submitted at',
    'Late by (min)',
    'Project title',
    ...linkLabels,
  ];
  const latest = new Map<string, number>();
  for (const v of versions)
    latest.set(v.submissionId, Math.max(latest.get(v.submissionId) ?? 0, v.versionNo));
  const rows = versions.map((v) => {
    const values = v.values as Record<string, string>;
    return [
      v.submission.team.teamCode,
      v.submission.team.name,
      v.submission.round.name,
      String(v.versionNo),
      latest.get(v.submissionId) === v.versionNo ? 'Current' : 'Superseded',
      stamp(v.submittedAt),
      String(v.lateMinutes),
      v.title,
      ...linkLabels.map((l) => {
        const f = fields.find((x) => x.label === l && x.roundId === v.submission.roundId);
        return f ? String(values[f.id] ?? '') : '';
      }),
    ].map(cell);
  });
  return [head, ...rows];
}
