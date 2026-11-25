import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useOutletContext } from 'react-router';
import type { MyEvent } from '@arthakram/shared';
import { eventApi } from '../../lib/events.js';
import { participantApi } from '../../lib/participant.js';
import { PageHeader, Alert, Badge, Button, Card, EmptyState, Spinner } from '../../ui/index.js';
import { DeadlineLines } from './Deadline.js';
import { extensionOf } from './SubmissionPage.js';

const statusTone = {
  NOT_STARTED: 'info',
  DRAFT: 'warning',
  SUBMITTED: 'success',
  SUBMITTED_LATE: 'warning',
  LOCKED: 'success',
  NOT_SUBMITTED: 'error',
} as const;

/** One round goes straight to the form; several rounds show a short list with each one's status. */
export function SubmissionIndexPage() {
  const mine = useOutletContext<MyEvent>();
  const rounds = useQuery({
    queryKey: ['rounds', mine.eventId],
    queryFn: () => eventApi.rounds(mine.eventId),
  });
  const list = rounds.data ?? [];
  // Same query key as the submission page, so opening a round reuses what was loaded here.
  const views = useQueries({
    queries: (list.length > 1 ? list : []).map((r) => ({
      queryKey: ['submission', mine.eventId, r.id],
      queryFn: () => participantApi.submission(mine.eventId, r.id),
      retry: false,
    })),
  });

  const header = (
    <PageHeader
      title="Submissions"
      description="Your team’s work for each round, submitted before the deadline."
    />
  );
  if (rounds.isPending) return <Spinner label="Loading rounds" />;
  if (rounds.isError)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Alert tone="error" title="We could not load the rounds">
          Check your connection and try again.
          <div className="mt-2">
            <Button variant="secondary" onClick={() => void rounds.refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      </div>
    );
  if (list.length === 1) return <Navigate to={list[0]!.id} replace />;
  if (list.length === 0)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState title="No rounds have been announced yet">
          When the organisers announce a round, its deadline and your submission form will appear
          here.
        </EmptyState>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      {header}
      <ul className="flex flex-col gap-3">
        {list.map((r, i) => {
          const view = views[i]?.data;
          return (
            <li key={r.id}>
              <Card footerLabel={`Round ${r.order}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3>
                    <Link to={r.id}>{r.name}</Link>
                  </h3>
                  {view && <Badge tone={statusTone[view.status]}>{view.statusLabel}</Badge>}
                </div>
                {view?.blockedReason && <p className="mt-1 text-sm">{view.blockedReason}</p>}
                <div className="mt-2">
                  <DeadlineLines
                    compact
                    deadline={r.submissionDeadline ?? null}
                    graceMinutes={r.graceMinutes}
                    extensionDeadline={view ? extensionOf(view) : null}
                    timeZone={mine.timeZone}
                  />
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
