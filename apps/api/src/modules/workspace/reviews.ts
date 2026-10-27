import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../../http/deps.js';
import { requireCtx } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { adminOnly, loadRound, judgeMayViewTeam } from '../judging/common.js';
import { assertWritable } from '../events/service.js';
import { writeAudit } from '../../audit/audit.js';
import { provenance, compareFile } from './integrity.js';
export function projectReviewRouter({ db, limit }: Deps) {
  const r = Router({ mergeParams: true });
  r.get('/workspace/reviews/:roundId', async (req, res) => {
    const c = requireCtx(req);
    const round = await loadRound(db, c, String(req.params.roundId));
    const reviews = await db.projectReview.findMany({
      where: { eventId: c.event.id, roundId: round.id },
    });
    if (c.membership.role === 'ADMIN') return res.json({ reviews });
    if (c.membership.role === 'JUDGE') {
      const allowed = await Promise.all(
        reviews.map(async (v) =>
          (await judgeMayViewTeam(db, c.membership.id, round.id, v.teamId))
            ? { teamId: v.teamId, marketNote: v.marketNote, sources: [] }
            : null,
        ),
      );
      return res.json({ reviews: allowed.filter(Boolean) });
    }
    const member = await db.teamMember.findFirst({
      where: { eventId: c.event.id, membershipId: c.membership.id, leftAt: null },
    });
    res.json({
      reviews: reviews
        .filter((v) => v.teamId === member?.teamId && v.releaseToTeam)
        .map((v) => ({ teamId: v.teamId, marketNote: v.marketNote, sources: [] })),
    });
  });
  r.post(
    '/workspace/reviews/:roundId/:teamId/scan',
    limit('integrity-scan', 10, 60000),
    async (req, res) => {
      const c = requireCtx(req);
      adminOnly(c);
      assertWritable(c);
      const round = await loadRound(db, c, String(req.params.roundId));
      const teamId = String(req.params.teamId);
      if (!(await db.team.findFirst({ where: { id: teamId, eventId: c.event.id } })))
        throw AppError.notFound();
      const { repoUrl } = parse(
        z.object({ repoUrl: z.string().url().max(500) }).strict(),
        req.body,
      );
      const result = await provenance(repoUrl, c.event.startsAt);
      const review = await db.projectReview.upsert({
        where: { roundId_teamId: { roundId: round.id, teamId } },
        create: {
          eventId: c.event.id,
          roundId: round.id,
          teamId,
          repoUrl: result.repoUrl,
          integrityNote: result.note,
          sources: [result],
          status: result.beforeKickoff ? 'FLAGGED' : 'PENDING',
        },
        update: {
          repoUrl: result.repoUrl,
          integrityNote: result.note,
          sources: [result],
          status: result.beforeKickoff ? 'FLAGGED' : 'PENDING',
        },
      });
      await writeAudit(db, {
        eventId: c.event.id,
        actorId: c.membership.userId,
        action: 'integrity.scanned',
        entityType: 'ProjectReview',
        entityId: review.id,
      });
      res.json(review);
    },
  );
  r.post(
    '/workspace/reviews/:roundId/:teamId/compare',
    limit('integrity-compare', 10, 60000),
    async (req, res) => {
      const c = requireCtx(req);
      adminOnly(c);
      assertWritable(c);
      const round = await loadRound(db, c, String(req.params.roundId));
      const teamId = String(req.params.teamId);
      if (!(await db.team.findFirst({ where: { id: teamId, eventId: c.event.id } })))
        throw AppError.notFound();
      const input = parse(
        z
          .object({
            repoUrl: z.string().url(),
            referenceUrl: z.string().url(),
            path: z.string().min(1).max(300),
          })
          .strict(),
        req.body,
      );
      const result = await compareFile(input.repoUrl, input.referenceUrl, input.path);
      const review = await db.projectReview.upsert({
        where: { roundId_teamId: { roundId: round.id, teamId } },
        create: {
          eventId: c.event.id,
          roundId: round.id,
          teamId,
          repoUrl: input.repoUrl,
          sources: [result],
          integrityNote: result.note,
          status: result.matchedLines >= 6 ? 'FLAGGED' : 'PENDING',
        },
        update: {
          sources: [result],
          integrityNote: result.note,
          status: result.matchedLines >= 6 ? 'FLAGGED' : 'PENDING',
        },
      });
      await writeAudit(db, {
        eventId: c.event.id,
        actorId: c.membership.userId,
        action: 'integrity.compared',
        entityType: 'ProjectReview',
        entityId: review.id,
      });
      res.json(review);
    },
  );
  r.put('/workspace/reviews/:roundId/:teamId', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    assertWritable(c);
    const round = await loadRound(db, c, String(req.params.roundId));
    const teamId = String(req.params.teamId);
    if (!(await db.team.findFirst({ where: { id: teamId, eventId: c.event.id } })))
      throw AppError.notFound();
    const input = parse(
      z
        .object({
          integrityNote: z.string().max(4000),
          marketNote: z.string().max(4000),
          status: z.enum(['PENDING', 'FLAGGED', 'CLEARED', 'REVIEWED']),
          releaseToTeam: z.boolean(),
        })
        .strict(),
      req.body,
    );
    const row = await db.projectReview.upsert({
      where: { roundId_teamId: { roundId: round.id, teamId } },
      create: {
        eventId: c.event.id,
        roundId: round.id,
        teamId,
        ...input,
        reviewedById: c.membership.id,
      },
      update: { ...input, reviewedById: c.membership.id },
    });
    await writeAudit(db, {
      eventId: c.event.id,
      actorId: c.membership.userId,
      action: 'integrity.reviewed',
      entityType: 'ProjectReview',
      entityId: row.id,
    });
    res.json(row);
  });
  return r;
}
