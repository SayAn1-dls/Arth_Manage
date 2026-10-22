import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createDb } from './db/client.js';
import { ConsoleEmailProvider } from './email/provider.js';
import { LocalDiskStorage } from './storage/provider.js';
import { createApp } from './http/app.js';
import { createRateLimiter } from './http/rateLimit.js';

const env = loadEnv();
const logger = createLogger(env);
const db = createDb(env.DATABASE_URL);
const app = createApp({
  db,
  logger,
  env,
  email: new ConsoleEmailProvider(db, logger),
  storage: new LocalDiskStorage(env.STORAGE_DIR),
  limit: createRateLimiter(env.NODE_ENV !== 'test' && !env.RATE_LIMIT_DISABLED),
});

const server = app.listen(env.API_PORT, () => {
  logger.info(`API listening on http://localhost:${env.API_PORT}`);
});

async function shutdown() {
  server.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
