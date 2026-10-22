import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx, type EventContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { sendCsv, toCsv } from '../../exports/csv.js';
import { assertWritable } from '../events/service.js';
import { activeTeamOf } from '../teams/service.js';
import { adminOnly, loadRound } from '../judging/common.js';
import { computeReview, type TeamResult } from './compute.js';

const reasonField = z.string().trim().min(10, 'Give a reason of at least 10 characters').max(300);

/** Result review, tie resolution, approval and publication (PRD FR-032..035, FR-149..156). */
export function resultsRouter(deps: Deps) {
  const { db } = deps;
  const router = Router({ mergeParams: true });

  /** Lazily invalidates an approval whose inputs have changed since it was approved (PRD FR-034, FR-154). */
  async function freshApproval(ctx: EventContext, roundId: string) {
    const round = await loadRound(db, ctx, roundId);
    const latest = await db.resultSnapshot.findFirst({
      where: { roundId, status: 'APPROVED' },
      orderBy: { versionNo: 'desc' },
    });
    const review = await computeReview(db, round);
    if (latest && latest.fingerprint !== review.fingerprint) {
      await db.$transaction(async (tx) => {
        await tx.resultSnapshot.update({
          where: { id: latest.id },
          data: {
            status: 'INVALIDATED',
            invalidatedAt: new Date(),
            invalidatedReason:
              'Evaluations, assignments, disqualifications or decisions changed after approval',
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: null,
          action: 'results.invalidated',
          entityType: 'ResultSnapshot',
          entityId: latest.id,
          after: { versionNo: latest.versionNo },
        });
      });
      return { round, review, approved: null };
    }
    return { round, review, approved: latest };
  }

  router.get(
    '/rounds/:roundId/results/review',
    requireAction('results.approve'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      const { round, review, approved } = await freshApproval(ctx, String(req.params.roundId));
      const snapshots = await db.resultSnapshot.findMany({
        where: { roundId: round.id },
        orderBy: { versionNo: 'desc' },
        select: {
          id: true,
          versionNo: true,
          status: true,
          approvedAt: true,
          invalidatedAt: true,
          invalidatedReason: true,
          publishedAt: true,
          unpublishedAt: true,
        },
      });
      const ties = await db.tieResolution.findMany({ where: { roundId: round.id } });
      const marks = await db.notRankedMark.findMany({ where: { roundId: round.id } });
      res.json({
        round: {
          id: round.id,
          name: round.name,
          judgingStatus: round.judgingStatus,
          awardPositions: round.awardPositions,
          rankingScope: round.rankingScope,
          requiredEvaluations: round.requiredEvaluations,
        },
        criteria: review.criteria,
        results: review.results,
        checklist: review.checklist,
        canApprove: review.canApprove,
        approvedVersion: approved?.versionNo ?? null,
        published: snapshots.find((s) => s.publishedAt && !s.unpublishedAt)?.versionNo ?? null,
        snapshots,
        ties: ties.map((t) => ({
          id: t.id,
          group: t.group,
          rank: t.rank,
          teamIds: t.teamIds,
          mode: t.mode,
          order: t.order,
          reason: t.reason,
        })),
        notRanked: marks.map((m) => ({ teamId: m.teamId, reason: m.reason })),
      });
    },
  );

  // ── Tie resolution: share the position or order manually, with a reason (FR-033) ──
  const tieInput = z
    .object({
      group: z.string().min(1),
      rank: z.number().int().min(1),
      teamIds: z.array(z.string().min(1)).min(2),
      mode: z.enum(['SHARE', 'ORDER']),
      order: z.array(z.string()).default([]),
      reason: reasonField,
    })
    .strict();

  router.put(
    '/rounds/:roundId/results/ties',
    requireAction('results.approve'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const input = parse(tieInput, req.body);
      const review = await computeReview(db, round);
      const group = review.results.filter((r) => r.group === input.group && r.state === 'RANKED');
      const scores = new Set(
        input.teamIds.map((id) => group.find((g) => g.teamId === id)?.score ?? 'x'),
      );
      if (scores.has('x') || scores.size !== 1)
        throw AppError.invalid(
          'Only teams with identical scores in the same ranking group can be resolved together',
        );
      if (
        input.mode === 'ORDER' &&
        [...input.order].sort().join() !== [...input.teamIds].sort().join()
      ) {
        throw AppError.invalid('Put every tied team in the order, once each', {
          order: 'List each tied team exactly once',
        });
      }
      await db.$transaction(async (tx) => {
        await tx.tieResolution.upsert({
          where: {
            roundId_group_rank: { roundId: round.id, group: input.group, rank: input.rank },
          },
          update: {
            teamIds: input.teamIds,
            mode: input.mode,
            order: input.mode === 'ORDER' ? input.order : [],
            reason: input.reason,
            createdBy: ctx.membership.userId,
          },
          create: {
            eventId: ctx.event.id,
            roundId: round.id,
            group: input.group,
            rank: input.rank,
            teamIds: input.teamIds,
            mode: input.mode,
            order: input.mode === 'ORDER' ? input.order : [],
            reason: input.reason,
            createdBy: ctx.membership.userId,
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'results.tie_resolved',
          entityType: 'Round',
          entityId: round.id,
          after: {
            group: input.group,
            rank: input.rank,
            mode: input.mode,
            order: input.order,
            teams: input.teamIds,
          },
          reason: input.reason,
        });
      });
      res.json({ ok: true });
    },
  );

  router.delete(
    '/rounds/:roundId/results/ties/:tieId',
    requireAction('results.approve'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const tie = await db.tieResolution.findFirst({
        where: { id: String(req.params.tieId), roundId: round.id },
      });
      if (!tie) throw AppError.notFound();
      await db.$transaction(async (tx) => {
        await tx.tieResolution.delete({ where: { id: tie.id } });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'results.tie_cleared',
          entityType: 'Round',
          entityId: round.id,
          before: { group: tie.group, rank: tie.rank },
        });
      });
      res.status(204).end();
    },
  );

  // ── Explicit "Not ranked" decisions for teams that cannot reach a counted evaluation (FR-149) ──
  router.put(
    '/rounds/:roundId/results/not-ranked',
    requireAction('results.approve'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const { teamId, reason } = parse(
        z.object({ teamId: z.string().min(1), reason: reasonField }).strict(),
        req.body,
      );
      if (
        !(await db.team.findFirst({
          where: { id: teamId, eventId: ctx.event.id, status: { not: 'DISSOLVED' } },
        }))
      )
        throw AppError.notFound();
      await db.$transaction(async (tx) => {
        await tx.notRankedMark.upsert({
          where: { roundId_teamId: { roundId: round.id, teamId } },
          update: { reason, createdBy: ctx.membership.userId },
          create: {
            eventId: ctx.event.id,
            roundId: round.id,
            teamId,
            reason,
            createdBy: ctx.membership.userId,
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'results.not_ranked',
          entityType: 'Team',
          entityId: teamId,
          after: { roundId: round.id },
          reason,
        });
      });
      res.json({ ok: true });
    },
  );

  router.delete(
    '/rounds/:roundId/results/not-ranked/:teamId',
    requireAction('results.approve'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      await db.$transaction(async (tx) => {
        await tx.notRankedMark.deleteMany({
          where: { roundId: round.id, teamId: String(req.params.teamId) },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'results.not_ranked_cleared',
          entityType: 'Team',
          entityId: String(req.params.teamId),
        });
      });
      res.status(204).end();
    },
  );

  // ── Approval creates an immutable, versioned snapshot (FR-034) ──
  router.post(
    '/rounds/:roundId/results/approve',
    requireAction('results.approve'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const review = await computeReview(db, round);
      const blockers: string[] = [];
      if (!review.checklist.hasRubric) blockers.push('There is no rubric for this round');
      if (!review.checklist.judgingClosed) blockers.push('Judging must be closed');
      if (review.checklist.missing.length)
        blockers.push(
          `${review.checklist.missing.length} team(s) lack counted evaluations: ${review.checklist.missing.map((m) => m.teamCode).join(', ')}`,
        );
      if (review.checklist.unresolvedTies.length)
        blockers.push(
          `${review.checklist.unresolvedTies.length} tie(s) inside the award positions need a decision`,
        );
      if (blockers.length)
        throw AppError.conflict('approval_blocked', `Cannot approve yet. ${blockers.join('. ')}.`, {
          blockers,
        });

      const [ties, marks] = await Promise.all([
        db.tieResolution.findMany({ where: { roundId: round.id } }),
        db.notRankedMark.findMany({ where: { roundId: round.id } }),
      ]);
      const snapshot = await db.$transaction(async (tx) => {
        const last = await tx.resultSnapshot.findFirst({
          where: { roundId: round.id },
          orderBy: { versionNo: 'desc' },
        });
        const versionNo = (last?.versionNo ?? 0) + 1;
        // A newer approval supersedes earlier ones (their content stays, their status says so).
        await tx.resultSnapshot.updateMany({
          where: { roundId: round.id, status: 'APPROVED' },
          data: {
            status: 'INVALIDATED',
            invalidatedAt: new Date(),
            invalidatedReason: `Superseded by version ${versionNo}`,
          },
        });
        const entries = review.results.filter((r) => r.rank !== null).map(entry);
        const unranked = review.results
          .filter((r) => r.rank === null)
          .map((r) => ({
            teamId: r.teamId,
            teamCode: r.teamCode,
            name: r.name,
            state: r.state,
            reason: r.reason,
          }));
        const snap = await tx.resultSnapshot.create({
          data: {
            eventId: ctx.event.id,
            roundId: round.id,
            versionNo,
            entries: entries as unknown as Prisma.InputJsonValue,
            unranked: unranked as unknown as Prisma.InputJsonValue,
            fingerprint: review.fingerprint,
            approvedById: ctx.membership.userId,
            tieDecisions: ties.map((t) => ({
              group: t.group,
              rank: t.rank,
              teamIds: t.teamIds,
              mode: t.mode,
              order: t.order,
              reason: t.reason,
            })),
            exclusions: [
              ...review.results.flatMap((r) => r.excluded.map((e) => ({ teamId: r.teamId, ...e }))),
              ...marks.map((m) => ({ teamId: m.teamId, status: 'NOT_RANKED', reason: m.reason })),
            ],
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'results.approved',
          entityType: 'ResultSnapshot',
          entityId: snap.id,
          after: { roundId: round.id, versionNo, ranked: entries.length },
        });
        return snap;
      });
      res.status(201).json({ snapshotId: snapshot.id, versionNo: snapshot.versionNo });
    },
  );

  // ── Publication: only an approved, still-valid snapshot (FR-035) ──
  router.post(
    '/rounds/:roundId/results/publish',
    requireAction('results.publish'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const { approved } = await freshApproval(ctx, String(req.params.roundId));
      if (!approved)
        throw AppError.conflict(
          'not_approved',
          'Approve the results first. An approval is withdrawn when evaluations or decisions change.',
        );
      if (approved.publishedAt && !approved.unpublishedAt)
        throw AppError.conflict('already_published', 'This version is already published');
      await db.$transaction(async (tx) => {
        await tx.resultSnapshot.update({
          where: { id: approved.id },
          data: {
            publishedAt: new Date(),
            publishedById: ctx.membership.userId,
            unpublishedAt: null,
            unpublishReason: null,
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'results.published',
          entityType: 'ResultSnapshot',
          entityId: approved.id,
          after: { versionNo: approved.versionNo },
        });
      });
      res.json({ versionNo: approved.versionNo });
    },
  );

  router.post(
    '/rounds/:roundId/results/unpublish',
    requireAction('results.publish'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const { reason } = parse(
        z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) }).strict(),
        req.body,
      );
      const visible = await db.resultSnapshot.findMany({
        where: { roundId: round.id, publishedAt: { not: null }, unpublishedAt: null },
      });
      if (!visible.length)
        throw AppError.conflict('not_published', 'Nothing is published for this round');
      await db.$transaction(async (tx) => {
        await tx.resultSnapshot.updateMany({
          where: { id: { in: visible.map((v) => v.id) } },
          data: { unpublishedAt: new Date(), unpublishReason: reason },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'results.unpublished',
          entityType: 'Round',
          entityId: round.id,
          reason,
        });
      });
      res.json({ ok: true });
    },
  );

  // ── What participants (and admins previewing) see: only published snapshots, shaped by the visibility toggles ──
  router.get('/results', requireAction('results.viewAggregate'), async (req, res) => {
    const ctx = requireCtx(req);
    const snaps = await db.resultSnapshot.findMany({
      where: { eventId: ctx.event.id, publishedAt: { not: null }, unpublishedAt: null },
      orderBy: [{ roundId: 'asc' }, { publishedAt: 'desc' }],
      include: { round: true },
    });
    const latest = new Map<string, (typeof snaps)[number]>();
    for (const s of snaps) if (!latest.has(s.roundId)) latest.set(s.roundId, s);
    const mine =
      ctx.membership.role === 'PARTICIPANT'
        ? await activeTeamOf(db, ctx.event.id, ctx.membership.id)
        : null;
    const rounds = [...latest.values()]
      .sort((a, b) => a.round.order - b.round.order)
      .map((s) => {
        const entries = s.entries as unknown as PublishedEntry[];
        const unranked = s.unranked as unknown as { teamId: string }[];
        const earlier = snaps.some((o) => o.roundId === s.roundId && o.versionNo < s.versionNo);
        const winners = ctx.event.showWinners
          ? entries
              .filter((e) => e.rank <= s.round.awardPositions)
              .map((e) => ({ rank: e.rank, teamCode: e.teamCode, name: e.name, group: e.group }))
          : null;
        const own = entries.find((e) => e.teamId === mine?.teamId);
        return {
          roundId: s.roundId,
          roundName: s.round.name,
          versionNo: s.versionNo,
          publishedAt: s.publishedAt,
          updated: earlier,
          scope: s.round.rankingScope,
          awardPositions: s.round.awardPositions,
          winners,
          own: mine
            ? {
                teamCode: mine.team.teamCode,
                name: mine.team.name,
                ranked: Boolean(own),
                rank: ctx.event.showOwnRank ? (own?.rank ?? null) : null,
                score: ctx.event.showOwnScores ? (own?.score ?? null) : null,
                notRanked: !own && unranked.some((u) => u.teamId === mine.teamId),
              }
            : null,
        };
      });
    res.json({
      rounds,
      visibility: {
        winners: ctx.event.showWinners,
        ownRank: ctx.event.showOwnRank,
        ownScores: ctx.event.showOwnScores,
      },
    });
  });

  router.get(
    '/rounds/:roundId/results/export.csv',
    requireAction('export.csv'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const snap = await db.resultSnapshot.findFirst({
        where: { roundId: round.id },
        orderBy: { versionNo: 'desc' },
      });
      if (!snap)
        throw AppError.conflict('no_snapshot', 'Approve the results before exporting them');
      const entries = snap.entries as unknown as PublishedEntry[];
      const csv = toCsv(
        [
          'Rank',
          'Team ID',
          'Team',
          'Group',
          'Score',
          'Counted evaluations',
          'Required evaluations',
          'Shared rank',
          'Snapshot version',
          'Approved at',
        ],
        entries.map((e) => [
          e.rank,
          e.teamCode,
          e.name,
          e.group,
          e.score,
          e.counted,
          e.required,
          e.tied ? 'Yes' : 'No',
          snap.versionNo,
          snap.approvedAt,
        ]),
      );
      await writeAudit(db, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'export.results',
        entityType: 'Export',
        after: { roundId: round.id, versionNo: snap.versionNo },
      });
      sendCsv(
        res,
        `${ctx.event.slug}-${round.name.toLowerCase().replace(/\W+/g, '-')}-results.csv`,
        csv,
      );
    },
  );

  return router;
}

interface PublishedEntry {
  teamId: string;
  teamCode: string;
  name: string;
  group: string;
  rank: number;
  score: string;
  tied: boolean;
  counted: number;
  required: number;
}

function entry(
  r: TeamResult,
): PublishedEntry & { trackName: string; incomplete: boolean; breakdown: TeamResult['breakdown'] } {
  return {
    teamId: r.teamId,
    teamCode: r.teamCode,
    name: r.name,
    group: r.group,
    trackName: r.trackName,
    rank: r.rank!,
    score: r.score!,
    tied: r.tied,
    counted: r.counted,
    required: r.required,
    incomplete: !r.complete,
    breakdown: r.breakdown,
  };
}
