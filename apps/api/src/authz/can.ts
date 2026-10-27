import type { RequestHandler } from 'express';
import { ACTIONS, scopeFor, type Action, type Role, type Scope } from '@arthakram/shared';
import { AppError } from '../http/errors.js';
import type { Deps } from '../http/deps.js';
import { requireCtx } from '../http/context.js';

/** Actions that routes actually enforce; a test asserts each one exists in the PERMISSIONS matrix. */
export const enforcedActions = new Set<Action>();

/** The caller's scope for an action in this event, from the matrix. NONE means no access. */
export function scopeOf(role: Role, action: Action): Scope {
  return scopeFor(role, action);
}

export function assertKnownActions(): Action[] {
  return [...enforcedActions].filter((a) => !ACTIONS.includes(a));
}

/**
 * Event-scoped authorisation, step 1: resolve the event and the caller's ACTIVE membership in it.
 * The event id comes from the URL; every nested record is later checked to belong to this event
 * (PRD 8.2-4). No membership means "not found", and the attempt is logged (PRD 8.3).
 */
export function eventContext(deps: Deps): RequestHandler {
  return async (req, _res, next) => {
    const eventId = req.params.eventId as string;
    const user = req.user;
    if (!user) return next(AppError.unauthorized());
    const membership = await deps.db.eventMembership.findUnique({
      where: { eventId_userId: { eventId, userId: user.id } },
      include: { event: true },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      deps.logger.warn({ userId: user.id, eventId }, 'denied: no active membership in event');
      return next(AppError.notFound());
    }
    const { event, ...m } = membership;
    if (
      m.accessLevel === 'SPONSOR_VIEWER' &&
      !(req.method === 'GET' && /\/workspace\/report\.pdf$/.test(req.originalUrl.split('?')[0]!))
    )
      return next(AppError.notFound());
    req.ctx = { event, membership: m };
    next();
  };
}

/** Step 2: the matrix check. Records inside the event are still scoped by the route/service (OWN/ASSIGNED). */
export function requireAction(action: Action): RequestHandler {
  enforcedActions.add(action);
  return (req, _res, next) => {
    const { membership, event } = requireCtx(req);
    if (scopeOf(membership.role, action) === 'NONE') {
      req.log?.warn(
        { userId: membership.userId, eventId: event.id, action },
        'denied by permission matrix',
      );
      return next(AppError.notFound());
    }
    next();
  };
}
