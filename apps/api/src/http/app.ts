import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Deps } from './deps.js';
import { errorHandler, notFoundHandler } from './errors.js';
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
  app.set('trust proxy', 1);
  app.use(pinoHttp({ logger: deps.logger }));
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
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
