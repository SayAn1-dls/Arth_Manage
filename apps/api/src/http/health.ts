import { Router } from 'express';
import type { HealthResponse } from '@arthakram/shared';
import type { Db } from '../db/client.js';

export function healthRouter(db: Db) {
  const router = Router();

  router.get('/health', async (_req, res) => {
    let database: HealthResponse['database'] = 'up';
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    const body: HealthResponse = { status: 'ok', database, time: new Date().toISOString() };
    res.status(database === 'up' ? 200 : 503).json(body);
  });

  return router;
}
