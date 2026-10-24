import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { MyEvent } from '@arthakram/shared';
import { eventApi, useEvent } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import { participantApi } from '../../lib/participant.js';
import { Badge, Card, Countdown } from '../../ui/index.js';

const tone = {
  NOT_STARTED: 'info',
  DRAFT: 'warning',
  SUBMITTED: 'success',
  SUBMITTED_LATE: 'warning',
  LOCKED: 'success',
  NOT_SUBMITTED: 'error',
} as const;

/** What a team needs to know right now: team state, the next deadline and each round's submission status (PRD FR-059). */
export function ParticipantPanel({ mine }: { mine: MyEvent }) {
  const base = `/events/${mine.eventId}`;
  const event = useEvent(mine.eventId);
  const team = useQuery({
    queryKey: ['my-team', mine.eventId],
    queryFn: () => participantApi.myTeam(mine.eventId),
  });
  const rounds = useQuery({
    queryKey: ['rounds', mine.eventId],
    queryFn: () => eventApi.rounds(mine.eventId),
  });
  const subs = useQueries({
    queries: (rounds.data ?? []).map((r) => ({
      queryKey: ['submission', mine.eventId, r.id],
      queryFn: () => participantApi.submission(mine.eventId, r.id),
      enabled: Boolean(team.data),
      retry: false,
    })),
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card footerLabel="My team">
        {team.isPending && <p>Loading…</p>}
        {team.data === null && (
          <>
            <h3>You are not in a team yet</h3>
            <p className="mt-1">
              {event.data?.registrationStatus === 'OPEN' ? (
                <>
                  Create a team or join one with a code.{' '}
                  <Link to={`${base}/team`}>Go to My team</Link>
                </>
              ) : (
                'Registration is closed. Contact the organisers to be placed in a team.'
              )}
            </p>
          </>
        )}
        {team.data && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h3>
                <Link to={`${base}/team`}>{team.data.name}</Link>
              </h3>
              <Badge tone="info">{team.data.teamCode}</Badge>
              {team.data.complete ? (
                <Badge tone="success">Complete</Badge>
              ) : (
                <Badge tone="warning">Needs {team.data.min - team.data.size} more</Badge>
              )}
            </div>
            <p className="mt-2 text-sm">
              {team.data.size} of {team.data.max} members
            </p>
          </>
        )}
      </Card>
      <Card footerLabel="Submissions">
        <ul className="flex flex-col gap-3">
          {rounds.data?.map((r, i) => {
            const s = subs[i]?.data;
            const deadline = s?.cutoff ?? r.submissionDeadline;
            return (
              <li key={r.id}>
                <p className="flex flex-wrap items-center gap-2">
                  <strong>
                    <Link to={`${base}/submission/${r.id}`}>{r.name}</Link>
                  </strong>
                  {s ? (
                    <Badge tone={tone[s.status]}>{s.statusLabel}</Badge>
                  ) : (
                    <Badge tone="info">{team.data ? 'Loading' : 'Needs a team'}</Badge>
                  )}
                </p>
                {deadline && (
                  <p className="text-sm">
                    {formatDateTime(deadline, mine.timeZone)}{' '}
                    {(s ? s.editable : true) && new Date(deadline) > new Date() && (
                      <Countdown until={deadline} className="font-semibold text-ink" />
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
