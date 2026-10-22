import express, { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import {
  draftSchema,
  extensionSchema,
  overrideSchema,
  submissionFormSchema,
  submitSchema,
  type FormFieldDto,
} from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx, type EventContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { checkUpload, extensionOf, safeFilename } from '../../storage/validate.js';
import { assertWritable } from '../events/service.js';
import { judgeMayViewTeam } from '../judging/common.js';
import { activeTeamOf } from '../teams/service.js';
import { cutoffFor, decideSubmit, submissionStatus, STATUS_LABEL } from './logic.js';
import {
  assertFilesBelong,
  hasDraftContent,
  roundTiming,
  validateDraftShape,
  validateForSubmit,
  type DraftValues,
} from './service.js';

const fieldDto = (f: {
  id: string;
  type: FormFieldDto['type'];
  label: string;
  helpText: string | null;
  required: boolean;
  order: number;
  allowedExtensions: string[];
  maxMb: number;
}): FormFieldDto => ({
  id: f.id,
  type: f.type,
  label: f.label,
  helpText: f.helpText,
  required: f.required,
  order: f.order,
  allowedExtensions: f.allowedExtensions,
  maxMb: f.maxMb,
});

function when(date: Date, tz: string) {
  const d = new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${d}, ${t} ${tz === 'Asia/Kolkata' ? 'IST' : tz}`;
}

export function submissionsRouter(deps: Deps) {
  const { db, storage, email, env } = deps;
  const router = Router({ mergeParams: true });

  async function loadRound(ctx: EventContext, roundId: string) {
    const round = await db.round.findFirst({
      where: { id: roundId, eventId: ctx.event.id },
      include: { formFields: { orderBy: { order: 'asc' } } },
    });
    if (!round) throw AppError.notFound();
    return round;
  }

  /** The participant's own team and its submission row for the round (created lazily on first save). */
  async function ownTeam(ctx: EventContext) {
    if (ctx.membership.role !== 'PARTICIPANT') throw AppError.notFound();
    const m = await activeTeamOf(db, ctx.event.id, ctx.membership.id);
    if (!m || m.team.status === 'DISQUALIFIED')
      throw AppError.conflict('no_team', 'Create or join a team before you start a submission');
    return m.team;
  }

  async function view(
    ctx: EventContext,
    round: Awaited<ReturnType<typeof loadRound>>,
    teamId: string,
    audience: 'team' | 'admin',
  ) {
    const submission = await db.submission.findUnique({
      where: { roundId_teamId: { roundId: round.id, teamId } },
      include: { versions: { orderBy: { versionNo: 'desc' } } },
    });
    const team = await db.team.findUniqueOrThrow({
      where: { id: teamId },
      include: { members: { where: { leftAt: null } } },
    });
    const timing = roundTiming(round);
    const now = new Date();
    const last = submission?.versions[0];
    const status = submissionStatus(
      timing,
      submission?.extensionDeadline ?? null,
      submission
        ? {
            hasDraftContent: hasDraftContent(submission),
            lastVersionNo: submission.lastVersionNo,
            lastVersionLateMinutes: last?.lateMinutes ?? 0,
          }
        : null,
      now,
    );
    const cutoff = cutoffFor(timing, submission?.extensionDeadline ?? null);
    const decision = decideSubmit(timing, submission?.extensionDeadline ?? null, now);
    const files = submission
      ? await db.submissionFile.findMany({
          where: { submissionId: submission.id },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const names = new Map(
      (
        await db.registration.findMany({
          where: {
            eventId: ctx.event.id,
            membershipId: { in: submission?.versions.map((v) => v.submittedByMembershipId) ?? [] },
          },
        })
      ).map((r) => [r.membershipId, r.fullName]),
    );
    const draftValues = (submission?.draftValues ?? {}) as DraftValues;
    return {
      round: {
        id: round.id,
        name: round.name,
        opensAt: round.opensAt,
        submissionDeadline: round.submissionDeadline,
        graceMinutes: round.graceMinutes,
        latePolicy: round.latePolicy,
      },
      fields: round.formFields.map(fieldDto),
      status,
      statusLabel: STATUS_LABEL[status],
      cutoff,
      editable: decision.allowed,
      closedReason: decision.allowed
        ? null
        : decision.reason === 'not_open'
          ? `Submissions open ${when(round.opensAt!, ctx.event.timeZone)}`
          : `The deadline passed at ${when(cutoff!, ctx.event.timeZone)}. Contact the organisers if you believe this is an error.`,
      extensionDeadline: audience === 'admin' ? (submission?.extensionDeadline ?? null) : undefined,
      minSizeOverride: audience === 'admin' ? (submission?.minSizeOverride ?? false) : undefined,
      team: {
        id: team.id,
        teamCode: team.teamCode,
        name: team.name,
        size: team.members.length,
        min: ctx.event.teamMin,
        complete: team.members.length >= ctx.event.teamMin,
      },
      draft: {
        title: submission?.draftTitle ?? '',
        summary: submission?.draftSummary ?? '',
        values: draftValues,
        version: submission?.draftVersion ?? 1,
        hasUnsubmittedChanges: Boolean(
          submission &&
          submission.lastVersionNo > 0 &&
          JSON.stringify({
            t: submission.draftTitle,
            s: submission.draftSummary,
            v: draftValues,
          }) !== JSON.stringify({ t: last?.title, s: last?.summary, v: last?.values }),
        ),
      },
      files: files.map((f) => ({
        id: f.id,
        fieldId: f.fieldId,
        name: f.originalName,
        size: f.sizeBytes,
        uploadedAt: f.createdAt,
      })),
      versions: (submission?.versions ?? []).map((v) => ({
        versionNo: v.versionNo,
        title: v.title,
        summary: v.summary,
        values: v.values,
        submittedAt: v.submittedAt,
        submittedBy: names.get(v.submittedByMembershipId) ?? 'A team member',
        lateMinutes: v.lateMinutes,
      })),
    };
  }

  // ─────────── Participant: own team's submission ───────────

  router.get('/rounds/:roundId/submission', requireAction('submission.view'), async (req, res) => {
    const ctx = requireCtx(req);
    const round = await loadRound(ctx, String(req.params.roundId));
    const team = await ownTeam(ctx);
    res.json(await view(ctx, round, team.id, 'team'));
  });

  async function writableSubmission(ctx: EventContext, roundId: string) {
    assertWritable(ctx);
    const round = await loadRound(ctx, roundId);
    const team = await ownTeam(ctx);
    const submission = await db.submission.findUnique({
      where: { roundId_teamId: { roundId, teamId: team.id } },
    });
    const decision = decideSubmit(
      roundTiming(round),
      submission?.extensionDeadline ?? null,
      new Date(),
    );
    if (!decision.allowed) {
      const cutoff = cutoffFor(roundTiming(round), submission?.extensionDeadline ?? null);
      throw AppError.conflict(
        decision.reason === 'not_open' ? 'round_not_open' : 'deadline_passed',
        decision.reason === 'not_open'
          ? `Submissions open ${when(round.opensAt!, ctx.event.timeZone)}`
          : `Submissions closed at ${when(cutoff!, ctx.event.timeZone)}.`,
      );
    }
    return { round, team, submission };
  }

  router.put(
    '/rounds/:roundId/submission/draft',
    requireAction('submission.edit'),
    async (req, res) => {
      const ctx = requireCtx(req);
      const { round, team, submission } = await writableSubmission(ctx, String(req.params.roundId));
      const input = parse(draftSchema, req.body);
      const errors = validateDraftShape(round.formFields, input.title, input.summary, input.values);
      if (Object.keys(errors).length)
        throw AppError.invalid('Please fix the highlighted fields', errors);

      const saved = await db.$transaction(async (tx) => {
        let s =
          submission ??
          (await tx.submission.upsert({
            where: { roundId_teamId: { roundId: round.id, teamId: team.id } },
            update: {},
            create: { eventId: ctx.event.id, roundId: round.id, teamId: team.id },
          }));
        await assertFilesBelong(tx, s.id, round.formFields, input.values);
        const r = await tx.submission.updateMany({
          where: { id: s.id, draftVersion: input.version },
          data: {
            draftTitle: input.title,
            draftSummary: input.summary,
            draftValues: input.values,
            draftVersion: { increment: 1 },
            draftUpdatedAt: new Date(),
          },
        });
        if (r.count === 0)
          throw AppError.conflict(
            'stale_version',
            'A teammate changed this draft. Reload to see the latest version before editing.',
          );
        s = await tx.submission.findUniqueOrThrow({ where: { id: s.id } });
        return s;
      });
      res.json({ version: saved.draftVersion, savedAt: saved.draftUpdatedAt });
    },
  );

  // Raw body upload: the file is the request body, the name travels in X-Filename (no multipart dependency).
  router.put(
    '/rounds/:roundId/submission/files/:fieldId',
    requireAction('submission.upload'),
    express.raw({ type: () => true, limit: '51mb' }),
    async (req, res) => {
      const ctx = requireCtx(req);
      const { round, team, submission } = await writableSubmission(ctx, String(req.params.roundId));
      const field = round.formFields.find((f) => f.id === String(req.params.fieldId));
      if (!field || field.type !== 'FILE') throw AppError.notFound();
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const filename = safeFilename(decodeURIComponent(String(req.get('x-filename') ?? 'file')));
      const check = checkUpload({
        filename,
        bytes,
        allowedExtensions: field.allowedExtensions,
        maxMb: field.maxMb,
      });
      if (!check.ok)
        throw AppError.invalid(check.message, { [`values.${field.id}`]: check.message });

      const key = `events/${ctx.event.id}/submissions/${randomUUID()}.${extensionOf(filename) || check.extension}`;
      await storage.put(key, bytes);
      const saved = await db.$transaction(async (tx) => {
        const s =
          submission ??
          (await tx.submission.upsert({
            where: { roundId_teamId: { roundId: round.id, teamId: team.id } },
            update: {},
            create: { eventId: ctx.event.id, roundId: round.id, teamId: team.id },
          }));
        const file = await tx.submissionFile.create({
          data: {
            eventId: ctx.event.id,
            submissionId: s.id,
            fieldId: field.id,
            storageKey: key,
            originalName: filename,
            sizeBytes: bytes.length,
            contentType: contentTypeFor(check.extension),
            sha256: createHash('sha256').update(bytes).digest('hex'),
            uploadedByMembershipId: ctx.membership.id,
          },
        });
        const values = { ...((s.draftValues as DraftValues) ?? {}), [field.id]: file.id };
        const updated = await tx.submission.update({
          where: { id: s.id },
          data: { draftValues: values, draftVersion: { increment: 1 }, draftUpdatedAt: new Date() },
        });
        return { file, version: updated.draftVersion };
      });
      res.status(201).json({
        file: {
          id: saved.file.id,
          fieldId: field.id,
          name: saved.file.originalName,
          size: saved.file.sizeBytes,
        },
        version: saved.version,
      });
    },
  );

  router.post(
    '/rounds/:roundId/submission/submit',
    requireAction('submission.edit'),
    async (req, res) => {
      const ctx = requireCtx(req);
      const { round, team, submission } = await writableSubmission(ctx, String(req.params.roundId));
      const { version } = parse(submitSchema, req.body);
      if (!submission)
        throw AppError.invalid('There is nothing to submit yet. Fill in the form first.');

      // Team completeness and required choices (PRD FR-065)
      const size = await db.teamMember.count({ where: { teamId: team.id, leftAt: null } });
      if (size < ctx.event.teamMin && !submission.minSizeOverride) {
        throw AppError.conflict(
          'team_incomplete',
          `Your team needs at least ${ctx.event.teamMin} members to submit. Contact the organisers.`,
        );
      }
      if (
        ctx.event.trackRequired &&
        !team.trackId &&
        (await db.track.count({ where: { eventId: ctx.event.id } })) > 0
      ) {
        throw AppError.conflict('track_required', 'Choose a track first');
      }

      const values = (submission.draftValues ?? {}) as DraftValues;
      const { errors, missing } = validateForSubmit(
        round.formFields,
        submission.draftTitle,
        submission.draftSummary,
        values,
      );
      if (Object.keys(errors).length) {
        throw AppError.invalid(
          `Complete the required fields: ${[...new Set(missing)].join(', ')}`,
          errors,
        );
      }
      await assertFilesBelong(db, submission.id, round.formFields, values);

      const decision = decideSubmit(roundTiming(round), submission.extensionDeadline, new Date());
      if (!decision.allowed) throw AppError.conflict('deadline_passed', 'Submissions are closed');

      const created = await db.$transaction(async (tx) => {
        // Lock the row: concurrent submits (double click, two teammates) serialise here.
        const locked = await tx.$queryRaw<
          { draftVersion: number; lastVersionNo: number }[]
        >`SELECT "draftVersion", "lastVersionNo" FROM "Submission" WHERE id = ${submission.id} FOR UPDATE`;
        if (!locked[0] || locked[0].draftVersion !== version) {
          throw AppError.conflict(
            'already_submitted',
            locked[0] && locked[0].lastVersionNo > 0
              ? 'This draft was already submitted, or a teammate changed it. Reload to see the current state.'
              : 'The draft changed. Reload and review it before submitting.',
          );
        }
        const v = await tx.submissionVersion.create({
          data: {
            submissionId: submission.id,
            eventId: ctx.event.id,
            versionNo: locked[0].lastVersionNo + 1,
            title: submission.draftTitle.trim(),
            summary: submission.draftSummary.trim(),
            values,
            submittedAt: new Date(),
            submittedByMembershipId: ctx.membership.id,
            lateMinutes: decision.lateMinutes,
          },
        });
        await tx.submission.update({
          where: { id: submission.id },
          data: { lastVersionNo: v.versionNo, draftVersion: { increment: 1 } },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'submission.submitted',
          entityType: 'Submission',
          entityId: submission.id,
          after: {
            teamId: team.id,
            roundId: round.id,
            versionNo: v.versionNo,
            lateMinutes: v.lateMinutes,
          },
        });
        return v;
      });

      // Receipt to every member (PRD FR-070). A mail failure never undoes the submission.
      try {
        const members = await db.teamMember.findMany({
          where: { teamId: team.id, leftAt: null },
          include: { membership: { include: { user: true } } },
        });
        await Promise.all(
          members.map((m) =>
            email.send({
              to: m.membership.user.email,
              subject: `Submission received for ${team.name}`,
              body: `${team.name} (${team.teamCode}) submitted version ${created.versionNo} for ${round.name} at ${when(created.submittedAt, ctx.event.timeZone)}.`,
              link: `${env.APP_BASE_URL}/events/${ctx.event.id}`,
            }),
          ),
        );
      } catch (err) {
        deps.logger.warn({ err }, 'submission receipt email failed');
      }
      res.status(201).json({
        versionNo: created.versionNo,
        submittedAt: created.submittedAt,
        lateMinutes: created.lateMinutes,
      });
    },
  );

  router.post(
    '/rounds/:roundId/submission/discard-draft',
    requireAction('submission.edit'),
    async (req, res) => {
      const ctx = requireCtx(req);
      const { round, submission } = await writableSubmission(ctx, String(req.params.roundId));
      if (!submission || submission.lastVersionNo === 0)
        throw AppError.conflict('no_version', 'There is no submitted version to restore');
      const last = await db.submissionVersion.findUniqueOrThrow({
        where: {
          submissionId_versionNo: {
            submissionId: submission.id,
            versionNo: submission.lastVersionNo,
          },
        },
      });
      await db.submission.update({
        where: { id: submission.id },
        data: {
          draftTitle: last.title,
          draftSummary: last.summary,
          draftValues: last.values as DraftValues,
          draftVersion: { increment: 1 },
        },
      });
      const team = await ownTeam(ctx);
      res.json(await view(ctx, round, team.id, 'team'));
    },
  );

  // ─────────── File download: permission checked on every request ───────────

  router.get('/files/:fileId', requireAction('submission.view'), async (req, res) => {
    const ctx = requireCtx(req);
    const file = await db.submissionFile.findFirst({
      where: { id: String(req.params.fileId), eventId: ctx.event.id },
      include: { submission: true },
    });
    if (!file) throw AppError.notFound();
    if (ctx.membership.role === 'PARTICIPANT') {
      const mine = await activeTeamOf(db, ctx.event.id, ctx.membership.id);
      if (!mine || mine.teamId !== file.submission.teamId) throw AppError.notFound();
    } else if (ctx.membership.role === 'JUDGE') {
      const assigned = await judgeMayViewTeam(
        db,
        ctx.membership.id,
        file.submission.roundId,
        file.submission.teamId,
      );
      if (!assigned) throw AppError.notFound();
      // Judges see only files of the version being judged, never a team's unsubmitted draft files.
      const judged = await db.submissionVersion.findFirst({
        where: { submissionId: file.submissionId, versionNo: file.submission.lastVersionNo },
      });
      if (!judged || !Object.values(judged.values as Record<string, string>).includes(file.id))
        throw AppError.notFound();
    } // ADMIN: FULL
    const bytes = await storage.get(file.storageKey);
    const inlinePdf = req.query.inline === '1' && file.contentType === 'application/pdf';
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `${inlinePdf ? 'inline' : 'attachment'}; filename="${file.originalName.replace(/"/g, '')}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(bytes);
  });

  // ─────────── Core Admin: form definition, monitoring, extensions ───────────

  router.get('/rounds/:roundId/form', requireAction('event.view'), async (req, res) => {
    const ctx = requireCtx(req);
    const round = await loadRound(ctx, String(req.params.roundId));
    res.json({ fields: round.formFields.map(fieldDto) });
  });

  router.put('/rounds/:roundId/form', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const round = await loadRound(ctx, String(req.params.roundId));
    const input = parse(submissionFormSchema, req.body);
    const hasVersions =
      (await db.submissionVersion.count({ where: { submission: { roundId: round.id } } })) > 0;
    const existing = new Map(round.formFields.map((f) => [f.id, f]));
    const keep = new Set(input.fields.map((f) => f.id).filter(Boolean) as string[]);
    for (const f of input.fields) {
      if (f.id && !existing.has(f.id))
        throw AppError.invalid('Unknown field', {
          fields: 'A field does not belong to this round',
        });
      if (f.id && hasVersions && existing.get(f.id)!.type !== f.type)
        throw AppError.conflict('form_locked', 'A field type cannot change once submissions exist');
    }
    const removed = round.formFields.filter((f) => !keep.has(f.id));
    if (hasVersions && removed.length)
      throw AppError.conflict(
        'form_locked',
        'Fields cannot be removed once submissions exist. Make them optional instead.',
      );
    if (hasVersions && input.fields.some((f) => !f.id && f.required))
      throw AppError.conflict(
        'form_locked',
        'New fields added after submissions exist must be optional.',
      );

    await db.$transaction(async (tx) => {
      await tx.submissionFormField.deleteMany({ where: { id: { in: removed.map((f) => f.id) } } });
      // Rename through temporary labels first so swapping two labels cannot trip the unique constraint.
      for (const [i, f] of input.fields.entries()) {
        const data = {
          type: f.type,
          helpText: f.helpText ?? null,
          required: f.required,
          order: i,
          allowedExtensions: f.type === 'FILE' ? f.allowedExtensions : [],
          maxMb: f.maxMb,
        };
        if (f.id)
          await tx.submissionFormField.update({
            where: { id: f.id },
            data: { ...data, label: `__tmp_${i}_${f.id}` },
          });
        else
          await tx.submissionFormField.create({
            data: { roundId: round.id, label: `__new_${i}_${randomUUID()}`, ...data },
          });
      }
      const all = await tx.submissionFormField.findMany({
        where: { roundId: round.id },
        orderBy: { order: 'asc' },
      });
      for (const [i, row] of all.entries())
        await tx.submissionFormField.update({
          where: { id: row.id },
          data: { label: input.fields[i]!.label },
        });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'round.form_updated',
        entityType: 'Round',
        entityId: round.id,
        before: round.formFields.map((f) => f.label),
        after: input.fields.map((f) => f.label),
      });
    });
    const fresh = await db.submissionFormField.findMany({
      where: { roundId: round.id },
      orderBy: { order: 'asc' },
    });
    res.json({ fields: fresh.map(fieldDto) });
  });

  router.get('/rounds/:roundId/submissions', requireAction('submission.view'), async (req, res) => {
    const ctx = requireCtx(req);
    if (ctx.membership.role !== 'ADMIN') throw AppError.notFound();
    const round = await loadRound(ctx, String(req.params.roundId));
    const q = String(req.query.q ?? '')
      .trim()
      .toLowerCase();
    const statusFilter = String(req.query.status ?? '');
    const teams = await db.team.findMany({
      where: { eventId: ctx.event.id, status: { not: 'DISSOLVED' } },
      include: {
        members: { where: { leftAt: null } },
        submissions: {
          where: { roundId: round.id },
          include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
        },
      },
      orderBy: { teamCode: 'asc' },
    });
    const now = new Date();
    let rows = teams.map((t) => {
      const s = t.submissions[0];
      const last = s?.versions[0];
      const status = submissionStatus(
        roundTiming(round),
        s?.extensionDeadline ?? null,
        s
          ? {
              hasDraftContent: hasDraftContent(s),
              lastVersionNo: s.lastVersionNo,
              lastVersionLateMinutes: last?.lateMinutes ?? 0,
            }
          : null,
        now,
      );
      return {
        teamId: t.id,
        teamCode: t.teamCode,
        name: t.name,
        size: t.members.length,
        complete: t.members.length >= ctx.event.teamMin,
        disqualified: t.status === 'DISQUALIFIED',
        status,
        statusLabel: STATUS_LABEL[status],
        lastVersionNo: s?.lastVersionNo ?? 0,
        lastSubmittedAt: last?.submittedAt ?? null,
        lateMinutes: last?.lateMinutes ?? 0,
        extensionDeadline: s?.extensionDeadline ?? null,
        minSizeOverride: s?.minSizeOverride ?? false,
      };
    });
    if (q)
      rows = rows.filter(
        (r) => r.name.toLowerCase().includes(q) || r.teamCode.toLowerCase().includes(q),
      );
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    res.json({ rows, total: rows.length });
  });

  router.get(
    '/rounds/:roundId/submissions/:teamId',
    requireAction('submission.view'),
    async (req, res) => {
      const ctx = requireCtx(req);
      if (ctx.membership.role !== 'ADMIN') throw AppError.notFound();
      const round = await loadRound(ctx, String(req.params.roundId));
      const team = await db.team.findFirst({
        where: { id: String(req.params.teamId), eventId: ctx.event.id },
      });
      if (!team) throw AppError.notFound();
      res.json(await view(ctx, round, team.id, 'admin'));
    },
  );

  router.put(
    '/rounds/:roundId/submissions/:teamId/extension',
    requireAction('submission.unlock'),
    async (req, res) => {
      const ctx = requireCtx(req);
      assertWritable(ctx);
      const round = await loadRound(ctx, String(req.params.roundId));
      const team = await db.team.findFirst({
        where: { id: String(req.params.teamId), eventId: ctx.event.id },
      });
      if (!team) throw AppError.notFound();
      const { deadline, reason } = parse(extensionSchema, req.body);
      const existing = await db.submission.findUnique({
        where: { roundId_teamId: { roundId: round.id, teamId: team.id } },
      });
      const saved = await db.$transaction(async (tx) => {
        const s = await tx.submission.upsert({
          where: { roundId_teamId: { roundId: round.id, teamId: team.id } },
          update: { extensionDeadline: new Date(deadline), extensionReason: reason },
          create: {
            eventId: ctx.event.id,
            roundId: round.id,
            teamId: team.id,
            extensionDeadline: new Date(deadline),
            extensionReason: reason,
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'submission.extended',
          entityType: 'Submission',
          entityId: s.id,
          before: { extensionDeadline: existing?.extensionDeadline ?? null },
          after: { extensionDeadline: s.extensionDeadline, teamId: team.id },
          reason,
        });
        return s;
      });
      res.json({ extensionDeadline: saved.extensionDeadline });
    },
  );

  router.put(
    '/rounds/:roundId/submissions/:teamId/override',
    requireAction('submission.unlock'),
    async (req, res) => {
      const ctx = requireCtx(req);
      assertWritable(ctx);
      const round = await loadRound(ctx, String(req.params.roundId));
      const team = await db.team.findFirst({
        where: { id: String(req.params.teamId), eventId: ctx.event.id },
      });
      if (!team) throw AppError.notFound();
      const { enabled, reason } = parse(overrideSchema, req.body);
      await db.$transaction(async (tx) => {
        const s = await tx.submission.upsert({
          where: { roundId_teamId: { roundId: round.id, teamId: team.id } },
          update: { minSizeOverride: enabled },
          create: {
            eventId: ctx.event.id,
            roundId: round.id,
            teamId: team.id,
            minSizeOverride: enabled,
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'submission.min_size_override',
          entityType: 'Submission',
          entityId: s.id,
          after: { enabled, teamId: team.id },
          reason,
        });
      });
      res.json({ minSizeOverride: enabled });
    },
  );

  return router;
}

function contentTypeFor(ext: string): string {
  return (
    {
      pdf: 'application/pdf',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      zip: 'application/zip',
    }[ext] ?? 'application/octet-stream'
  );
}
