import type { Db } from '../../db/client.js';
import type { Event } from '../../generated/prisma/client.js';
import { effectiveRegistration } from '../events/registrationState.js';
import { judgedVersions } from '../judging/common.js';

/**
 * Where an event is in its life, worked out from stored state (status, registration, judging, results,
 * certificates), not from the calendar alone. The admin dashboard uses it to show the current stage, the
 * next steps and what needs attention. Every count is read from the database; nothing is estimated.
 */
export type Stage = 'setup' | 'registration' | 'event' | 'judging' | 'results' | 'wrapup';

export const STAGES: { key: Stage; label: string }[] = [
  { key: 'setup', label: 'Setup' },
  { key: 'registration', label: 'Registration' },
  { key: 'event', label: 'Event and submissions' },
  { key: 'judging', label: 'Judging' },
  { key: 'results', label: 'Results' },
  { key: 'wrapup', label: 'Wrap-up' },
];

export interface Step {
  key: string;
  label: string;
  done: boolean;
  /** Path under /events/:id, with any filter in the query string. */
  to: string;
  optional?: boolean;
  /** Why the step is not done yet, when that is not obvious from the label. */
  hint?: string;
}

export interface AttentionItem {
  key: string;
  label: string;
  count: number;
  to: string;
  tone: 'error' | 'warning' | 'info';
}

