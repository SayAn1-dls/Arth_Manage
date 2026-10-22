import { Router } from 'express';
import { problemSchema, roundSchema, trackSchema } from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { roundDto } from './dto.js';
import { assertWritable } from './service.js';
import { assertProblemUnused, assertTrackUnused, roundHasSubmissions } from './usage.js';

const MAX_TRACKS = 20;

/** Tracks, problem statements and rounds (PRD A.2). Reads are for every member; writes for Core Admins. */
export function structureRouter({ db }: Deps) {
  const router = Router({ mergeParams: true });
  const auditBase = (req: Parameters<typeof requireCtx>[0]) => {
    const ctx = requireCtx(req);
    return { eventId: ctx.event.id, actorId: ctx.membership.userId };
  };

  // ── Tracks ──
  router.get('/tracks', requireAction('event.view'), async (req, res) => {
    const tracks = await db.track.findMany({
      where: { eventId: requireCtx(req).event.id },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    res.json({ tracks });
  });

  router.post('/tracks', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const input = parse(trackSchema, req.body);
    if ((await db.track.count({ where: { eventId: ctx.event.id } })) >= MAX_TRACKS) {
      throw AppError.invalid(`An event can have at most ${MAX_TRACKS} tracks`);
    }
    if (
      await db.track.findUnique({
        where: { eventId_name: { eventId: ctx.event.id, name: input.name } },
      })
    ) {
      throw AppError.invalid('A track with this name already exists', {
        name: 'Track names must be unique',
      });
    }
    const track = await db.$transaction(async (tx) => {
      const t = await tx.track.create({
        data: {
          eventId: ctx.event.id,
          name: input.name,
          description: input.description ?? null,
          order: input.order ?? 0,
        },
      });
      await writeAudit(tx, {
        ...auditBase(req),
        action: 'track.created',
        entityType: 'Track',
        entityId: t.id,
        after: { name: t.name },
      });
      return t;
    });
    res.status(201).json(track);
  });

  router.patch('/tracks/:trackId', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const existing = await db.track.findFirst({
      where: { id: String(req.params.trackId), eventId: ctx.event.id },
    });
    if (!existing) throw AppError.notFound();
    const input = parse(trackSchema, req.body);
    const dup = await db.track.findFirst({
      where: { eventId: ctx.event.id, name: input.name, NOT: { id: existing.id } },
    });
    if (dup)
      throw AppError.invalid('A track with this name already exists', {
        name: 'Track names must be unique',
      });
    const track = await db.$transaction(async (tx) => {
      const t = await tx.track.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          description: input.description ?? null,
          order: input.order ?? existing.order,
        },
      });
      await writeAudit(tx, {
        ...auditBase(req),
        action: 'track.updated',
        entityType: 'Track',
        entityId: t.id,
        before: { name: existing.name },
        after: { name: t.name },
      });
      return t;
    });
    res.json(track);
  });

  router.delete('/tracks/:trackId', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const existing = await db.track.findFirst({
      where: { id: String(req.params.trackId), eventId: ctx.event.id },
    });
    if (!existing) throw AppError.notFound();
    await assertTrackUnused(db, existing.id);
    await db.$transaction(async (tx) => {
      await tx.track.delete({ where: { id: existing.id } });
      await writeAudit(tx, {
        ...auditBase(req),
        action: 'track.deleted',
        entityType: 'Track',
        entityId: existing.id,
        before: { name: existing.name },
      });
    });
    res.status(204).end();
  });

  // ── Problem statements ──
  router.get('/problems', requireAction('event.view'), async (req, res) => {
    const problems = await db.problemStatement.findMany({
      where: { eventId: requireCtx(req).event.id },
      orderBy: [{ order: 'asc' }, { title: 'asc' }],
    });
    res.json({ problems });
  });

  async function checkTrack(eventId: string, trackId: string | null | undefined) {
    if (!trackId) return;
    const t = await db.track.findFirst({ where: { id: trackId, eventId } });
    if (!t)
      throw AppError.invalid('That track does not belong to this event', {
        trackId: 'Choose a track from this event',
      });
  }

  router.post('/problems', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const input = parse(problemSchema, req.body);
    await checkTrack(ctx.event.id, input.trackId);
    if (
      await db.problemStatement.findUnique({
        where: { eventId_title: { eventId: ctx.event.id, title: input.title } },
      })
    ) {
      throw AppError.invalid('A problem statement with this title already exists', {
        title: 'Titles must be unique',
      });
    }
    const problem = await db.$transaction(async (tx) => {
      const p = await tx.problemStatement.create({
        data: {
          eventId: ctx.event.id,
          title: input.title,
          description: input.description,
          trackId: input.trackId ?? null,
          order: input.order ?? 0,
        },
      });
      await writeAudit(tx, {
        ...auditBase(req),
        action: 'problem.created',
        entityType: 'ProblemStatement',
        entityId: p.id,
        after: { title: p.title },
      });
      return p;
    });
    res.status(201).json(problem);
  });

  router.patch('/problems/:problemId', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const existing = await db.problemStatement.findFirst({
      where: { id: String(req.params.problemId), eventId: ctx.event.id },
    });
    if (!existing) throw AppError.notFound();
    const input = parse(problemSchema, req.body);
    await checkTrack(ctx.event.id, input.trackId);
    const dup = await db.problemStatement.findFirst({
      where: { eventId: ctx.event.id, title: input.title, NOT: { id: existing.id } },
    });
    if (dup)
      throw AppError.invalid('A problem statement with this title already exists', {
        title: 'Titles must be unique',
      });
    const problem = await db.$transaction(async (tx) => {
      const p = await tx.problemStatement.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          description: input.description,
          trackId: input.trackId ?? null,
          order: input.order ?? existing.order,
        },
      });
      await writeAudit(tx, {
        ...auditBase(req),
        action: 'problem.updated',
        entityType: 'ProblemStatement',
        entityId: p.id,
        before: { title: existing.title },
        after: { title: p.title },
      });
      return p;
    });
    res.json(problem);
  });

  router.delete('/problems/:problemId', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const existing = await db.problemStatement.findFirst({
      where: { id: String(req.params.problemId), eventId: ctx.event.id },
    });
    if (!existing) throw AppError.notFound();
    await assertProblemUnused(db, existing.id);
    await db.$transaction(async (tx) => {
      await tx.problemStatement.delete({ where: { id: existing.id } });
      await writeAudit(tx, {
        ...auditBase(req),
        action: 'problem.deleted',
        entityType: 'ProblemStatement',
        entityId: existing.id,
        before: { title: existing.title },
      });
    });
    res.status(204).end();
  });

  // ── Rounds ──
  router.get('/rounds', requireAction('event.view'), async (req, res) => {
    const rounds = await db.round.findMany({
      where: { eventId: requireCtx(req).event.id },
      orderBy: { order: 'asc' },
    });
    res.json({ rounds: rounds.map(roundDto) });
  });

  router.post('/rounds', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const input = parse(roundSchema, req.body); // `reason` only matters when editing
    const last = await db.round.findFirst({
      where: { eventId: ctx.event.id },
      orderBy: { order: 'desc' },
    });
    const round = await db.$transaction(async (tx) => {
      const r = await tx.round.create({
        data: {
          eventId: ctx.event.id,
          order: (last?.order ?? 0) + 1,
          name: input.name,
          opensAt: input.opensAt ? new Date(input.opensAt) : null,
          submissionDeadline: input.submissionDeadline ? new Date(input.submissionDeadline) : null,
          graceMinutes: input.graceMinutes,
          latePolicy: input.latePolicy,
          judgingDeadline: input.judgingDeadline ? new Date(input.judgingDeadline) : null,
          rankingScope: input.rankingScope,
          requiredEvaluations: input.requiredEvaluations,
          awardPositions: input.awardPositions,
        },
      });
      await writeAudit(tx, {
        ...auditBase(req),
        action: 'round.created',
        entityType: 'Round',
        entityId: r.id,
        after: roundDto(r),
      });
      return r;
    });
    res.status(201).json(roundDto(round));
  });

  router.patch('/rounds/:roundId', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const existing = await db.round.findFirst({
      where: { id: String(req.params.roundId), eventId: ctx.event.id },
    });
    if (!existing) throw AppError.notFound();
    const { reason, ...input } = parse(roundSchema, req.body);
    const deadlineChanged =
      (input.submissionDeadline ?? null) !== (existing.submissionDeadline?.toISOString() ?? null) ||
      (input.judgingDeadline ?? null) !== (existing.judgingDeadline?.toISOString() ?? null);
    if (deadlineChanged && (await roundHasSubmissions(db, existing.id)) && !reason) {
      throw AppError.invalid('Changing a deadline after submissions exist needs a reason', {
        reason: 'Give a reason for the change',
      });
    }
    const round = await db.$transaction(async (tx) => {
      const r = await tx.round.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          opensAt: input.opensAt ? new Date(input.opensAt) : null,
          submissionDeadline: input.submissionDeadline ? new Date(input.submissionDeadline) : null,
          graceMinutes: input.graceMinutes,
          latePolicy: input.latePolicy,
          judgingDeadline: input.judgingDeadline ? new Date(input.judgingDeadline) : null,
          rankingScope: input.rankingScope,
          requiredEvaluations: input.requiredEvaluations,
          awardPositions: input.awardPositions,
          version: { increment: 1 },
        },
      });
      await writeAudit(tx, {
        ...auditBase(req),
        action: 'round.updated',
        entityType: 'Round',
        entityId: r.id,
        before: roundDto(existing),
        after: roundDto(r),
        reason: reason ?? null,
      });
      return r;
    });
    res.json(roundDto(round));
  });

  router.delete('/rounds/:roundId', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const existing = await db.round.findFirst({
      where: { id: String(req.params.roundId), eventId: ctx.event.id },
    });
    if (!existing) throw AppError.notFound();
    if ((await db.round.count({ where: { eventId: ctx.event.id } })) <= 1) {
      throw AppError.conflict('last_round', 'An event needs at least one round');
    }
    if (await roundHasSubmissions(db, existing.id)) {
      throw AppError.conflict(
        'round_has_submissions',
        'This round has submissions and cannot be deleted',
      );
    }
    await db.$transaction(async (tx) => {
      await tx.round.delete({ where: { id: existing.id } });
      await writeAudit(tx, {
        ...auditBase(req),
        action: 'round.deleted',
        entityType: 'Round',
        entityId: existing.id,
        before: roundDto(existing),
      });
    });
    res.status(204).end();
  });

  return router;
}
