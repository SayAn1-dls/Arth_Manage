import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { assertWritable } from '../events/service.js';
import { adminOnly, judgedVersions, loadRound, submissionsClosed } from './common.js';

const reasonInput = z
  .object({ reason: z.string().trim().min(3, 'Give a reason').max(300) })
  .strict();

/** Judge assignments, judging status and progress monitoring for Core Admins (PRD FR-026..031, FR-097, FR-155). */
export function assignmentsRouter({ db }: Deps) {
  const router = Router({ mergeParams: true });

  // ── Judging status: Not open / Open / Closed (PRD FR-029) ──
  router.put('/rounds/:roundId/judging', requireAction('judges.assign'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const round = await loadRound(db, ctx, String(req.params.roundId));
    const { status } = parse(
      z.object({ status: z.enum(['NOT_OPEN', 'OPEN', 'CLOSED']) }).strict(),
      req.body,
    );
    if (status === 'OPEN') {
      const rubric = await db.rubric.findUnique({ where: { roundId: round.id } });
      if (!rubric || rubric.state === 'DRAFT')
        throw AppError.conflict('rubric_not_active', 'Activate the rubric before opening judging');
      if (!round.submissionDeadline)
        throw AppError.conflict('no_deadline', 'Set the submission deadline first');
      if (!submissionsClosed(round)) {
        throw AppError.conflict(
          'submissions_open',
          'Judging can open only after the submission deadline and grace period have passed',
        );
      }
    }
    if (
      status === 'NOT_OPEN' &&
      (await db.evaluation.count({ where: { assignment: { roundId: round.id } } })) > 0
    ) {
      throw AppError.conflict(
        'evaluations_exist',
        'Judges have started scoring. Close judging instead of resetting it.',
      );
    }
    await db.$transaction(async (tx) => {
      await tx.round.update({ where: { id: round.id }, data: { judgingStatus: status } });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'judging.status_changed',
        entityType: 'Round',
        entityId: round.id,
        before: { judgingStatus: round.judgingStatus },
        after: { judgingStatus: status },
      });
    });
    res.json({ judgingStatus: status });
  });

  // ── Overview: judges, teams, assignments and progress in one payload (PRD FR-030, FR-031) ──
  router.get(
    '/rounds/:roundId/judging/overview',
    requireAction('judges.assign'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const [rubric, judges, teams, assignments, judged] = await Promise.all([
        db.rubric.findUnique({
          where: { roundId: round.id },
          include: { _count: { select: { criteria: true } } },
        }),
        db.eventMembership.findMany({
          where: { eventId: ctx.event.id, role: 'JUDGE', status: 'ACTIVE' },
          include: { user: true },
        }),
        db.team.findMany({
          where: { eventId: ctx.event.id, status: { not: 'DISSOLVED' } },
          orderBy: { teamCode: 'asc' },
        }),
        db.judgeAssignment.findMany({
          where: { roundId: round.id },
          include: { evaluation: true },
        }),
        judgedVersions(db, round.id),
      ]);
      const judgeName = new Map(judges.map((j) => [j.id, j.user.name]));
      const teamRows = teams.map((t) => {
        const mine = assignments.filter((a) => a.teamId === t.id);
        const counted = mine.filter(
          (a) => a.status === 'ACTIVE' && a.evaluation?.status === 'SUBMITTED',
        ).length;
        const submitted = judged.has(t.id);
        return {
          teamId: t.id,
          teamCode: t.teamCode,
          name: t.name,
          disqualified: t.status === 'DISQUALIFIED',
          submitted,
          required: round.requiredEvaluations,
          counted,
          assignments: mine.map((a) => ({
            id: a.id,
            judgeMembershipId: a.judgeMembershipId,
            judgeName: judgeName.get(a.judgeMembershipId) ?? 'Former judge',
            status: a.status,
            reason: a.reason,
            conflictDeclaredBy: a.conflictDeclaredBy,
            evaluation: a.evaluation
              ? {
                  status: a.evaluation.status,
                  correctionRequested: Boolean(a.evaluation.correctionRequestedAt),
                  correctionReason: a.evaluation.correctionReason,
                }
              : null,
          })),
          complete: counted >= round.requiredEvaluations,
        };
      });
      const judgeRows = judges.map((j) => {
        const mine = assignments.filter(
          (a) => a.judgeMembershipId === j.id && a.status === 'ACTIVE',
        );
        const done = mine.filter((a) => a.evaluation?.status === 'SUBMITTED').length;
        return {
          membershipId: j.id,
          name: j.user.name,
          email: j.user.email,
          assigned: mine.length,
          submitted: done,
          drafts: mine.filter((a) => a.evaluation && a.evaluation.status !== 'SUBMITTED').length,
        };
      });
      // Missing evaluations: teams that submitted work and still lack counted evaluations (PRD FR-031).
      const missing = teamRows
        .filter((t) => t.submitted && !t.disqualified && !t.complete)
        .map((t) => ({
          teamId: t.teamId,
          teamCode: t.teamCode,
          name: t.name,
          counted: t.counted,
          required: t.required,
          shortfall: t.required - t.counted,
        }));
      const warnAt = round.judgingDeadline
        ? new Date(round.judgingDeadline.getTime() - 3600_000)
        : null;
      res.json({
        round: {
          id: round.id,
          name: round.name,
          judgingStatus: round.judgingStatus,
          requiredEvaluations: round.requiredEvaluations,
          judgingDeadline: round.judgingDeadline,
        },
        rubric: rubric ? { state: rubric.state, criteria: rubric._count.criteria } : null,
        canOpen: Boolean(rubric && rubric.state !== 'DRAFT' && submissionsClosed(round)),
        judges: judgeRows,
        teams: teamRows,
        missing,
        // Judges with no progress inside the final hour are highlighted (PRD FR-030).
        judgesAtRisk:
          warnAt && new Date() >= warnAt
            ? judgeRows
                .filter((j) => j.assigned > 0 && j.submitted === 0)
                .map((j) => j.membershipId)
            : [],
      });
    },
  );

  // ── Bulk assignment: selected judges × selected teams (PRD FR-027) ──
  const bulkInput = z
    .object({
      judgeMembershipIds: z.array(z.string().min(1)).min(1).max(100),
      teamIds: z.array(z.string().min(1)).min(1).max(500),
    })
    .strict();

  router.post('/rounds/:roundId/assignments', requireAction('judges.assign'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const round = await loadRound(db, ctx, String(req.params.roundId));
    const input = parse(bulkInput, req.body);
    const [judges, teams] = await Promise.all([
      db.eventMembership.findMany({
        where: {
          id: { in: input.judgeMembershipIds },
          eventId: ctx.event.id,
          role: 'JUDGE',
          status: 'ACTIVE',
        },
      }),
      db.team.findMany({
        where: { id: { in: input.teamIds }, eventId: ctx.event.id, status: { not: 'DISSOLVED' } },
      }),
    ]);
    if (judges.length !== new Set(input.judgeMembershipIds).size)
      throw AppError.invalid('Choose judges of this event', {
        judgeMembershipIds: 'Every selected person must be an active judge',
      });
    if (teams.length !== new Set(input.teamIds).size)
      throw AppError.invalid('Choose teams of this event', {
        teamIds: 'Every selected team must belong to this event',
      });
    const result = {
      created: 0,
      restored: 0,
      alreadyAssigned: 0,
      skippedDisqualified: [] as string[],
    };
    await db.$transaction(async (tx) => {
      for (const team of teams) {
        if (team.status === 'DISQUALIFIED') {
          result.skippedDisqualified.push(team.teamCode);
          continue;
        }
        for (const judge of judges) {
          const existing = await tx.judgeAssignment.findUnique({
            where: {
              roundId_teamId_judgeMembershipId: {
                roundId: round.id,
                teamId: team.id,
                judgeMembershipId: judge.id,
              },
            },
          });
          if (existing && existing.status === 'UNASSIGNED') {
            // Re-assigning the same judge restores their submitted evaluation (PRD FR-155).
            await tx.judgeAssignment.update({
              where: { id: existing.id },
              data: { status: 'ACTIVE', reason: null },
            });
            result.restored += 1;
          } else if (existing) result.alreadyAssigned += 1;
          else {
            await tx.judgeAssignment.create({
              data: {
                eventId: ctx.event.id,
                roundId: round.id,
                teamId: team.id,
                judgeMembershipId: judge.id,
              },
            });
            result.created += 1;
          }
        }
      }
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'judging.assigned',
        entityType: 'Round',
        entityId: round.id,
        after: { judges: judges.length, teams: teams.length, ...result },
      });
    });
    res.status(201).json(result);
  });

  // Even-load distribution so each team reaches the required number of judges (PRD FR-027, P1).
  router.post(
    '/rounds/:roundId/assignments/auto-balance',
    requireAction('judges.assign'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const { judgeMembershipIds } = parse(
        z.object({ judgeMembershipIds: z.array(z.string().min(1)).min(1).max(100) }).strict(),
        req.body,
      );
      const judges = await db.eventMembership.findMany({
        where: {
          id: { in: judgeMembershipIds },
          eventId: ctx.event.id,
          role: 'JUDGE',
          status: 'ACTIVE',
        },
      });
      if (judges.length !== new Set(judgeMembershipIds).size)
        throw AppError.invalid('Choose judges of this event');
      if (judges.length < round.requiredEvaluations)
        throw AppError.conflict(
          'not_enough_judges',
          `This round needs ${round.requiredEvaluations} judges per team, but only ${judges.length} were chosen.`,
        );
      const created = await db.$transaction(async (tx) => {
        const [teams, current] = await Promise.all([
          tx.team.findMany({
            where: { eventId: ctx.event.id, status: 'ACTIVE' },
            include: {
              members: {
                where: { leftAt: null },
                include: { membership: { include: { registration: true } } },
              },
            },
            orderBy: { teamCode: 'asc' },
          }),
          tx.judgeAssignment.findMany({ where: { roundId: round.id } }),
        ]);
        const load = new Map(
          judges.map((j) => [
            j.id,
            current.filter((a) => a.judgeMembershipId === j.id && a.status === 'ACTIVE').length,
          ]),
        );
        let made = 0;
        const entries = round.shortlistEnabled
          ? await tx.roundEntry.findMany({ where: { roundId: round.id } })
          : [];
        for (const team of teams) {
          if (round.shortlistEnabled && !entries.some((e) => e.teamId === team.id)) continue;
          const have = current.filter((a) => a.teamId === team.id && a.status === 'ACTIVE');
          const taken = new Set(
            current.filter((a) => a.teamId === team.id).map((a) => a.judgeMembershipId),
          );
          for (let n = have.length; n < round.requiredEvaluations; n++) {
            const pick = [...judges]
              .filter(
                (j) =>
                  !taken.has(j.id) &&
                  (!j.trackIds.length || (team.trackId && j.trackIds.includes(team.trackId))) &&
                  (!j.institution.trim() ||
                    !team.members.some(
                      (m) =>
                        m.membership.registration?.institution.trim().toLowerCase() ===
                        j.institution.trim().toLowerCase(),
                    )),
              )
              .sort((a, b) => load.get(a.id)! - load.get(b.id)! || a.id.localeCompare(b.id))[0];
            if (!pick) break;
            await tx.judgeAssignment.create({
              data: {
                eventId: ctx.event.id,
                roundId: round.id,
                teamId: team.id,
                judgeMembershipId: pick.id,
              },
            });
            taken.add(pick.id);
            load.set(pick.id, load.get(pick.id)! + 1);
            made += 1;
          }
        }
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'judging.auto_balanced',
          entityType: 'Round',
          entityId: round.id,
          after: { created: made, judges: judges.length },
        });
        return made;
      });
      res.status(201).json({ created });
    },
  );

  async function loadAssignment(ctx: ReturnType<typeof requireCtx>, id: string) {
    const a = await db.judgeAssignment.findFirst({
      where: { id, eventId: ctx.event.id },
      include: { evaluation: true },
    });
    if (!a) throw AppError.notFound();
    return a;
  }

  // Unassigning someone who already submitted needs confirmation and keeps the evaluation, uncounted (PRD FR-155).
  router.delete('/assignments/:assignmentId', requireAction('judges.assign'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const a = await loadAssignment(ctx, String(req.params.assignmentId));
    const hasSubmitted = Boolean(a.evaluation && a.evaluation.submissionCount > 0);
    if (hasSubmitted && req.query.confirm !== '1') {
      throw AppError.conflict(
        'confirm_required',
        'This judge already submitted an evaluation. It will be kept but no longer counted. Confirm to unassign.',
      );
    }
    await db.$transaction(async (tx) => {
      if (hasSubmitted)
        await tx.judgeAssignment.update({
          where: { id: a.id },
          data: { status: 'UNASSIGNED', reason: 'Unassigned by an admin' },
        });
      else await tx.judgeAssignment.delete({ where: { id: a.id } });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'judging.unassigned',
        entityType: 'JudgeAssignment',
        entityId: a.id,
        after: { teamId: a.teamId, judgeMembershipId: a.judgeMembershipId, kept: hasSubmitted },
      });
    });
    res.status(204).end();
  });

  router.post(
    '/assignments/:assignmentId/exclude',
    requireAction('judges.assign'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const { reason } = parse(reasonInput, req.body);
      const a = await loadAssignment(ctx, String(req.params.assignmentId));
      await db.$transaction(async (tx) => {
        await tx.judgeAssignment.update({
          where: { id: a.id },
          data: { status: 'EXCLUDED', reason },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'judging.assignment_excluded',
          entityType: 'JudgeAssignment',
          entityId: a.id,
          reason,
        });
      });
      res.json({ ok: true });
    },
  );

  router.post(
    '/assignments/:assignmentId/restore',
    requireAction('judges.assign'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const a = await loadAssignment(ctx, String(req.params.assignmentId));
      if (a.status !== 'EXCLUDED' && a.status !== 'UNASSIGNED')
        throw AppError.conflict(
          'not_excluded',
          'Only an excluded or unassigned assignment can be restored',
        );
      await db.$transaction(async (tx) => {
        await tx.judgeAssignment.update({
          where: { id: a.id },
          data: { status: 'ACTIVE', reason: null },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'judging.assignment_restored',
          entityType: 'JudgeAssignment',
          entityId: a.id,
        });
      });
      res.json({ ok: true });
    },
  );

  // ── Conflicts of interest (PRD FR-097): the judge or an admin declares; only an admin overrides, with a reason ──
  router.post(
    '/assignments/:assignmentId/conflict',
    requireAction('score.view'),
    async (req, res) => {
      const ctx = requireCtx(req);
      const { reason } = parse(
        z
          .object({
            reason: z
              .string()
              .trim()
              .min(10, 'Explain the conflict in at least 10 characters')
              .max(300),
          })
          .strict(),
        req.body,
      );
      const a = await loadAssignment(ctx, String(req.params.assignmentId));
      const admin = ctx.membership.role === 'ADMIN';
      if (!admin && (ctx.membership.role !== 'JUDGE' || a.judgeMembershipId !== ctx.membership.id))
        throw AppError.notFound();
      if (!admin) assertWritable(ctx);
      if (a.evaluation?.status === 'SUBMITTED')
        throw AppError.conflict(
          'already_submitted',
          'This evaluation is already submitted. Ask an organiser to reopen it.',
        );
      if (a.status !== 'ACTIVE')
        throw AppError.conflict('not_active', 'This assignment is not active');
      await db.$transaction(async (tx) => {
        await tx.judgeAssignment.update({
          where: { id: a.id },
          data: { status: 'CONFLICT', reason, conflictDeclaredBy: admin ? 'ADMIN' : 'JUDGE' },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'judging.conflict_declared',
          entityType: 'JudgeAssignment',
          entityId: a.id,
          after: { by: admin ? 'ADMIN' : 'JUDGE' },
          reason,
        });
      });
      res.json({ ok: true });
    },
  );

  router.post(
    '/assignments/:assignmentId/conflict/override',
    requireAction('judges.assign'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const { reason } = parse(reasonInput, req.body);
      const a = await loadAssignment(ctx, String(req.params.assignmentId));
      if (a.status !== 'CONFLICT')
        throw AppError.conflict('no_conflict', 'There is no conflict to override');
      await db.$transaction(async (tx) => {
        await tx.judgeAssignment.update({
          where: { id: a.id },
          data: { status: 'ACTIVE', reason: null, conflictDeclaredBy: null },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'judging.conflict_overridden',
          entityType: 'JudgeAssignment',
          entityId: a.id,
          reason,
        });
      });
      res.json({ ok: true });
    },
  );

  return router;
}
