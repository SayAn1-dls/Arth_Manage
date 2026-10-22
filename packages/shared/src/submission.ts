import { z } from 'zod';

export const SUBMISSION_FIELD_TYPES = [
  'FILE',
  'REPO_URL',
  'VIDEO_URL',
  'LIVE_URL',
  'OTHER_URL',
  'SHORT_TEXT',
  'LONG_TEXT',
] as const;
export type SubmissionFieldType = (typeof SUBMISSION_FIELD_TYPES)[number];

export const FILE_TYPES = ['pdf', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'zip'] as const;
export const MAX_SUBMISSION_FIELDS = 10;
export const SUMMARY_MAX = 1500;
export const TITLE_MAX = 120;
export const URL_MAX = 2000;

const REPO_RE =
  /^https:\/\/(www\.)?(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+\/?$/i;

export function checkRepoUrl(url: string): string | null {
  if (url.length > URL_MAX) return `Keep the link under ${URL_MAX} characters`;
  return REPO_RE.test(url.trim())
    ? null
    : 'Use an https link to a repository on github.com, gitlab.com or bitbucket.org, like https://github.com/owner/repo';
}

export function checkHttpUrl(url: string): string | null {
  if (url.length > URL_MAX) return `Keep the link under ${URL_MAX} characters`;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? null : 'Use an http or https link';
  } catch {
    return 'Enter a valid link starting with https://';
  }
}

const fileRule = (f: { type: string; allowedExtensions: string[] }) =>
  f.type !== 'FILE' || f.allowedExtensions.length > 0;
const fileRuleIssue = {
  message: 'Choose at least one allowed file type',
  path: ['allowedExtensions'],
};

const submissionFieldBase = z
  .object({
    type: z.enum(SUBMISSION_FIELD_TYPES),
    label: z.string().trim().min(1, 'Label is required').max(60),
    helpText: z.string().trim().max(300).nullish(),
    required: z.boolean().default(false),
    allowedExtensions: z.array(z.enum(FILE_TYPES)).default([]),
    maxMb: z.number().int().min(1, 'Minimum is 1 MB').max(50, 'Maximum is 50 MB').default(25),
  })
  .strict();

export const submissionFieldSchema = submissionFieldBase.refine(fileRule, fileRuleIssue);

/** The whole form for a round; `id` identifies fields that already exist so their data is kept. */
export const submissionFormSchema = z
  .object({
    fields: z
      .array(
        submissionFieldBase
          .extend({ id: z.string().min(1).optional() })
          .refine(fileRule, fileRuleIssue),
      )
      .max(MAX_SUBMISSION_FIELDS, `At most ${MAX_SUBMISSION_FIELDS} fields`),
  })
  .strict()
  .refine((f) => new Set(f.fields.map((x) => x.label.toLowerCase())).size === f.fields.length, {
    message: 'Field labels must be unique',
    path: ['fields'],
  });

export const draftSchema = z
  .object({
    title: z.string().max(TITLE_MAX, `Keep the title under ${TITLE_MAX} characters`),
    summary: z.string().max(SUMMARY_MAX, `Keep the summary under ${SUMMARY_MAX} characters`),
    /** fieldId -> text, URL or (for files) the id of an uploaded file. */
    values: z.record(z.string(), z.string().max(5000)),
    version: z.number().int().min(1),
  })
  .strict();

export const submitSchema = z.object({ version: z.number().int().min(1) }).strict();
export const extensionSchema = z
  .object({
    deadline: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(3, 'Give a reason').max(300),
  })
  .strict();
export const overrideSchema = z
  .object({ enabled: z.boolean(), reason: z.string().trim().min(3).max(300) })
  .strict();

export type SubmissionStatus =
  'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'SUBMITTED_LATE' | 'LOCKED' | 'NOT_SUBMITTED';

export interface FormFieldDto {
  id: string;
  type: SubmissionFieldType;
  label: string;
  helpText: string | null;
  required: boolean;
  order: number;
  allowedExtensions: string[];
  maxMb: number;
}

/** Hackathon and case-competition defaults (PRD B.3); editable by the organiser. */
export function defaultSubmissionFields(eventType: 'HACKATHON' | 'CASE_COMPETITION' | 'OTHER') {
  if (eventType === 'CASE_COMPETITION') {
    return [
      {
        type: 'FILE' as const,
        label: 'Deck',
        helpText: 'Your final deck as a PDF.',
        required: true,
        allowedExtensions: ['pdf'],
        maxMb: 25,
      },
    ];
  }
  return [
    {
      type: 'FILE' as const,
      label: 'Presentation',
      helpText: 'PDF, PPT or PPTX.',
      required: true,
      allowedExtensions: ['pdf', 'ppt', 'pptx'],
      maxMb: 25,
    },
    {
      type: 'REPO_URL' as const,
      label: 'Repository URL',
      helpText: 'Make sure the repository is public or shared with the organisers.',
      required: true,
      allowedExtensions: [],
      maxMb: 25,
    },
    {
      type: 'VIDEO_URL' as const,
      label: 'Demo video',
      helpText: 'Set the video to public or unlisted.',
      required: false,
      allowedExtensions: [],
      maxMb: 25,
    },
    {
      type: 'LIVE_URL' as const,
      label: 'Live project URL',
      helpText: null,
      required: false,
      allowedExtensions: [],
      maxMb: 25,
    },
  ];
}
