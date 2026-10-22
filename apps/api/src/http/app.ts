import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Deps } from './deps.js';
import { AppError, errorHandler, notFoundHandler } from './errors.js';
import { healthRouter } from './health.js';
import { authRouter } from '../auth/routes.js';
import { csrfGuard, sessionLoader } from '../auth/middleware.js';
import { meRouter } from '../modules/me.js';
import { devRouter } from '../modules/dev.js';
import { eventsRouter } from '../modules/events/routes.js';
import { syncHooks } from '../modules/integrations/routes.js';

export function createApp(deps: Deps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.env.TRUST_PROXY_HOPS);
  app.use(pinoHttp({ logger: deps.logger }));
  // Everything is same-origin: scripts, styles, fonts and images come from this origin only.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // React sets inline style attributes (progress bars, widths)
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  // PostgreSQL cannot store NUL characters; reject them up front instead of failing deep inside a query.
  app.use((req, _res, next) => {
    const hasNul = (v: unknown): boolean =>
      typeof v === 'string'
        ? v.includes('\u0000')
        : Array.isArray(v)
          ? v.some(hasNul)
          : v !== null && typeof v === 'object'
            ? Object.entries(v).some(([k, x]) => k.includes('\u0000') || hasNul(x))
            : false;
    if (hasNul(req.query) || hasNul(req.body))
      return next(AppError.invalid('The request contains a character that is not allowed', {}));
    next();
  });

  const api = express.Router();
  // Responses carry personal data and per-user state; never let a shared cache keep them.
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(csrfGuard);
  api.use(sessionLoader(deps));
  api.use(healthRouter(deps.db));
  api.use(authRouter(deps));
  api.use(syncHooks(deps));
  api.use(meRouter(deps));
  api.use(eventsRouter(deps));
  if (deps.env.NODE_ENV !== 'production') api.use(devRouter(deps));
  app.use('/api/v1', api);

  // One process can serve the built web app too (apps/web/dist), with client-side routes falling back to index.html.
  const webDist = fileURLToPath(new URL('../../../web/dist', import.meta.url));
  if (deps.env.NODE_ENV === 'production' && existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile('index.html', { root: webDist }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
