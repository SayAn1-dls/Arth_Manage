import { z } from 'zod';
import { emailSchema } from './auth.js';

const text = (label: string, max = 120) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

// 7-15 digits with an optional leading + (PRD FR-056).
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?\d{7,15}$/, 'Enter 7 to 15 digits, with an optional leading +');

export const REGISTRATION_FIELD_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'NUMBER',
  'SELECT',
  'URL',
  'CHECKBOX',
] as const;

export const registrationFieldSchema = z
  .object({
    label: text('Label', 60),
    type: z.enum(REGISTRATION_FIELD_TYPES),
    helpText: z.string().trim().max(200).nullish(),
    options: z.array(text('Option', 60)).max(20, 'At most 20 options').default([]),
    required: z.boolean().default(false),
    hidden: z.boolean().default(false),
    order: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine((f) => f.type !== 'SELECT' || f.options.length >= 2, {
    message: 'Add at least two options',
    path: ['options'],
  });

const answerValue = z.union([z.string().max(5000), z.number(), z.boolean()]);

const profile = {
  fullName: text('Full name', 80),
  phone: phoneSchema.nullish(),
  institution: text('Institution'),
  course: z.string().trim().max(120).nullish(),
  yearOfStudy: z.string().trim().max(40).nullish(),
  certificateName: text('Name on certificate', 80),
  answers: z.record(z.string(), answerValue),
};

export const registerForEventSchema = z
  .object({
    ...profile,
    answers: profile.answers.default({}),
    certificateName: profile.certificateName.optional(),
    /** One entry per declaration the event requires; every one must be true (PRD FR-013/051). */
    declarations: z.array(z.boolean()).max(5).default([]),
  })
  .strict();

export const updateRegistrationSchema = z
  .object({ ...profile, version: z.number().int().min(1) })
  .partial()
  .required({ version: true })
  .strict();

export const adminUpdateRegistrationSchema = updateRegistrationSchema;

// ───────────── Teams ─────────────

export const teamNameSchema = z
  .string()
  .trim()
  .min(3, 'Team names need 3 to 40 characters')
  .max(40, 'Team names need 3 to 40 characters');

export const createTeamSchema = z.object({ name: teamNameSchema }).strict();
export const joinTeamSchema = z
  .object({ code: z.string().trim().toUpperCase().min(1, 'Enter the join code').max(16) })
  .strict();
export const confirmJoinSchema = joinTeamSchema
  .extend({ confirm: z.boolean().default(false) })
  .strict();

export const updateTeamSchema = z
  .object({
    name: teamNameSchema,
    trackId: z.string().min(1).nullable(),
    problemId: z.string().min(1).nullable(),
    version: z.number().int().min(1),
  })
  .partial()
  .required({ version: true })
  .strict();

export const reasonSchema = z
  .object({ reason: z.string().trim().min(3, 'Give a reason').max(300) })
  .strict();
export const membershipRefSchema = z.object({ membershipId: z.string().min(1) }).strict();
export const adminCreateTeamSchema = z
  .object({
    name: teamNameSchema,
    leaderMembershipId: z.string().min(1),
    memberMembershipIds: z.array(z.string()).max(9).default([]),
  })
  .strict();

// ───────────── Invitations ─────────────

export const INVITABLE_ROLES = ['ADMIN', 'JUDGE', 'STAFF'] as const;
export const inviteSchema = z
  .object({ email: emailSchema, role: z.enum(INVITABLE_ROLES) })
  .strict();

export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0, O, 1, I (PRD FR-052)

export type RegisterForEventInput = z.infer<typeof registerForEventSchema>;
export type RegistrationFieldInput = z.infer<typeof registrationFieldSchema>;

export interface TeamMemberDto {
  membershipId: string;
  name: string;
  institution: string;
  role: 'LEADER' | 'MEMBER';
  /** True for the viewer's own row. */
  isYou: boolean;
  email?: string; // visible to teammates and admins only
}

export interface TeamDto {
  id: string;
  teamCode: string;
  name: string;
  status: 'ACTIVE' | 'DISSOLVED' | 'DISQUALIFIED';
  disqualifiedReason?: string | null;
  trackId: string | null;
  problemId: string | null;
  joinCode?: string | null; // members only, and only while registration is open
  version: number;
  members: TeamMemberDto[];
  size: number;
  min: number;
  max: number;
  complete: boolean;
}
