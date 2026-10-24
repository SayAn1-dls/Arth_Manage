import type { Request } from 'express';
import type { Role } from '@arthakram/shared';
import type { Event, EventMembership, User } from '../generated/prisma/client.js';

export interface EventContext {
  event: Event;
  membership: EventMembership & { role: Role };
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    sessionId?: string;
    ctx?: EventContext;
  }
}

export function requireUser(req: Request): User {
  if (!req.user) throw new Error('requireUser called on an unauthenticated request');
  return req.user;
}

export function requireCtx(req: Request): EventContext {
  if (!req.ctx) throw new Error('requireCtx called outside an event-scoped route');
  return req.ctx;
}
