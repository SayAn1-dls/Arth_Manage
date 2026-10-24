import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useOutletContext } from 'react-router';
import type { MyEvent } from '@arthakram/shared';
import { eventApi } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import { Card, Spinner } from '../../ui/index.js';

/** One round goes straight to the form; several rounds show a short list. */
export function SubmissionIndexPage() {
  const mine = useOutletContext<MyEvent>();
  const rounds = useQuery({
    queryKey: ['rounds', mine.eventId],
    queryFn: () => eventApi.rounds(mine.eventId),
  });
  if (rounds.isPending) return <Spinner label="Loading rounds" />;
  if (rounds.data?.length === 1) return <Navigate to={rounds.data[0]!.id} replace />;
  return (
    <div className="flex flex-col gap-4">
      <h2>Submissions</h2>
      <ul className="flex flex-col gap-3">
        {rounds.data?.map((r) => (
          <li key={r.id}>
            <Card footerLabel={`Round ${r.order}`}>
              <h3>
                <Link to={r.id}>{r.name}</Link>
              </h3>
              <p className="mt-1 text-sm">
                {r.submissionDeadline
                  ? `Deadline ${formatDateTime(r.submissionDeadline, mine.timeZone)}`
                  : 'No deadline set yet'}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
