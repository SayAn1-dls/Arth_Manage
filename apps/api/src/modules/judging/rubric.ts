import { Router } from 'express';
import { z } from 'zod';
import { RUBRIC_TEMPLATES, MAX_CRITERIA, validateRubricStructure } from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { assertWritable } from '../events/service.js';
import { adminOnly, isAdmin, loadRound } from './common.js';

const criterionInput = z
  .object({
    id: z.string().min(1).optional(),
    order: z.number().optional(),
    name: z.string().trim().max(60, 'Keep names to 60 characters'),
    description: z.string().trim().max(500, 'Keep descriptions to 500 characters').default(''),
    weight: z.number(),
    min: z.number(),
    max: z.number(),
  })
  .strict();

const rubricInput = z
  .object({
    name: z.string().trim().min(1, 'Name the rubric').max(80),
    teamCommentMode: z.enum(['OFF', 'OPTIONAL', 'REQUIRED']),
    criteria: z
      .array(criterionInput)
      .max(MAX_CRITERIA, `A rubric can have at most ${MAX_CRITERIA} criteria`),
  })
  .strict();

export function rubricRouter({ db }: Deps) {
  const router = Router({ mergeParams: true });

  async function rubricFor(roundId: string) {
    return db.rubric.findUnique({
      where: { roundId },
      include: { criteria: { orderBy: { order: 'asc' } } },
    });
  }
  const dto = (r: NonNullable<Awaited<ReturnType<typeof rubricFor>>>) => ({
    id: r.id,
    name: r.name,
    state: r.state,
    teamCommentMode: r.teamCommentMode,
    sourceTemplate: r.sourceTemplate,
    structureVersion: r.structureVersion,
    criteria: r.criteria.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      weight: c.weight,
      min: c.min,
      max: c.max,
      order: c.order,
    })),
    problems: validateRubricStructure(r.criteria),
  });

  router.get('/rounds/:roundId/templates', requireAction('rubric.edit'), (_req, res) => {
    res.json({ templates: RUBRIC_TEMPLATES });
  });

  // Admins see any state; judges see the active rubric only for rounds where they have an assignment.
  router.get('/rounds/:roundId/rubric', requireAction('rubric.view'), async (req, res) => {
    const ctx = requireCtx(req);
    const round = await loadRound(db, ctx, String(req.params.roundId));
    const rubric = await rubricFor(round.id);
    if (!isAdmin(ctx)) {
      const assigned = await db.judgeAssignment.count({
        where: {
          roundId: round.id,
          judgeMembershipId: ctx.membership.id,
          status: { not: 'UNASSIGNED' },
        },
      });
      if (!assigned || !rubric || rubric.state === 'DRAFT') throw AppError.notFound();
    }
    res.json({ rubric: rubric ? dto(rubric) : null });
  });

  router.post(
    '/rounds/:roundId/rubric/template',
    requireAction('rubric.edit'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const { key } = parse(
        z.object({ key: z.enum(['HACKATHON', 'CASE_COMPETITION']) }).strict(),
        req.body,
      );
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const existing = await rubricFor(round.id);
      if (existing && existing.state !== 'DRAFT')
        throw AppError.conflict(
          'rubric_not_draft',
          'This rubric is active. Deactivate it before replacing it with a template.',
        );
      const template = RUBRIC_TEMPLATES.find((t) => t.key === key)!;
      await db.$transaction(async (tx) => {
        if (existing) await tx.rubric.delete({ where: { id: existing.id } });
        await tx.rubric.create({
          data: {
            roundId: round.id,
            name: template.name,
            sourceTemplate: template.key,
            criteria: { create: template.criteria.map((c, i) => ({ ...c, order: i })) },
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'rubric.template_applied',
          entityType: 'Rubric',
          entityId: round.id,
          after: { template: key },
        });
      });
      res.status(201).json({ rubric: dto((await rubricFor(round.id))!) });
    },
  );

  // Draft rubrics may be saved invalid; activation is where every rule is enforced (PRD FR-143).
  router.put('/rounds/:roundId/rubric', requireAction('rubric.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const round = await loadRound(db, ctx, String(req.params.roundId));
    const input = parse(rubricInput, req.body);
    // Weights may total anything while drafting (they must total 100 to activate), but each criterion
    // must be individually sane so nothing nonsensical is ever stored (PRD FR-142).
    const rangeErrors: Record<string, string> = {};
    input.criteria.forEach((c, i) => {
      if (!c.name.trim()) rangeErrors[`criteria.${i}.name`] = 'Every criterion needs a name';
      if (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 100)
        rangeErrors[`criteria.${i}.weight`] = 'Enter a whole number from 1 to 100';
      if (c.min !== 0 && c.min !== 1)
        rangeErrors[`criteria.${i}.min`] = 'The lowest score must be 0 or 1';
      if (!Number.isInteger(c.max) || c.max <= c.min || c.max > 100)
        rangeErrors[`criteria.${i}.max`] =
          `The highest score must be a whole number above ${c.min} and at most 100`;
    });
    if (Object.keys(rangeErrors).length)
      throw AppError.invalid('Please fix the highlighted criteria', rangeErrors);
    const existing = await rubricFor(round.id);
    if (existing && existing.state !== 'DRAFT')
      throw AppError.conflict(
        'rubric_not_draft',
        existing.state === 'LOCKED'
          ? 'Evaluations exist. Unlock the rubric to change its structure.'
          : 'Deactivate the rubric to change it.',
      );

    const saved = await db.$transaction(async (tx) => {
      const rubric = existing
        ? await tx.rubric.update({
            where: { id: existing.id },
            data: {
              name: input.name,
              teamCommentMode: input.teamCommentMode,
              structureVersion: { increment: 1 },
            },
          })
        : await tx.rubric.create({
            data: { roundId: round.id, name: input.name, teamCommentMode: input.teamCommentMode },
          });
      const keep = new Set(input.criteria.map((c) => c.id).filter(Boolean) as string[]);
      const old = new Map((existing?.criteria ?? []).map((c) => [c.id, c]));
      for (const id of keep)
        if (!old.has(id))
          throw AppError.invalid('Unknown criterion', {
            criteria: 'A criterion does not belong to this rubric',
          });
      await tx.rubricCriterion.deleteMany({
        where: { rubricId: rubric.id, id: { notIn: [...keep] } },
      });
      // Rename through temporary names so swapping two names cannot trip the unique constraint.
      for (const [i, c] of input.criteria.entries()) {
        const data = {
          description: c.description,
          weight: Math.trunc(c.weight),
          min: Math.trunc(c.min),
          max: Math.trunc(c.max),
          order: i,
        };
        if (c.id) {
          const prev = old.get(c.id)!;
          await tx.rubricCriterion.update({
            where: { id: c.id },
            data: { ...data, name: `__tmp_${i}_${c.id}` },
          });
          // A changed range invalidates that criterion's old scores; unchanged criteria keep theirs (pre-filled on reopen).
          if (prev.min !== data.min || prev.max !== data.max)
            await tx.criterionScore.deleteMany({ where: { criterionId: c.id } });
        } else {
          await tx.rubricCriterion.create({
            data: {
              ...data,
              rubricId: rubric.id,
              name: `__new_${i}_${Math.random().toString(36).slice(2)}`,
            },
          });
        }
      }
      const rows = await tx.rubricCriterion.findMany({
        where: { rubricId: rubric.id },
        orderBy: { order: 'asc' },
      });
      for (const [i, row] of rows.entries())
        await tx.rubricCriterion.update({
          where: { id: row.id },
          data: { name: input.criteria[i]!.name },
        });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'rubric.updated',
        entityType: 'Rubric',
        entityId: rubric.id,
        before:
          existing?.criteria.map((c) => ({
            name: c.name,
            weight: c.weight,
            min: c.min,
            max: c.max,
          })) ?? null,
        after: input.criteria.map((c) => ({
          name: c.name,
          weight: c.weight,
          min: c.min,
          max: c.max,
        })),
      });
      return rubric;
    });
    res.json({ rubric: dto((await rubricFor(saved.roundId))!) });
  });

  router.post(
    '/rounds/:roundId/rubric/activate',
    requireAction('rubric.edit'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const rubric = await rubricFor(round.id);
      if (!rubric)
        throw AppError.conflict('no_rubric', 'Choose a template or build a rubric first');
      if (rubric.state !== 'DRAFT')
        throw AppError.conflict('not_draft', 'This rubric is already active');
      const problems = validateRubricStructure(rubric.criteria);
      if (problems.length) throw AppError.conflict('rubric_invalid', problems[0]!, { problems });
      await db.$transaction(async (tx) => {
        await tx.rubric.update({ where: { id: rubric.id }, data: { state: 'ACTIVE' } });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'rubric.activated',
          entityType: 'Rubric',
          entityId: rubric.id,
        });
      });
      res.json({ rubric: dto((await rubricFor(round.id))!) });
    },
  );

  router.post(
    '/rounds/:roundId/rubric/deactivate',
    requireAction('rubric.edit'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const rubric = await rubricFor(round.id);
      if (!rubric || rubric.state !== 'ACTIVE')
        throw AppError.conflict('not_active', 'Only an active rubric can be deactivated');
      if (round.judgingStatus === 'OPEN')
        throw AppError.conflict('judging_open', 'Close judging before changing the rubric');
      if ((await db.evaluation.count({ where: { assignment: { roundId: round.id } } })) > 0) {
        throw AppError.conflict(
          'evaluations_exist',
          'Judges have started scoring, so use Unlock instead once an evaluation is submitted.',
        );
      }
      await db.$transaction(async (tx) => {
        await tx.rubric.update({ where: { id: rubric.id }, data: { state: 'DRAFT' } });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'rubric.deactivated',
          entityType: 'Rubric',
          entityId: rubric.id,
        });
      });
      res.json({ rubric: dto((await rubricFor(round.id))!) });
    },
  );

  // Unlocking reopens every submitted evaluation; judges re-score, unchanged criteria stay pre-filled (PRD FR-153).
  router.post('/rounds/:roundId/rubric/unlock', requireAction('rubric.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const round = await loadRound(db, ctx, String(req.params.roundId));
    const rubric = await rubricFor(round.id);
    if (!rubric || rubric.state !== 'LOCKED')
      throw AppError.conflict('not_locked', 'Only a locked rubric can be unlocked');
    const { reason } = parse(
      z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) }).strict(),
      req.body,
    );
    const reopened = await db.$transaction(async (tx) => {
      const r = await tx.evaluation.updateMany({
        where: { status: 'SUBMITTED', assignment: { roundId: round.id } },
        data: { status: 'REOPENED', correctionReason: null, correctionRequestedAt: null },
      });
      await tx.rubric.update({
        where: { id: rubric.id },
        data: { state: 'DRAFT', structureVersion: { increment: 1 } },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'rubric.unlocked',
        entityType: 'Rubric',
        entityId: rubric.id,
        after: { reopenedEvaluations: r.count },
        reason,
      });
      return r.count;
    });
    res.json({ rubric: dto((await rubricFor(round.id))!), reopened });
  });

  // Descriptions are plain guidance and stay editable while locked; the change is logged and affects no score.
  router.patch(
    '/rounds/:roundId/rubric/criteria/:criterionId',
    requireAction('rubric.edit'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const { description } = parse(
        z.object({ description: z.string().trim().max(500) }).strict(),
        req.body,
      );
      const criterion = await db.rubricCriterion.findFirst({
        where: { id: String(req.params.criterionId), rubric: { roundId: round.id } },
      });
      if (!criterion) throw AppError.notFound();
      await db.$transaction(async (tx) => {
        await tx.rubricCriterion.update({ where: { id: criterion.id }, data: { description } });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'rubric.description_edited',
          entityType: 'RubricCriterion',
          entityId: criterion.id,
          before: { description: criterion.description },
          after: { description },
        });
      });
      res.json({ ok: true });
    },
  );

  return router;
}
