import { z } from 'zod';
import { emailSchema } from './auth.js';
import { isValidTimeZone } from './time.js';

export const EVENT_TYPES = ['HACKATHON', 'CASE_COMPETITION', 'OTHER'] as const;
export const EVENT_MODES = ['IN_PERSON', 'ONLINE', 'HYBRID'] as const;
export const EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CONCLUDED', 'ARCHIVED'] as const;
export const REGISTRATION_STATUSES = ['NOT_OPEN', 'OPEN', 'CLOSED'] as const;
export const LATE_POLICIES = ['REJECT', 'ACCEPT_AND_FLAG'] as const;
export const RANKING_SCOPES = ['OVERALL', 'PER_TRACK'] as const;
export const AUDIENCES = ['EVERYONE', 'PARTICIPANTS', 'JUDGES', 'STAFF'] as const;

export const SHORT = 120;
export const LONG = 5000;

const isoInstant = z.iso.datetime({ offset: true, message: 'Enter a valid date and time' });
const timeZoneSchema = z.string().refine(isValidTimeZone, 'Choose a valid time zone');
const shortText = (label: string, max = SHORT) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

export const slugSchema = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters')
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and single hyphens');

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return base.length >= 3 ? base : `event-${base || 'new'}`.slice(0, 50);
}

const eventFields = {
  name: shortText('Event name', 80),
  type: z.enum(EVENT_TYPES),
  mode: z.enum(EVENT_MODES),
  startsAt: isoInstant,
  endsAt: isoInstant,
  timeZone: timeZoneSchema,
  institution: shortText('Organising institution'),
  contactEmail: emailSchema,
  venue: z.string().trim().max(SHORT).nullish(),
  description: z.string().trim().max(300, 'Keep the short description to 300 characters').nullish(),
};

const datesOrdered = (v: { startsAt?: string; endsAt?: string }) =>
  !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt);
const ORDER_MSG = { message: 'End must be after start', path: ['endsAt'] };

export const createEventSchema = z
  .object({ ...eventFields, slug: slugSchema.optional() })
  .strict()
  .refine(datesOrdered, ORDER_MSG);

export const updateEventSchema = z
  .object({
    ...eventFields,
    slug: slugSchema,
    eligibility: z.string().trim().max(LONG).nullable(),
    teamMin: z.number().int().min(1, 'Minimum is 1').max(10, 'Maximum is 10'),
    teamMax: z.number().int().min(1).max(10, 'Maximum is 10'),
    declarations: z.array(shortText('Declaration', 200)).max(5, 'At most 5 declarations'),
    trackRequired: z.boolean(),
    showWinners: z.boolean(),
    showOwnRank: z.boolean(),
    showOwnScores: z.boolean(),
    /** Optimistic lock: the version the editor loaded (PRD 6.0-3). */
    version: z.number().int().min(1),
    /** Required confirmation when dates change after people have registered. */
    confirmDateChange: z.boolean().optional(),
  })
  .partial()
  .required({ version: true })
  .strict()
  .refine(datesOrdered, ORDER_MSG)
  .refine((v) => v.teamMin === undefined || v.teamMax === undefined || v.teamMax >= v.teamMin, {
    message: 'Maximum team size must be at least the minimum',
    path: ['teamMax'],
  });

export const registrationControlSchema = z
  .object({
    status: z.enum(REGISTRATION_STATUSES),
    opensAt: isoInstant.nullish(),
    closesAt: isoInstant.nullish(),
  })
  .strict()
  .refine((v) => !v.opensAt || !v.closesAt || new Date(v.closesAt) > new Date(v.opensAt), {
    message: 'Closing must be after opening',
    path: ['closesAt'],
  });

export const trackSchema = z
  .object({
    name: shortText('Track name', 60),
    description: z.string().trim().max(1000).nullish(),
    order: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const problemSchema = z
  .object({
    title: shortText('Title', 160),
    description: shortText('Description', LONG),
    trackId: z.string().min(1).nullish(),
    order: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

export const roundSchema = z
  .object({
    name: shortText('Round name', 60),
    opensAt: isoInstant.nullish(),
    submissionDeadline: isoInstant.nullish(),
    graceMinutes: z.number().int().min(0, 'Minimum is 0').max(60, 'Maximum is 60 minutes'),
    latePolicy: z.enum(LATE_POLICIES),
    judgingDeadline: isoInstant.nullish(),
    rankingScope: z.enum(RANKING_SCOPES),
    requiredEvaluations: z.number().int().min(1, 'Minimum is 1').max(5, 'Maximum is 5'),
    awardPositions: z.number().int().min(1).max(10),
    /** Required when a deadline changes after submissions exist (PRD FR-012). */
    reason: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine(
    (r) =>
      !r.opensAt || !r.submissionDeadline || new Date(r.opensAt) < new Date(r.submissionDeadline),
    {
      message: 'Opening must be before the deadline',
      path: ['opensAt'],
    },
  )
  .refine(
    (r) =>
      !r.submissionDeadline ||
      !r.judgingDeadline ||
      new Date(r.submissionDeadline) <= new Date(r.judgingDeadline),
    {
      message: 'Judging deadline must not be before the submission deadline',
      path: ['judgingDeadline'],
    },
  );

export const announcementSchema = z
  .object({
    audience: z.enum(AUDIENCES),
    title: shortText('Title', 160),
    body: shortText('Message', 2000),
  })
  .strict();

// ───────────── Guidebook ─────────────

export const DEFAULT_GUIDEBOOK_SECTIONS = [
  'Overview',
  'Eligibility',
  'Schedule',
  'Registration',
  'Tracks and problem statements',
  'Submission requirements',
  'Judging criteria',
  'Prizes',
  'FAQs',
  'Code of conduct',
  'Contacts',
] as const;

export const guidebookSectionSchema = z
  .object({
    id: z.string().min(1).max(40),
    title: shortText('Section title', 80),
    body: z.string().max(LONG * 4, 'This section is too long'),
    hidden: z.boolean(),
  })
  .strict();

export const guidebookDraftSchema = z
  .object({
    sections: z.array(guidebookSectionSchema).min(1).max(30),
    version: z.number().int().min(1),
  })
  .strict()
  .refine((g) => new Set(g.sections.map((s) => s.id)).size === g.sections.length, {
    message: 'Section ids must be unique',
    path: ['sections'],
  });

export const guidebookPublishSchema = z
  .object({ changeNote: z.string().trim().max(300).optional(), version: z.number().int().min(1) })
  .strict();

export type GuidebookSection = z.infer<typeof guidebookSectionSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type RoundInput = z.infer<typeof roundSchema>;

export interface EventDto {
  id: string;
  slug: string;
  name: string;
  type: (typeof EVENT_TYPES)[number];
  mode: (typeof EVENT_MODES)[number];
  startsAt: string;
  endsAt: string;
  timeZone: string;
  institution: string;
  contactEmail: string;
  venue: string | null;
  description: string | null;
  eligibility: string | null;
  status: (typeof EVENT_STATUSES)[number];
  registrationStatus: (typeof REGISTRATION_STATUSES)[number];
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  teamMin: number;
  teamMax: number;
  declarations: string[];
  trackRequired: boolean;
  showWinners: boolean;
  showOwnRank: boolean;
  showOwnScores: boolean;
  ownerId: string;
  version: number;
  publishedAt: string | null;
}

export interface RoundDto extends Omit<RoundInput, 'reason'> {
  id: string;
  order: number;
  version: number;
}
