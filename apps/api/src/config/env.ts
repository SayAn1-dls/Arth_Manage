import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    APP_BASE_URL: z.string().url().default('http://localhost:5173'),
    // Reverse proxies between the internet and the API. Rate limits use the client IP, so set 0 when there is no proxy.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    API_PORT: z.coerce.number().int().positive().default(4000),
    STORAGE_DIR: z.string().default('./.data/uploads'),
    EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default('Arthakram <no-reply@localhost>'),
    // Local development and automated browser runs sign in far more often than real users; never set in production.
    RATE_LIMIT_DISABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // Optional Google integration. Without all three, the integration screens say "not configured" and nothing is simulated.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    // 32 bytes, base64 or 64 hex characters. Encrypts stored Google tokens; must live outside the database.
    TOKEN_ENCRYPTION_KEY: z.string().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  })
  .refine((e) => e.EMAIL_PROVIDER !== 'smtp' || Boolean(e.SMTP_URL), {
    message: 'SMTP_URL is required when EMAIL_PROVIDER=smtp',
    path: ['SMTP_URL'],
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.EMAIL_PROVIDER === 'smtp', {
    message:
      'Production needs EMAIL_PROVIDER=smtp, otherwise verification and reset emails are never delivered',
    path: ['EMAIL_PROVIDER'],
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.APP_BASE_URL.startsWith('https://'), {
    message: 'Production APP_BASE_URL must be https',
    path: ['APP_BASE_URL'],
  });

export type Env = z.infer<typeof envSchema>;

/** Parse and validate the environment once; fail fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
