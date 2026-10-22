import type { RequestHandler } from 'express';
import { AppError } from './errors.js';

/** Small in-memory fixed-window limiter (single-process pilot deployment; see TECHNICAL_ARCHITECTURE §10). */
export function createRateLimiter(enabled: boolean) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return function limit(name: string, max: number, windowMs: number): RequestHandler {
    return (req, _res, next) => {
      if (!enabled) return next();
      const key = `${name}:${req.ip ?? 'unknown'}`;
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return next();
      }
      entry.count += 1;
      if (entry.count > max) {
        return next(
          new AppError(
            429,
            'rate_limited',
            'Too many requests. Please wait a moment and try again.',
          ),
        );
      }
      next();
    };
  };
}
export type RateLimiter = ReturnType<typeof createRateLimiter>;
