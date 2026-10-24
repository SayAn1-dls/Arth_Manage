import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createDb } from './db/client.js';
import { ConsoleEmailProvider, SmtpEmailProvider } from './email/provider.js';
import { LocalDiskStorage } from './storage/provider.js';
import { createApp } from './http/app.js';
import { createRateLimiter } from './http/rateLimit.js';
import { createGoogleProvider } from './integrations/google.js';
import { parseKey } from './integrations/crypto.js';
import { startSyncWorker } from './integrations/queue.js';
import { startMaintenance } from './auth/maintenance.js';
import type { Deps } from './http/deps.js';

const env = loadEnv();
const logger = createLogger(env);
const db = createDb(env.DATABASE_URL);
const deps: Deps = {
  db,
  logger,
  env,
  email:
    env.EMAIL_PROVIDER === 'smtp'
      ? SmtpEmailProvider.fromUrl(env.SMTP_URL!, env.EMAIL_FROM, logger)
      : new ConsoleEmailProvider(db, logger),
  storage: new LocalDiskStorage(env.STORAGE_DIR),
  limit: createRateLimiter(env.NODE_ENV !== 'test' && !env.RATE_LIMIT_DISABLED),
  google: createGoogleProvider({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${env.APP_BASE_URL}/api/v1/integrations/google/callback`,
    encryptionKeyOk: parseKey(env.TOKEN_ENCRYPTION_KEY) !== null,
  }),
};
// Fail fast: a server that cannot write uploads would accept registrations and then lose submissions.
await deps.storage.check().catch((err: unknown) => {
  logger.fatal({ err }, `File storage at ${env.STORAGE_DIR} is not writable`);
  process.exit(1);
});
const app = createApp(deps);
const stopWorker = startSyncWorker(deps);
const stopMaintenance = startMaintenance(deps);

const server = app.listen(env.API_PORT, () => {
  logger.info(`API listening on http://localhost:${env.API_PORT}`);
});

async function shutdown() {
  stopWorker();
  stopMaintenance();
  server.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