export interface Lifecycle {
  stage: Stage;
  stages: typeof STAGES;
  nextSteps: Step[];
  attention: AttentionItem[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function eventLifecycle(db: Db, e: Event, now = new Date()): Promise<Lifecycle> {
  const rounds = await db.round.findMany({
    where: { eventId: e.id },
    orderBy: { order: 'asc' },
    include: {
      rubric: { select: { state: true } },
      snapshots: {
        where: { status: 'APPROVED' },
        select: { versionNo: true, publishedAt: true, unpublishedAt: true },
      },
    },
  });
  const registration = effectiveRegistration(e, now);
  const published = (r: (typeof rounds)[number]) =>
    r.snapshots.some((s) => s.publishedAt && !s.unpublishedAt);
  const approvedNotPublished = (r: (typeof rounds)[number]) =>
    r.snapshots.length > 0 && !published(r);
  const finalRound = rounds.at(-1);

  // ── Stage ──
  let stage: Stage;
  if (e.status === 'DRAFT') stage = 'setup';
  else if (e.status !== 'PUBLISHED' || (finalRound && published(finalRound))) stage = 'wrapup';
  else if (rounds.some((r) => r.judgingStatus === 'CLOSED' && !published(r))) stage = 'results';
  else if (rounds.some((r) => r.judgingStatus === 'OPEN')) stage = 'judging';
  else if (registration !== 'CLOSED' && now < e.startsAt) stage = 'registration';
  else stage = 'event';

  // ── Facts shared by steps and attention ──
  const [
    judges,
    staff,
    pendingJudgeInvites,
    tracks,
    problems,
    questions,
    guidebookVersions,
    openQuestions,
    pendingExceptions,
    unassignedRequests,
    pendingApplications,
    failedMessages,
    openIssues,
    urgentIssues,
    blockedTasks,
    corrections,
    flaggedCertificates,
    certificates,
    feedbackForms,
    firstRoundAssignments,
  ] = await Promise.all([
    db.eventMembership.count({ where: { eventId: e.id, role: 'JUDGE', status: 'ACTIVE' } }),
    db.eventMembership.count({ where: { eventId: e.id, role: 'STAFF', status: 'ACTIVE' } }),
    db.invitation.count({ where: { eventId: e.id, role: 'JUDGE', status: 'PENDING' } }),
    db.track.count({ where: { eventId: e.id } }),
    db.problemStatement.count({ where: { eventId: e.id } }),
    db.registrationFieldDef.count({ where: { eventId: e.id } }),
    db.guidebookVersion.count({ where: { eventId: e.id } }),
    db.supportTicket.count({
      where: { eventId: e.id, kind: 'QUESTION', status: { in: ['OPEN', 'IN_PROGRESS'] } },
    }),
    db.supportTicket.count({
      where: { eventId: e.id, kind: { not: 'QUESTION' }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    }),
    db.supportTicket.count({
      where: { eventId: e.id, status: { in: ['OPEN', 'IN_PROGRESS'] }, assignedToId: null },
    }),
    e.applicationReview
      ? db.team.count({ where: { eventId: e.id, status: 'ACTIVE', applicationStatus: 'PENDING' } })
      : Promise.resolve(0),
    db.messageDelivery.count({ where: { eventId: e.id, status: 'FAILED' } }),
    db.issueReport.count({ where: { eventId: e.id, status: { not: 'RESOLVED' } } }),
    db.issueReport.count({
      where: { eventId: e.id, status: { not: 'RESOLVED' }, severity: 'URGENT' },
    }),
    db.staffTask.count({ where: { eventId: e.id, status: 'BLOCKED' } }),
    db.evaluation.count({
      where: { eventId: e.id, correctionRequestedAt: { not: null } },
    }),
    db.certificate.count({
      where: { eventId: e.id, status: { in: ['FLAGGED', 'NEEDS_REGENERATION'] } },
    }),
    db.certificate.groupBy({ by: ['status'], where: { eventId: e.id }, _count: true }),
    db.feedbackForm.findMany({ where: { eventId: e.id }, select: { audience: true, state: true } }),
    rounds[0]
      ? db.judgeAssignment.count({ where: { roundId: rounds[0].id, status: 'ACTIVE' } })
      : Promise.resolve(0),
  ]);

  // Judging work per round: submitted teams without enough judges, and evaluations still to submit.
  const judging = await Promise.all(
    rounds
      .filter((r) => r.judgingStatus === 'OPEN')
      .map(async (r) => {
        const [judged, assignments] = await Promise.all([
          judgedVersions(db, r.id),
          db.judgeAssignment.findMany({
            where: { roundId: r.id, status: 'ACTIVE' },
            select: { teamId: true, evaluation: { select: { status: true } } },
          }),
        ]);
        const teams = await db.team.findMany({
          where: { id: { in: [...judged.keys()] }, status: 'ACTIVE' },
          select: { id: true },
        });
        const short = teams.filter(
          (t) => assignments.filter((a) => a.teamId === t.id).length < r.requiredEvaluations,
        ).length;
        const pending = assignments.filter(
          (a) => judged.has(a.teamId) && a.evaluation?.status !== 'SUBMITTED',
        ).length;
        return { round: r, short, pending };
      }),
  );

  // ── Needs attention: only items with something to do, each linking to its filtered list ──
  const attention: AttentionItem[] = [];
  const add = (item: AttentionItem) => item.count > 0 && attention.push(item);
  add({
    key: 'urgent-issues',
    label: `${plural(urgentIssues, 'urgent issue')} open`,
    count: urgentIssues,
    to: 'issues?severity=URGENT',
    tone: 'error',
  });
  add({
    key: 'exceptions',
    label: `${plural(pendingExceptions, 'exception request')} awaiting a decision`,
    count: pendingExceptions,
    to: 'support?tab=exceptions',
    tone: 'warning',
  });
  add({
    key: 'questions',
    label: `${plural(openQuestions, 'question')} from participants or judges not resolved`,
    count: openQuestions,
    to: 'support?tab=general',
    tone: 'warning',
  });
  add({
    key: 'unassigned-requests',
    label: `${plural(unassignedRequests, 'open request')} with nobody assigned`,
    count: unassignedRequests,
    to: 'support?assignee=none',
    tone: 'info',
  });
  add({
    key: 'applications',
    label: `${plural(pendingApplications, 'team application')} to review`,
    count: pendingApplications,
    to: 'applications',
    tone: 'warning',
  });
  for (const j of judging) {
    add({
      key: `short-${j.round.id}`,
      label: `${j.round.name}: ${plural(j.short, 'submitted team')} with fewer than ${j.round.requiredEvaluations} judges`,
      count: j.short,
      to: `judging?round=${j.round.id}`,
      tone: 'warning',
    });
    add({
      key: `pending-${j.round.id}`,
      label: `${j.round.name}: ${plural(j.pending, 'evaluation')} not yet submitted`,
      count: j.pending,
      to: `judging?round=${j.round.id}`,
      tone: 'info',
    });
  }
  add({
    key: 'corrections',
    label: `${plural(corrections, 'judge correction request')} to answer`,
    count: corrections,
    to: 'judging',
    tone: 'warning',
  });
  for (const r of rounds) {
    if (r.judgingStatus === 'CLOSED' && r.snapshots.length === 0)
      add({
        key: `approve-${r.id}`,
        label: `${r.name}: judging is closed and results are not approved`,
        count: 1,
        to: `results?round=${r.id}`,
        tone: 'warning',
      });
    else if (approvedNotPublished(r))
      add({
        key: `publish-${r.id}`,
        label: `${r.name}: approved results are not published`,
        count: 1,
        to: `results?round=${r.id}`,
        tone: 'info',
      });
  }
  add({
    key: 'failed-messages',
    label: `${plural(failedMessages, 'message')} could not be delivered`,
    count: failedMessages,
    to: 'communication?history=targeted&delivery=FAILED',
    tone: 'error',
  });
  add({
    key: 'blocked-tasks',
    label: `${plural(blockedTasks, 'staff task')} blocked`,
    count: blockedTasks,
    to: 'tasks?status=BLOCKED',
    tone: 'warning',
  });
  add({
    key: 'open-issues',
    label: `${plural(openIssues - urgentIssues, 'other issue')} open`,
    count: Math.max(openIssues - urgentIssues, 0),
    to: 'issues',
    tone: 'info',
  });
  add({
    key: 'certificates',
    label: `${plural(flaggedCertificates, 'certificate')} flagged or needing regeneration`,
    count: flaggedCertificates,
    to: 'certificates',
    tone: 'warning',
  });

  // ── Next steps for the current stage ──
  const firstRound = rounds[0];
  const rubricReady = (r?: (typeof rounds)[number]) =>
    Boolean(r?.rubric && r.rubric.state !== 'DRAFT');
  const certCount = (s: string) => certificates.find((c) => c.status === s)?._count ?? 0;
  const form = (a: 'PARTICIPANT' | 'JUDGE') => feedbackForms.find((f) => f.audience === a);
  const steps: Record<Stage, Step[]> = {
    setup: [
      {
        key: 'deadline',
        label: 'Add a round with a submission deadline',
        done: rounds.some((r) => r.submissionDeadline),
        to: 'rounds',
      },
      {
        key: 'structure',
        label: 'Add tracks or problem statements',
        done: tracks + problems > 0,
        to: 'structure',
        optional: true,
      },
      {
        key: 'questions',
        label: 'Add custom registration questions',
        done: questions > 0,
        to: 'setup#registration-questions',
        optional: true,
      },
      {
        key: 'guidebook',
        label: 'Publish the guidebook',
        done: guidebookVersions > 0,
        to: 'guidebook',
      },
      {
        key: 'judges',
        label: 'Invite judges',
        done: judges + pendingJudgeInvites > 0,
        to: 'people',
      },
      {
        key: 'staff',
        label: 'Invite helping staff',
        done: staff > 0,
        to: 'people',
        optional: true,
      },
      {
        key: 'rubric',
        label: firstRound ? `Activate the ${firstRound.name} rubric` : 'Activate a rubric',
        done: rubricReady(firstRound),
        to: 'rubric',
        hint: 'Can also be done later, before judging opens.',
      },
      { key: 'publish', label: 'Publish the event', done: false, to: 'setup' },
    ],
    registration: [
      {
        key: 'open',
        label: 'Open registration',
        done: registration !== 'NOT_OPEN',
        to: 'setup',
      },
      ...(e.applicationReview
        ? [
            {
              key: 'applications',
              label: 'Review team applications',
              done: pendingApplications === 0,
              to: 'applications',
            },
          ]
        : []),
      {
        key: 'judges',
        label: 'Invite judges',
        done: judges + pendingJudgeInvites > 0,
        to: 'people',
      },
      {
        key: 'rubric',
        label: firstRound ? `Activate the ${firstRound.name} rubric` : 'Activate a rubric',
        done: rubricReady(firstRound),
        to: 'rubric',
      },
      {
        key: 'guidebook',
        label: 'Publish the guidebook',
        done: guidebookVersions > 0,
        to: 'guidebook',
      },
    ],
    event: [
      {
        key: 'rubric',
        label: 'Activate the rubric for each round',
        done: rounds.length > 0 && rounds.every(rubricReady),
        to: 'rubric',
      },
      {
        key: 'assign',
        label: 'Assign judges',
        done: firstRoundAssignments > 0,
        to: 'judging',
        hint: 'Assign once submissions are in; judging opens after the deadline.',
      },
      { key: 'open-judging', label: 'Open judging', done: false, to: 'judging' },
    ],
    judging: [
      {
        key: 'assign',
        label: 'Every submitted team has enough judges',
        done: judging.every((j) => j.short === 0),
        to: 'judging',
      },
      {
        key: 'evaluations',
        label: 'All evaluations submitted',
        done: judging.every((j) => j.pending === 0),
        to: 'judging',
      },
      { key: 'close', label: 'Close judging', done: false, to: 'judging' },
    ],
    results: [
      {
        key: 'approve',
        label: 'Review ties and approve results',
        done: rounds.every((r) => r.judgingStatus !== 'CLOSED' || r.snapshots.length > 0),
        to: 'results',
      },
      {
        key: 'publish',
        label: 'Publish results',
        done: rounds.every((r) => r.judgingStatus !== 'CLOSED' || published(r)),
        to: 'results',
      },
    ],
    wrapup: [
      {
        key: 'comments',
        label: 'Release judges’ comments to teams',
        done: rounds.filter(published).every((r) => r.commentsReleasedAt),
        to: 'feedback?tab=comments',
        optional: true,
      },
      {
        key: 'feedback',
        label: 'Open the participant and judge surveys',
        done: form('PARTICIPANT')?.state !== 'DRAFT' && form('JUDGE')?.state !== 'DRAFT',
        to: 'feedback',
        optional: true,
      },
      {
        key: 'certificates',
        label: 'Generate and release certificates',
        done: certCount('RELEASED') > 0 && certCount('GENERATED') === 0,
        to: 'certificates',
      },
      {
        key: 'report',
        label: 'Download the impact report',
        done: false,
        to: 'report',
        optional: true,
      },
      {
        key: 'conclude',
        label: 'Conclude the event',
        done: e.status === 'CONCLUDED' || e.status === 'ARCHIVED',
        to: 'setup#conclude',
      },
    ],
  };

  return { stage, stages: STAGES, nextSteps: steps[stage], attention };
}
