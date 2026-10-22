import {
  checkHttpUrl,
  checkRepoUrl,
  defaultSubmissionFields,
  SUMMARY_MAX,
  TITLE_MAX,
} from '@arthakram/shared';
import type { Db } from '../../db/client.js';
import { AppError } from '../../http/errors.js';
import type { Event, Prisma, Round, SubmissionFormField } from '../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

export async function createDefaultFormFields(tx: Tx, roundId: string, eventType: Event['type']) {
  await tx.submissionFormField.createMany({
    data: defaultSubmissionFields(eventType).map((f, i) => ({ roundId, order: i, ...f })),
  });
}

export type DraftValues = Record<string, string>;

/** Light validation while a draft is saved: shape and lengths, plus URL format for filled links. */
export function validateDraftShape(
  fields: SubmissionFormField[],
  title: string,
  summary: string,
  values: DraftValues,
) {
  const errors: Record<string, string> = {};
  if (title.length > TITLE_MAX) errors.title = `Keep the title under ${TITLE_MAX} characters`;
  if (summary.length > SUMMARY_MAX)
    errors.summary = `Keep the summary under ${SUMMARY_MAX} characters`;
  const known = new Map(fields.map((f) => [f.id, f]));
  for (const [id, value] of Object.entries(values)) {
    const f = known.get(id);
    if (!f) {
      errors[`values.${id}`] = 'This field is not part of the form';
      continue;
    }
    if (!value) continue;
    const msg = urlProblem(f.type, value);
    if (msg) errors[`values.${id}`] = msg;
    if (f.type === 'SHORT_TEXT' && value.length > 200)
      errors[`values.${id}`] = 'Keep this under 200 characters';
    if (f.type === 'LONG_TEXT' && value.length > 5000)
      errors[`values.${id}`] = 'Keep this under 5,000 characters';
  }
  return errors;
}

function urlProblem(type: SubmissionFormField['type'], value: string): string | null {
  if (type === 'REPO_URL') return checkRepoUrl(value);
  if (type === 'VIDEO_URL' || type === 'LIVE_URL' || type === 'OTHER_URL')
    return checkHttpUrl(value);
  return null;
}

/** Full validation at Submit time: everything the organiser marked required must be present and valid (PRD FR-065). */
export function validateForSubmit(
  fields: SubmissionFormField[],
  title: string,
  summary: string,
  values: DraftValues,
) {
  const errors = validateDraftShape(fields, title, summary, values);
  if (!title.trim()) errors.title = 'Project title is required';
  if (!summary.trim()) errors.summary = 'Summary is required';
  for (const f of fields) {
    if (f.required && !(values[f.id] ?? '').trim())
      errors[`values.${f.id}`] = `${f.label} is required`;
  }
  const missing = Object.entries(errors).map(([key]) => {
    if (key === 'title') return 'Project title';
    if (key === 'summary') return 'Summary';
    return fields.find((f) => `values.${f.id}` === key)?.label ?? 'A field';
  });
  return { errors, missing };
}

export function hasDraftContent(s: {
  draftTitle: string;
  draftSummary: string;
  draftValues: unknown;
}): boolean {
  return Boolean(
    s.draftTitle.trim() ||
    s.draftSummary.trim() ||
    Object.values((s.draftValues as DraftValues) ?? {}).some((v) => v),
  );
}

/** Every file id in a draft must be a file uploaded to this submission for that very field. */
export async function assertFilesBelong(
  db: Db | Tx,
  submissionId: string,
  fields: SubmissionFormField[],
  values: DraftValues,
) {
  for (const f of fields.filter((x) => x.type === 'FILE')) {
    const id = values[f.id];
    if (!id) continue;
    const file = await db.submissionFile.findFirst({ where: { id, submissionId, fieldId: f.id } });
    if (!file)
      throw AppError.invalid('That file does not belong to this submission', {
        [`values.${f.id}`]: 'Upload the file again',
      });
  }
}

export function roundTiming(r: Round) {
  return {
    opensAt: r.opensAt,
    submissionDeadline: r.submissionDeadline,
    graceMinutes: r.graceMinutes,
    latePolicy: r.latePolicy,
  };
}
