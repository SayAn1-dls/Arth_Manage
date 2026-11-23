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

/**
 * Where to continue after signing up and verifying (for example an event's registration page or an
 * invitation). Only same-site relative paths are accepted, so an emailed link can never send anyone to
 * another website.
 */
export const returnToSchema = z
  .string()
  .max(300)
  .regex(/^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/, 'Invalid return path');

/** The same rule for the browser, used before following a ?next= value. */
export const isSafeReturnTo = (v: unknown): v is string => returnToSchema.safeParse(v).success;

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80),
    email: emailSchema,
    password: passwordSchema,
    returnTo: returnToSchema.optional(),
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
  accessLevel?: string;
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
