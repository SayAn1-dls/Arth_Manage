import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@arthakram/shared';
import { createTestKit } from '../test/helpers.js';
import { createApp } from './app.js';

const { app, db } = createTestKit();
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

describe('health reflects file storage too', () => {
  it('answers 503 when storage cannot be written, so a monitor sees the outage', async () => {
    const kit = createTestKit();
    kit.deps.storage.check = async () => {
      throw new Error('disk full');
    };
    const res = await request(createApp(kit.deps)).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ database: 'up', storage: 'down' });
  });
});
