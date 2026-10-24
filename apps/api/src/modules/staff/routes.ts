import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx, type EventContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { assertWritable } from '../events/service.js';
import { adminOnly, isAdmin } from '../judging/common.js';

const taskInput = z
  .object({
    title: z.string().trim().min(1, 'Give the task a title').max(120),
    description: z.string().trim().max(1000).nullish(),
    type: z.enum(['CHECKIN', 'VERIFICATION', 'GENERAL']),
    dueAt: z.iso.datetime({ offset: true }).nullish(),
    location: z.string().trim().max(120).nullish(),
    assigneeMembershipIds: z
      .array(z.string().min(1))
      .min(1, 'Assign the task to at least one staff member')
      .max(30),
    teamIds: z.array(z.string().min(1)).max(50).default([]),
  })
  .strict();

const statusInput = z
  .object({
    status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED']),
    note: z.string().trim().max(300).nullish(),
  })
  .strict();
const issueInput = z
  .object({
    category: z.enum(['REGISTRATION_MISMATCH', 'TECHNICAL', 'FACILITIES', 'CONDUCT', 'OTHER']),
    description: z.string().trim().min(1, 'Describe the problem').max(2000),
    teamId: z.string().min(1).nullish(),
    severity: z.enum(['NORMAL', 'URGENT']).default('NORMAL'),
  })
  .strict();

type TeamRow = { id: string; teamCode: string; name: string };

