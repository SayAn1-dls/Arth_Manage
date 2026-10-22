import { Router } from 'express';
import type { MyEvent } from '@arthakram/shared';
import type { Deps } from '../http/deps.js';
import { requireAuth } from '../auth/middleware.js';
import { requireUser } from '../http/context.js';

export function meRouter({ db }: Deps) {
  const router = Router();

  // PRD FR-002: every event the user belongs to, with a role badge, status and dates.
  router.get('/me/events', requireAuth, async (req, res) => {
    const user = requireUser(req);
    const memberships = await db.eventMembership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { event: true },
      orderBy: { event: { startsAt: 'desc' } },
    });
    const events: MyEvent[] = memberships.map((m) => ({
      eventId: m.event.id,
      slug: m.event.slug,
      name: m.event.name,
      role: m.role,
      status: m.event.status,
      registrationStatus: m.event.registrationStatus,
      startsAt: m.event.startsAt.toISOString(),
      endsAt: m.event.endsAt.toISOString(),
      timeZone: m.event.timeZone,
    }));
    res.json({ events });
  });

  return router;
}
