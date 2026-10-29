import { afterAll, describe, expect, it } from 'vitest';
import { agentFor, createTestKit } from '../../test/helpers.js';

describe('public certificate verification', () => {
  const kit = createTestKit({ rateLimit: true });
  afterAll(() => kit.db.$disconnect());

  it('answers 404 for an unknown code and limits guessing from one address', async () => {
    const agent = agentFor(kit.app);
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++)
      statuses.push((await agent.get(`/api/v1/public/certificates/CERT-NOPE-${i}`)).status);
    expect(statuses[0]).toBe(404);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((s) => s === 404).length).toBe(60);
  });
});
