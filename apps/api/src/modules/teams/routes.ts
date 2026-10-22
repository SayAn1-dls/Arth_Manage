import { Router } from 'express';
import {
  confirmJoinSchema,
  createTeamSchema,
  joinTeamSchema,
  membershipRefSchema,
  updateTeamSchema,
} from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { assertWritable } from '../events/service.js';
import {
  activeTeamOf,
  assertRegistrationOpen,
  createTeamTx,
  isUniqueViolation,
  newJoinCode,
  removeMemberTx,
  teamDto,
} from './service.js';

const FAILED_JOIN_LIMIT = 10;
const FAILED_JOIN_WINDOW_MS = 10 * 60 * 1000;

/** Participant self-service team routes (PRD FR-052..057). Core Admins use the admin routes instead. */
export function participantTeamsRouter({ db }: Deps) {
  const router = Router({ mergeParams: true });

  /** Participants only: resolves the caller's registration state or explains why they cannot act. */
  async function participantOf(req: Parameters<typeof requireCtx>[0]) {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    if (ctx.membership.role !== 'PARTICIPANT') throw AppError.notFound();
    const reg = await db.registration.findUnique({ where: { membershipId: ctx.membership.id } });
    if (!reg || reg.status !== 'ACTIVE')
      throw AppError.conflict('not_registered', 'Register for the event first');
    return {
      ctx,
      event: ctx.event,
      membershipId: ctx.membership.id,
      userId: ctx.membership.userId,
    };
  }

  router.get('/my-team', requireAction('team.view'), async (req, res) => {
    const ctx = requireCtx(req);
    if (ctx.membership.role !== 'PARTICIPANT') throw AppError.notFound();
    const m = await activeTeamOf(db, ctx.event.id, ctx.membership.id);
    if (!m) return void res.json({ team: null });
    res.json({
      team: await teamDto(db, ctx.event, m.teamId, {
        role: 'PARTICIPANT',
        membershipId: ctx.membership.id,
      }),
    });
  });

  router.post('/teams', requireAction('team.edit'), async (req, res) => {
    const { event, membershipId, userId } = await participantOf(req);
    assertRegistrationOpen(event);
    const { name } = parse(createTeamSchema, req.body);
    const current = await activeTeamOf(db, event.id, membershipId);
    if (current)
      throw AppError.conflict(
        'already_in_team',
        `You're already in ${current.team.name}. Leave it before creating another team.`,
      );
    try {
      const team = await db.$transaction(async (tx) => {
        const t = await createTeamTx(tx, event, membershipId, name);
        await writeAudit(tx, {
          eventId: event.id,
          actorId: userId,
          action: 'team.created',
          entityType: 'Team',
          entityId: t.id,
          after: { name: t.name, teamCode: t.teamCode },
        });
        return t;
      });
      res
        .status(201)
        .json({ team: await teamDto(db, event, team.id, { role: 'PARTICIPANT', membershipId }) });
    } catch (err) {
      if (isUniqueViolation(err, 'team_name_unique_per_event') || isUniqueViolation(err, 'lower')) {
        throw AppError.invalid('A team with this name already exists', {
          name: 'A team with this name already exists',
        });
      }
      if (isUniqueViolation(err))
        throw AppError.conflict('already_in_team', "You're already in a team for this event.");
      throw err;
    }
  });

  /** Looks a join code up and records failed attempts; blocks after 10 failures in 10 minutes (PRD FR-053). */
  async function lookupCode(eventId: string, userId: string, code: string) {
    const since = new Date(Date.now() - FAILED_JOIN_WINDOW_MS);
    const failures = await db.joinAttempt.count({
      where: { userId, eventId, success: false, at: { gte: since } },
    });
    if (failures >= FAILED_JOIN_LIMIT) {
      throw new AppError(429, 'too_many_attempts', 'Too many attempts. Try again in 10 minutes.');
    }
    const team = await db.team.findUnique({
      where: { eventId_joinCode: { eventId, joinCode: code } },
    });
    if (!team || team.status !== 'ACTIVE') {
      await db.joinAttempt.create({ data: { userId, eventId, success: false } });
      throw AppError.invalid('Code not recognised.', { code: 'Code not recognised.' });
    }
    return team;
  }

  router.post('/teams/join/preview', requireAction('team.edit'), async (req, res) => {
    const { event, userId } = await participantOf(req);
    assertRegistrationOpen(event);
    const { code } = parse(joinTeamSchema, req.body);
    const team = await lookupCode(event.id, userId, code);
    const members = await db.teamMember.findMany({
      where: { teamId: team.id, leftAt: null },
      include: { membership: { include: { registration: true, user: true } } },
    });
    const leader = members.find((m) => m.role === 'LEADER');
    res.json({
      name: team.name,
      leaderName: leader?.membership.registration?.fullName ?? leader?.membership.user.name ?? '',
      size: members.length,
      max: event.teamMax,
      full: members.length >= event.teamMax,
    });
  });

  router.post('/teams/join', requireAction('team.edit'), async (req, res) => {
    const { event, membershipId, userId } = await participantOf(req);
    assertRegistrationOpen(event);
    const { code } = parse(confirmJoinSchema, req.body);
    const found = await lookupCode(event.id, userId, code);
    const current = await activeTeamOf(db, event.id, membershipId);
    if (current)
      throw AppError.conflict(
        'already_in_team',
        `You're already in ${current.team.name}. Leave it before joining another team.`,
      );

    try {
      await db.$transaction(async (tx) => {
        // Lock the team row so the size check and the insert are one atomic step (PRD FR-053): two people
        // taking the last slot at once cannot both succeed.
        const locked = await tx.$queryRaw<
          { id: string; status: string }[]
        >`SELECT id, status FROM "Team" WHERE id = ${found.id} AND "eventId" = ${event.id} FOR UPDATE`;
        if (!locked[0] || locked[0].status !== 'ACTIVE')
          throw AppError.invalid('Code not recognised.', { code: 'Code not recognised.' });
        const size = await tx.teamMember.count({ where: { teamId: found.id, leftAt: null } });
        if (size >= event.teamMax) {
          throw AppError.conflict(
            'team_full',
            `${found.name} is full (${size}/${event.teamMax}). Ask the leader or create your own team.`,
          );
        }
        await tx.teamMember.create({
          data: { teamId: found.id, eventId: event.id, membershipId, role: 'MEMBER' },
        });
        await tx.joinAttempt.create({ data: { userId, eventId: event.id, success: true } });
        await writeAudit(tx, {
          eventId: event.id,
          actorId: userId,
          action: 'team.member_joined',
          entityType: 'Team',
          entityId: found.id,
          after: { membershipId },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw AppError.conflict('already_in_team', "You're already in a team for this event.");
      throw err;
    }
    res.json({ team: await teamDto(db, event, found.id, { role: 'PARTICIPANT', membershipId }) });
  });

  async function myTeamAsLeader(
    req: Parameters<typeof requireCtx>[0],
    { requireOpen = true } = {},
  ) {
    const p = await participantOf(req);
    if (requireOpen) assertRegistrationOpen(p.event);
    const m = await activeTeamOf(db, p.event.id, p.membershipId);
    if (!m) throw AppError.notFound();
    if (m.role !== 'LEADER') throw AppError.forbidden('Only the team leader can do this');
    return { ...p, team: m.team };
  }

  router.patch('/my-team', requireAction('team.edit'), async (req, res) => {
    const p = await participantOf(req);
    const m = await activeTeamOf(db, p.event.id, p.membershipId);
    if (!m) throw AppError.notFound();
    if (m.role !== 'LEADER') throw AppError.forbidden('Only the team leader can do this');
    const input = parse(updateTeamSchema, req.body);
    const data: Record<string, unknown> = {};

    if (input.name !== undefined && input.name !== m.team.name) {
      assertRegistrationOpen(p.event); // the name is editable until registration closes (PRD FR-057)
      data.name = input.name;
    }
    if (input.trackId !== undefined || input.problemId !== undefined) {
      await assertSelectionOpen(db, p.event.id); // until the Round 1 submission deadline (FR-061)
      const trackId = input.trackId === undefined ? m.team.trackId : input.trackId;
      const problemId = input.problemId === undefined ? m.team.problemId : input.problemId;
      if (trackId && !(await db.track.findFirst({ where: { id: trackId, eventId: p.event.id } }))) {
        throw AppError.invalid('That track does not belong to this event', {
          trackId: 'Choose a track from this event',
        });
      }
      if (problemId) {
        const problem = await db.problemStatement.findFirst({
          where: { id: problemId, eventId: p.event.id },
        });
        if (!problem)
          throw AppError.invalid('That problem statement does not belong to this event', {
            problemId: 'Choose a problem statement from this event',
          });
        if (trackId && problem.trackId && problem.trackId !== trackId) {
          throw AppError.invalid('That problem statement belongs to a different track', {
            problemId: 'Choose a statement from your track',
          });
        }
      }
      data.trackId = trackId;
      data.problemId = problemId;
    }
    if (Object.keys(data).length === 0)
      return void res.json({
        team: await teamDto(db, p.event, m.teamId, {
          role: 'PARTICIPANT',
          membershipId: p.membershipId,
        }),
      });

    try {
      const updated = await db.$transaction(async (tx) => {
        const r = await tx.team.updateMany({
          where: { id: m.teamId, version: input.version },
          data: { ...data, version: { increment: 1 } },
        });
        if (r.count === 0)
          throw AppError.conflict(
            'stale_version',
            'This team was changed by someone else. Reload to see the latest version.',
          );
        await writeAudit(tx, {
          eventId: p.event.id,
          actorId: p.userId,
          action: 'team.updated',
          entityType: 'Team',
          entityId: m.teamId,
          before: { name: m.team.name, trackId: m.team.trackId, problemId: m.team.problemId },
          after: data,
        });
        return tx.team.findUniqueOrThrow({ where: { id: m.teamId } });
      });
      res.json({
        team: await teamDto(db, p.event, updated.id, {
          role: 'PARTICIPANT',
          membershipId: p.membershipId,
        }),
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw AppError.invalid('A team with this name already exists', {
          name: 'A team with this name already exists',
        });
      throw err;
    }
  });

  router.post('/my-team/regenerate-code', requireAction('team.edit'), async (req, res) => {
    const { event, team, userId, membershipId } = await myTeamAsLeader(req);
    for (let i = 0; i < 5; i++) {
      try {
        await db.$transaction(async (tx) => {
          await tx.team.update({
            where: { id: team.id },
            data: { joinCode: newJoinCode(), version: { increment: 1 } },
          });
          await writeAudit(tx, {
            eventId: event.id,
            actorId: userId,
            action: 'team.join_code_regenerated',
            entityType: 'Team',
            entityId: team.id,
          });
        });
        break;
      } catch (err) {
        if (!isUniqueViolation(err) || i === 4) throw err;
      }
    }
    res.json({ team: await teamDto(db, event, team.id, { role: 'PARTICIPANT', membershipId }) });
  });

  router.delete('/my-team/members/:membershipId', requireAction('team.edit'), async (req, res) => {
    const { event, team, userId, membershipId } = await myTeamAsLeader(req);
    const target = String(req.params.membershipId);
    if (target === membershipId)
      throw AppError.conflict('use_leave', 'Use "Leave team" to leave your own team.');
    await db.$transaction(async (tx) => {
      await removeMemberTx(tx, event, team.id, target, { actorId: userId });
      await writeAudit(tx, {
        eventId: event.id,
        actorId: userId,
        action: 'team.member_removed',
        entityType: 'Team',
        entityId: team.id,
        after: { membershipId: target },
      });
    });
    res.json({ team: await teamDto(db, event, team.id, { role: 'PARTICIPANT', membershipId }) });
  });

  router.post('/my-team/leave', requireAction('team.edit'), async (req, res) => {
    const p = await participantOf(req);
    assertRegistrationOpen(p.event);
    const m = await activeTeamOf(db, p.event.id, p.membershipId);
    if (!m) throw AppError.notFound();
    const { dissolved } = await db.$transaction(async (tx) => {
      const r = await removeMemberTx(tx, p.event, m.teamId, p.membershipId, { actorId: p.userId });
      await writeAudit(tx, {
        eventId: p.event.id,
        actorId: p.userId,
        action: 'team.member_left',
        entityType: 'Team',
        entityId: m.teamId,
      });
      return r;
    });
    res.json({ left: true, dissolved });
  });

  router.post('/my-team/transfer', requireAction('team.edit'), async (req, res) => {
    const { event, team, userId, membershipId } = await myTeamAsLeader(req);
    const { membershipId: to } = parse(membershipRefSchema, req.body);
    await db.$transaction(async (tx) => {
      const target = await tx.teamMember.findFirst({
        where: { teamId: team.id, eventId: event.id, membershipId: to, leftAt: null },
      });
      if (!target || target.membershipId === membershipId)
        throw AppError.invalid('Choose another member of your team');
      await tx.teamMember.updateMany({
        where: { teamId: team.id, leftAt: null, role: 'LEADER' },
        data: { role: 'MEMBER' },
      });
      await tx.teamMember.update({ where: { id: target.id }, data: { role: 'LEADER' } });
      await writeAudit(tx, {
        eventId: event.id,
        actorId: userId,
        action: 'team.leader_transferred',
        entityType: 'Team',
        entityId: team.id,
        after: { membershipId: to },
      });
    });
    res.json({ team: await teamDto(db, event, team.id, { role: 'PARTICIPANT', membershipId }) });
  });

  return router;
}

/** Track and problem selection stay open until the Round 1 submission deadline (PRD FR-061/062). */
async function assertSelectionOpen(db: Deps['db'], eventId: string) {
  const first = await db.round.findFirst({ where: { eventId }, orderBy: { order: 'asc' } });
  if (first?.submissionDeadline && first.submissionDeadline <= new Date()) {
    throw AppError.conflict(
      'selection_locked',
      'Track and problem statement choices closed at the Round 1 submission deadline.',
    );
  }
}
