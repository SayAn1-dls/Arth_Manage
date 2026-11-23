import { formatDateTime } from '../../lib/format.js';

/**
 * One official deadline, with the grace period and any team extension shown as separate, labelled lines
 * (audit P0-02). Every participant screen uses this, so the same round never shows two different
 * "deadlines".
 */
export function DeadlineLines({
  deadline,
  graceMinutes = 0,
  extensionDeadline,
  timeZone,
  compact = false,
}: {
  deadline: string | null;
  graceMinutes?: number;
  extensionDeadline?: string | null;
  timeZone: string;
  compact?: boolean;
}) {
  if (!deadline) return <p>Deadline to be announced.</p>;
  const grace = graceMinutes > 0 ? new Date(+new Date(deadline) + graceMinutes * 60000) : null;
  return (
    <div className={compact ? 'text-sm' : undefined}>
      <p>
        <strong>Deadline:</strong> {formatDateTime(deadline, timeZone)}
      </p>
      {grace && (
        <p>
          <strong>Grace period:</strong> submissions until{' '}
          {formatDateTime(grace.toISOString(), timeZone)} still count as on time ({graceMinutes}{' '}
          min).
        </p>
      )}
      {extensionDeadline && (
        <p>
          <strong>Your team's extension:</strong> until{' '}
          {formatDateTime(extensionDeadline, timeZone)}.
        </p>
      )}
    </div>
  );
}

export const APPLICATION_TEXT: Record<
  string,
  { label: string; text: string; tone: 'info' | 'success' | 'warning' | 'error' }
> = {
  PENDING: {
    label: 'Under review',
    text: 'The organisers are reviewing your team’s application. You can submit once it is accepted.',
    tone: 'info',
  },
  ACCEPTED: { label: 'Accepted', text: 'Your team is accepted and can submit.', tone: 'success' },
  WAITLISTED: {
    label: 'On the waitlist',
    text: 'Your team is on the waitlist. You will be told if a place opens; you can submit once accepted.',
    tone: 'warning',
  },
  REJECTED: {
    label: 'Not accepted',
    text: 'Your team’s application was not accepted for this event.',
    tone: 'error',
  },
};
