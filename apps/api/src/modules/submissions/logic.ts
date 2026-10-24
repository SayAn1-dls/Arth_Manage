import type { SubmissionStatus } from '@arthakram/shared';

export interface RoundTiming {
  opensAt: Date | null;
  submissionDeadline: Date | null;
  graceMinutes: number;
  latePolicy: 'REJECT' | 'ACCEPT_AND_FLAG';
}

/**
 * The instant after which a submission counts as late: the team's extension if any, otherwise the
 * deadline plus the grace period (PRD FR-071). Evaluated against server time only.
 */
export function cutoffFor(round: RoundTiming, extension: Date | null): Date | null {
  if (extension) return extension;
  if (!round.submissionDeadline) return null;
  return new Date(round.submissionDeadline.getTime() + round.graceMinutes * 60_000);
}

export type SubmitDecision =
  { allowed: true; lateMinutes: number } | { allowed: false; reason: 'not_open' | 'closed' };

export function decideSubmit(
  round: RoundTiming,
  extension: Date | null,
  now: Date,
): SubmitDecision {
  if (round.opensAt && now < round.opensAt) return { allowed: false, reason: 'not_open' };
  const cutoff = cutoffFor(round, extension);
  if (!cutoff || now <= cutoff) return { allowed: true, lateMinutes: 0 };
  if (round.latePolicy === 'REJECT') return { allowed: false, reason: 'closed' };
  return { allowed: true, lateMinutes: Math.ceil((now.getTime() - cutoff.getTime()) / 60_000) };
}

export interface SubmissionFacts {
  hasDraftContent: boolean;
  lastVersionNo: number;
  lastVersionLateMinutes: number;
}

/** Status shown to teams and organisers (PRD FR-073). After the cutoff a submitted version is Locked. */
export function submissionStatus(
  round: RoundTiming,
  extension: Date | null,
  facts: SubmissionFacts | null,
  now: Date,
): SubmissionStatus {
  const cutoff = cutoffFor(round, extension);
  const closed = Boolean(cutoff && now > cutoff);
  if (facts && facts.lastVersionNo > 0) {
    if (facts.lastVersionLateMinutes > 0) return closed ? 'LOCKED' : 'SUBMITTED_LATE';
    return closed ? 'LOCKED' : 'SUBMITTED';
  }
  if (facts?.hasDraftContent)
    return closed && round.latePolicy === 'REJECT' ? 'NOT_SUBMITTED' : 'DRAFT';
  return closed ? 'NOT_SUBMITTED' : 'NOT_STARTED';
}

export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  NOT_STARTED: 'Not started',
  DRAFT: 'Draft, not submitted',
  SUBMITTED: 'Submitted',
  SUBMITTED_LATE: 'Submitted late',
  LOCKED: 'Locked',
  NOT_SUBMITTED: 'Not submitted',
};
