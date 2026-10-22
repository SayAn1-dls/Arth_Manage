import { Router } from 'express';
import { registerForEventSchema } from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAuth } from '../../auth/middleware.js';
import { requireUser } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { createRegistrationService } from './service.js';

/** Public and signed-in registration entry points: the user has no membership yet, so these sit outside event scope. */
export function registrationRouter(deps: Deps) {
  const router = Router();
  const svc = createRegistrationService(deps);
  const { db } = deps;

  const publishedBySlug = async (slug: string) => {
    const event = await db.event.findUnique({ where: { slug } });
    if (!event || event.status === 'DRAFT') throw AppError.notFound();
    return event;
  };

  router.get('/public/events/:slug/registration-form', async (req, res) => {
    res.json(await svc.publicForm(await publishedBySlug(String(req.params.slug))));
  });

  // What the landing page needs to choose its primary action (Register / Go to my team / Registration closed).
  router.get('/public/events/:slug/me', requireAuth, async (req, res) => {
    const event = await publishedBySlug(String(req.params.slug));
    const m = await db.eventMembership.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: requireUser(req).id } },
      include: { registration: true },
    });
    res.json({
      eventId: event.id,
      role: m?.status === 'ACTIVE' || m?.status === 'REMOVED' ? m.role : null,
      removed: m?.status === 'REMOVED',
      registered: Boolean(
        m?.registration && m.registration.status === 'ACTIVE' && m.status === 'ACTIVE',
      ),
    });
  });

  router.post('/public/events/:slug/register', requireAuth, async (req, res) => {
    const event = await publishedBySlug(String(req.params.slug));
    const input = parse(registerForEventSchema, req.body);
    const result = await svc.register(requireUser(req), event, input);
    res.status(result.alreadyRegistered ? 200 : 201).json(result);
  });

  return router;
}
