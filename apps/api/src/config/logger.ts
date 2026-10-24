import { pino } from 'pino';
import type { Env } from './env.js';

export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>) {
  return pino({
    level: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
    // Secrets must never reach logs (PRD NFR-S2).
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'password',
        '*.password',
        '*.token',
      ],
      censor: '[redacted]',
    },
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  });
}
