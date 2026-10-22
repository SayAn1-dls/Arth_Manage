import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router';
import { CheckCircle2, Circle } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { eventApi, MODE_LABEL, TYPE_LABEL, useEvent } from '../../lib/events.js';
import { formatDateTime, ROLE_LABEL } from '../../lib/format.js';
import { Alert, Badge, Card, Spinner } from '../../ui/index.js';

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
  const guidebook = useQuery({
    queryKey: ['guidebook', mine.eventId],
    queryFn: () => eventApi.guidebook(mine.eventId),
  });
  const checks = useQuery({
    queryKey: ['publish-checks', mine.eventId],
    queryFn: () => eventApi.checks(mine.eventId),
    enabled: mine.role === 'ADMIN' && mine.status === 'DRAFT',
  });

  if (event.isPending) return <Spinner label="Loading overview" />;
  const e = event.data;
  if (!e) return <Alert tone="error" title="We couldn't load this event" />;
  const base = `/events/${mine.eventId}`;

  const steps = [
    {
      done: Boolean(rounds.data?.some((r) => r.submissionDeadline)),
      label: 'Set a submission deadline',
      to: `${base}/rounds`,
    },
    {
      done: Boolean(guidebook.data?.published),
      label: 'Publish the guidebook',
      to: `${base}/guidebook`,
    },
    { done: e.status !== 'DRAFT', label: 'Publish the event', to: `${base}/setup` },
    { done: e.registrationStatus === 'OPEN', label: 'Open registration', to: `${base}/setup` },
  ];

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

      {mine.role === 'ADMIN' && e.status === 'DRAFT' && (
        <Card footerLabel="Getting ready">
          <h3>Setup checklist</h3>
          <ul className="mt-3 flex flex-col gap-2">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-2">
                {s.done ? (
                  <CheckCircle2 aria-label="Done" className="size-5 text-success-fg" />
                ) : (
                  <Circle aria-label="To do" className="size-5" />
                )}
                <Link to={s.to}>{s.label}</Link>
              </li>
            ))}
          </ul>
          {checks.data && checks.data.blocking.length > 0 && (
            <p className="mt-3 text-sm">
              Still needed to publish: {checks.data.blocking.join(', ')}.
            </p>
          )}
        </Card>
      )}

      <section aria-labelledby="latest-h" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 id="latest-h">Latest announcements</h3>
          <Link to={`${base}/announcements`} className="text-sm">
            All announcements
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
