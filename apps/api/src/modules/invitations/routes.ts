import { Router } from 'express';
import { inviteSchema, tokenSchema } from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAuth } from '../../auth/middleware.js';
import { newToken, sha256 } from '../../auth/crypto.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx, requireUser } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { assertWritable } from '../events/service.js';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const ROLE_NAME = {
  ADMIN: 'a core admin',
  JUDGE: 'a judge',
  STAFF: 'helping staff',
  PARTICIPANT: 'a participant',
} as const;

/** Invitations for core admins, judges and helping staff, and member management (PRD FR-006, §8.2, §8.4). */
export function invitationsRouter(deps: Deps) {
  const { db, email, env, limit } = deps;
  const accept = Router();
  const scoped = Router({ mergeParams: true });

  accept.post(
    '/invitations/accept',
    requireAuth,
    limit('invite-accept', 20, 15 * 60 * 1000),
    async (req, res) => {
      const user = requireUser(req);
      const { token } = parse(tokenSchema, req.body);
      const inv = await db.invitation.findUnique({
        where: { tokenHash: sha256(token) },
        include: { event: true },
      });
      if (!inv || inv.status !== 'PENDING' || inv.expiresAt < new Date()) {
        throw new AppError(
          400,
          'invitation_expired',
          'This invitation has expired or was already used',
        );
      }
      if (inv.email !== user.email) {
        throw AppError.forbidden(
          `This invitation was sent to ${inv.email}. Sign in with that address to accept it.`,
        );
      }
      const existing = await db.eventMembership.findUnique({
        where: { eventId_userId: { eventId: inv.eventId, userId: user.id } },
      });
      if (existing && existing.status !== 'REMOVED') {
        throw AppError.conflict(
          'role_conflict',
          `You are already ${ROLE_NAME[existing.role]} in this event, and a person can hold only one role per event.`,
        );
      }
      await db.$transaction(async (tx) => {
        if (existing)
          await tx.eventMembership.update({
            where: { id: existing.id },
            data: { role: inv.role, status: 'ACTIVE', invitedById: inv.invitedById },
          });
        else
          await tx.eventMembership.create({
            data: {
              eventId: inv.eventId,
              userId: user.id,
              role: inv.role,
              invitedById: inv.invitedById,
            },
          });
        await tx.invitation.update({
          where: { id: inv.id },
          data: { status: 'ACCEPTED', acceptedAt: new Date() },
        });
        await writeAudit(tx, {
          eventId: inv.eventId,
          actorId: user.id,
          action: 'member.joined',
          entityType: 'EventMembership',
          after: { role: inv.role, via: 'invitation' },
        });
      });
      res.json({ eventId: inv.eventId, eventName: inv.event.name, role: inv.role });
    },
  );

  scoped.use(requireAuth);

  scoped.get('/members', requireAction('members.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    const [members, invitations] = await Promise.all([
      db.eventMembership.findMany({
        where: {
          eventId: ctx.event.id,
          role: { in: ['ADMIN', 'JUDGE', 'STAFF'] },
          status: { not: 'REMOVED' },
        },
        include: { user: true },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      }),
      db.invitation.findMany({
        where: { eventId: ctx.event.id, status: 'PENDING', expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    res.json({
      members: members.map((m) => ({
        membershipId: m.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        owner: m.userId === ctx.event.ownerId,
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt,
      })),
    });
  });

  scoped.post(
    '/invitations',
    limit('invite-send', 100, 60 * 60 * 1000),
    requireAction('members.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      assertWritable(ctx);
      const { email: to, role } = parse(inviteSchema, req.body);
      const user = await db.user.findUnique({ where: { email: to } });
      if (user) {
        const m = await db.eventMembership.findUnique({
          where: { eventId_userId: { eventId: ctx.event.id, userId: user.id } },
        });
        if (m && m.status !== 'REMOVED') {
          throw AppError.conflict(
            'role_conflict',
            `${to} is already ${ROLE_NAME[m.role]} in this event, and a person can hold only one role per event.`,
          );
        }
      }
      // A fresh invitation replaces an earlier pending one for the same address.
      await db.invitation.updateMany({
        where: { eventId: ctx.event.id, email: to, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      const token = newToken();
      const inv = await db.$transaction(async (tx) => {
        const row = await tx.invitation.create({
          data: {
            eventId: ctx.event.id,
            email: to,
            role,
            tokenHash: sha256(token),
            invitedById: ctx.membership.userId,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'member.invited',
          entityType: 'Invitation',
          entityId: row.id,
          after: { email: to, role },
        });
        return row;
      });
      await email.send({
        to,
        subject: `You're invited to ${ctx.event.name} as ${ROLE_NAME[role]}`,
        body: `You have been invited to ${ctx.event.name} as ${ROLE_NAME[role]}. Sign in (or create an account) with this email address to accept. The invitation expires in 14 days.`,
        link: `${env.APP_BASE_URL}/invitations/accept?token=${token}`,
      });
      res
        .status(201)
        .json({ id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt });
    },
  );

  scoped.delete('/invitations/:id', requireAction('members.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const inv = await db.invitation.findFirst({
      where: { id: String(req.params.id), eventId: ctx.event.id, status: 'PENDING' },
    });
    if (!inv) throw AppError.notFound();
    await db.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id: inv.id }, data: { status: 'REVOKED' } });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'member.invitation_revoked',
        entityType: 'Invitation',
        entityId: inv.id,
        after: { email: inv.email },
      });
    });
    res.status(204).end();
  });

  // Removal effects (PRD §8.4): access is denied from the next request; the owner and the last admin stay.
  scoped.delete('/members/:membershipId', requireAction('members.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const m = await db.eventMembership.findFirst({
      where: {
        id: String(req.params.membershipId),
        eventId: ctx.event.id,
        role: { in: ['ADMIN', 'JUDGE', 'STAFF'] },
        status: 'ACTIVE',
      },
    });
    if (!m) throw AppError.notFound();
    if (m.userId === ctx.event.ownerId)
      throw AppError.conflict('owner', 'The event owner cannot be removed');
    if (
      m.role === 'ADMIN' &&
      (await db.eventMembership.count({
        where: { eventId: ctx.event.id, role: 'ADMIN', status: 'ACTIVE' },
      })) <= 1
    ) {
      throw AppError.conflict('last_admin', 'The last core admin cannot be removed');
    }
    await db.$transaction(async (tx) => {
      await tx.eventMembership.update({ where: { id: m.id }, data: { status: 'REMOVED' } });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'member.removed',
        entityType: 'EventMembership',
        entityId: m.id,
        after: { role: m.role },
      });
    });
    res.status(204).end();
  });

  return { accept, scoped };
}
