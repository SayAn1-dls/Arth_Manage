import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  database: z.enum(['up', 'down']),
  storage: z.enum(['up', 'down']).default('up'),
  time: z.string(),
  /** Category of the most recent failed email since start-up (no addresses or secrets); absent when none failed. */
  emailLastFailure: z
    .object({ at: z.string(), code: z.string(), detail: z.string().optional() })
    .optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
