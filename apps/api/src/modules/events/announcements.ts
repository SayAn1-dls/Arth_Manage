import { Router } from 'express';
import { announcementSchema } from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { assertWritable } from './service.js';

const AUDIENCES_FOR_ROLE = {
  ADMIN: ['EVERYONE', 'PARTICIPANTS', 'JUDGES', 'STAFF'],
  PARTICIPANT: ['EVERYONE', 'PARTICIPANTS'],
  JUDGE: ['EVERYONE', 'JUDGES'],
  STAFF: ['EVERYONE', 'STAFF'],
} as const;

/** Announcements (PRD FR-007): admins post to an audience; each role only ever reads its own audiences. */
export function announcementsRouter({ db }: Deps) {
  const router = Router({ mergeParams: true });

  router.get('/announcements', requireAction('announcements.view'), async (req, res) => {
    const ctx = requireCtx(req);
    const rows = await db.announcement.findMany({
      where: {
        eventId: ctx.event.id,
        audience: { in: [...AUDIENCES_FOR_ROLE[ctx.membership.role]] },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({
      announcements: rows.map((a) => ({
        id: a.id,
        audience: a.audience,
        title: a.title,
        body: a.body,
        createdAt: a.createdAt,
        edited: Boolean(a.editedAt),
      })),
    });
  });

  router.post('/announcements', requireAction('announcements.post'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const input = parse(announcementSchema, req.body);
    const a = await db.$transaction(async (tx) => {
      const row = await tx.announcement.create({
        data: { eventId: ctx.event.id, authorId: ctx.membership.userId, ...input },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'announcement.created',
        entityType: 'Announcement',
        entityId: row.id,
        after: { title: row.title, audience: row.audience },
      });
      return row;
    });
    res.status(201).json(a);
  });

  router.patch('/announcements/:id', requireAction('announcements.post'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const existing = await db.announcement.findFirst({
      where: { id: String(req.params.id), eventId: ctx.event.id },
    });
    if (!existing) throw AppError.notFound();
    const input = parse(announcementSchema, req.body);
    const a = await db.$transaction(async (tx) => {
      const row = await tx.announcement.update({
        where: { id: existing.id },
        data: { ...input, editedAt: new Date() },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'announcement.updated',
        entityType: 'Announcement',
        entityId: row.id,
        before: { title: existing.title, audience: existing.audience },
        after: { title: row.title, audience: row.audience },
      });
      return row;
    });
    res.json(a);
  });

  router.delete('/announcements/:id', requireAction('announcements.post'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const existing = await db.announcement.findFirst({
      where: { id: String(req.params.id), eventId: ctx.event.id },
    });
    if (!existing) throw AppError.notFound();
    await db.$transaction(async (tx) => {
      await tx.announcement.delete({ where: { id: existing.id } });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'announcement.deleted',
        entityType: 'Announcement',
        entityId: existing.id,
        before: { title: existing.title },
      });
    });
    res.status(204).end();
  });

  return router;
}
