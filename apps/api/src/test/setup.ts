// Integration tests run against the dedicated test database, never the development one.
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile(new URL('../../../../.env', import.meta.url));
} catch {
  // .env is optional in CI; variables may come from the environment.
}

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789abcdef';
process.env.TOKEN_ENCRYPTION_KEY ??= 'ab'.repeat(32);
