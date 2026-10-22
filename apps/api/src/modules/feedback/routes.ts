import { Router } from 'express';
import { z } from 'zod';
import {
  DEFAULT_FEEDBACK,
  feedbackFormSchema,
  validateFeedbackAnswers,
  type FeedbackQuestion,
} from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx, type EventContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { sendCsv, toCsv } from '../../exports/csv.js';
import { assertWritable } from '../events/service.js';
import { adminOnly, loadRound } from '../judging/common.js';
import { activeTeamOf } from '../teams/service.js';
import type { FeedbackAudience } from '../../generated/prisma/client.js';

const audienceSchema = z.enum(['PARTICIPANT', 'JUDGE']);
const roleOf = (a: FeedbackAudience) => (a === 'PARTICIPANT' ? 'PARTICIPANT' : 'JUDGE');

/** Feedback forms, responses and controlled release of judges' team comments (PRD Module H). */
export function feedbackRouter(deps: Deps) {
  const { db } = deps;
  const router = Router({ mergeParams: true });

  /** Every event has exactly two forms, created from the defaults on first use (PRD FR-210). */
  async function ensureForms(eventId: string) {
    for (const audience of ['PARTICIPANT', 'JUDGE'] as const) {
      await db.feedbackForm.upsert({
        where: { eventId_audience: { eventId, audience } },
        update: {},
        create: {
          eventId,
          audience,
          confidential: DEFAULT_FEEDBACK[audience].confidential,
          questions: DEFAULT_FEEDBACK[audience].questions,
        },
      });
    }
    return db.feedbackForm.findMany({ where: { eventId }, orderBy: { audience: 'asc' } });
  }

  const formDto = (f: Awaited<ReturnType<typeof ensureForms>>[number], responses: number) => ({
    audience: f.audience,
    state: f.state,
    confidential: f.confidential,
    closeAt: f.closeAt,
    version: f.version,
    questions: f.questions as unknown as FeedbackQuestion[],
    responses,
  });

  const isOpen = (f: { state: string; closeAt: Date | null }) =>
    f.state === 'OPEN' && (!f.closeAt || f.closeAt > new Date());

  // ── Admin: forms ──
  router.get('/feedback/forms', requireAction('feedbackForms.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    const forms = await ensureForms(ctx.event.id);
    const out = [];
    for (const f of forms) {
      const [responses, eligible] = await Promise.all([
        db.feedbackResponse.count({ where: { formId: f.id } }),
        eligibleCount(ctx, f.audience),
      ]);
      out.push({ ...formDto(f, responses), eligible });
    }
    res.json({ forms: out });
  });

  async function eligibleCount(ctx: EventContext, audience: FeedbackAudience) {
    return db.eventMembership.count({
      where: {
        eventId: ctx.event.id,
        role: roleOf(audience),
        status: 'ACTIVE',
        ...(audience === 'PARTICIPANT' ? { registration: { is: { status: 'ACTIVE' } } } : {}),
      },
    });
  }

  router.put(
    '/feedback/forms/:audience',
    requireAction('feedbackForms.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const audience = parse(audienceSchema, req.params.audience);
      const input = parse(feedbackFormSchema, req.body);
      const [form] = (await ensureForms(ctx.event.id)).filter((f) => f.audience === audience);
      const responses = await db.feedbackResponse.count({ where: { formId: form!.id } });
      const old = form!.questions as unknown as FeedbackQuestion[];
      if (responses > 0) {
        // With responses, questions cannot be deleted or change type; new ones must be optional (PRD FR-210).
        for (const q of old) {
          const next = input.questions.find((n) => n.id === q.id);
          if (!next)
            throw AppError.conflict(
              'form_locked',
              `Responses exist, so "${q.text}" cannot be deleted.`,
            );
          if (next.type !== q.type)
            throw AppError.conflict(
              'form_locked',
              `Responses exist, so the type of "${q.text}" cannot change.`,
            );
        }
        if (input.questions.some((n) => !old.some((q) => q.id === n.id) && n.required))
          throw AppError.conflict(
            'form_locked',
            'Questions added after responses exist must be optional.',
          );
        if (input.confidential !== form!.confidential)
          throw AppError.conflict(
            'form_locked',
            'The confidential setting is locked once responses exist.',
          );
      }
      const changedText = input.questions.filter((n) =>
        old.some((q) => q.id === n.id && q.text !== n.text),
      );
      const updated = await db.$transaction(async (tx) => {
        const f = await tx.feedbackForm.update({
          where: { id: form!.id },
          data: {
            questions: input.questions,
            confidential: input.confidential,
            closeAt: input.closeAt ? new Date(input.closeAt) : null,
            version: { increment: 1 },
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'feedback_form.updated',
          entityType: 'FeedbackForm',
          entityId: f.id,
          before: { questions: old.length, confidential: form!.confidential },
          after: {
            questions: input.questions.length,
            confidential: input.confidential,
            reworded: changedText.map((q) => q.id),
          },
        });
        return f;
      });
      res.json(formDto(updated, responses));
    },
  );

  router.post(
    '/feedback/forms/:audience/state',
    requireAction('feedbackForms.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const audience = parse(audienceSchema, req.params.audience);
      const { state } = parse(
        z.object({ state: z.enum(['DRAFT', 'OPEN', 'CLOSED']) }).strict(),
        req.body,
      );
      const [form] = (await ensureForms(ctx.event.id)).filter((f) => f.audience === audience);
      if (
        state === 'DRAFT' &&
        (await db.feedbackResponse.count({ where: { formId: form!.id } })) > 0
      )
        throw AppError.conflict(
          'has_responses',
          'Responses exist, so the form can only be opened or closed.',
        );
      await db.$transaction(async (tx) => {
        await tx.feedbackForm.update({ where: { id: form!.id }, data: { state } });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'feedback_form.state_changed',
          entityType: 'FeedbackForm',
          entityId: form!.id,
          before: { state: form!.state },
          after: { state },
        });
      });
      res.json({ state });
    },
  );

  // ── Respondents: the form they may answer, and submitting once ──
  router.get('/feedback/mine', requireAction('feedback.submit'), async (req, res) => {
    const ctx = requireCtx(req);
    const audience: FeedbackAudience = ctx.membership.role === 'JUDGE' ? 'JUDGE' : 'PARTICIPANT';
    const [form] = (await ensureForms(ctx.event.id)).filter((f) => f.audience === audience);
    const submitted = await db.feedbackResponse.findUnique({
      where: {
        formId_respondentMembershipId: {
          formId: form!.id,
          respondentMembershipId: ctx.membership.id,
        },
      },
    });
    const open = isOpen(form!);
    res.json({
      audience,
      available: open || Boolean(submitted),
      open,
      closed: form!.state === 'CLOSED' || Boolean(form!.closeAt && form!.closeAt <= new Date()),
      submitted: Boolean(submitted),
      submittedAt: submitted?.submittedAt ?? null,
      confidential: form!.confidential,
      questions: open && !submitted ? (form!.questions as unknown as FeedbackQuestion[]) : [],
    });
  });

  router.post('/feedback/responses', requireAction('feedback.submit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const { answers } = parse(
      z.object({ answers: z.record(z.string(), z.union([z.string(), z.number()])) }).strict(),
      req.body,
    );
    const audience: FeedbackAudience = ctx.membership.role === 'JUDGE' ? 'JUDGE' : 'PARTICIPANT';
    const [form] = (await ensureForms(ctx.event.id)).filter((f) => f.audience === audience);
    if (audience === 'PARTICIPANT') {
      const reg = await db.registration.findUnique({ where: { membershipId: ctx.membership.id } });
      if (!reg || reg.status !== 'ACTIVE') throw AppError.notFound();
    }
    if (form!.state !== 'OPEN')
      throw AppError.conflict(
        form!.state === 'CLOSED' ? 'feedback_closed' : 'feedback_not_open',
        form!.state === 'CLOSED' ? 'Feedback has closed' : "Feedback isn't open yet",
      );
    if (form!.closeAt && form!.closeAt <= new Date())
      throw AppError.conflict('feedback_closed', 'Feedback has closed');
    const { clean, errors } = validateFeedbackAnswers(
      form!.questions as unknown as FeedbackQuestion[],
      answers,
    );
    if (Object.keys(errors).length)
      throw AppError.invalid('Please fix the highlighted answers', errors);
    try {
      await db.$transaction(async (tx) => {
        await tx.feedbackResponse.create({
          data: { formId: form!.id, respondentMembershipId: ctx.membership.id, answers: clean },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'feedback.submitted',
          entityType: 'FeedbackForm',
          entityId: form!.id,
        });
      });
    } catch (err) {
      if (typeof err === 'object' && err && 'code' in err && err.code === 'P2002')
        throw AppError.conflict(
          'already_submitted',
          "You've already submitted feedback. Thank you!",
        );
      throw err;
    }
    res.status(201).json({ ok: true });
  });

  // ── Admin: aggregates, text answers and CSV. Confidential forms never reveal identity (PRD FR-213/214). ──
  async function aggregate(ctx: EventContext, audience: FeedbackAudience) {
    const [form] = (await ensureForms(ctx.event.id)).filter((f) => f.audience === audience);
    const responses = await db.feedbackResponse.findMany({
      where: { formId: form!.id },
      orderBy: { submittedAt: 'asc' },
    });
    const names = form!.confidential
      ? new Map()
      : new Map(
          (
            await db.eventMembership.findMany({
              where: { id: { in: responses.map((r) => r.respondentMembershipId) } },
              include: { user: true },
            })
          ).map((m) => [m.id, m.user.name]),
        );
    const eligible = await eligibleCount(ctx, audience);
    const questions = form!.questions as unknown as FeedbackQuestion[];
    return {
      audience,
      confidential: form!.confidential,
      eligible,
      responses: responses.length,
      rate: eligible ? responses.length / eligible : 0,
      questions: questions.map((q) => {
        const vals = responses
          .map((r) => (r.answers as Record<string, string | number>)[q.id])
          .filter((v) => v !== undefined);
        if (q.type === 'RATING') {
          const nums = vals as number[];
          return {
            id: q.id,
            text: q.text,
            type: q.type,
            count: nums.length,
            average: nums.length
              ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
              : null,
            distribution: [1, 2, 3, 4, 5].map((n) => nums.filter((x) => x === n).length),
          };
        }
        if (q.type === 'CHOICE')
          return {
            id: q.id,
            text: q.text,
            type: q.type,
            count: vals.length,
            counts: Object.fromEntries(
              (q.options ?? []).map((o) => [o, vals.filter((v) => v === o).length]),
            ),
          };
        return {
          id: q.id,
          text: q.text,
          type: q.type,
          count: vals.length,
          answers: vals.map(String),
        };
      }),
      rows: responses.map((r, i) => ({
        respondent: form!.confidential
          ? `Respondent ${i + 1}`
          : (names.get(r.respondentMembershipId) ?? 'Former member'),
        submittedAt: r.submittedAt,
        answers: r.answers as Record<string, string | number>,
      })),
      questionList: questions,
    };
  }

  router.get(
    '/feedback/results/:audience',
    requireAction('feedback.viewResponses'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      const a = await aggregate(ctx, parse(audienceSchema, req.params.audience));
      const { rows: _rows, questionList: _q, ...rest } = a;
      res.json(rest);
    },
  );

  router.get(
    '/feedback/results/:audience/export.csv',
    requireAction('feedback.viewResponses'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      const audience = parse(audienceSchema, req.params.audience);
      const a = await aggregate(ctx, audience);
      const csv = toCsv(
        ['Respondent', 'Submitted at', ...a.questionList.map((q) => q.text)],
        a.rows.map((r) => [
          r.respondent,
          r.submittedAt,
          ...a.questionList.map((q) => r.answers[q.id] ?? ''),
        ]),
      );
      await writeAudit(db, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'export.feedback',
        entityType: 'Export',
        after: { audience, rows: a.rows.length },
      });
      sendCsv(res, `${ctx.event.slug}-${audience.toLowerCase()}-feedback.csv`, csv);
    },
  );

  // ── Release of judges' team-facing comments, only after the round's results are published (FR-216, P1) ──
  async function commentRows(ctx: EventContext, roundId: string) {
    const evals = await db.evaluation.findMany({
      where: {
        status: 'SUBMITTED',
        teamComment: { not: null },
        assignment: { roundId, status: 'ACTIVE' },
      },
      include: { assignment: true },
      orderBy: { submittedAt: 'asc' },
    });
    const teams = await db.team.findMany({
      where: { id: { in: evals.map((e) => e.assignment.teamId) } },
    });
    const judges = await db.eventMembership.findMany({
      where: { id: { in: evals.map((e) => e.assignment.judgeMembershipId) } },
      include: { user: true },
    });
    return evals
      .filter((e) => (e.teamComment ?? '').trim())
      .map((e) => ({
        evaluationId: e.id,
        teamId: e.assignment.teamId,
        teamCode: teams.find((t) => t.id === e.assignment.teamId)?.teamCode ?? '',
        teamName: teams.find((t) => t.id === e.assignment.teamId)?.name ?? '',
        judgeName:
          judges.find((j) => j.id === e.assignment.judgeMembershipId)?.user.name ?? 'Judge',
        judgeMembershipId: e.assignment.judgeMembershipId,
        comment: e.teamComment!,
        hiddenReason: e.commentHiddenReason,
      }));
  }

  router.get(
    '/rounds/:roundId/comments',
    requireAction('feedbackForms.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const published =
        (await db.resultSnapshot.count({
          where: { roundId: round.id, publishedAt: { not: null }, unpublishedAt: null },
        })) > 0;
      res.json({
        released: Boolean(round.commentsReleasedAt),
        releasedAt: round.commentsReleasedAt,
        resultsPublished: published,
        comments: await commentRows(ctx, round.id),
      });
    },
  );

  router.post(
    '/rounds/:roundId/comments/release',
    requireAction('feedbackForms.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      const published = await db.resultSnapshot.count({
        where: { roundId: round.id, publishedAt: { not: null }, unpublishedAt: null },
      });
      if (!published)
        throw AppError.conflict(
          'results_not_published',
          "Publish this round's results before releasing judge comments.",
        );
      await db.$transaction(async (tx) => {
        await tx.round.update({
          where: { id: round.id },
          data: { commentsReleasedAt: new Date() },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'feedback.comments_released',
          entityType: 'Round',
          entityId: round.id,
        });
      });
      res.json({ released: true });
    },
  );

  router.post(
    '/rounds/:roundId/comments/withdraw',
    requireAction('feedbackForms.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const round = await loadRound(db, ctx, String(req.params.roundId));
      await db.$transaction(async (tx) => {
        await tx.round.update({ where: { id: round.id }, data: { commentsReleasedAt: null } });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'feedback.comments_withdrawn',
          entityType: 'Round',
          entityId: round.id,
        });
      });
      res.json({ released: false });
    },
  );

  router.put(
    '/evaluations/:evaluationId/comment-visibility',
    requireAction('feedbackForms.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const { hidden, reason } = parse(
        z.object({ hidden: z.boolean(), reason: z.string().trim().max(300).optional() }).strict(),
        req.body,
      );
      if (hidden && !(reason ?? '').trim())
        throw AppError.invalid('Give a reason for hiding this comment', {
          reason: 'A reason is required',
        });
      const ev = await db.evaluation.findFirst({
        where: { id: String(req.params.evaluationId), eventId: ctx.event.id },
      });
      if (!ev) throw AppError.notFound();
      await db.$transaction(async (tx) => {
        await tx.evaluation.update({
          where: { id: ev.id },
          data: { commentHiddenReason: hidden ? reason! : null },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: hidden ? 'feedback.comment_hidden' : 'feedback.comment_unhidden',
          entityType: 'Evaluation',
          entityId: ev.id,
          reason: reason ?? null,
        });
      });
      res.json({ ok: true });
    },
  );

  // A team sees only its own released comments, labelled Judge 1, Judge 2 … with no names (PRD FR-216).
  router.get('/feedback/team-comments', requireAction('judgeComments.view'), async (req, res) => {
    const ctx = requireCtx(req);
    if (ctx.membership.role !== 'PARTICIPANT') throw AppError.notFound();
    const mine = await activeTeamOf(db, ctx.event.id, ctx.membership.id);
    if (!mine) return void res.json({ rounds: [] });
    const rounds = await db.round.findMany({
      where: { eventId: ctx.event.id, commentsReleasedAt: { not: null } },
      orderBy: { order: 'asc' },
    });
    const out = [];
    for (const r of rounds) {
      const evals = await db.evaluation.findMany({
        where: {
          status: 'SUBMITTED',
          teamComment: { not: null },
          commentHiddenReason: null,
          assignment: { roundId: r.id, teamId: mine.teamId, status: 'ACTIVE' },
        },
        orderBy: { submittedAt: 'asc' },
      });
      out.push({
        roundId: r.id,
        roundName: r.name,
        comments: evals
          .filter((e) => (e.teamComment ?? '').trim())
          .map((e, i) => ({ label: `Judge ${i + 1}`, comment: e.teamComment! })),
      });
    }
    res.json({ rounds: out });
  });

  return router;
}
