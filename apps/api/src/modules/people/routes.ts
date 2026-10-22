import { Router } from 'express';
import {
  adminCreateTeamSchema,
  adminUpdateRegistrationSchema,
  membershipRefSchema,
  reasonSchema,
  registrationFieldSchema,
  updateRegistrationSchema,
  updateTeamSchema,
} from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx, type EventContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { assertWritable } from '../events/service.js';
import { effectiveRegistration } from '../events/registrationState.js';
import { validateAnswers } from '../registration/service.js';
import {
  activeTeamOf,
  createTeamTx,
  isUniqueViolation,
  removeMemberTx,
  teamDto,
} from '../teams/service.js';
import { sendCsv, toCsv } from '../../exports/csv.js';
import { hasCertificate } from '../events/usage.js';
import { submissionStatus, STATUS_LABEL } from '../submissions/logic.js';
import { hasDraftContent, roundTiming } from '../submissions/service.js';

type ParticipantStatus = 'Registered' | 'In team' | 'Withdrawn' | 'Removed';

/** Core Admin people management and participant self-service profile (PRD A.3, FR-016..022, FR-056). */
export function peopleRouter(deps: Deps) {
  const { db } = deps;
  const router = Router({ mergeParams: true });
  const admin = (req: Parameters<typeof requireCtx>[0]) => {
    const ctx = requireCtx(req);
    if (ctx.membership.role !== 'ADMIN') throw AppError.notFound();
    assertWritable(ctx);
    return ctx;
  };
  const adminRead = (req: Parameters<typeof requireCtx>[0]) => {
    const ctx = requireCtx(req);
    if (ctx.membership.role !== 'ADMIN') throw AppError.notFound();
    return ctx;
  };

  // ─────────── Registration field definitions (PRD FR-015) ───────────

  router.get('/registration-fields', requireAction('event.view'), async (req, res) => {
    const ctx = requireCtx(req);
    const fields = await db.registrationFieldDef.findMany({
      where: {
        eventId: ctx.event.id,
        ...(ctx.membership.role === 'ADMIN' ? {} : { hidden: false }),
      },
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
    });
    res.json({ fields });
  });

  router.post('/registration-fields', requireAction('event.edit'), async (req, res) => {
    const ctx = admin(req);
    const input = parse(registrationFieldSchema, req.body);
    if ((await db.registrationFieldDef.count({ where: { eventId: ctx.event.id } })) >= 10)
      throw AppError.invalid('An event can have at most 10 custom fields');
    if (input.required && (await db.registration.count({ where: { eventId: ctx.event.id } })) > 0) {
      throw AppError.conflict(
        'registrations_exist',
        'Fields added after people have registered must be optional.',
      );
    }
    if (
      await db.registrationFieldDef.findUnique({
        where: { eventId_label: { eventId: ctx.event.id, label: input.label } },
      })
    ) {
      throw AppError.invalid('A field with this label already exists', {
        label: 'Labels must be unique',
      });
    }
    const field = await db.$transaction(async (tx) => {
      const f = await tx.registrationFieldDef.create({
        data: {
          eventId: ctx.event.id,
          label: input.label,
          type: input.type,
          helpText: input.helpText ?? null,
          options: input.options,
          required: input.required,
          hidden: input.hidden,
          order: input.order ?? 0,
        },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'registration_field.created',
        entityType: 'RegistrationFieldDef',
        entityId: f.id,
        after: { label: f.label, type: f.type },
      });
      return f;
    });
    res.status(201).json(field);
  });

  router.patch('/registration-fields/:fieldId', requireAction('event.edit'), async (req, res) => {
    const ctx = admin(req);
    const existing = await db.registrationFieldDef.findFirst({
      where: { id: String(req.params.fieldId), eventId: ctx.event.id },
    });
    if (!existing) throw AppError.notFound();
    const input = parse(registrationFieldSchema, req.body);
    const hasData = (await db.registration.count({ where: { eventId: ctx.event.id } })) > 0;
    if (hasData && input.required && !existing.required)
      throw AppError.conflict(
        'registrations_exist',
        'This field can no longer become required after people have registered.',
      );
    const dup = await db.registrationFieldDef.findFirst({
      where: { eventId: ctx.event.id, label: input.label, NOT: { id: existing.id } },
    });
    if (dup)
      throw AppError.invalid('A field with this label already exists', {
        label: 'Labels must be unique',
      });
    const field = await db.$transaction(async (tx) => {
      const f = await tx.registrationFieldDef.update({
        where: { id: existing.id },
        data: {
          label: input.label,
          type: hasData ? existing.type : input.type,
          helpText: input.helpText ?? null,
          options: input.options,
          required: input.required,
          hidden: input.hidden,
          order: input.order ?? existing.order,
        },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'registration_field.updated',
        entityType: 'RegistrationFieldDef',
        entityId: f.id,
        before: { label: existing.label, hidden: existing.hidden },
        after: { label: f.label, hidden: f.hidden },
      });
      return f;
    });
    res.json(field);
  });

  router.delete('/registration-fields/:fieldId', requireAction('event.edit'), async (req, res) => {
    const ctx = admin(req);
    const existing = await db.registrationFieldDef.findFirst({
      where: { id: String(req.params.fieldId), eventId: ctx.event.id },
    });
    if (!existing) throw AppError.notFound();
    // Fields that already hold data can be hidden but never deleted (PRD FR-015).
    if ((await db.registration.count({ where: { eventId: ctx.event.id } })) > 0) {
      throw AppError.conflict(
        'registrations_exist',
        'This field may hold answers, so it can only be hidden, not deleted.',
      );
    }
    await db.$transaction(async (tx) => {
      await tx.registrationFieldDef.delete({ where: { id: existing.id } });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'registration_field.deleted',
        entityType: 'RegistrationFieldDef',
        entityId: existing.id,
        before: { label: existing.label },
      });
    });
    res.status(204).end();
  });

  // ─────────── Participant: own registration profile (PRD FR-056) ───────────

  router.get('/registration/me', requireAction('participants.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    if (ctx.membership.role !== 'PARTICIPANT') throw AppError.notFound();
    const reg = await db.registration.findUnique({ where: { membershipId: ctx.membership.id } });
    if (!reg) throw AppError.notFound();
    const fields = await db.registrationFieldDef.findMany({
      where: { eventId: ctx.event.id, hidden: false },
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
    });
    const open = effectiveRegistration(ctx.event) === 'OPEN';
    const locked = await hasCertificate(db, ctx.membership.id);
    res.json({
      registration: {
        fullName: reg.fullName,
        phone: reg.phone,
        institution: reg.institution,
        course: reg.course,
        yearOfStudy: reg.yearOfStudy,
        certificateName: reg.certificateName,
        answers: reg.answers,
        version: reg.version,
        status: reg.status,
      },
      fields: fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        helpText: f.helpText,
        options: f.options,
        required: f.required,
      })),
      editable: open ? 'all' : locked ? 'none' : 'phone_and_certificate_name',
    });
  });

  router.patch('/registration/me', requireAction('participants.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    if (ctx.membership.role !== 'PARTICIPANT') throw AppError.notFound();
    const input = parse(updateRegistrationSchema, req.body);
    const reg = await db.registration.findUnique({ where: { membershipId: ctx.membership.id } });
    if (!reg) throw AppError.notFound();
    const open = effectiveRegistration(ctx.event) === 'OPEN';
    const locked = await hasCertificate(db, ctx.membership.id);
    const { version, ...changes } = input;
    // After registration closes only phone and the certificate name stay editable, until certificates exist.
    const allowed = open ? Object.keys(changes) : locked ? [] : ['phone', 'certificateName'];
    const blocked = Object.keys(changes).filter((k) => !allowed.includes(k));
    if (blocked.length) {
      throw AppError.invalid(
        'Contact the organisers to correct these details',
        Object.fromEntries(
          blocked.map((k) => [k, 'Read-only now. Contact the organisers to correct it.']),
        ),
      );
    }
    const data: Record<string, unknown> = { ...changes };
    if (changes.answers) {
      const defs = await db.registrationFieldDef.findMany({ where: { eventId: ctx.event.id } });
      const { clean, errors } = validateAnswers(defs, changes.answers);
      if (Object.keys(errors).length)
        throw AppError.invalid('Please fix the highlighted fields', errors);
      data.answers = clean;
    }
    const updated = await db.$transaction(async (tx) => {
      const r = await tx.registration.updateMany({
        where: { id: reg.id, version },
        data: { ...data, version: { increment: 1 } },
      });
      if (r.count === 0)
        throw AppError.conflict(
          'stale_version',
          'Your details changed in another tab. Reload to see the latest version.',
        );
      const after = await tx.registration.findUniqueOrThrow({ where: { id: reg.id } });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'registration.updated',
        entityType: 'Registration',
        entityId: reg.id,
        before: pickChanged(reg, changes),
        after: pickChanged(after, changes),
      });
      return after;
    });
    res.json({ version: updated.version });
  });

  // ─────────── Admin: participants (PRD FR-016, FR-019, FR-020) ───────────

  function participantStatus(m: {
    status: string;
    registration: { status: string } | null;
    teamMembers: unknown[];
  }): ParticipantStatus {
    if (m.status === 'REMOVED') return 'Removed';
    if (m.registration?.status === 'WITHDRAWN') return 'Withdrawn';
    return m.teamMembers.length > 0 ? 'In team' : 'Registered';
  }

  async function participantRows(ctx: EventContext) {
    const rows = await db.eventMembership.findMany({
      where: { eventId: ctx.event.id, role: 'PARTICIPANT' },
      include: {
        user: true,
        registration: true,
        teamMembers: {
          where: { leftAt: null, team: { status: { not: 'DISSOLVED' } } },
          include: { team: true },
        },
      },
    });
    return rows.map((m) => ({
      membershipId: m.id,
      name: m.registration?.fullName ?? m.user.name,
      email: m.user.email,
      phone: m.registration?.phone ?? '',
      institution: m.registration?.institution ?? '',
      course: m.registration?.course ?? '',
      yearOfStudy: m.registration?.yearOfStudy ?? '',
      certificateName: m.registration?.certificateName ?? '',
      status: participantStatus(m),
      teamId: m.teamMembers[0]?.teamId ?? null,
      teamCode: m.teamMembers[0]?.team.teamCode ?? '',
      teamName: m.teamMembers[0]?.team.name ?? '',
      registeredAt: m.registration?.createdAt ?? m.createdAt,
      answers: (m.registration?.answers ?? {}) as Record<string, unknown>,
    }));
  }

  const SORTS = ['name', 'email', 'institution', 'status', 'teamCode', 'registeredAt'] as const;

  router.get('/participants', requireAction('participants.manage'), async (req, res) => {
    const ctx = adminRead(req);
    const q = String(req.query.q ?? '')
      .trim()
      .toLowerCase();
    const status = String(req.query.status ?? '');
    const team = String(req.query.team ?? '');
    const sort = (SORTS as readonly string[]).includes(String(req.query.sort))
      ? (String(req.query.sort) as (typeof SORTS)[number])
      : 'name';
    const dir = req.query.dir === 'desc' ? -1 : 1;
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50) || 50));

    let rows = await participantRows(ctx);
    if (q)
      rows = rows.filter((r) =>
        [r.name, r.email, r.phone, r.teamName, r.teamCode, r.institution].some((v) =>
          v.toLowerCase().includes(q),
        ),
      );
    if (status) rows = rows.filter((r) => r.status === status);
    if (team === 'none') rows = rows.filter((r) => !r.teamId);
    if (team === 'in') rows = rows.filter((r) => r.teamId);
    rows.sort((a, b) => {
      const x = a[sort],
        y = b[sort];
      return (
        (x instanceof Date && y instanceof Date
          ? x.getTime() - y.getTime()
          : String(x).localeCompare(String(y), undefined, { sensitivity: 'base' })) * dir
      );
    });
    res.json({
      total: rows.length,
      page,
      pageSize,
      rows: rows.slice((page - 1) * pageSize, page * pageSize).map(({ answers: _a, ...r }) => r),
    });
  });

  router.get(
    '/participants/:membershipId',
    requireAction('participants.manage'),
    async (req, res) => {
      const ctx = adminRead(req);
      const m = await db.eventMembership.findFirst({
        where: { id: String(req.params.membershipId), eventId: ctx.event.id, role: 'PARTICIPANT' },
        include: {
          user: true,
          registration: true,
          teamMembers: {
            where: { leftAt: null, team: { status: { not: 'DISSOLVED' } } },
            include: { team: true },
          },
        },
      });
      if (!m) throw AppError.notFound();
      const fields = await db.registrationFieldDef.findMany({
        where: { eventId: ctx.event.id },
        orderBy: [{ order: 'asc' }, { label: 'asc' }],
      });
      res.json({
        membershipId: m.id,
        email: m.user.email,
        status: participantStatus(m),
        membershipStatus: m.status,
        registration: m.registration && {
          fullName: m.registration.fullName,
          phone: m.registration.phone,
          institution: m.registration.institution,
          course: m.registration.course,
          yearOfStudy: m.registration.yearOfStudy,
          certificateName: m.registration.certificateName,
          answers: m.registration.answers,
          version: m.registration.version,
          registeredAt: m.registration.createdAt,
        },
        team: m.teamMembers[0]
          ? {
              id: m.teamMembers[0].teamId,
              teamCode: m.teamMembers[0].team.teamCode,
              name: m.teamMembers[0].team.name,
              role: m.teamMembers[0].role,
            }
          : null,
        fields: fields.map((f) => ({
          id: f.id,
          label: f.label,
          type: f.type,
          options: f.options,
          required: f.required,
          hidden: f.hidden,
        })),
      });
    },
  );

  router.patch(
    '/participants/:membershipId',
    requireAction('participants.manage'),
    async (req, res) => {
      const ctx = admin(req);
      const m = await db.eventMembership.findFirst({
        where: { id: String(req.params.membershipId), eventId: ctx.event.id, role: 'PARTICIPANT' },
        include: { registration: true },
      });
      if (!m?.registration) throw AppError.notFound();
      const input = parse(adminUpdateRegistrationSchema, req.body);
      const { version, ...changes } = input;
      const data: Record<string, unknown> = { ...changes };
      if (changes.answers) {
        const defs = await db.registrationFieldDef.findMany({ where: { eventId: ctx.event.id } });
        const { clean, errors } = validateAnswers(defs, changes.answers, { partial: true });
        if (Object.keys(errors).length)
          throw AppError.invalid('Please fix the highlighted fields', errors);
        data.answers = clean;
      }
      const reg = m.registration;
      await db.$transaction(async (tx) => {
        const r = await tx.registration.updateMany({
          where: { id: reg.id, version },
          data: { ...data, version: { increment: 1 } },
        });
        if (r.count === 0)
          throw AppError.conflict(
            'stale_version',
            'This record was changed by someone else. Reload to see the latest version.',
          );
        const after = await tx.registration.findUniqueOrThrow({ where: { id: reg.id } });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'participant.corrected',
          entityType: 'Registration',
          entityId: reg.id,
          before: pickChanged(reg, changes),
          after: pickChanged(after, changes),
        });
        // A changed certificate name after certificates exist marks them for regeneration (Phase 6 reads this audit trail).
      });
      res.json({ ok: true });
    },
  );

  router.post(
    '/participants/:membershipId/remove',
    requireAction('participants.manage'),
    async (req, res) => {
      const ctx = admin(req);
      const { reason } = parse(reasonSchema, req.body);
      const m = await db.eventMembership.findFirst({
        where: { id: String(req.params.membershipId), eventId: ctx.event.id, role: 'PARTICIPANT' },
      });
      if (!m) throw AppError.notFound();
      await db.$transaction(async (tx) => {
        const t = await tx.teamMember.findFirst({
          where: {
            eventId: ctx.event.id,
            membershipId: m.id,
            leftAt: null,
            team: { status: { not: 'DISSOLVED' } },
          },
        });
        if (t) {
          const others = await tx.teamMember.count({
            where: { teamId: t.teamId, leftAt: null, NOT: { id: t.id } },
          });
          if (t.role === 'LEADER' && others > 0)
            throw AppError.conflict(
              'leader_must_transfer',
              'This participant leads a team with other members. Choose a new leader first.',
            );
          await removeMemberTx(tx, ctx.event, t.teamId, m.id, { actorId: ctx.membership.userId });
        }
        await tx.eventMembership.update({ where: { id: m.id }, data: { status: 'REMOVED' } });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'participant.removed',
          entityType: 'EventMembership',
          entityId: m.id,
          reason,
        });
      });
      res.json({ ok: true });
    },
  );

  // ─────────── Admin: teams (PRD FR-017, FR-018, FR-020) ───────────

  router.get('/teams', requireAction('team.view'), async (req, res) => {
    const ctx = adminRead(req);
    const q = String(req.query.q ?? '')
      .trim()
      .toLowerCase();
    const complete = String(req.query.complete ?? '');
    const trackId = String(req.query.trackId ?? '');
    const problemId = String(req.query.problemId ?? '');
    const status = String(req.query.status ?? '');
    const roundId = String(req.query.roundId ?? '');
    const submissionStatusFilter = String(req.query.submission ?? '');
    const sort = String(req.query.sort ?? 'teamCode');
    const dir = req.query.dir === 'desc' ? -1 : 1;
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50) || 50));

    const round = roundId
      ? await db.round.findFirst({ where: { id: roundId, eventId: ctx.event.id } })
      : await db.round.findFirst({ where: { eventId: ctx.event.id }, orderBy: { order: 'asc' } });
    const teams = await db.team.findMany({
      where: {
        eventId: ctx.event.id,
        ...(status
          ? { status: status as 'ACTIVE' | 'DISSOLVED' | 'DISQUALIFIED' }
          : { status: { not: 'DISSOLVED' } }),
      },
      include: {
        track: true,
        problem: true,
        members: {
          where: { leftAt: null },
          include: { membership: { include: { user: true, registration: true } } },
        },
        submissions: {
          where: { roundId: round?.id ?? '__none__' },
          include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
        },
      },
    });
    const now = new Date();
    let rows = teams.map((t) => {
      const s = t.submissions[0];
      const last = s?.versions[0];
      const sub = round
        ? submissionStatus(
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
          )
        : 'NOT_STARTED';
      const leader = t.members.find((m) => m.role === 'LEADER');
      return {
        id: t.id,
        teamCode: t.teamCode,
        name: t.name,
        status: t.status,
        leader: leader?.membership.registration?.fullName ?? leader?.membership.user.name ?? '',
        size: t.members.length,
        complete: t.members.length >= ctx.event.teamMin,
        trackId: t.trackId,
        trackName: t.track?.name ?? '',
        problemId: t.problemId,
        problemTitle: t.problem?.title ?? '',
        submissionStatus: sub,
        submissionLabel: STATUS_LABEL[sub],
        search: [
          t.name,
          t.teamCode,
          ...t.members.flatMap((m) => [
            m.membership.user.email,
            m.membership.registration?.fullName ?? '',
            m.membership.registration?.phone ?? '',
          ]),
        ]
          .join(' ')
          .toLowerCase(),
      };
    });
    if (q) rows = rows.filter((r) => r.search.includes(q));
    if (complete === 'yes') rows = rows.filter((r) => r.complete);
    if (complete === 'no') rows = rows.filter((r) => !r.complete);
    if (trackId) rows = rows.filter((r) => r.trackId === trackId);
    if (problemId) rows = rows.filter((r) => r.problemId === problemId);
    if (submissionStatusFilter)
      rows = rows.filter((r) => r.submissionStatus === submissionStatusFilter);
    const key =
      (['teamCode', 'name', 'leader', 'size', 'trackName', 'submissionStatus'] as const).find(
        (k) => k === sort,
      ) ?? 'teamCode';
    rows.sort(
      (a, b) =>
        (typeof a[key] === 'number'
          ? (a[key] as number) - (b[key] as number)
          : String(a[key]).localeCompare(String(b[key]), undefined, {
              sensitivity: 'base',
              numeric: true,
            })) * dir,
    );
    res.json({
      total: rows.length,
      page,
      pageSize,
      round: round ? { id: round.id, name: round.name } : null,
      rows: rows.slice((page - 1) * pageSize, page * pageSize).map(({ search: _s, ...r }) => r),
    });
  });

  router.get('/teams/:teamId', requireAction('team.view'), async (req, res) => {
    const ctx = adminRead(req);
    const team = await db.team.findFirst({
      where: { id: String(req.params.teamId), eventId: ctx.event.id },
    });
    if (!team) throw AppError.notFound();
    const dto = await teamDto(db, ctx.event, team.id, {
      role: 'ADMIN',
      membershipId: ctx.membership.id,
    });
    const regs = await db.registration.findMany({
      where: { membershipId: { in: dto.members.map((m) => m.membershipId) } },
    });
    const phones = new Map(regs.map((r) => [r.membershipId, r.phone]));
    const history = await db.auditLog.findMany({
      where: { eventId: ctx.event.id, entityType: 'Team', entityId: team.id },
      orderBy: { at: 'desc' },
      take: 50,
    });
    res.json({
      ...dto,
      joinCode: team.joinCode,
      members: dto.members.map((m) => ({ ...m, phone: phones.get(m.membershipId) ?? null })),
      history: history.map((h) => ({
        action: h.action,
        at: h.at,
        before: h.before,
        after: h.after,
        reason: h.reason,
      })),
    });
  });

  // Participants create their own teams through the self-service route that follows this router.
  router.post('/teams', requireAction('team.edit'), async (req, res, next) => {
    if (requireCtx(req).membership.role === 'PARTICIPANT') return next('router');
    const ctx = admin(req);
    const input = parse(adminCreateTeamSchema, req.body);
    const ids = [input.leaderMembershipId, ...input.memberMembershipIds];
    if (ids.length > ctx.event.teamMax)
      throw AppError.invalid(`A team can have at most ${ctx.event.teamMax} members`);
    if (new Set(ids).size !== ids.length)
      throw AppError.invalid('A person can only be listed once');
    try {
      const team = await db.$transaction(async (tx) => {
        const regs = await tx.eventMembership.findMany({
          where: {
            id: { in: ids },
            eventId: ctx.event.id,
            role: 'PARTICIPANT',
            status: 'ACTIVE',
            registration: { is: { status: 'ACTIVE' } },
          },
        });
        if (regs.length !== ids.length)
          throw AppError.invalid('Every member must be a registered participant of this event');
        const t = await createTeamTx(tx, ctx.event, input.leaderMembershipId, input.name);
        for (const id of input.memberMembershipIds)
          await tx.teamMember.create({
            data: { teamId: t.id, eventId: ctx.event.id, membershipId: id, role: 'MEMBER' },
          });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'team.created_by_admin',
          entityType: 'Team',
          entityId: t.id,
          after: { name: t.name, members: ids.length },
        });
        return t;
      });
      res
        .status(201)
        .json(
          await teamDto(db, ctx.event, team.id, { role: 'ADMIN', membershipId: ctx.membership.id }),
        );
    } catch (err) {
      mapTeamConflict(err);
      throw err;
    }
  });

  router.patch('/teams/:teamId', requireAction('team.edit'), async (req, res) => {
    const ctx = admin(req);
    const team = await db.team.findFirst({
      where: { id: String(req.params.teamId), eventId: ctx.event.id },
    });
    if (!team) throw AppError.notFound();
    const input = parse(updateTeamSchema, req.body);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.trackId !== undefined) {
      if (
        input.trackId &&
        !(await db.track.findFirst({ where: { id: input.trackId, eventId: ctx.event.id } }))
      )
        throw AppError.invalid('That track does not belong to this event', {
          trackId: 'Choose a track from this event',
        });
      data.trackId = input.trackId;
    }
    if (input.problemId !== undefined) {
      if (
        input.problemId &&
        !(await db.problemStatement.findFirst({
          where: { id: input.problemId, eventId: ctx.event.id },
        }))
      )
        throw AppError.invalid('That problem statement does not belong to this event', {
          problemId: 'Choose a statement from this event',
        });
      data.problemId = input.problemId;
    }
    try {
      await db.$transaction(async (tx) => {
        const r = await tx.team.updateMany({
          where: { id: team.id, version: input.version },
          data: { ...data, version: { increment: 1 } },
        });
        if (r.count === 0)
          throw AppError.conflict(
            'stale_version',
            'This team was changed by someone else. Reload to see the latest version.',
          );
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'team.updated_by_admin',
          entityType: 'Team',
          entityId: team.id,
          before: { name: team.name, trackId: team.trackId, problemId: team.problemId },
          after: data,
        });
      });
    } catch (err) {
      mapTeamConflict(err);
      throw err;
    }
    res.json(
      await teamDto(db, ctx.event, team.id, { role: 'ADMIN', membershipId: ctx.membership.id }),
    );
  });

  router.post('/teams/:teamId/members', requireAction('team.edit'), async (req, res) => {
    const ctx = admin(req);
    const team = await db.team.findFirst({
      where: { id: String(req.params.teamId), eventId: ctx.event.id, status: { not: 'DISSOLVED' } },
    });
    if (!team) throw AppError.notFound();
    const { membershipId } = parse(membershipRefSchema, req.body);
    try {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Team" WHERE id = ${team.id} FOR UPDATE`;
        const m = await tx.eventMembership.findFirst({
          where: {
            id: membershipId,
            eventId: ctx.event.id,
            role: 'PARTICIPANT',
            status: 'ACTIVE',
            registration: { is: { status: 'ACTIVE' } },
          },
        });
        if (!m)
          throw AppError.invalid('Choose a registered participant of this event', {
            membershipId: 'Not a registered participant',
          });
        const current = await activeTeamOf(tx, ctx.event.id, membershipId);
        if (current)
          throw AppError.conflict(
            'already_in_team',
            `This participant is already in ${current.team.name} (${current.team.teamCode}).`,
            { teamId: current.teamId },
          );
        const size = await tx.teamMember.count({ where: { teamId: team.id, leftAt: null } });
        if (size >= ctx.event.teamMax)
          throw AppError.conflict(
            'team_full',
            `${team.name} is full (${size}/${ctx.event.teamMax}). The maximum size is never exceeded.`,
          );
        await tx.teamMember.create({
          data: {
            teamId: team.id,
            eventId: ctx.event.id,
            membershipId,
            role: size === 0 ? 'LEADER' : 'MEMBER',
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'team.member_added_by_admin',
          entityType: 'Team',
          entityId: team.id,
          after: { membershipId },
        });
      });
    } catch (err) {
      mapTeamConflict(err);
      throw err;
    }
    res.json(
      await teamDto(db, ctx.event, team.id, { role: 'ADMIN', membershipId: ctx.membership.id }),
    );
  });

  router.delete(
    '/teams/:teamId/members/:membershipId',
    requireAction('team.edit'),
    async (req, res) => {
      const ctx = admin(req);
      const team = await db.team.findFirst({
        where: {
          id: String(req.params.teamId),
          eventId: ctx.event.id,
          status: { not: 'DISSOLVED' },
        },
      });
      if (!team) throw AppError.notFound();
      await db.$transaction(async (tx) => {
        await removeMemberTx(tx, ctx.event, team.id, String(req.params.membershipId), {
          actorId: ctx.membership.userId,
          allowLeaderRemoval: true,
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'team.member_removed_by_admin',
          entityType: 'Team',
          entityId: team.id,
          after: { membershipId: String(req.params.membershipId) },
        });
      });
      res.json({ ok: true });
    },
  );

  router.post('/teams/:teamId/leader', requireAction('team.edit'), async (req, res) => {
    const ctx = admin(req);
    const team = await db.team.findFirst({
      where: { id: String(req.params.teamId), eventId: ctx.event.id, status: { not: 'DISSOLVED' } },
    });
    if (!team) throw AppError.notFound();
    const { membershipId } = parse(membershipRefSchema, req.body);
    await db.$transaction(async (tx) => {
      const target = await tx.teamMember.findFirst({
        where: { teamId: team.id, eventId: ctx.event.id, membershipId, leftAt: null },
      });
      if (!target) throw AppError.invalid('Choose a current member of this team');
      await tx.teamMember.updateMany({
        where: { teamId: team.id, leftAt: null, role: 'LEADER' },
        data: { role: 'MEMBER' },
      });
      await tx.teamMember.update({ where: { id: target.id }, data: { role: 'LEADER' } });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'team.leader_changed_by_admin',
        entityType: 'Team',
        entityId: team.id,
        after: { membershipId },
      });
    });
    res.json(
      await teamDto(db, ctx.event, team.id, { role: 'ADMIN', membershipId: ctx.membership.id }),
    );
  });

  router.post('/teams/:teamId/disqualify', requireAction('team.edit'), async (req, res) => {
    const ctx = admin(req);
    const { reason } = parse(reasonSchema, req.body);
    const team = await db.team.findFirst({
      where: { id: String(req.params.teamId), eventId: ctx.event.id, status: 'ACTIVE' },
    });
    if (!team) throw AppError.notFound();
    await db.$transaction(async (tx) => {
      await tx.team.update({
        where: { id: team.id },
        data: { status: 'DISQUALIFIED', disqualifiedReason: reason, version: { increment: 1 } },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'team.disqualified',
        entityType: 'Team',
        entityId: team.id,
        reason,
      });
    });
    res.json(
      await teamDto(db, ctx.event, team.id, { role: 'ADMIN', membershipId: ctx.membership.id }),
    );
  });

  router.post('/teams/:teamId/reinstate', requireAction('team.edit'), async (req, res) => {
    const ctx = admin(req);
    const { reason } = parse(reasonSchema, req.body);
    const team = await db.team.findFirst({
      where: { id: String(req.params.teamId), eventId: ctx.event.id, status: 'DISQUALIFIED' },
    });
    if (!team) throw AppError.notFound();
    await db.$transaction(async (tx) => {
      await tx.team.update({
        where: { id: team.id },
        data: { status: 'ACTIVE', disqualifiedReason: null, version: { increment: 1 } },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'team.reinstated',
        entityType: 'Team',
        entityId: team.id,
        reason,
      });
    });
    res.json(
      await teamDto(db, ctx.event, team.id, { role: 'ADMIN', membershipId: ctx.membership.id }),
    );
  });

  // ─────────── CSV exports (PRD FR-039; admin only, audited) ───────────

  router.get('/exports/participants.csv', requireAction('export.csv'), async (req, res) => {
    const ctx = adminRead(req);
    const rows = await participantRows(ctx);
    const defs = await db.registrationFieldDef.findMany({
      where: { eventId: ctx.event.id, hidden: false },
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
    });
    const csv = toCsv(
      [
        'Name',
        'Email',
        'Phone',
        'Institution',
        'Course',
        'Year of study',
        'Name on certificate',
        'Status',
        'Team ID',
        'Team',
        'Registered at',
        ...defs.map((d) => d.label),
      ],
      rows.map((r) => [
        r.name,
        r.email,
        r.phone,
        r.institution,
        r.course,
        r.yearOfStudy,
        r.certificateName,
        r.status,
        r.teamCode,
        r.teamName,
        r.registeredAt,
        ...defs.map((d) => r.answers[d.id] ?? ''),
      ]),
    );
    await writeAudit(db, {
      eventId: ctx.event.id,
      actorId: ctx.membership.userId,
      action: 'export.participants',
      entityType: 'Export',
      after: { rows: rows.length },
    });
    sendCsv(res, `${ctx.event.slug}-participants.csv`, csv);
  });

  router.get('/exports/teams.csv', requireAction('export.csv'), async (req, res) => {
    const ctx = adminRead(req);
    const teams = await db.team.findMany({
      where: { eventId: ctx.event.id, status: { not: 'DISSOLVED' } },
      include: {
        track: true,
        problem: true,
        members: {
          where: { leftAt: null },
          include: { membership: { include: { user: true, registration: true } } },
        },
      },
      orderBy: { teamCode: 'asc' },
    });
    const csv = toCsv(
      [
        'Team ID',
        'Team',
        'Status',
        'Members',
        'Complete',
        'Track',
        'Problem statement',
        'Leader',
        'Member emails',
      ],
      teams.map((t) => [
        t.teamCode,
        t.name,
        t.status,
        t.members.length,
        t.members.length >= ctx.event.teamMin ? 'Yes' : 'No',
        t.track?.name ?? '',
        t.problem?.title ?? '',
        t.members.find((m) => m.role === 'LEADER')?.membership.registration?.fullName ?? '',
        t.members.map((m) => m.membership.user.email).join('; '),
      ]),
    );
    await writeAudit(db, {
      eventId: ctx.event.id,
      actorId: ctx.membership.userId,
      action: 'export.teams',
      entityType: 'Export',
      after: { rows: teams.length },
    });
    sendCsv(res, `${ctx.event.slug}-teams.csv`, csv);
  });

  return router;
}

function pickChanged(row: object, changes: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(changes)) out[k] = (row as Record<string, unknown>)[k];
  return out;
}

function mapTeamConflict(err: unknown) {
  if (isUniqueViolation(err, 'team_name_unique_per_event') || isUniqueViolation(err, 'lower')) {
    throw AppError.invalid('A team with this name already exists', {
      name: 'A team with this name already exists',
    });
  }
  if (isUniqueViolation(err))
    throw AppError.conflict(
      'already_in_team',
      'This participant is already in a team for this event.',
    );
}
