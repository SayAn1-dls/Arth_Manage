import { useState } from 'react';
import { Link, Navigate, useOutletContext, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { MyEvent } from '@arthakram/shared';
import { eventApi } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import { judgingApi, type EvalStatus, type JudgeRound } from '../../lib/judging.js';
import { useListState } from '../../lib/useListState.js';
import {
  Alert,
  Badge,
  Card,
  Countdown,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Spinner,
} from '../../ui/index.js';

const roundTone = { NOT_OPEN: 'info', OPEN: 'success', CLOSED: 'warning' } as const;
const roundLabel = {
  NOT_OPEN: 'Judging not open',
  OPEN: 'Judging open',
  CLOSED: 'Judging closed',
} as const;
export const evalTone: Record<EvalStatus, 'info' | 'warning' | 'success' | 'error'> = {
  NOT_STARTED: 'info',
  DRAFT: 'warning',
  REOPENED: 'warning',
  SUBMITTED: 'success',
  NOT_REQUIRED: 'info',
  CONFLICT: 'error',
};
export const evalLabel: Record<EvalStatus, string> = {
  NOT_STARTED: 'Not started',
  DRAFT: 'Draft',
  REOPENED: 'Reopened',
  SUBMITTED: 'Submitted',
  NOT_REQUIRED: 'Not required',
  CONFLICT: 'Conflict',
};

/** Judge home: assigned rounds with live progress from persisted evaluations (PRD FR-091). */
export function JudgeRoundsPanel({ mine }: { mine: MyEvent }) {
  const q = useQuery({
    queryKey: ['judge-rounds', mine.eventId],
    queryFn: () => judgingApi.judgeRounds(mine.eventId),
  });
  if (q.isPending) return <Skeleton className="h-32" />;
  if (q.data?.length === 0)
    return (
      <EmptyState title="You have no teams assigned yet">
        The organisers will assign teams to you before judging opens. You will see them here.
      </EmptyState>
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {q.data?.map((r: JudgeRound) => (
        <Card key={r.roundId} footerLabel={`${r.submitted} of ${r.assigned} evaluated`}>
          <div className="flex flex-wrap items-center gap-2">
            <h3>
              <Link to={`/events/${mine.eventId}/judge/${r.roundId}`}>{r.name}</Link>
            </h3>
            <Badge tone={roundTone[r.judgingStatus]}>{roundLabel[r.judgingStatus]}</Badge>
          </div>
          <p className="mt-2 text-sm">
            {r.submitted === r.assigned && r.assigned > 0
              ? 'All your evaluations are submitted.'
              : `${r.assigned - r.submitted} team${r.assigned - r.submitted === 1 ? '' : 's'} left to evaluate.`}
          </p>
          {r.judgingDeadline && (
            <p className="text-sm">
              Judging deadline {formatDateTime(r.judgingDeadline, mine.timeZone)}{' '}
              {r.judgingStatus === 'OPEN' && (
                <Countdown until={r.judgingDeadline} className="font-semibold text-ink" />
              )}
            </p>
          )}
          {r.judgingStatus === 'NOT_OPEN' && (
            <p className="mt-1 text-sm">Judging opens after submissions close.</p>
          )}
          <progress
            className="mt-3 w-full accent-ember"
            value={r.submitted}
            max={Math.max(r.assigned, 1)}
            aria-label={`${r.submitted} of ${r.assigned} evaluations submitted`}
          />
        </Card>
      ))}
    </div>
  );
}

export function JudgeIndexPage() {
  const mine = useOutletContext<MyEvent>();
  const q = useQuery({
    queryKey: ['judge-rounds', mine.eventId],
    queryFn: () => judgingApi.judgeRounds(mine.eventId),
  });
  if (q.isPending) return <Spinner label="Loading your rounds" />;
  if (q.data?.length === 1) return <Navigate to={q.data[0]!.roundId} replace />;
  return (
    <div className="flex flex-col gap-4">
      <h2>My rounds</h2>
      <JudgeRoundsPanel mine={mine} />
    </div>
  );
}

/** The judge's assigned teams for a round: search, filter, "not started" first (PRD FR-092). */
export function JudgeTeamsPage() {
  const mine = useOutletContext<MyEvent>();
  const { roundId = '' } = useParams();
  const list = useListState({ sort: 'default' });
  const [q, setQ] = useState(list.get('q'));
  const tracks = useQuery({
    queryKey: ['tracks', mine.eventId],
    queryFn: () => eventApi.tracks(mine.eventId),
  });
  const qs = new URLSearchParams({
    q: list.get('q'),
    status: list.get('status'),
    trackId: list.get('trackId'),
  });
  const res = useQuery({
    queryKey: ['judge-teams', mine.eventId, roundId, qs.toString()],
    queryFn: () => judgingApi.judgeTeams(mine.eventId, roundId, qs.toString()),
    placeholderData: (p) => p,
  });
  if (res.isPending) return <Spinner label="Loading your teams" />;
  if (res.isError || !res.data) return <Alert tone="error" title="We couldn't load your teams" />;
  const { round, rows, total } = res.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2>{round.name}</h2>
        <Badge tone={roundTone[round.judgingStatus as keyof typeof roundTone]}>
          {roundLabel[round.judgingStatus as keyof typeof roundLabel]}
        </Badge>
      </div>
      {round.judgingStatus === 'NOT_OPEN' && (
        <Alert tone="info" title="Judging opens after submissions close">
          You can see your assigned teams now. Their work and the rubric appear when judging opens.
        </Alert>
      )}
      {round.judgingStatus === 'CLOSED' && (
        <Alert tone="warning" title="Judging for this round has closed">
          Submitted evaluations are final unless an organiser reopens one.
        </Alert>
      )}
      <Card>
        <form
          className="grid gap-3 sm:grid-cols-3"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            list.set({ q });
          }}
        >
          <Input
            label="Search"
            hint="Team name or ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => q !== list.get('q') && list.set({ q })}
          />
          <Select
            label="Evaluation status"
            value={list.get('status')}
            onChange={(e) => list.set({ status: e.target.value })}
          >
            <option value="">All</option>
            {(Object.keys(evalLabel) as EvalStatus[]).map((s) => (
              <option key={s} value={s}>
                {evalLabel[s]}
              </option>
            ))}
          </Select>
          {(tracks.data?.length ?? 0) > 0 && (
            <Select
              label="Track"
              value={list.get('trackId')}
              onChange={(e) => list.set({ trackId: e.target.value })}
            >
              <option value="">All tracks</option>
              {tracks.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </form>
      </Card>
      {total === 0 && (
        <EmptyState title="You have no teams assigned in this round">
          The organisers assign teams to judges. You will see yours here.
        </EmptyState>
      )}
      {total > 0 && rows.length === 0 && (
        <EmptyState title="No teams match">
          Clear the filters to see all {total} of your teams.
        </EmptyState>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.assignmentId}>
            <Card
              footerLabel={r.trackName || 'No track'}
              className={r.evaluationStatus === 'NOT_REQUIRED' ? 'opacity-70' : ''}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3>
                  <Link to={r.teamId}>{r.name}</Link>
                </h3>
                <Badge tone="info">{r.teamCode}</Badge>
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={evalTone[r.evaluationStatus]}>{evalLabel[r.evaluationStatus]}</Badge>
                <Badge
                  tone={
                    r.submission === 'DID_NOT_SUBMIT'
                      ? 'warning'
                      : r.submission === 'LATE'
                        ? 'warning'
                        : 'success'
                  }
                >
                  {r.submission === 'DID_NOT_SUBMIT'
                    ? 'Did not submit'
                    : r.submission === 'LATE'
                      ? 'Submitted late'
                      : 'Submitted'}
                </Badge>
              </p>
              {r.problemTitle && <p className="mt-2 text-sm">{r.problemTitle}</p>}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
