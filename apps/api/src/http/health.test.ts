import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@arthakram/shared';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { createDb } from '../db/client.js';
import { createApp } from './app.js';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = createApp({ db, logger: createLogger(env) });

afterAll(() => db.$disconnect());

describe('GET /api/v1/health', () => {
  it('reports ok and database up', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body).database).toBe('up');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns a JSON 404 without stack traces for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
    expect(JSON.stringify(res.body)).not.toContain('at ');
  });
});
