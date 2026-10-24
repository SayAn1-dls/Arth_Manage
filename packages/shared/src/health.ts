import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  database: z.enum(['up', 'down']),
  storage: z.enum(['up', 'down']).default('up'),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
