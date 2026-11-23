import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router';
import type { MyEvent } from '@arthakram/shared';
import { eventApi, MODE_LABEL, TYPE_LABEL, useEvent } from '../../lib/events.js';
import { formatDateTime, ROLE_LABEL } from '../../lib/format.js';
import { Alert, Badge, Card, Spinner } from '../../ui/index.js';
import { ParticipantPanel } from '../participant/DashboardPanel.js';
import { DashboardCards } from '../ops/DashboardCards.js';
import { StaffPanel } from '../staff/StaffPages.js';
import { JudgeRoundsPanel } from '../judging/JudgePages.js';

const EVENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft, not public yet',
  PUBLISHED: 'Published',
  CONCLUDED: 'Concluded',
  ARCHIVED: 'Archived',
};
const REGISTRATION_LABEL: Record<string, string> = {
  NOT_OPEN: 'not open yet',
  OPEN: 'open',
  CLOSED: 'closed',
};

/** Role-aware overview built from real persisted data: dates, deadlines, setup progress and announcements. */
export function EventOverviewPage() {
  const mine = useOutletContext<MyEvent>();
  const event = useEvent(mine.eventId);
  const rounds = useQuery({
    queryKey: ['rounds', mine.eventId],
    queryFn: () => eventApi.rounds(mine.eventId),
  });
  const announcements = useQuery({
    queryKey: ['announcements', mine.eventId],
    queryFn: () => eventApi.announcements(mine.eventId),
  });

  if (event.isPending) return <Spinner label="Loading overview" />;
  const e = event.data;
  if (!e) return <Alert tone="error" title="We couldn't load this event" />;
  const base = `/events/${mine.eventId}`;

  // Core Admins land on the event dashboard: stage, needs attention, next steps and the seven divisions.
  if (mine.role === 'ADMIN')
    return (
      <DashboardCards
        mine={mine}
        identity={
          <p className="text-ink">
            <strong>{EVENT_STATUS_LABEL[e.status] ?? e.status}</strong>
            {e.status === 'PUBLISHED' && (
              <> · Registration {REGISTRATION_LABEL[e.registrationStatus] ?? ''}</>
            )}{' '}
            · {formatDateTime(e.startsAt, e.timeZone)} to {formatDateTime(e.endsAt, e.timeZone)}
            {e.venue ? ` · ${e.venue}` : ''}
          </p>
        }
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <h2>Overview</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card footerLabel={`${TYPE_LABEL[e.type]} · ${MODE_LABEL[e.mode]}`}>
          <dl className="grid gap-3">
            <div>
              <dt className="text-xs font-bold uppercase tracking-eyebrow text-ink">Starts</dt>
              <dd>{formatDateTime(e.startsAt, e.timeZone)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-eyebrow text-ink">Ends</dt>
              <dd>{formatDateTime(e.endsAt, e.timeZone)}</dd>
            </div>
            {e.venue && (
              <div>
                <dt className="text-xs font-bold uppercase tracking-eyebrow text-ink">Venue</dt>
                <dd>{e.venue}</dd>
              </div>
            )}
          </dl>
        </Card>
        <Card footerLabel={`You are ${ROLE_LABEL[mine.role]}`}>
          <h3>Deadlines</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {rounds.data?.map((r) => (
              <li key={r.id}>
                <strong>{r.name}</strong>:{' '}
                {r.submissionDeadline ? (
                  formatDateTime(r.submissionDeadline, e.timeZone)
                ) : (
                  <Badge tone="warning">No deadline set</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {mine.role === 'STAFF' && <StaffPanel mine={mine} />}
      {mine.role === 'PARTICIPANT' && <ParticipantPanel mine={mine} />}
      {mine.role === 'JUDGE' && (
        <section aria-labelledby="judge-h" className="flex flex-col gap-3">
          <h3 id="judge-h">Your rounds</h3>
          <JudgeRoundsPanel mine={mine} />
        </section>
      )}

      <section aria-labelledby="latest-h" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 id="latest-h">Latest announcements</h3>
          <Link to={`${base}/updates`} className="text-sm">
            All updates
          </Link>
        </div>
        {announcements.data?.length === 0 && <p>Nothing posted yet.</p>}
        {announcements.data?.slice(0, 3).map((a) => (
          <Card key={a.id} footerLabel={formatDateTime(a.createdAt, e.timeZone)}>
            <h4 className="font-display text-lg font-bold">{a.title}</h4>
            <p className="mt-1 whitespace-pre-line">{a.body}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
