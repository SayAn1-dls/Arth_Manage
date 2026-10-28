import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../../http/deps.js';
import { requireCtx } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { adminOnly, loadRound } from '../judging/common.js';
import { assertWritable } from '../events/service.js';
import { writeAudit } from '../../audit/audit.js';
import { calibration, engagement } from './analytics.js';
import { createBrandDocument, PDF_COLORS, safeText } from '../../pdf/brand.js';

const text = z.string().trim().min(1).max(4000);
export function workspaceRouter({ db }: Deps) {
  const router = Router({ mergeParams: true });
  // Every new operation inherits authenticated, event-scoped membership from eventsRouter.
  router.use('/workspace', (req, _res, next) => {
    const ctx = requireCtx(req);
    if (
      ctx.membership.accessLevel === 'SPONSOR_VIEWER' &&
      !['/engagement', '/report.pdf'].includes(req.path)
    )
      throw AppError.notFound();
    if (!['GET', 'HEAD'].includes(req.method)) assertWritable(ctx);
    next();
  });
  const audit = async (ctx: ReturnType<typeof requireCtx>, action: string, entityId: string) =>
    writeAudit(db, {
      eventId: ctx.event.id,
      actorId: ctx.membership.userId,
      action,
      entityType: 'Workspace',
      entityId,
    });
  const ownTeam = async (ctx: ReturnType<typeof requireCtx>) => {
    const m = await db.teamMember.findFirst({
      where: {
        eventId: ctx.event.id,
        membershipId: ctx.membership.id,
        leftAt: null,
        team: { status: 'ACTIVE' },
      },
    });
    return m?.teamId ?? null;
  };
  router.get('/workspace/sandbox', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    const members = await db.eventMembership.findMany({
      where: { eventId: c.event.id, status: 'ACTIVE', role: { in: ['PARTICIPANT', 'JUDGE'] } },
      select: { id: true, role: true, user: { select: { name: true } } },
    });
    const rounds = await db.round.findMany({
      where: { eventId: c.event.id },
      orderBy: { order: 'asc' },
      include: {
        rubric: { include: { criteria: { orderBy: { order: 'asc' } } } },
        formFields: { orderBy: { order: 'asc' } },
      },
    });
    const member = members.find((m) => m.id === req.query.membershipId) ?? members[0] ?? null;
    const assignments =
      member?.role === 'JUDGE'
        ? await db.judgeAssignment.findMany({
            where: { eventId: c.event.id, judgeMembershipId: member.id, status: 'ACTIVE' },
            select: { teamId: true, roundId: true },
          })
        : [];
    const teams = await db.team.findMany({
      where: { eventId: c.event.id, id: { in: assignments.map((a) => a.teamId) } },
      select: { id: true, name: true, teamCode: true },
    });
    res.json({
      members,
      rounds,
      member,
      assignments: assignments.map((a) => ({ ...a, team: teams.find((t) => t.id === a.teamId) })),
    });
  });
  router.get('/workspace/options', async (req, res) => {
    const c = requireCtx(req);
    const admin = c.membership.role === 'ADMIN';
    const [rounds, tracks, staff, teams] = await Promise.all([
      db.round.findMany({
        where: { eventId: c.event.id },
        orderBy: { order: 'asc' },
        select: { id: true, name: true, order: true, shortlistEnabled: true, normalisation: true },
      }),
      db.track.findMany({ where: { eventId: c.event.id }, select: { id: true, name: true } }),
      admin
        ? db.eventMembership.findMany({
            where: {
              eventId: c.event.id,
              status: 'ACTIVE',
              role: { in: ['ADMIN', 'STAFF', 'JUDGE'] },
            },
            select: {
              id: true,
              role: true,
              accessLevel: true,
              institution: true,
              trackIds: true,
              user: { select: { name: true } },
            },
          })
        : [],
      admin
        ? db.team.findMany({
            where: { eventId: c.event.id, status: 'ACTIVE' },
            select: {
              id: true,
              teamCode: true,
              name: true,
              applicationStatus: true,
              applicationNote: true,
            },
          })
        : [],
    ]);
    res.json({ rounds, tracks, staff, teams, ownTeamId: await ownTeam(c) });
  });
  router.post('/workspace/activity', async (req, res) => {
    const c = requireCtx(req);
    const { guidebook } = parse(
      z.object({ guidebook: z.boolean().default(false) }).strict(),
      req.body,
    );
    await db.activityPulse.upsert({
      where: { eventId_membershipId: { eventId: c.event.id, membershipId: c.membership.id } },
      create: {
        eventId: c.event.id,
        membershipId: c.membership.id,
        guidebookAt: guidebook ? new Date() : null,
      },
      update: { lastSeenAt: new Date(), ...(guidebook ? { guidebookAt: new Date() } : {}) },
    });
    res.json({ ok: true });
  });
  router.get('/workspace/tickets', async (req, res) => {
    const c = requireCtx(req);
    const manager = ['ADMIN', 'STAFF'].includes(c.membership.role);
    const tickets = await db.supportTicket.findMany({
      where: { eventId: c.event.id, ...(manager ? {} : { authorId: c.membership.id }) },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    res.json({ tickets });
  });
  router.post('/workspace/tickets', async (req, res) => {
    const c = requireCtx(req);
    const input = parse(
      z
        .object({
          subject: text.max(200),
          body: text,
          kind: z.enum(['QUESTION', 'EXTENSION', 'UNLOCK', 'TEAM_CHANGE']).default('QUESTION'),
          roundId: z.string().optional(),
          minutes: z.number().int().min(1).max(1440).default(10),
          replacementEmail: z.string().email().toLowerCase().optional(),
          departingEmail: z.string().email().toLowerCase().optional(),
        })
        .strict(),
      req.body,
    );
    const teamId = await ownTeam(c);
    if (input.kind !== 'QUESTION' && (!teamId || c.membership.role !== 'PARTICIPANT'))
      throw AppError.invalid('An active participant team is required');
    if (['EXTENSION', 'UNLOCK'].includes(input.kind) && !input.roundId)
      throw AppError.invalid('Choose a round');
    if (input.kind === 'TEAM_CHANGE' && (!input.replacementEmail || !input.departingEmail))
      throw AppError.invalid('Provide both the departing and replacement participant emails');
    if (input.roundId) await loadRound(db, c, input.roundId);
    const { body, ...data } = input;
    const ticket = await db.supportTicket.create({
      data: {
        ...data,
        eventId: c.event.id,
        authorId: c.membership.id,
        teamId,
        messages: { create: { authorId: c.membership.id, body } },
      },
    });
    await audit(c, 'helpdesk.created', ticket.id);
    res.status(201).json(ticket);
  });
  router.post('/workspace/tickets/:id/reply', async (req, res) => {
    const c = requireCtx(req);
    const { body } = parse(z.object({ body: text }).strict(), req.body);
    const t = await db.supportTicket.findFirst({
      where: {
        id: String(req.params.id),
        eventId: c.event.id,
        ...(['ADMIN', 'STAFF'].includes(c.membership.role) ? {} : { authorId: c.membership.id }),
      },
    });
    if (!t) throw AppError.notFound();
    await db.$transaction([
      db.ticketMessage.create({ data: { ticketId: t.id, authorId: c.membership.id, body } }),
      db.supportTicket.update({ where: { id: t.id }, data: { updatedAt: new Date() } }),
    ]);
    res.json({ ok: true });
  });
  router.patch('/workspace/tickets/:id', async (req, res) => {
    const c = requireCtx(req);
    if (!['ADMIN', 'STAFF'].includes(c.membership.role)) throw AppError.notFound();
    const input = parse(
      z
        .object({
          status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']).optional(),
          assignedToId: z.string().nullable().optional(),
        })
        .strict(),
      req.body,
    );
    const t = await db.supportTicket.findFirst({
      where: { id: String(req.params.id), eventId: c.event.id },
    });
    if (!t) throw AppError.notFound();
    if (
      input.assignedToId &&
      !(await db.eventMembership.findFirst({
        where: {
          id: input.assignedToId,
          eventId: c.event.id,
          status: 'ACTIVE',
          role: { in: ['ADMIN', 'STAFF'] },
        },
      }))
    )
      throw AppError.invalid('Choose active event staff');
    if (input.status && ['APPROVED', 'DENIED'].includes(t.status))
      throw AppError.conflict(
        'decided',
        'Exception decisions cannot be reopened; create a new request',
      );
    await db.supportTicket.update({ where: { id: t.id }, data: input });
    await audit(c, 'helpdesk.updated', t.id);
    res.json({ ok: true });
  });
  router.post('/workspace/tickets/:id/decision', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    const input = parse(z.object({ approve: z.boolean(), note: text }).strict(), req.body);
    await db.$transaction(async (tx) => {
      const t = await tx.supportTicket.findFirst({
        where: { id: String(req.params.id), eventId: c.event.id },
      });
      if (!t || t.kind === 'QUESTION') throw AppError.notFound();
      if (!['OPEN', 'IN_PROGRESS'].includes(t.status))
        throw AppError.conflict('decided', 'This request has already been decided');
      const changed = await tx.supportTicket.updateMany({
        where: { id: t.id, status: t.status },
        data: { status: input.approve ? 'APPROVED' : 'DENIED', decisionNote: input.note },
      });
      if (!changed.count) throw AppError.conflict('decided', 'Another admin decided this request');
      if (input.approve && t.kind === 'TEAM_CHANGE' && t.teamId) {
        await tx.$queryRaw`SELECT id FROM "Team" WHERE id = ${t.teamId} FOR UPDATE`;
        const team = await tx.team.findFirst({
          where: { id: t.teamId, eventId: c.event.id, status: 'ACTIVE' },
        });
        const outgoing = await tx.teamMember.findFirst({
          where: {
            teamId: t.teamId,
            eventId: c.event.id,
            leftAt: null,
            membership: { user: { email: t.departingEmail ?? '' } },
          },
        });
        const incoming = await tx.eventMembership.findFirst({
          where: {
            eventId: c.event.id,
            status: 'ACTIVE',
            role: 'PARTICIPANT',
            user: { email: t.replacementEmail ?? '' },
            registration: { status: 'ACTIVE' },
          },
        });
        if (!team || !outgoing || !incoming)
          throw AppError.invalid(
            'Both participants must be registered in this event and the departing participant must belong to this team',
          );
        if (
          await tx.teamMember.findFirst({
            where: { eventId: c.event.id, membershipId: incoming.id, leftAt: null },
          })
        )
          throw AppError.conflict(
            'already_teamed',
            'Replacement participant already belongs to a team',
          );
        await tx.teamMember.update({ where: { id: outgoing.id }, data: { leftAt: new Date() } });
        await tx.teamMember.create({
          data: {
            eventId: c.event.id,
            teamId: t.teamId,
            membershipId: incoming.id,
            role: outgoing.role,
          },
        });
        await tx.team.update({ where: { id: t.teamId }, data: { version: { increment: 1 } } });
      }
      if (input.approve && ['EXTENSION', 'UNLOCK'].includes(t.kind) && t.teamId && t.roundId) {
        const round = await tx.round.findFirst({ where: { id: t.roundId, eventId: c.event.id } });
        const team = await tx.team.findFirst({
          where: { id: t.teamId, eventId: c.event.id, status: 'ACTIVE' },
        });
        if (!round || !team) throw AppError.notFound();
        const old = await tx.submission.findUnique({
          where: { roundId_teamId: { roundId: round.id, teamId: team.id } },
        });
        const base = Math.max(
          Date.now(),
          +(
            old?.extensionDeadline ??
            (round.submissionDeadline
              ? new Date(+round.submissionDeadline + round.graceMinutes * 60000)
              : new Date())
          ),
        );
        const extensionDeadline = new Date(base + t.minutes * 60000);
        await tx.submission.upsert({
          where: { roundId_teamId: { roundId: round.id, teamId: team.id } },
          create: {
            eventId: c.event.id,
            roundId: round.id,
            teamId: team.id,
            extensionDeadline,
            extensionReason: input.note,
          },
          update: { extensionDeadline, extensionReason: input.note },
        });
      }
      await writeAudit(tx, {
        eventId: c.event.id,
        actorId: c.membership.userId,
        action: 'exception.decided',
        entityType: 'SupportTicket',
        entityId: t.id,
        after: input,
      });
    });
    res.json({ ok: true });
  });
  router.post('/workspace/applications', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    const input = parse(
      z
        .object({
          teamIds: z.array(z.string()).min(1).max(500),
          status: z.enum(['ACCEPTED', 'REJECTED', 'WAITLISTED']),
          note: z.string().max(1000).default(''),
        })
        .strict(),
      req.body,
    );
    const teams = await db.team.findMany({
      where: { eventId: c.event.id, id: { in: input.teamIds }, status: 'ACTIVE' },
    });
    if (teams.length !== new Set(input.teamIds).size)
      throw AppError.invalid('Choose active teams from this event');
    await db.$transaction(async (tx) => {
      await tx.event.update({ where: { id: c.event.id }, data: { applicationReview: true } });
      await tx.team.updateMany({
        where: { eventId: c.event.id, id: { in: input.teamIds } },
        data: { applicationStatus: input.status, applicationNote: input.note },
      });
      const members = await tx.teamMember.findMany({
        where: { teamId: { in: input.teamIds }, eventId: c.event.id, leftAt: null },
      });
      await tx.messageDelivery.createMany({
        data: members.map((m) => ({
          eventId: c.event.id,
          membershipId: m.membershipId,
          key: `application:${m.teamId}:${input.status}:${Date.now()}`,
          subject: `${c.event.name}: application ${input.status.toLowerCase()}`,
          body: input.note || `Your team's application is ${input.status.toLowerCase()}.`,
        })),
        skipDuplicates: true,
      });
      await writeAudit(tx, {
        eventId: c.event.id,
        actorId: c.membership.userId,
        action: 'applications.reviewed',
        entityType: 'Team',
        after: input,
      });
    });
    res.json({ updated: teams.length });
  });
  router.get('/workspace/application', async (req, res) => {
    const c = requireCtx(req);
    const teamId = await ownTeam(c);
    res.json({
      team: teamId
        ? await db.team.findUnique({
            where: { id: teamId },
            select: { applicationStatus: true, applicationNote: true },
          })
        : null,
    });
  });
  router.post('/workspace/shortlist', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    const input = parse(
      z
        .object({
          fromRoundId: z.string(),
          toRoundId: z.string(),
          teamIds: z.array(z.string()).max(500),
        })
        .strict(),
      req.body,
    );
    const from = await loadRound(db, c, input.fromRoundId),
      to = await loadRound(db, c, input.toRoundId);
    if (to.order <= from.order) throw AppError.invalid('Choose a later destination round');
    if (
      to.judgingStatus !== 'NOT_OPEN' ||
      (await db.submission.count({ where: { roundId: to.id, lastVersionNo: { gt: 0 } } }))
    )
      throw AppError.conflict(
        'round_started',
        'Shortlist before destination judging or submissions begin',
      );
    const teams = await db.team.findMany({
      where: { eventId: c.event.id, status: 'ACTIVE', id: { in: input.teamIds } },
    });
    if (teams.length !== new Set(input.teamIds).size)
      throw AppError.invalid('Choose teams from this event');
    const eligible = await db.submission.findMany({
      where: { roundId: from.id, lastVersionNo: { gt: 0 }, teamId: { in: input.teamIds } },
    });
    if (eligible.length !== teams.length)
      throw AppError.invalid('Only teams with a submitted project in the source round can advance');
    await db.$transaction(async (tx) => {
      await tx.roundEntry.deleteMany({ where: { roundId: to.id, eventId: c.event.id } });
      await tx.roundEntry.createMany({
        data: teams.map((t) => ({ eventId: c.event.id, roundId: to.id, teamId: t.id })),
      });
      await tx.round.update({ where: { id: to.id }, data: { shortlistEnabled: true } });
      const members = await tx.teamMember.findMany({
        where: { eventId: c.event.id, leftAt: null },
      });
      await tx.messageDelivery.createMany({
        data: members.map((m) => ({
          eventId: c.event.id,
          membershipId: m.membershipId,
          key: `shortlist:${to.id}:${Date.now()}`,
          subject: `${c.event.name}: ${to.name}`,
          body: input.teamIds.includes(m.teamId)
            ? `Your team has advanced to ${to.name}.`
            : `Your team has not been shortlisted for ${to.name}. Thank you for participating.`,
        })),
        skipDuplicates: true,
      });
      await writeAudit(tx, {
        eventId: c.event.id,
        actorId: c.membership.userId,
        action: 'round.shortlisted',
        entityType: 'Round',
        entityId: to.id,
        after: input,
      });
    });
    res.json({ advanced: teams.length });
  });
  router.get('/workspace/engagement', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    res.json({ teams: await engagement(db, c.event.id) });
  });
  router.get('/workspace/calibration/:roundId', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    const r = await loadRound(db, c, String(req.params.roundId));
    const rows = await db.judgeAssignment.findMany({
      where: { roundId: r.id, status: 'ACTIVE', evaluation: { status: 'SUBMITTED' } },
      include: { evaluation: true },
    });
    const judges = await db.eventMembership.findMany({
      where: { eventId: c.event.id, role: 'JUDGE' },
      include: { user: { select: { name: true } } },
    });
    res.json({
      normalisation: r.normalisation,
      judges: calibration(
        rows.map((a) => ({
          judgeId: a.judgeMembershipId,
          score: Number(a.evaluation!.weightedScore),
          seconds: Math.max(
            0,
            (+(a.evaluation!.submittedAt ?? a.evaluation!.updatedAt) - +a.evaluation!.createdAt) /
              1000,
          ),
          at: a.evaluation!.submittedAt ?? a.evaluation!.updatedAt,
        })),
      ).map((j) => ({
        ...j,
        name: judges.find((x) => x.id === j.judgeId)?.user.name ?? 'Former judge',
      })),
    });
  });
  router.put('/workspace/normalisation/:roundId', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    const r = await loadRound(db, c, String(req.params.roundId));
    const { enabled } = parse(z.object({ enabled: z.boolean() }).strict(), req.body);
    if (await db.resultSnapshot.count({ where: { roundId: r.id, status: 'APPROVED' } }))
      throw AppError.conflict(
        'approved_results',
        'Invalidate approved results before changing the scoring method',
      );
    await db.round.update({ where: { id: r.id }, data: { normalisation: enabled } });
    await audit(c, 'judging.normalisation_changed', r.id);
    res.json({ ok: true });
  });
  router.get('/workspace/discovery', async (req, res) => {
    const c = requireCtx(req);
    const profiles = await db.discoveryProfile.findMany({
      where: { eventId: c.event.id, visible: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const members = await db.eventMembership.findMany({
      where: {
        eventId: c.event.id,
        id: { in: profiles.map((p) => p.membershipId) },
        status: 'ACTIVE',
        role: 'PARTICIPANT',
      },
      select: { id: true, user: { select: { name: true } } },
    });
    res.json({
      profiles: profiles
        .filter((p) => members.some((m) => m.id === p.membershipId))
        .map((p) => ({ ...p, name: members.find((m) => m.id === p.membershipId)!.user.name })),
      mine: await db.discoveryProfile.findUnique({
        where: { eventId_membershipId: { eventId: c.event.id, membershipId: c.membership.id } },
      }),
    });
  });
  router.put('/workspace/discovery', async (req, res) => {
    const c = requireCtx(req);
    if (c.membership.role !== 'PARTICIPANT') throw AppError.notFound();
    const input = parse(
      z
        .object({
          headline: text.max(150),
          skills: text.max(500),
          about: text.max(1000),
          contact: text.max(200),
          visible: z.boolean(),
        })
        .strict(),
      req.body,
    );
    await db.discoveryProfile.upsert({
      where: { eventId_membershipId: { eventId: c.event.id, membershipId: c.membership.id } },
      create: { eventId: c.event.id, membershipId: c.membership.id, ...input },
      update: input,
    });
    res.json({ ok: true });
  });
  router.put('/workspace/access/:id', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    if (c.event.ownerId !== c.membership.userId)
      throw AppError.forbidden('Only the event owner can change access levels');
    const input = parse(
      z
        .object({
          accessLevel: z.enum(['STANDARD', 'CO_ADMIN', 'STAFF_LEAD', 'SPONSOR_VIEWER']),
          institution: z.string().trim().max(200),
          trackIds: z.array(z.string()).max(100),
        })
        .strict(),
      req.body,
    );
    const m = await db.eventMembership.findFirst({
      where: { id: String(req.params.id), eventId: c.event.id, status: 'ACTIVE' },
    });
    if (!m || m.userId === c.event.ownerId) throw AppError.invalid('Choose another event member');
    if (
      (input.accessLevel === 'CO_ADMIN' && m.role !== 'ADMIN') ||
      (input.accessLevel === 'STAFF_LEAD' && m.role !== 'STAFF') ||
      (input.accessLevel === 'SPONSOR_VIEWER' && m.role !== 'ADMIN')
    )
      throw AppError.invalid(
        'Co-admin and sponsor viewer require an Admin membership; staff lead requires Staff',
      );
    if (
      (await db.track.count({ where: { eventId: c.event.id, id: { in: input.trackIds } } })) !==
      new Set(input.trackIds).size
    )
      throw AppError.invalid('Choose event tracks');
    await db.eventMembership.update({ where: { id: m.id }, data: input });
    await audit(c, 'membership.access_changed', m.id);
    res.json({ ok: true });
  });
  router.get('/workspace/inbox', async (req, res) => {
    const c = requireCtx(req);
    res.json({
      messages: await db.messageDelivery.findMany({
        where: { eventId: c.event.id, membershipId: c.membership.id },
        select: { id: true, subject: true, body: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    });
  });
  router.get('/workspace/deliveries', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    res.json({
      deliveries: await db.messageDelivery.findMany({
        where: { eventId: c.event.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    });
  });
  router.post('/workspace/broadcast', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    const input = parse(
      z
        .object({
          subject: text.max(200),
          body: text,
          trackId: z.string().optional(),
          roundId: z.string().optional(),
          shortlistedOnly: z.boolean().default(false),
        })
        .strict(),
      req.body,
    );
    if (input.roundId) await loadRound(db, c, input.roundId);
    if (input.shortlistedOnly && !input.roundId)
      throw AppError.invalid('Choose the shortlist round');
    if (
      input.trackId &&
      !(await db.track.findFirst({ where: { id: input.trackId, eventId: c.event.id } }))
    )
      throw AppError.invalid('Choose an event track');
    const roundFilter = input.roundId ? await loadRound(db, c, input.roundId) : null;
    const entries = input.roundId
      ? await db.roundEntry.findMany({ where: { eventId: c.event.id, roundId: input.roundId } })
      : [];
    const teamMembers = await db.teamMember.findMany({
      where: {
        eventId: c.event.id,
        leftAt: null,
        team: {
          status: 'ACTIVE',
          ...(input.trackId ? { trackId: input.trackId } : {}),
          ...(input.shortlistedOnly || roundFilter?.shortlistEnabled
            ? { id: { in: entries.map((e) => e.teamId) } }
            : {}),
        },
      },
    });
    const all = await db.eventMembership.findMany({
      where: { eventId: c.event.id, status: 'ACTIVE', role: 'PARTICIPANT' },
    });
    const ids =
      input.trackId || input.shortlistedOnly || roundFilter?.shortlistEnabled
        ? new Set(teamMembers.map((m) => m.membershipId))
        : new Set(all.map((m) => m.id));
    const key = `broadcast:${crypto.randomUUID()}`;
    await db.messageDelivery.createMany({
      data: [...ids].map((membershipId) => ({
        eventId: c.event.id,
        membershipId,
        key,
        subject: input.subject,
        body: input.body,
      })),
    });
    await audit(c, 'announcement.broadcast_queued', key);
    res.json({ queued: ids.size });
  });
  router.get('/workspace/report.pdf', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    const [registrations, teams, submissions, checkins, tracks, feedback] = await Promise.all([
      db.registration.findMany({
        where: { eventId: c.event.id, status: 'ACTIVE' },
        select: { institution: true, answers: true },
      }),
      db.team.count({ where: { eventId: c.event.id, status: 'ACTIVE' } }),
      db.submission.count({ where: { eventId: c.event.id, lastVersionNo: { gt: 0 } } }),
      db.checkIn.count({ where: { eventId: c.event.id, undoneAt: null } }),
      db.track.findMany({
        where: { eventId: c.event.id },
        include: { _count: { select: { teams: true } } },
      }),
      db.feedbackResponse.count({ where: { form: { eventId: c.event.id } } }),
    ]);
    const colleges = new Map<string, number>();
    for (const r of registrations)
      colleges.set(r.institution, (colleges.get(r.institution) ?? 0) + 1);
    const { doc, fonts } = await createBrandDocument();
    let page = doc.addPage();
    let y = 780;
    const line = (s: string, size = 12) => {
      if (y < 60) {
        page = doc.addPage();
        y = 780;
      }
      page.drawText(safeText(fonts.text, s).slice(0, 105), {
        x: 45,
        y,
        size,
        font: fonts.text,
        color: PDF_COLORS.ink,
      });
      y -= size + 12;
    };
    line(c.event.name, 22);
    line('Post-event impact report', 17);
    line(`Generated ${new Date().toISOString().slice(0, 10)}`);
    for (const s of [
      `Participants: ${registrations.length}`,
      `Active teams: ${teams}`,
      `Round submissions: ${submissions}`,
      `Check-ins: ${checkins}`,
      `Feedback responses: ${feedback}`,
    ])
      line(s);
    const bar = (label: string, count: number, max: number) => {
      line(`${label}: ${count}`);
      page.drawRectangle({
        x: 45,
        y: y + 4,
        width: Math.max(1, (400 * count) / Math.max(1, max)),
        height: 6,
        color: PDF_COLORS.ember,
      });
      y -= 8;
    };
    line('College representation', 16);
    for (const [name, n] of [...colleges].sort((a, b) => b[1] - a[1]))
      bar(name, n, registrations.length);
    line('Track participation', 16);
    for (const t of tracks) bar(t.name, t._count.teams, teams);
    const demographicFields = await db.registrationFieldDef.findMany({
      where: {
        eventId: c.event.id,
        hidden: false,
        type: 'SELECT',
        OR: [
          { label: { contains: 'gender', mode: 'insensitive' } },
          { label: { contains: 'diversity', mode: 'insensitive' } },
        ],
      },
    });
    for (const field of demographicFields) {
      line(field.label, 16);
      const counts = new Map<string, number>();
      for (const r of registrations) {
        const val = (r.answers as Record<string, unknown>)[field.id];
        if (typeof val === 'string' && val) counts.set(val, (counts.get(val) ?? 0) + 1);
      }
      for (const [label, n] of counts) bar(label, n, registrations.length);
      if (!counts.size) line('No responses collected');
    }
    if (!demographicFields.length)
      line('Demographic breakdowns: no explicit gender/diversity fields configured.');
    const latestRound = await db.round.findFirst({
      where: { eventId: c.event.id },
      orderBy: { order: 'desc' },
    });
    if (latestRound) {
      const evaluated = await db.judgeAssignment.findMany({
        where: { roundId: latestRound.id, status: 'ACTIVE', evaluation: { status: 'SUBMITTED' } },
        include: { evaluation: true },
      });
      const teamTracks = await db.team.findMany({
        where: { eventId: c.event.id, status: 'ACTIVE' },
        select: { id: true, trackId: true },
      });
      line('Track evaluation averages (latest round)', 16);
      for (const t of tracks) {
        const ids = new Set(teamTracks.filter((x) => x.trackId === t.id).map((x) => x.id));
        const scores = evaluated
          .filter((e) => ids.has(e.teamId))
          .map((e) => Number(e.evaluation!.weightedScore));
        if (scores.length)
          line(
            `${t.name}: ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)} / 100 (${scores.length} evaluations)`,
          );
      }
    }
    res
      .type('application/pdf')
      .set('Content-Disposition', 'attachment; filename="event-impact-report.pdf"')
      .send(Buffer.from(await doc.save()));
  });
  return router;
}
