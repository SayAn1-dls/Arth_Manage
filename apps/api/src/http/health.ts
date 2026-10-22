import { Router } from 'express';
import type { HealthResponse } from '@arthakram/shared';
import type { Db } from '../db/client.js';
import type { StorageProvider } from '../storage/provider.js';

/** 200 only when both the database and file storage work, so a load balancer or monitor sees a real outage. */
export function healthRouter(db: Db, storage: StorageProvider) {
  const router = Router();

  router.get('/health', async (_req, res) => {
    let database: HealthResponse['database'] = 'up';
    let store: HealthResponse['storage'] = 'up';
    await Promise.all([
      db.$queryRaw`SELECT 1`.catch(() => {
        database = 'down';
      }),
      storage.check().catch(() => {
        store = 'down';
      }),
    ]);
    const body: HealthResponse = {
      status: 'ok',
      database,
      storage: store,
      time: new Date().toISOString(),
    };
    res.status(database === 'up' && store === 'up' ? 200 : 503).json(body);
  });

  return router;
}
