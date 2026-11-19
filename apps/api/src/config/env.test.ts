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

  it("uses Render's external URL when APP_BASE_URL is unset", () => {
    const base = { DATABASE_URL: 'postgresql://x/y', SESSION_SECRET: 'a'.repeat(32) };
    const url = 'https://arthmanage-x1.onrender.com';
    expect(loadEnv({ ...base, RENDER_EXTERNAL_URL: url }).APP_BASE_URL).toBe(url);
    expect(
      loadEnv({ ...base, RENDER_EXTERNAL_URL: url, APP_BASE_URL: 'https://a.test' }).APP_BASE_URL,
    ).toBe('https://a.test');
    expect(loadEnv(base).APP_BASE_URL).toBe('http://localhost:5173');
  });

  it('rejects a short session secret with a readable message', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgresql://x/y', SESSION_SECRET: 'short' })).toThrow(
      /SESSION_SECRET/,
    );
  });
});
