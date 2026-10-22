import type { RequestHandler } from 'express';
import { AppError } from '../http/errors.js';
import type { Deps } from '../http/deps.js';
import { createAuthService } from './service.js';

export const SESSION_COOKIE = 'ak_session';
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'arthakram';

/**
 * Defence in depth on top of SameSite=Lax: state-changing requests must carry a custom header, which a
 * cross-site form post cannot set. The web client adds it to every non-GET call.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get(CSRF_HEADER) !== CSRF_VALUE) {
    return next(new AppError(403, 'csrf', 'Request rejected. Reload the page and try again.'));
  }
  next();
};

/** Resolves the cookie to req.user when valid; never fails by itself. */
export function sessionLoader(deps: Deps): RequestHandler {
  const auth = createAuthService(deps);
  return async (req, _res, next) => {
    const raw = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (raw) {
      const session = await auth.resolveSession(raw);
      if (session) {
        req.user = session.user;
        req.sessionId = session.id;
      }
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(AppError.unauthorized());
  next();
};
