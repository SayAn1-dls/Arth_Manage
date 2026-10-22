import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('applies defaults and validates required values', () => {
    const env = loadEnv({ DATABASE_URL: 'postgresql://x/y', SESSION_SECRET: 'a'.repeat(32) });
    expect(env.API_PORT).toBe(4000);
    expect(env.EMAIL_PROVIDER).toBe('console');
  });

  it('rejects a short session secret with a readable message', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgresql://x/y', SESSION_SECRET: 'short' })).toThrow(
      /SESSION_SECRET/,
    );
  });
});
