import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api.js';
import { formatDate, ROLE_LABEL } from '../../lib/format.js';
import { Alert, Badge, Card, EmptyState, Skeleton } from '../../ui/index.js';

const statusTone = {
  DRAFT: 'info',
  PUBLISHED: 'success',
  CONCLUDED: 'warning',
  ARCHIVED: 'info',
} as const;
const statusLabel = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  CONCLUDED: 'Concluded',
  ARCHIVED: 'Archived',
} as const;

/** PRD FR-002: every event the user belongs to, with a role badge and status. */
export function MyEventsPage() {
  const events = useQuery({ queryKey: ['my-events'], queryFn: api.myEvents });

  return (
    <main className="mx-auto max-w-content px-4 py-8 sm:px-8">
      <p className="text-xs font-bold uppercase tracking-eyebrow text-ink">Your workspace</p>
      <h1 className="mt-2 text-[2rem] sm:text-[2.5rem]">My events</h1>

      <div className="mt-6">
        {events.isPending && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        )}
        {events.isError && (
          <Alert tone="error" title="We couldn't load your events">
            Reload the page to try again.
          </Alert>
        )}
        {events.data?.length === 0 && (
          <EmptyState title="No events yet">
            Open an event link from an organiser to register, or ask to be added as a judge or
            helper.
          </EmptyState>
        )}
        {events.data && events.data.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2">
            {events.data.map((e) => (
              <li key={e.eventId}>
                <Card footerLabel={ROLE_LABEL[e.role]} className="h-full">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={statusTone[e.status]}>{statusLabel[e.status]}</Badge>
                  </div>
                  <h2 className="mt-3 text-xl">
                    <Link to={`/events/${e.eventId}`}>{e.name}</Link>
                  </h2>
                  <p className="mt-1 text-sm">
                    {formatDate(e.startsAt, e.timeZone)} to {formatDate(e.endsAt, e.timeZone)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
