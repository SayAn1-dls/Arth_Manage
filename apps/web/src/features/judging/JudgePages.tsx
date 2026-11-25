import { JudgeLinks } from './JudgeTools.js';
import {
  BookOpen,
  CircleCheck,
  ClipboardList,
  Hourglass,
  ListChecks,
  Megaphone,
  Send,
  Timer,
} from 'lucide-react';
import { useEvent } from '../../lib/events.js';
import { HomeGreeting } from '../ops/EventHeader.js';
import { useState, type ReactNode } from 'react';
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

/**
 * Judge dashboard: the judge's own assigned work in numbers (assigned, pending, completed, next deadline),
 * then each round, then the tools judges use before and while scoring. Only this judge's assignments are
 * read (GET /judge/rounds is scoped to the caller), so nothing about other judges is exposed.
 */
export function JudgeHome({ mine }: { mine: MyEvent }) {
  const event = useEvent(mine.eventId);
  const q = useQuery({
    queryKey: ['judge-rounds', mine.eventId],
    queryFn: () => judgingApi.judgeRounds(mine.eventId),
  });
  const base = `/events/${mine.eventId}`;
  const rounds = q.data ?? [];
  const assigned = rounds.reduce((n, r) => n + r.toEvaluate, 0);
  const done = rounds.reduce((n, r) => n + Math.min(r.submitted, r.toEvaluate), 0);
  const pending = Math.max(assigned - done, 0);
  const now = Date.now();
  const nextDeadline = rounds
    .filter(
      (r) =>
        r.judgingStatus !== 'CLOSED' && r.judgingDeadline && +new Date(r.judgingDeadline) > now,
    )
    .sort((a, b) => a.judgingDeadline!.localeCompare(b.judgingDeadline!))[0];
  const openRound = rounds.find((r) => r.judgingStatus === 'OPEN' && r.submitted < r.toEvaluate);
  const one = rounds.length === 1 ? rounds[0] : undefined;
  const teamsLink = one ? `${base}/judge/${one.roundId}` : `${base}/judge`;
  const metric = (icon: ReactNode, value: ReactNode, label: string, to?: string) => {
    const body = (
      <>
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0">
          <span className="block font-display text-3xl font-extrabold text-ink">{value}</span>
          <span className="block">{label}</span>
        </span>
      </>
    );
    const cls =
      'flex h-full items-center gap-4 rounded-[14px] border border-line/60 bg-white p-5 text-graphite no-underline shadow-card';
    return to ? (
      <Link to={to} className={`${cls} hover:border-ember/60`}>
        {body}
      </Link>
    ) : (
      <div className={cls}>{body}</div>
    );
  };
  const tools = [
    { label: 'Rubric & briefing', to: `${base}/briefing`, icon: BookOpen },
    { label: 'Practice team', to: `${base}/practice`, icon: ListChecks },
    { label: 'Announcements', to: `${base}/updates`, icon: Megaphone },
    { label: 'Ask the organisers', to: `${base}/support`, icon: Send },
  ];
  return (
    <div className="flex flex-col gap-6">
      <HomeGreeting
        mine={mine}
        event={event.data}
        subtitle={
          q.isPending
            ? 'Loading your assignments…'
            : pending > 0
              ? `You have ${pending} evaluation${pending === 1 ? '' : 's'} to submit.`
              : assigned > 0
                ? 'All your evaluations are submitted. Thank you!'
                : 'Your assigned teams will appear here.'
        }
      />
      {openRound && (
        <section
          aria-labelledby="judge-next-h"
          className="flex flex-wrap items-center gap-4 rounded-[14px] bg-blush p-5 sm:p-6"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-ember">
            <ClipboardList aria-hidden className="size-6 stroke-ink" />
          </span>
          <div className="min-w-0 flex-1 basis-64">
            <p className="text-xs font-bold tracking-eyebrow text-graphite uppercase">
              Your next step
            </p>
            <h3 id="judge-next-h" className="mt-0.5 text-xl">
              Continue judging {openRound.name}
            </h3>
            <p className="mt-0.5">
              {openRound.toEvaluate - openRound.submitted} of {openRound.toEvaluate} left. Only
              submitted evaluations count.
            </p>
          </div>
          <Link
            to={`${base}/judge/${openRound.roundId}`}
            className="inline-flex min-h-12 items-center rounded-pill bg-ember px-6 font-bold text-ink no-underline hover:brightness-95"
          >
            Continue judging
          </Link>
        </section>
      )}
      {!q.isPending && !q.isError && rounds.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <li>
            {metric(
              <ClipboardList aria-hidden className="size-9 stroke-ember" />,
              assigned,
              'Assigned teams',
              teamsLink,
            )}
          </li>
          <li>
            {metric(
              <Hourglass aria-hidden className="size-9 stroke-ember" />,
              pending,
              'Pending evaluations',
              teamsLink,
            )}
          </li>
          <li>
            {metric(
              <CircleCheck aria-hidden className="size-9 stroke-ember" />,
              done,
              'Completed evaluations',
              one ? `${base}/judge/${one.roundId}?status=SUBMITTED` : `${base}/judge`,
            )}
          </li>
          <li>
            {metric(
              <Timer aria-hidden className="size-9 stroke-ember" />,
              nextDeadline ? (
                <Countdown until={nextDeadline.judgingDeadline!} className="text-2xl" />
              ) : (
                '—'
              ),
              nextDeadline
                ? `Until ${nextDeadline.name} judging closes (${formatDateTime(nextDeadline.judgingDeadline!, mine.timeZone)})`
                : 'No judging deadline set',
            )}
          </li>
        </ul>
      )}
      <section aria-labelledby="judge-rounds-h" className="flex flex-col gap-3">
        <h3
          id="judge-rounds-h"
          className="font-sans text-sm font-bold tracking-eyebrow text-graphite uppercase"
        >
          Your rounds
        </h3>
        <JudgeRoundsPanel mine={mine} />
      </section>
      <section aria-labelledby="judge-tools-h" className="flex flex-col gap-3">
        <h3
          id="judge-tools-h"
          className="font-sans text-sm font-bold tracking-eyebrow text-graphite uppercase"
        >
          Before and while you judge
        </h3>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tools.map((t) => (
            <li key={t.label}>
              <Link
                to={t.to}
                className="flex h-full min-h-24 flex-col items-center justify-center gap-2 rounded-card border border-line/70 bg-white p-3 text-center font-semibold text-ink no-underline hover:border-ember/50 hover:bg-blush/50"
              >
                <t.icon aria-hidden className="size-7 stroke-ember" />
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Judge home: assigned rounds with live progress from persisted evaluations (PRD FR-091, audit P1-18..20). */
export function JudgeRoundsPanel({ mine }: { mine: MyEvent }) {
  const q = useQuery({
    queryKey: ['judge-rounds', mine.eventId],
    queryFn: () => judgingApi.judgeRounds(mine.eventId),
  });
  if (q.isPending) return <Skeleton className="h-32" />;
  if (q.isError) return <Alert tone="error" title="We couldn't load your rounds" />;
  if (q.data?.length === 0)
    return (
      <EmptyState title="You have no teams assigned yet">
        The organisers will assign teams to you before judging opens. You will see them here.
      </EmptyState>
    );
  const now = Date.now();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {q.data?.map((r: JudgeRound) => {
        const left = Math.max(r.toEvaluate - r.submitted, 0);
        const passed = r.judgingDeadline !== null && +new Date(r.judgingDeadline) <= now;
        return (
          <Card key={r.roundId} className="rounded-[14px] border border-line/60">
            <div className="flex flex-wrap items-center gap-2">
              <h3>{r.name}</h3>
              <Badge tone={roundTone[r.judgingStatus]}>{roundLabel[r.judgingStatus]}</Badge>
            </div>
            <p className="mt-2 text-lg font-semibold text-ink">
              {r.toEvaluate === 0
                ? 'No teams need your evaluation.'
                : left === 0
                  ? 'All your evaluations are submitted.'
                  : `${left} of ${r.toEvaluate} team${r.toEvaluate === 1 ? '' : 's'} left to evaluate`}
            </p>
            {r.notRequired > 0 && (
              <p>
                {r.notRequired} assigned team{r.notRequired === 1 ? '' : 's'} did not submit, so
                there is nothing to evaluate for {r.notRequired === 1 ? 'it' : 'them'}.
              </p>
            )}
            <progress
              className="mt-3 w-full accent-ember"
              value={r.submitted}
              max={Math.max(r.toEvaluate, 1)}
              aria-label={`${r.submitted} of ${r.toEvaluate} evaluations submitted`}
            />
            {r.judgingDeadline && (
              <p className="mt-2">
                Judging deadline {formatDateTime(r.judgingDeadline, mine.timeZone)}
                {r.judgingStatus === 'OPEN' && !passed && (
                  <>
                    {' · '}
                    <Countdown until={r.judgingDeadline} className="font-semibold text-ink" />
                  </>
                )}
              </p>
            )}
            {r.judgingStatus === 'OPEN' && passed && left > 0 && (
              <Alert tone="warning" title="The judging deadline has passed" className="mt-2">
                Submit your remaining evaluations now. Organisers will close judging soon, and
                drafts do not count.
              </Alert>
            )}
            {r.judgingStatus === 'OPEN' && !passed && (
              <p className="mt-1 text-sm">Only submitted evaluations count; drafts do not.</p>
            )}
            {r.judgingStatus === 'NOT_OPEN' && (
              <p className="mt-1">
                Judging opens after submissions close. Until then you can read the briefing and try
                the practice team.
              </p>
            )}
            {r.judgingStatus === 'CLOSED' && (
              <p className="mt-1">Judging for this round is closed.</p>
            )}
            <Link
              to={`/events/${mine.eventId}/judge/${r.roundId}`}
              className="mt-3 inline-flex min-h-11 items-center rounded-pill bg-ember px-5 font-bold text-ink no-underline"
            >
              {r.judgingStatus === 'OPEN' && left > 0 ? 'Continue judging' : 'Open my teams'}
            </Link>
          </Card>
        );
      })}
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
    starred: list.get('starred'),
  });
  const res = useQuery({
    queryKey: ['judge-teams', mine.eventId, roundId, qs.toString()],
    queryFn: () => judgingApi.judgeTeams(mine.eventId, roundId, qs.toString()),
    placeholderData: (p) => p,
  });
  const rounds = useQuery({
    queryKey: ['judge-rounds', mine.eventId],
    queryFn: () => judgingApi.judgeRounds(mine.eventId),
  });
  if (res.isPending) return <Spinner label="Loading your teams" />;
  if (res.isError || !res.data) return <Alert tone="error" title="We couldn't load your teams" />;
  const { round, rows, total } = res.data;
  const progress = rounds.data?.find((x) => x.roundId === roundId);
  return (
    <div className="flex flex-col gap-4">
      <JudgeLinks eventId={mine.eventId} />
      <Link to={`/events/${mine.eventId}/judge/${roundId}/compare`}>
        Compare two assigned teams
      </Link>
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={list.get('starred') === '1'}
          onChange={(e) => list.set({ starred: e.target.checked ? '1' : '' })}
        />
        Only starred teams
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <h2>{round.name}</h2>
        <Badge tone={roundTone[round.judgingStatus as keyof typeof roundTone]}>
          {roundLabel[round.judgingStatus as keyof typeof roundLabel]}
        </Badge>
      </div>
      {progress && (
        <p className="text-lg text-ink" role="status">
          <strong>
            {progress.submitted} of {progress.toEvaluate}
          </strong>{' '}
          evaluations submitted
          {round.judgingDeadline && (
            <>
              {' '}
              · judging deadline {formatDateTime(round.judgingDeadline, mine.timeZone)}
              {round.judgingStatus === 'OPEN' && +new Date(round.judgingDeadline) > Date.now() && (
                <>
                  {' · '}
                  <Countdown until={round.judgingDeadline} className="font-semibold text-ink" />
                </>
              )}
            </>
          )}
          {round.judgingStatus === 'OPEN' && (
            <span className="block text-base">
              Only submitted evaluations count; drafts do not.
            </span>
          )}
        </p>
      )}
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
                  <Link to={r.teamId}>
                    {r.starred ? '★ ' : ''}
                    {r.name}
                  </Link>
                </h3>
                <Badge tone="info">{r.teamCode}</Badge>
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <span className="font-semibold">Your evaluation:</span>
                <Badge tone={evalTone[r.evaluationStatus]}>{evalLabel[r.evaluationStatus]}</Badge>
              </p>
              <p className="mt-1">
                <span className="font-semibold">Project:</span>{' '}
                {r.submission === 'DID_NOT_SUBMIT'
                  ? 'the team did not submit, nothing to evaluate'
                  : r.submission === 'LATE'
                    ? 'submitted late'
                    : 'submitted on time'}
              </p>
              {r.problemTitle && <p className="mt-2 text-sm">{r.problemTitle}</p>}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
