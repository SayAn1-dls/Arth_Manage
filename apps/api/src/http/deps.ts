import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import type { Env } from '../config/env.js';
import type { EmailProvider } from '../email/provider.js';
import type { RateLimiter } from './rateLimit.js';
import type { StorageProvider } from '../storage/provider.js';
import type { GoogleProvider } from '../integrations/google.js';

/** Everything a module needs, passed explicitly so tests can swap pieces. */
export interface Deps {
  db: Db;
  logger: Logger;
  env: Env;
  email: EmailProvider;
  limit: RateLimiter;
  storage: StorageProvider;
  google: GoogleProvider;
}
