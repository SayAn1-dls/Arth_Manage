import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { healthRouter } from './health.js';

export interface AppDeps {
  db: Db;
  logger: Logger;
}

export function createApp({ db, logger }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/v1', healthRouter(db));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
