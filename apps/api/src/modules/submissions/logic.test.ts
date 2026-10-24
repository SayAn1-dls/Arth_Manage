import { describe, expect, it } from 'vitest';
import { cutoffFor, decideSubmit, submissionStatus, type RoundTiming } from './logic.js';

const deadline = new Date('2027-02-15T12:30:00Z'); // 18:00 IST
const base: RoundTiming = {
  opensAt: null,
  submissionDeadline: deadline,
  graceMinutes: 0,
  latePolicy: 'REJECT',
};
const at = (ms: number) => new Date(deadline.getTime() + ms);

describe('deadline decisions (AT-07, PRD FR-071)', () => {
  it('accepts at deadline - 1s and at the deadline itself, rejects at +1s under Reject', () => {
    expect(decideSubmit(base, null, at(-1000))).toEqual({ allowed: true, lateMinutes: 0 });
    expect(decideSubmit(base, null, at(0))).toEqual({ allowed: true, lateMinutes: 0 });
    expect(decideSubmit(base, null, at(1000))).toEqual({ allowed: false, reason: 'closed' });
  });
  it('treats the grace period as on time and rejects one second after it', () => {
    const grace = { ...base, graceMinutes: 5 };
    expect(decideSubmit(grace, null, at(5 * 60_000))).toEqual({ allowed: true, lateMinutes: 0 });
    expect(decideSubmit(grace, null, at(5 * 60_000 + 1000))).toEqual({
      allowed: false,
      reason: 'closed',
    });
  });
  it('accepts and flags late work under Accept-and-flag with the minutes late', () => {
    const flag = { ...base, latePolicy: 'ACCEPT_AND_FLAG' as const };
    expect(decideSubmit(flag, null, at(7 * 60_000))).toEqual({ allowed: true, lateMinutes: 7 });
    expect(decideSubmit(flag, null, at(30_000))).toEqual({ allowed: true, lateMinutes: 1 });
  });
  it('honours a per-team extension over the deadline', () => {
    const ext = at(60 * 60_000);
    expect(decideSubmit(base, ext, at(30 * 60_000))).toEqual({ allowed: true, lateMinutes: 0 });
    expect(decideSubmit(base, ext, at(61 * 60_000))).toEqual({ allowed: false, reason: 'closed' });
    expect(cutoffFor(base, ext)).toEqual(ext);
  });
  it('blocks submissions before the round opens', () => {
    const opens = { ...base, opensAt: new Date(deadline.getTime() - 3600_000) };
    expect(decideSubmit(opens, null, at(-2 * 3600_000))).toEqual({
      allowed: false,
      reason: 'not_open',
    });
  });
});

describe('submission status (PRD FR-073)', () => {
  const facts = (over = {}) => ({
    hasDraftContent: false,
    lastVersionNo: 0,
    lastVersionLateMinutes: 0,
    ...over,
  });
  it('walks not started -> draft -> submitted -> locked', () => {
    expect(submissionStatus(base, null, null, at(-1000))).toBe('NOT_STARTED');
    expect(submissionStatus(base, null, facts({ hasDraftContent: true }), at(-1000))).toBe('DRAFT');
    expect(submissionStatus(base, null, facts({ lastVersionNo: 1 }), at(-1000))).toBe('SUBMITTED');
    expect(submissionStatus(base, null, facts({ lastVersionNo: 1 }), at(1000))).toBe('LOCKED');
  });
  it('reports teams that never submitted as Not submitted after the deadline, even with a draft', () => {
    expect(submissionStatus(base, null, null, at(1000))).toBe('NOT_SUBMITTED');
    expect(submissionStatus(base, null, facts({ hasDraftContent: true }), at(1000))).toBe(
      'NOT_SUBMITTED',
    );
  });
  it('flags late submissions', () => {
    expect(
      submissionStatus(
        { ...base, latePolicy: 'ACCEPT_AND_FLAG' },
        at(3600_000),
        facts({ lastVersionNo: 2, lastVersionLateMinutes: 4 }),
        at(10 * 60_000),
      ),
    ).toBe('SUBMITTED_LATE');
  });
});
