import { z } from 'zod';

export const PASSWORD_MIN = 10;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(200);

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80),
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(200) })
  .strict();
export const tokenSchema = z.object({ token: z.string().min(10).max(200) }).strict();
export const emailOnlySchema = z.object({ email: emailSchema }).strict();
export const resetSchema = z
  .object({ token: z.string().min(10).max(200), password: passwordSchema })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export interface MeResponse {
  id: string;
  email: string;
  name: string;
}

export interface MyEvent {
  eventId: string;
  slug: string;
  name: string;
  role: 'ADMIN' | 'JUDGE' | 'STAFF' | 'PARTICIPANT';
  status: 'DRAFT' | 'PUBLISHED' | 'CONCLUDED' | 'ARCHIVED';
  registrationStatus: 'NOT_OPEN' | 'OPEN' | 'CLOSED';
  startsAt: string;
  endsAt: string;
  timeZone: string;
}
