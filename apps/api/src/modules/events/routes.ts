import { Router } from 'express';
import { z } from 'zod';
import { createEventSchema, registrationControlSchema, updateEventSchema } from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAuth } from '../../auth/middleware.js';
import { eventContext, requireAction } from '../../authz/can.js';
import { requireCtx, requireUser } from '../../http/context.js';
import { parse } from '../../http/validate.js';
import { AppError } from '../../http/errors.js';
import { eventDto } from './dto.js';
import { createEventService } from './service.js';
import { structureRouter } from './structure.js';
import { guidebookRouter } from './guidebook.js';
import { announcementsRouter } from './announcements.js';

export function eventsRouter(deps: Deps) {
  const router = Router();
  const svc = createEventService(deps);
  const { db } = deps;

  // Any verified user may create an event and becomes its owner and Core Admin (DECISIONS D-06, OQ-02).
  router.post('/events', requireAuth, async (req, res) => {
    const event = await svc.create(requireUser(req), parse(createEventSchema, req.body));
    res.status(201).json(eventDto(event));
  });

  // Public landing data: published events only, no private fields (PRD 5.2-4).
  router.get('/public/events/:slug', async (req, res) => {
    const event = await db.event.findUnique({ where: { slug: String(req.params.slug) } });
    if (!event || event.status === 'DRAFT') throw AppError.notFound();
    const [rounds, tracks] = await Promise.all([
      db.round.findMany({ where: { eventId: event.id }, orderBy: { order: 'asc' } }),
      db.track.findMany({ where: { eventId: event.id }, orderBy: { order: 'asc' } }),
    ]);
    res.json({
      event: {
        slug: event.slug,
        name: event.name,
        type: event.type,
        mode: event.mode,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timeZone: event.timeZone,
        institution: event.institution,
        venue: event.venue,
        description: event.description,
        eligibility: event.eligibility,
        status: event.status,
        registrationStatus: event.registrationStatus,
        registrationOpensAt: event.registrationOpensAt,
        registrationClosesAt: event.registrationClosesAt,
        teamMin: event.teamMin,
        teamMax: event.teamMax,
        contactEmail: event.contactEmail,
      },
      rounds: rounds.map((r) => ({ name: r.name, submissionDeadline: r.submissionDeadline })),
      tracks: tracks.map((t) => ({ name: t.name, description: t.description })),
    });
  });

  const scoped = Router({ mergeParams: true });
  scoped.use(requireAuth, eventContext(deps));

  scoped.get('/', requireAction('event.view'), (req, res) => {
    res.json(eventDto(requireCtx(req).event));
  });

  scoped.patch('/', requireAction('event.edit'), async (req, res) => {
    const event = await svc.update(requireCtx(req), parse(updateEventSchema, req.body));
    res.json(eventDto(event));
  });

  scoped.get('/publish-checks', requireAction('event.edit'), async (req, res) => {
    res.json(await svc.publishChecks(requireCtx(req).event));
  });

  scoped.post('/publish', requireAction('event.edit'), async (req, res) => {
    const { event, warnings } = await svc.publish(requireCtx(req));
    res.json({ event: eventDto(event), warnings });
  });

  scoped.post('/unpublish', requireAction('event.edit'), async (req, res) => {
    res.json(eventDto(await svc.unpublish(requireCtx(req))));
  });

  scoped.put('/registration', requireAction('event.edit'), async (req, res) => {
    res.json(
      eventDto(
        await svc.setRegistration(requireCtx(req), parse(registrationControlSchema, req.body)),
      ),
    );
  });

  scoped.post('/conclude', requireAction('event.edit'), async (req, res) => {
    const { confirmWithoutResults } = parse(
      z.object({ confirmWithoutResults: z.boolean().default(false) }).strict(),
      req.body ?? {},
    );
    res.json(eventDto(await svc.conclude(requireCtx(req), confirmWithoutResults)));
  });

  scoped.post('/archive', requireAction('event.edit'), async (req, res) => {
    res.json(eventDto(await svc.archive(requireCtx(req))));
  });

  scoped.use(structureRouter(deps));
  scoped.use(guidebookRouter(deps));
  scoped.use(announcementsRouter(deps));

  router.use('/events/:eventId', scoped);
  return router;
}
