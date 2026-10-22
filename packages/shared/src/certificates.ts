import { z } from 'zod';

export const CERT_TYPES = ['PARTICIPATION', 'WINNER'] as const;
export type CertType = (typeof CERT_TYPES)[number];
export const CERT_FIELDS = ['NAME', 'EVENT', 'TEAM', 'AWARD', 'DATE', 'CODE'] as const;
export type CertField = (typeof CERT_FIELDS)[number];
export const CERT_FONTS = ['display', 'sans', 'sansBold'] as const; // Bricolage ExtraBold, Instrument Sans, Instrument Sans Bold

export const FIELD_LABEL: Record<CertField, string> = {
  NAME: 'Recipient name',
  EVENT: 'Event name',
  TEAM: 'Team name',
  AWARD: 'Award text',
  DATE: 'Date',
  CODE: 'Certificate ID',
};

/** One placed field. x and y are fractions of the page (0..1) measured from the top-left; maxWidth is a fraction of page width. */
export const certFieldSchema = z
  .object({
    field: z.enum(CERT_FIELDS),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    font: z.enum(CERT_FONTS),
    size: z.number().min(8).max(120),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #000000'),
    align: z.enum(['left', 'center', 'right']),
    maxWidth: z.number().min(0.1).max(1),
  })
  .strict();

export const certTemplateSchema = z
  .object({
    fields: z.array(certFieldSchema).max(12),
    awardTexts: z
      .record(z.string().regex(/^\d{1,2}$/), z.string().trim().min(1).max(80))
      .default({}),
  })
  .strict()
  .refine((t) => new Set(t.fields.map((f) => f.field)).size === t.fields.length, {
    message: 'Each field can be placed once',
    path: ['fields'],
  });

/** Sensible placements used until an organiser customises the template. */
export const DEFAULT_PLACEMENTS: z.infer<typeof certFieldSchema>[] = [
  {
    field: 'EVENT',
    x: 0.5,
    y: 0.3,
    font: 'sansBold',
    size: 20,
    color: '#443D39',
    align: 'center',
    maxWidth: 0.8,
  },
  {
    field: 'NAME',
    x: 0.5,
    y: 0.45,
    font: 'display',
    size: 44,
    color: '#000000',
    align: 'center',
    maxWidth: 0.8,
  },
  {
    field: 'AWARD',
    x: 0.5,
    y: 0.58,
    font: 'sansBold',
    size: 22,
    color: '#000000',
    align: 'center',
    maxWidth: 0.7,
  },
  {
    field: 'TEAM',
    x: 0.5,
    y: 0.66,
    font: 'sans',
    size: 14,
    color: '#443D39',
    align: 'center',
    maxWidth: 0.7,
  },
  {
    field: 'DATE',
    x: 0.1,
    y: 0.87,
    font: 'sans',
    size: 11,
    color: '#443D39',
    align: 'left',
    maxWidth: 0.3,
  },
  {
    field: 'CODE',
    x: 0.9,
    y: 0.87,
    font: 'sans',
    size: 11,
    color: '#443D39',
    align: 'right',
    maxWidth: 0.3,
  },
];

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Award text for a winning position, with the ranking group appended when ranking is per track (PRD FR-231). */
export function awardTextFor(
  rank: number,
  group: string,
  perTrack: boolean,
  custom: Record<string, string>,
): string {
  const base =
    custom[String(rank)] ??
    { 1: 'First Place', 2: 'Second Place', 3: 'Third Place' }[rank] ??
    `${ordinal(rank)} Place`;
  return perTrack ? `${base} – ${group}` : base;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function certificateCode(random: (n: number) => number): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[random(ALPHABET.length)]).join('');
  return `CERT-${part()}-${part()}`;
}

export const releaseSchema = z
  .object({
    type: z.enum(CERT_TYPES),
    ids: z.array(z.string().min(1)).max(2000).optional(),
    reviewed: z.literal(true, { error: 'Confirm that you reviewed a sample' }),
  })
  .strict();
export const exceptionSchema = z
  .object({
    membershipId: z.string().min(1),
    type: z.enum(CERT_TYPES),
    include: z.boolean(),
    reason: z.string().trim().min(3, 'Give a reason').max(300),
  })
  .strict();
export const nameCorrectionSchema = z
  .object({ name: z.string().trim().min(1, 'Enter the corrected name').max(80) })
  .strict();
