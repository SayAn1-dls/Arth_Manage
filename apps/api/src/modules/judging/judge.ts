import { Router } from 'express';
import { z } from 'zod';
import { judgeScore, validateScores, type ScoringCriterion } from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx, type EventContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { assertWritable } from '../events/service.js';
import {
  adminOnly,
  isAdmin,
  judgeOnly,
  judgedVersions,
  loadRound,
  submissionsClosed,
  toCriteria,
  type Tx,
} from './common.js';

const draftInput = z
  .object({
    scores: z.record(z.string(), z.number().nullable()),
    teamComment: z.string().max(2000).nullish(),
    privateNote: z.string().max(2000).nullish(),
    version: z.number().int().min(0),
  })
  .strict();

export type EvalRowStatus =
  'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'REOPENED' | 'NOT_REQUIRED' | 'CONFLICT';
const ORDER: Record<EvalRowStatus, number> = {
  NOT_STARTED: 0,
  REOPENED: 1,
  DRAFT: 2,
  SUBMITTED: 3,
  CONFLICT: 4,
  NOT_REQUIRED: 5,
};

const decimalToString = (d: { toString(): string } | null | undefined) =>
  d ? Number(d.toString()).toFixed(4) : null;

/** The judge workspace: assigned rounds and teams, one evaluation per assignment (PRD Module C). */
export function judgeRouter(deps: Deps) {
  const { db, logger } = deps;
  const router = Router({ mergeParams: true });

  const denied = (ctx: EventContext, what: string) => {
    logger.warn(
      { userId: ctx.membership.userId, eventId: ctx.event.id, what },
      'denied: judge access outside assignments',
    );
    throw AppError.notFound();
  };

  router.get('/judge/rounds', requireAction('rubric.view'), async (req, res) => {
    const ctx = requireCtx(req);
    judgeOnly(ctx);
    const assignments = await db.judgeAssignment.findMany({
      where: { judgeMembershipId: ctx.membership.id, status: { not: 'UNASSIGNED' } },
      include: { round: true, evaluation: true },
    });
    const byRound = new Map<string, typeof assignments>();
    for (const a of assignments) byRound.set(a.roundId, [...(byRound.get(a.roundId) ?? []), a]);
    const rows = await Promise.all(
      [...byRound.entries()].map(async ([roundId, list]) => {
        const round = list[0]!.round;
        const rubric = await db.rubric.findUnique({ where: { roundId } });
        const counted = list.filter((a) => a.status === 'ACTIVE');
        return {
          roundId,
          name: round.name,
          order: round.order,
          judgingStatus: round.judgingStatus,
          judgingDeadline: round.judgingDeadline,
          assigned: counted.length,
          submitted: counted.filter((a) => a.evaluation?.status === 'SUBMITTED').length,
          rubricState: rubric?.state ?? null,
        };
      }),
    );
    res.json({ rounds: rows.sort((a, b) => a.order - b.order) });
  });

  async function teamRows(ctx: EventContext, roundId: string) {
    const round = await loadRound(db, ctx, roundId);
    const [assignments, judged] = await Promise.all([
      db.judgeAssignment.findMany({
        where: { roundId, judgeMembershipId: ctx.membership.id, status: { not: 'UNASSIGNED' } },
        include: { evaluation: true },
      }),
      judgedVersions(db, roundId),
    ]);
    const teams = await db.team.findMany({
      where: { id: { in: assignments.map((a) => a.teamId) } },
      include: { track: true, problem: true },
    });
    const closed = submissionsClosed(round);
    const subs = await db.submissionVersion.findMany({
      where: { submission: { roundId, teamId: { in: assignments.map((a) => a.teamId) } } },
      orderBy: { versionNo: 'desc' },
    });
    const rows = assignments.map((a) => {
      const team = teams.find((t) => t.id === a.teamId)!;
      const didSubmit = judged.has(a.teamId);
      const latest = subs.find((v) => v.submissionId === judged.get(a.teamId)?.id);
      let status: EvalRowStatus;
      if (a.status === 'CONFLICT') status = 'CONFLICT';
      else if (a.status === 'EXCLUDED' || (!didSubmit && closed)) status = 'NOT_REQUIRED';
      else status = a.evaluation?.status ?? 'NOT_STARTED';
      return {
        assignmentId: a.id,
        teamId: team.id,
        teamCode: team.teamCode,
        name: team.name,
        trackId: team.trackId,
        trackName: team.track?.name ?? '',
        problemTitle: team.problem?.title ?? '',
        disqualified: team.status === 'DISQUALIFIED',
        submission: didSubmit
          ? latest && latest.lateMinutes > 0
            ? 'LATE'
            : 'SUBMITTED'
          : 'DID_NOT_SUBMIT',
        evaluationStatus: status,
        assignmentStatus: a.status,
      };
    });
    rows.sort(
      (a, b) =>
        ORDER[a.evaluationStatus] - ORDER[b.evaluationStatus] ||
        a.teamCode.localeCompare(b.teamCode, undefined, { numeric: true }),
    );
    return { round, rows };
  }

  router.get('/rounds/:roundId/judge/teams', requireAction('rubric.view'), async (req, res) => {
    const ctx = requireCtx(req);
    judgeOnly(ctx);
    const { round, rows } = await teamRows(ctx, String(req.params.roundId));
    const q = String(req.query.q ?? '')
      .trim()
      .toLowerCase();
    const status = String(req.query.status ?? '');
    const trackId = String(req.query.trackId ?? '');
    const filtered = rows.filter(
      (r) =>
        (!q || r.name.toLowerCase().includes(q) || r.teamCode.toLowerCase().includes(q)) &&
        (!status || r.evaluationStatus === status) &&
        (!trackId || r.trackId === trackId),
    );
    res.json({
      round: {
        id: round.id,
        name: round.name,
        judgingStatus: round.judgingStatus,
        judgingDeadline: round.judgingDeadline,
      },
      total: rows.length,
      rows: filtered,
    });
  });

  // ── The scoring workspace for one assigned team ──
  router.get(
    '/rounds/:roundId/judge/teams/:teamId',
    requireAction('rubric.view'),
    async (req, res) => {
      const ctx = requireCtx(req);
      judgeOnly(ctx);
      const { round, rows } = await teamRows(ctx, String(req.params.roundId));
      const idx = rows.findIndex((r) => r.teamId === String(req.params.teamId));
      if (idx < 0) return denied(ctx, `team ${String(req.params.teamId)}`);
      const row = rows[idx]!;
      const assignment = await db.judgeAssignment.findUniqueOrThrow({
        where: { id: row.assignmentId },
        include: { evaluation: { include: { scores: true } } },
      });
      const base = {
        assignmentId: assignment.id,
        assignmentStatus: assignment.status,
        conflictReason: assignment.reason,
        team: { id: row.teamId, teamCode: row.teamCode, name: row.name },
        round: { id: round.id, name: round.name, judgingStatus: round.judgingStatus },
        prevTeamId: rows[idx - 1]?.teamId ?? null,
        nextTeamId: rows[idx + 1]?.teamId ?? null,
      };
      // Before judging opens nothing about the work is shown (PRD §8.1: submissions visible when judging is Open/Closed).
      if (round.judgingStatus === 'NOT_OPEN')
        return void res.json({ ...base, locked: 'Judging opens after submissions close.' });

      const team = await db.team.findUniqueOrThrow({
        where: { id: row.teamId },
        include: {
          track: true,
          problem: true,
          members: {
            where: { leftAt: null },
            include: { membership: { include: { registration: true, user: true } } },
          },
        },
      });
      const submission = await db.submission.findUnique({
        where: { roundId_teamId: { roundId: round.id, teamId: team.id } },
      });
      const version =
        submission && submission.lastVersionNo > 0
          ? await db.submissionVersion.findUnique({
              where: {
                submissionId_versionNo: {
                  submissionId: submission.id,
                  versionNo: submission.lastVersionNo,
                },
              },
            })
          : null;
      const fields = await db.submissionFormField.findMany({
        where: { roundId: round.id },
        orderBy: { order: 'asc' },
      });
      const files = submission
        ? await db.submissionFile.findMany({ where: { submissionId: submission.id } })
        : [];
      const rubric = await db.rubric.findUnique({
        where: { roundId: round.id },
        include: { criteria: { orderBy: { order: 'asc' } } },
      });
      const ev = assignment.evaluation;
      const editable = Boolean(
        version &&
        rubric &&
        rubric.state !== 'DRAFT' &&
        assignment.status === 'ACTIVE' &&
        !deniedByStatus(ev?.status) &&
        (round.judgingStatus === 'OPEN' || ev?.status === 'REOPENED'),
      );
      res.json({
        ...base,
        locked: null,
        // Judges see only each member's name and institution (PRD §11.4): no email, phone or custom answers.
        members: team.members.map((m) => ({
          name: m.membership.registration?.fullName ?? m.membership.user.name,
          institution: m.membership.registration?.institution ?? '',
        })),
        track: team.track?.name ?? null,
        problem: team.problem
          ? { title: team.problem.title, description: team.problem.description }
          : null,
        submission: version
          ? {
              versionNo: version.versionNo,
              submittedAt: version.submittedAt,
              lateMinutes: version.lateMinutes,
              title: version.title,
              summary: version.summary,
              fields: fields.map((f) => {
                const value = (version.values as Record<string, string>)[f.id] ?? '';
                const file = f.type === 'FILE' ? files.find((x) => x.id === value) : undefined;
                return {
                  id: f.id,
                  label: f.label,
                  type: f.type,
                  value: f.type === 'FILE' ? '' : value,
                  file: file
                    ? {
                        id: file.id,
                        name: file.originalName,
                        size: file.sizeBytes,
                        contentType: file.contentType,
                      }
                    : null,
                };
              }),
            }
          : null,
        rubric:
          rubric && rubric.state !== 'DRAFT'
            ? {
                teamCommentMode: rubric.teamCommentMode,
                criteria: rubric.criteria.map((c) => ({
                  id: c.id,
                  name: c.name,
                  description: c.description,
                  weight: c.weight,
                  min: c.min,
                  max: c.max,
                })),
              }
            : null,
        evaluation: ev
          ? {
              status: ev.status,
              version: ev.version,
              scores: Object.fromEntries(ev.scores.map((s) => [s.criterionId, s.score])),
              teamComment: ev.teamComment ?? '',
              privateNote: ev.privateNote ?? '',
              weightedScore: decimalToString(ev.weightedScore),
              submittedAt: ev.submittedAt,
              correctionRequested: Boolean(ev.correctionRequestedAt),
              correctionReason: ev.correctionReason,
              correctionDeclinedReason: ev.correctionDeclinedReason,
            }
          : null,
        editable,
        notEditableReason: editable
          ? null
          : notEditableReason(
              round.judgingStatus,
              assignment.status,
              ev?.status,
              Boolean(version),
              rubric?.state ?? null,
            ),
      });
    },
  );

  function deniedByStatus(status: string | undefined) {
    return status === 'SUBMITTED';
  }
  function notEditableReason(
    judging: string,
    assignment: string,
    evalStatus: string | undefined,
    hasVersion: boolean,
    rubricState: string | null,
  ) {
    if (!hasVersion) return 'This team did not submit, so there is nothing to score.';
    if (assignment === 'CONFLICT') return 'You declared a conflict of interest for this team.';
    if (assignment !== 'ACTIVE') return 'This assignment is no longer active.';
    if (evalStatus === 'SUBMITTED')
      return 'You submitted this evaluation. Request a correction if something is wrong.';
    if (!rubricState || rubricState === 'DRAFT') return 'The rubric is not active yet.';
    if (judging === 'CLOSED') return 'Judging for this round has closed.';
    return 'Judging is not open.';
  }

  async function ownAssignment(ctx: EventContext, tx: Tx | typeof db, id: string) {
    judgeOnly(ctx);
    const a = await tx.judgeAssignment.findFirst({
      where: { id, eventId: ctx.event.id },
      include: { round: true, evaluation: true },
    });
    if (!a || a.judgeMembershipId !== ctx.membership.id || a.status === 'UNASSIGNED')
      return denied(ctx, `assignment ${id}`) as never;
    return a;
  }

  async function activeRubric(tx: Tx | typeof db, roundId: string) {
    const rubric = await tx.rubric.findUnique({
      where: { roundId },
      include: { criteria: { orderBy: { order: 'asc' } } },
    });
    if (!rubric || rubric.state === 'DRAFT')
      throw AppError.conflict('rubric_not_active', 'The rubric is not active yet');
    return rubric;
  }

  /** Why this judge cannot score right now, as an AppError. Judging must be open, except for one reopened evaluation. */
  function assertCanScore(a: Awaited<ReturnType<typeof ownAssignment>>) {
    const reopened = a.evaluation?.status === 'REOPENED';
    if (a.status === 'CONFLICT')
      throw AppError.conflict(
        'conflict_declared',
        'You declared a conflict of interest for this team.',
      );
    if (a.status !== 'ACTIVE')
      throw AppError.conflict('not_assigned', 'You are no longer assigned to this team.');
    if (a.evaluation?.status === 'SUBMITTED')
      throw AppError.conflict(
        'already_submitted',
        `This evaluation was already submitted at ${a.evaluation.submittedAt?.toISOString()}.`,
        { submittedAt: a.evaluation.submittedAt },
      );
    if (a.round.judgingStatus === 'NOT_OPEN' && !reopened)
      throw AppError.conflict('judging_not_open', 'Judging opens after submissions close.');
    if (a.round.judgingStatus === 'CLOSED' && !reopened)
      throw AppError.conflict('judging_closed', 'Judging for this round has closed.');
  }

  // ── Autosaved draft (PRD FR-096). Partial scores are fine here; nothing counts until submit. ──
  router.put(
    '/assignments/:assignmentId/evaluation',
    requireAction('score.enter'),
    async (req, res) => {
      const ctx = requireCtx(req);
      assertWritable(ctx);
      const input = parse(draftInput, req.body);
      const a = await ownAssignment(ctx, db, String(req.params.assignmentId));
      assertCanScore(a);
      const rubric = await activeRubric(db, a.roundId);
      const criteria = toCriteria(rubric.criteria);
      const errors: Record<string, string> = {};
      for (const [id, v] of Object.entries(input.scores)) {
        if (v === null) continue;
        const c = criteria.find((x) => x.id === id);
        if (!c) errors[id] = 'This criterion is not part of the rubric';
        else if (!Number.isInteger(v) || v < c.min || v > c.max)
          errors[id] = `Enter a whole number from ${c.min} to ${c.max}`;
      }
      if (Object.keys(errors).length)
        throw AppError.invalid('Please fix the highlighted scores', errors);

      const saved = await db.$transaction(async (tx) => {
        let ev = a.evaluation;
        if (!ev) {
          if (input.version !== 0)
            throw AppError.conflict(
              'stale_version',
              'This evaluation changed. Reload to continue.',
            );
          ev = await tx.evaluation.create({
            data: {
              assignmentId: a.id,
              eventId: ctx.event.id,
              structureVersion: rubric.structureVersion,
            },
          });
        } else {
          const r = await tx.evaluation.updateMany({
            where: { id: ev.id, version: input.version, status: { in: ['DRAFT', 'REOPENED'] } },
            data: { version: { increment: 1 } },
          });
          if (r.count === 0)
            throw AppError.conflict(
              'stale_version',
              'This evaluation was changed in another tab. Reload to continue.',
            );
        }
        await tx.criterionScore.deleteMany({ where: { evaluationId: ev.id } });
        const rows = Object.entries(input.scores)
          .filter(([, v]) => v !== null)
          .map(([criterionId, score]) => ({
            evaluationId: ev!.id,
            criterionId,
            score: score as number,
          }));
        if (rows.length) await tx.criterionScore.createMany({ data: rows });
        return tx.evaluation.update({
          where: { id: ev.id },
          data: {
            teamComment: input.teamComment ?? null,
            privateNote: input.privateNote ?? null,
            structureVersion: rubric.structureVersion,
            ...(a.evaluation ? {} : {}),
          },
        });
      });
      res.json({ version: saved.version, status: saved.status });
    },
  );

  // ── Submit (PRD FR-098/099): validated, locked, idempotent ──
  router.post(
    '/assignments/:assignmentId/evaluation/submit',
    requireAction('score.enter'),
    async (req, res) => {
      const ctx = requireCtx(req);
      assertWritable(ctx);
      const { version } = parse(z.object({ version: z.number().int().min(1) }).strict(), req.body);
      const a = await ownAssignment(ctx, db, String(req.params.assignmentId));
      assertCanScore(a);
      if (!a.evaluation)
        throw AppError.invalid('There is nothing to submit yet. Enter your scores first.');
      const rubric = await activeRubric(db, a.roundId);
      const criteria: ScoringCriterion[] = toCriteria(rubric.criteria);

      const result = await db.$transaction(async (tx) => {
        // Serialise concurrent submits (double click, two tabs): the second sees SUBMITTED and is refused.
        const locked = await tx.$queryRaw<
          { status: string; version: number; submittedAt: Date | null }[]
        >`SELECT status, version, "submittedAt" FROM "Evaluation" WHERE id = ${a.evaluation!.id} FOR UPDATE`;
        const cur = locked[0]!;
        if (cur.status === 'SUBMITTED') {
          throw AppError.conflict(
            'already_submitted',
            `This evaluation was already submitted at ${cur.submittedAt?.toISOString()}.`,
            { submittedAt: cur.submittedAt },
          );
        }
        if (cur.version !== version)
          throw AppError.conflict(
            'stale_version',
            'This evaluation changed. Reload before submitting.',
          );
        const ev = await tx.evaluation.findUniqueOrThrow({
          where: { id: a.evaluation!.id },
          include: { scores: true },
        });
        const scores = Object.fromEntries(ev.scores.map((s) => [s.criterionId, s.score]));
        const check = validateScores(criteria, scores);
        if (!check.ok) {
          const names = check.missing
            .map((id) => rubric.criteria.find((c) => c.id === id)?.name)
            .filter(Boolean);
          throw AppError.invalid(
            names.length
              ? `Score every criterion before submitting: ${names.join(', ')}`
              : 'Please fix the highlighted scores',
            check.errors,
          );
        }
        if (rubric.teamCommentMode === 'REQUIRED' && !(ev.teamComment ?? '').trim()) {
          throw AppError.invalid('Add feedback for the team before submitting', {
            teamComment: 'Feedback for the team is required',
          });
        }
        const j = judgeScore(criteria, scores);
        const versionNo = ev.submissionCount + 1;
        await tx.evaluationVersion.create({
          data: {
            evaluationId: ev.id,
            versionNo,
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
        const updated = await tx.evaluation.update({
          where: { id: ev.id },
          data: {
            status: 'SUBMITTED',
            weightedScore: j.toFixed(4),
            submittedAt: new Date(),
            submissionCount: versionNo,
            version: { increment: 1 },
            correctionReason: null,
            correctionRequestedAt: null,
            correctionDeclinedReason: null,
            structureVersion: rubric.structureVersion,
          },
        });
        // The first submitted evaluation locks the rubric structure (PRD FR-153).
        if (rubric.state === 'ACTIVE')
          await tx.rubric.update({ where: { id: rubric.id }, data: { state: 'LOCKED' } });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: ev.submissionCount > 0 ? 'evaluation.resubmitted' : 'evaluation.submitted',
          entityType: 'Evaluation',
          entityId: ev.id,
          after: { assignmentId: a.id, teamId: a.teamId, versionNo, weightedScore: j.toFixed(4) },
        });
        return updated;
      });
      res.status(201).json({
        weightedScore: decimalToString(result.weightedScore),
        submittedAt: result.submittedAt,
        version: result.version,
      });
    },
  );

  // ── Corrections (PRD FR-100): the judge asks, an admin reopens; nobody types scores for a judge ──
  router.post(
    '/assignments/:assignmentId/evaluation/request-correction',
    requireAction('score.enter'),
    async (req, res) => {
      const ctx = requireCtx(req);
      assertWritable(ctx);
      const { reason } = parse(
        z
          .object({ reason: z.string().trim().min(3, 'Explain what needs correcting').max(300) })
          .strict(),
        req.body,
      );
      const a = await ownAssignment(ctx, db, String(req.params.assignmentId));
      if (!a.evaluation || a.evaluation.status !== 'SUBMITTED')
        throw AppError.conflict(
          'not_submitted',
          'Only a submitted evaluation can have a correction requested',
        );
      await db.$transaction(async (tx) => {
        await tx.evaluation.update({
          where: { id: a.evaluation!.id },
          data: {
            correctionReason: reason,
            correctionRequestedAt: new Date(),
            correctionDeclinedReason: null,
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'evaluation.correction_requested',
          entityType: 'Evaluation',
          entityId: a.evaluation!.id,
          reason,
        });
      });
      res.json({ ok: true });
    },
  );

  router.post(
    '/assignments/:assignmentId/evaluation/reopen',
    requireAction('judges.assign'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const { reason } = parse(
        z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) }).strict(),
        req.body,
      );
      const a = await db.judgeAssignment.findFirst({
        where: { id: String(req.params.assignmentId), eventId: ctx.event.id },
        include: { evaluation: true },
      });
      if (!a?.evaluation) throw AppError.notFound();
      if (a.evaluation.status !== 'SUBMITTED')
        throw AppError.conflict('not_submitted', 'Only a submitted evaluation can be reopened');
      await db.$transaction(async (tx) => {
        await tx.evaluation.update({
          where: { id: a.evaluation!.id },
          data: {
            status: 'REOPENED',
            correctionRequestedAt: null,
            correctionReason: null,
            version: { increment: 1 },
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'evaluation.reopened',
          entityType: 'Evaluation',
          entityId: a.evaluation!.id,
          reason,
        });
      });
      res.json({ ok: true });
    },
  );

  router.post(
    '/assignments/:assignmentId/evaluation/decline-correction',
    requireAction('judges.assign'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const { reason } = parse(
        z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) }).strict(),
        req.body,
      );
      const a = await db.judgeAssignment.findFirst({
        where: { id: String(req.params.assignmentId), eventId: ctx.event.id },
        include: { evaluation: true },
      });
      if (!a?.evaluation?.correctionRequestedAt) throw AppError.notFound();
      await db.$transaction(async (tx) => {
        await tx.evaluation.update({
          where: { id: a.evaluation!.id },
          data: { correctionRequestedAt: null, correctionDeclinedReason: reason },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'evaluation.correction_declined',
          entityType: 'Evaluation',
          entityId: a.evaluation!.id,
          reason,
        });
      });
      res.json({ ok: true });
    },
  );

  // ── Evaluation review: admins see every judge's scores, comments and private notes; judges only their own ──
  router.get('/rounds/:roundId/evaluations', requireAction('score.view'), async (req, res) => {
    const ctx = requireCtx(req);
    const round = await loadRound(db, ctx, String(req.params.roundId));
    const where = {
      roundId: round.id,
      ...(isAdmin(ctx) ? {} : { judgeMembershipId: ctx.membership.id }),
    };
    if (!isAdmin(ctx) && ctx.membership.role !== 'JUDGE') throw AppError.notFound();
    const [assignments, rubric] = await Promise.all([
      db.judgeAssignment.findMany({
        where,
        include: {
          evaluation: { include: { scores: true, history: { orderBy: { versionNo: 'desc' } } } },
        },
      }),
      db.rubric.findUnique({
        where: { roundId: round.id },
        include: { criteria: { orderBy: { order: 'asc' } } },
      }),
    ]);
    const [teams, judges] = await Promise.all([
      db.team.findMany({ where: { id: { in: assignments.map((a) => a.teamId) } } }),
      db.eventMembership.findMany({
        where: { id: { in: assignments.map((a) => a.judgeMembershipId) } },
        include: { user: true },
      }),
    ]);
    res.json({
      criteria:
        rubric?.criteria.map((c) => ({
          id: c.id,
          name: c.name,
          weight: c.weight,
          min: c.min,
          max: c.max,
        })) ?? [],
      evaluations: assignments
        .filter((a) => a.evaluation)
        .map((a) => ({
          assignmentId: a.id,
          assignmentStatus: a.status,
          teamId: a.teamId,
          teamCode: teams.find((t) => t.id === a.teamId)?.teamCode,
          teamName: teams.find((t) => t.id === a.teamId)?.name,
          judgeName: judges.find((j) => j.id === a.judgeMembershipId)?.user.name,
          status: a.evaluation!.status,
          weightedScore: decimalToString(a.evaluation!.weightedScore),
          scores: Object.fromEntries(a.evaluation!.scores.map((s) => [s.criterionId, s.score])),
          teamComment: a.evaluation!.teamComment,
          privateNote:
            isAdmin(ctx) || ctx.membership.id === a.judgeMembershipId
              ? a.evaluation!.privateNote
              : null,
          submittedAt: a.evaluation!.submittedAt,
          versions: a.evaluation!.history.length,
          correctionRequested: Boolean(a.evaluation!.correctionRequestedAt),
          correctionReason: a.evaluation!.correctionReason,
        })),
    });
  });

  return router;
}