/** Helping-staff operations: tasks, team lookup and check-in, issue reports (PRD Module D, FR-120..130). */
export function staffRouter(deps: Deps) {
  const { db } = deps;
  const router = Router({ mergeParams: true });

  async function checkAssignees(ctx: EventContext, ids: string[]) {
    const staff = await db.eventMembership.findMany({
      where: { id: { in: ids }, eventId: ctx.event.id, role: 'STAFF', status: 'ACTIVE' },
    });
    if (staff.length !== new Set(ids).size)
      throw AppError.invalid('Choose helping staff of this event', {
        assigneeMembershipIds: 'Every assignee must be active helping staff',
      });
  }
  async function checkTeams(ctx: EventContext, ids: string[]) {
    if (!ids.length) return;
    const n = await db.team.count({ where: { id: { in: ids }, eventId: ctx.event.id } });
    if (n !== new Set(ids).size)
      throw AppError.invalid('Choose teams of this event', {
        teamIds: 'Every linked team must belong to this event',
      });
  }

  async function taskDto(ctx: EventContext, taskIds?: string[]) {
    const tasks = await db.staffTask.findMany({
      where: {
        eventId: ctx.event.id,
        ...(taskIds ? { id: { in: taskIds } } : {}),
        ...(isAdmin(ctx) ? {} : { assignees: { some: { membershipId: ctx.membership.id } } }),
      },
      include: { assignees: true, teams: true },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    });
    const members = await db.eventMembership.findMany({
      where: {
        id: {
          in: tasks.flatMap((t) => [
            ...t.assignees.map((a) => a.membershipId),
            ...(t.statusChangedById ? [t.statusChangedById] : []),
          ]),
        },
      },
      include: { user: true },
    });
    const name = (id: string | null) => members.find((m) => m.id === id)?.user.name ?? null;
    const teams = await db.team.findMany({
      where: { id: { in: tasks.flatMap((t) => t.teams.map((x) => x.teamId)) } },
    });
    return tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      type: t.type,
      dueAt: t.dueAt,
      location: t.location,
      status: t.status,
      note: t.note,
      statusChangedBy: name(t.statusChangedById),
      statusChangedAt: t.statusChangedAt,
      overdue: Boolean(t.dueAt && t.dueAt < new Date() && t.status !== 'DONE'),
      assignees: t.assignees.map((a) => ({
        membershipId: a.membershipId,
        name: name(a.membershipId),
      })),
      teams: t.teams
        .map((x) => teams.find((tm) => tm.id === x.teamId))
        .filter(Boolean)
        .map((tm) => ({ id: tm!.id, teamCode: tm!.teamCode, name: tm!.name })),
    }));
  }

  // ── Tasks ──
  router.get('/staff/tasks', requireAction('staffTasks.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    const status = String(req.query.status ?? '');
    const all = await taskDto(ctx);
    res.json({ tasks: status ? all.filter((t) => t.status === status) : all });
  });

  router.post('/staff/tasks', requireAction('staffTasks.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const input = parse(taskInput, req.body);
    await checkAssignees(ctx, input.assigneeMembershipIds);
    await checkTeams(ctx, input.teamIds);
    const task = await db.$transaction(async (tx) => {
      const t = await tx.staffTask.create({
        data: {
          eventId: ctx.event.id,
          title: input.title,
          description: input.description ?? null,
          type: input.type,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          location: input.location ?? null,
          createdById: ctx.membership.userId,
          assignees: {
            create: input.assigneeMembershipIds.map((membershipId) => ({ membershipId })),
          },
          teams: { create: input.teamIds.map((teamId) => ({ teamId })) },
        },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'staff_task.created',
        entityType: 'StaffTask',
        entityId: t.id,
        after: { title: t.title, assignees: input.assigneeMembershipIds.length },
      });
      return t;
    });
    res.status(201).json((await taskDto(ctx, [task.id]))[0]);
  });

  router.patch('/staff/tasks/:taskId', requireAction('staffTasks.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const existing = await db.staffTask.findFirst({
      where: { id: String(req.params.taskId), eventId: ctx.event.id },
    });
    if (!existing) throw AppError.notFound();
    const input = parse(taskInput, req.body);
    await checkAssignees(ctx, input.assigneeMembershipIds);
    await checkTeams(ctx, input.teamIds);
    await db.$transaction(async (tx) => {
      await tx.staffTaskAssignee.deleteMany({ where: { taskId: existing.id } });
      await tx.staffTaskTeam.deleteMany({ where: { taskId: existing.id } });
      await tx.staffTask.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          description: input.description ?? null,
          type: input.type,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          location: input.location ?? null,
          assignees: {
            create: input.assigneeMembershipIds.map((membershipId) => ({ membershipId })),
          },
          teams: { create: input.teamIds.map((teamId) => ({ teamId })) },
        },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'staff_task.updated',
        entityType: 'StaffTask',
        entityId: existing.id,
        before: { title: existing.title },
        after: { title: input.title },
      });
    });
    res.json((await taskDto(ctx, [existing.id]))[0]);
  });

  router.delete('/staff/tasks/:taskId', requireAction('staffTasks.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const existing = await db.staffTask.findFirst({
      where: { id: String(req.params.taskId), eventId: ctx.event.id },
    });
    if (!existing) throw AppError.notFound();
    await db.$transaction(async (tx) => {
      await tx.staffTask.delete({ where: { id: existing.id } });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'staff_task.deleted',
        entityType: 'StaffTask',
        entityId: existing.id,
        before: { title: existing.title },
      });
    });
    res.status(204).end();
  });

  // Staff change only the status of tasks assigned to them; Blocked needs a note (PRD FR-123, FR-130).
  router.put(
    '/staff/tasks/:taskId/status',
    requireAction('staffTasks.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      assertWritable(ctx);
      const { status, note } = parse(statusInput, req.body);
      const task = await db.staffTask.findFirst({
        where: { id: String(req.params.taskId), eventId: ctx.event.id },
        include: { assignees: true },
      });
      if (
        !task ||
        (!isAdmin(ctx) && !task.assignees.some((a) => a.membershipId === ctx.membership.id))
      )
        throw AppError.notFound();
      if (status === 'BLOCKED' && !(note ?? '').trim())
        throw AppError.invalid('Say what is blocking this task', {
          note: 'A note is required when a task is blocked',
        });
      await db.$transaction(async (tx) => {
        await tx.staffTask.update({
          where: { id: task.id },
          data: {
            status,
            note: note ?? null,
            statusChangedById: ctx.membership.id,
            statusChangedAt: new Date(),
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'staff_task.status_changed',
          entityType: 'StaffTask',
          entityId: task.id,
          before: { status: task.status },
          after: { status },
          reason: note ?? null,
        });
      });
      res.json((await taskDto(ctx, [task.id]))[0]);
    },
  );

  // ── Team lookup and check-in (limited fields, never email or phone) ──
  async function cardFor(ctx: EventContext, team: TeamRow) {
    const members = await db.teamMember.findMany({
      where: { teamId: team.id, leftAt: null },
      include: { membership: { include: { registration: true, user: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    const checks = await db.checkIn.findMany({
      where: {
        eventId: ctx.event.id,
        membershipId: { in: members.map((m) => m.membershipId) },
        undoneAt: null,
      },
    });
    const people = await db.eventMembership.findMany({
      where: {
        id: {
          in: checks.flatMap((c) => [
            c.checkedInById,
            ...(c.idVerifiedById ? [c.idVerifiedById] : []),
          ]),
        },
      },
      include: { user: true },
    });
    const name = (id: string | null) => people.find((p) => p.id === id)?.user.name ?? null;
    const fullTeam = await db.team.findUniqueOrThrow({
      where: { id: team.id },
      include: { track: true },
    });
    const rows = members.map((m) => {
      const c = checks.find((x) => x.membershipId === m.membershipId);
      return {
        membershipId: m.membershipId,
        name: m.membership.registration?.fullName ?? m.membership.user.name,
        institution: m.membership.registration?.institution ?? '',
        yearOfStudy: m.membership.registration?.yearOfStudy ?? '',
        checkedIn: Boolean(c),
        checkedInAt: c?.checkedInAt ?? null,
        checkedInBy: name(c?.checkedInById ?? null),
        idVerified: Boolean(c?.idVerifiedAt),
        idVerifiedBy: name(c?.idVerifiedById ?? null),
        idVerifiedAt: c?.idVerifiedAt ?? null,
        note: c?.note ?? null,
        canUndo: Boolean(c && (isAdmin(ctx) || c.checkedInById === ctx.membership.id)),
      };
    });
    const present = rows.filter((r) => r.checkedIn).length;
    return {
      teamId: team.id,
      teamCode: team.teamCode,
      name: team.name,
      track: fullTeam.track?.name ?? null,
      disqualified: fullTeam.status === 'DISQUALIFIED',
      members: rows,
      status: present === 0 ? 'NOT_CHECKED_IN' : present === rows.length ? 'CHECKED_IN' : 'PARTIAL',
    };
  }

  router.get('/checkin/teams', requireAction('checkin.record'), async (req, res) => {
    const ctx = requireCtx(req);
    const q = String(req.query.q ?? '')
      .trim()
      .toLowerCase();
    if (q.length < 1) return void res.json({ teams: [] });
    const teams = await db.team.findMany({
      where: {
        eventId: ctx.event.id,
        status: { not: 'DISSOLVED' },
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { teamCode: { contains: q, mode: 'insensitive' } },
          {
            members: {
              some: {
                leftAt: null,
                membership: { registration: { fullName: { contains: q, mode: 'insensitive' } } },
              },
            },
          },
        ],
      },
      orderBy: { teamCode: 'asc' },
      take: 20,
    });
    res.json({ teams: await Promise.all(teams.map((t) => cardFor(ctx, t))) });
  });

  router.get('/checkin/summary', requireAction('checkin.record'), async (req, res) => {
    const ctx = requireCtx(req);
    res.json(await checkinSummary(deps, ctx.event.id));
  });

  router.post(
    '/checkin/members/:membershipId',
    requireAction('checkin.record'),
    async (req, res) => {
      const ctx = requireCtx(req);
      assertWritable(ctx);
      const { action, note } = parse(
        z
          .object({
            action: z.enum(['check_in', 'undo', 'verify']),
            note: z.string().trim().max(200).nullish(),
          })
          .strict(),
        req.body,
      );
      const target = await db.eventMembership.findFirst({
        where: {
          id: String(req.params.membershipId),
          eventId: ctx.event.id,
          role: 'PARTICIPANT',
          status: 'ACTIVE',
        },
      });
      if (!target) throw AppError.notFound();
      const active = await db.checkIn.findFirst({
        where: { eventId: ctx.event.id, membershipId: target.id, undoneAt: null },
      });
      await db.$transaction(async (tx) => {
        if (action === 'check_in') {
          if (active) return; // a second tap is idempotent (PRD FR-126)
          await tx.checkIn.create({
            data: {
              eventId: ctx.event.id,
              membershipId: target.id,
              checkedInById: ctx.membership.id,
            },
          });
          await writeAudit(tx, {
            eventId: ctx.event.id,
            actorId: ctx.membership.userId,
            action: 'checkin.marked',
            entityType: 'CheckIn',
            entityId: target.id,
          });
        } else if (action === 'verify') {
          if (!active)
            throw AppError.conflict(
              'not_checked_in',
              'Check the participant in before verifying their ID',
            );
          await tx.checkIn.update({
            where: { id: active.id },
            data: {
              idVerifiedAt: new Date(),
              idVerifiedById: ctx.membership.id,
              note: note ?? null,
            },
          });
          await writeAudit(tx, {
            eventId: ctx.event.id,
            actorId: ctx.membership.userId,
            action: 'checkin.id_verified',
            entityType: 'CheckIn',
            entityId: target.id,
            reason: note ?? null,
          });
        } else {
          if (!active) return;
          if (!isAdmin(ctx) && active.checkedInById !== ctx.membership.id)
            throw AppError.forbidden(
              'Only the person who checked them in, or an admin, can undo it',
            );
          await tx.checkIn.update({
            where: { id: active.id },
            data: { undoneAt: new Date(), undoneById: ctx.membership.id },
          });
          await writeAudit(tx, {
            eventId: ctx.event.id,
            actorId: ctx.membership.userId,
            action: 'checkin.undone',
            entityType: 'CheckIn',
            entityId: target.id,
          });
        }
      });
      const m = await db.teamMember.findFirst({
        where: { membershipId: target.id, leftAt: null, team: { status: { not: 'DISSOLVED' } } },
        include: { team: true },
      });
      res.json(m ? await cardFor(ctx, m.team) : { ok: true });
    },
  );

  // ── Issue reports ──
  async function issueDto(ctx: EventContext, where: object) {
    const issues = await db.issueReport.findMany({
      where: { eventId: ctx.event.id, ...where },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    });
    const reporters = await db.eventMembership.findMany({
      where: { id: { in: issues.map((i) => i.reporterMembershipId) } },
      include: { user: true },
    });
    const teams = await db.team.findMany({
      where: { id: { in: issues.flatMap((i) => (i.teamId ? [i.teamId] : [])) } },
    });
    return issues.map((i) => ({
      id: i.id,
      category: i.category,
      description: i.description,
      severity: i.severity,
      status: i.status,
      resolutionNote: i.resolutionNote,
      createdAt: i.createdAt,
      reporter: reporters.find((r) => r.id === i.reporterMembershipId)?.user.name ?? 'Unknown',
      reporterRole: reporters.find((r) => r.id === i.reporterMembershipId)?.role ?? null,
      team: teams.find((t) => t.id === i.teamId)
        ? {
            id: i.teamId!,
            teamCode: teams.find((t) => t.id === i.teamId)!.teamCode,
            name: teams.find((t) => t.id === i.teamId)!.name,
          }
        : null,
    }));
  }

  router.post('/issues', requireAction('issues.report'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const input = parse(issueInput, req.body);
    if (
      input.teamId &&
      !(await db.team.findFirst({ where: { id: input.teamId, eventId: ctx.event.id } }))
    )
      throw AppError.invalid('Choose a team of this event', { teamId: 'Unknown team' });
    const issue = await db.$transaction(async (tx) => {
      const i = await tx.issueReport.create({
        data: {
          eventId: ctx.event.id,
          reporterMembershipId: ctx.membership.id,
          category: input.category,
          description: input.description,
          teamId: input.teamId ?? null,
          severity: input.severity,
        },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'issue.reported',
        entityType: 'IssueReport',
        entityId: i.id,
        after: { category: i.category, severity: i.severity },
      });
      return i;
    });
    res.status(201).json((await issueDto(ctx, { id: issue.id }))[0]);
  });

  router.get('/issues', requireAction('issues.report'), async (req, res) => {
    const ctx = requireCtx(req);
    const status = String(req.query.status ?? '');
    res.json({
      issues: await issueDto(ctx, {
        ...(isAdmin(ctx) ? {} : { reporterMembershipId: ctx.membership.id }),
        ...(status ? { status } : {}),
      }),
    });
  });

  router.post('/issues/:issueId/escalate', requireAction('issues.report'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const i = await db.issueReport.findFirst({
      where: { id: String(req.params.issueId), eventId: ctx.event.id },
    });
    if (!i || (!isAdmin(ctx) && i.reporterMembershipId !== ctx.membership.id))
      throw AppError.notFound();
    if (i.status !== 'OPEN')
      throw AppError.conflict('not_open', 'Only an open issue can be escalated');
    await db.$transaction(async (tx) => {
      await tx.issueReport.update({ where: { id: i.id }, data: { severity: 'URGENT' } });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'issue.escalated',
        entityType: 'IssueReport',
        entityId: i.id,
      });
    });
    res.json((await issueDto(ctx, { id: i.id }))[0]);
  });

  router.put('/issues/:issueId/status', requireAction('issues.report'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const { status, resolutionNote } = parse(
      z
        .object({
          status: z.enum(['ACKNOWLEDGED', 'RESOLVED']),
          resolutionNote: z.string().trim().max(500).nullish(),
        })
        .strict(),
      req.body,
    );
    const i = await db.issueReport.findFirst({
      where: { id: String(req.params.issueId), eventId: ctx.event.id },
    });
    if (!i) throw AppError.notFound();
    if (status === 'RESOLVED' && !(resolutionNote ?? '').trim())
      throw AppError.invalid('Say how it was resolved', {
        resolutionNote: 'A resolution note is required',
      });
    await db.$transaction(async (tx) => {
      await tx.issueReport.update({
        where: { id: i.id },
        data: {
          status,
          resolutionNote: resolutionNote ?? i.resolutionNote,
          resolvedById: status === 'RESOLVED' ? ctx.membership.id : null,
        },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: `issue.${status.toLowerCase()}`,
        entityType: 'IssueReport',
        entityId: i.id,
        reason: resolutionNote ?? null,
      });
    });
    res.json((await issueDto(ctx, { id: i.id }))[0]);
  });

  // A judge who cannot load a team's file tells the organisers (PRD FR-094). Only assigned judges may report.
  router.post(
    '/rounds/:roundId/judge/teams/:teamId/report-file',
    requireAction('rubric.view'),
    async (req, res) => {
      const ctx = requireCtx(req);
      if (ctx.membership.role !== 'JUDGE') throw AppError.notFound();
      assertWritable(ctx);
      const { description } = parse(
        z.object({ description: z.string().trim().max(500).default('') }).strict(),
        req.body,
      );
      const a = await db.judgeAssignment.findUnique({
        where: {
          roundId_teamId_judgeMembershipId: {
            roundId: String(req.params.roundId),
            teamId: String(req.params.teamId),
            judgeMembershipId: ctx.membership.id,
          },
        },
      });
      if (!a || a.eventId !== ctx.event.id || a.status === 'UNASSIGNED') throw AppError.notFound();
      const i = await db.$transaction(async (tx) => {
        const issue = await tx.issueReport.create({
          data: {
            eventId: ctx.event.id,
            reporterMembershipId: ctx.membership.id,
            category: 'TECHNICAL',
            teamId: a.teamId,
            description:
              `Missing or unreadable submission file reported by a judge. ${description}`.trim(),
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'issue.reported',
          entityType: 'IssueReport',
          entityId: issue.id,
          after: { category: 'TECHNICAL', source: 'judge file report' },
        });
        return issue;
      });
      res.status(201).json({ id: i.id });
    },
  );

  return router;
}

export async function checkinSummary({ db }: Deps, eventId: string) {
  const [participants, checked, verified] = await Promise.all([
    db.eventMembership.count({
      where: {
        eventId,
        role: 'PARTICIPANT',
        status: 'ACTIVE',
        registration: { is: { status: 'ACTIVE' } },
      },
    }),
    db.checkIn.count({ where: { eventId, undoneAt: null } }),
    db.checkIn.count({ where: { eventId, undoneAt: null, idVerifiedAt: { not: null } } }),
  ]);
  const teams = await db.team.findMany({
    where: { eventId, status: { not: 'DISSOLVED' } },
    include: { members: { where: { leftAt: null } } },
  });
  const present = new Set(
    (
      await db.checkIn.findMany({
        where: { eventId, undoneAt: null },
        select: { membershipId: true },
      })
    ).map((c) => c.membershipId),
  );
  const state = (t: (typeof teams)[number]) => {
    const n = t.members.filter((m) => present.has(m.membershipId)).length;
    return n === 0 ? 'none' : n === t.members.length ? 'all' : 'some';
  };
  return {
    participants,
    checkedIn: checked,
    idVerified: verified,
    teams: {
      total: teams.length,
      checkedIn: teams.filter((t) => state(t) === 'all').length,
      partial: teams.filter((t) => state(t) === 'some').length,
      notCheckedIn: teams.filter((t) => state(t) === 'none').length,
    },
  };
}
