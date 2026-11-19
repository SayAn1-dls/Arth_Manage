import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('applies defaults and validates required values', () => {
    const env = loadEnv({ DATABASE_URL: 'postgresql://x/y', SESSION_SECRET: 'a'.repeat(32) });
    expect(env.API_PORT).toBe(4000);
    expect(env.EMAIL_PROVIDER).toBe('console');
  });

  it('falls back to the host-provided PORT when API_PORT is unset', () => {
    const base = { DATABASE_URL: 'postgresql://x/y', SESSION_SECRET: 'a'.repeat(32) };
    expect(loadEnv({ ...base, PORT: '10000' }).API_PORT).toBe(10000);
    expect(loadEnv({ ...base, PORT: '10000', API_PORT: '4100' }).API_PORT).toBe(4100);
  });

  it('rejects a short session secret with a readable message', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgresql://x/y', SESSION_SECRET: 'short' })).toThrow(
      /SESSION_SECRET/,
    );
  });
});
