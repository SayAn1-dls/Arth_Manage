import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight, CalendarClock } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { engageApi } from '../../lib/engage.js';
import { eventApi, useEvent } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import { opsApi } from '../../lib/ops.js';
import { participantApi, type SubmissionView } from '../../lib/participant.js';
import { Alert, Badge, Card, Countdown, Spinner } from '../../ui/index.js';
import { APPLICATION_TEXT, DeadlineLines } from './Deadline.js';
import { HomeGreeting } from '../ops/EventHeader.js';

const tone = {
  NOT_STARTED: 'info',
  DRAFT: 'warning',
  SUBMITTED: 'success',
  SUBMITTED_LATE: 'warning',
  LOCKED: 'success',
  NOT_SUBMITTED: 'error',
} as const;

interface Step {
  title: string;
  text: string;
  to?: string;
  action?: string;
}

/**
 * My event: the participant's home (PRD FR-059, §11.6 "next required action"). The next step comes first,
 * then the official deadlines, application state, team, updates, and results and certificates once they
 * exist. Statuses are always explained in words.
 */
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
  const application = useQuery({
    queryKey: ['application', mine.eventId],
    queryFn: () =>
      request<{ team: { applicationStatus: string; applicationNote: string | null } | null }>(
        'GET',
        `${base}/workspace/application`,
      ),
    enabled: Boolean(event.data?.applicationReview && team.data),
  });
  const results = useQuery({
    queryKey: ['published-results', mine.eventId],
    queryFn: () => opsApi.published(mine.eventId),
    retry: false,
  });
  const certificates = useQuery({
    queryKey: ['my-certificates', mine.eventId],
    queryFn: () => engageApi.myCertificates(mine.eventId),
    retry: false,
  });
  const announcements = useQuery({
    queryKey: ['announcements', mine.eventId],
    queryFn: () => eventApi.announcements(mine.eventId),
  });
  const inbox = useQuery({
    queryKey: ['inbox', mine.eventId],
    queryFn: () =>
      request<{ messages: { id: string; subject: string; createdAt: string }[] }>(
        'GET',
        `${base}/workspace/inbox`,
      ),
  });

  if (team.isPending || event.isPending) return <Spinner label="Loading your event" />;
  const e = event.data;
  const t = team.data;
  const views = subs.map((s) => s.data).filter((s): s is SubmissionView => Boolean(s));
  const appStatus = application.data?.team?.applicationStatus;
  const published = results.data?.rounds ?? [];
  const certs = (certificates.data?.certificates ?? []).filter((c) => c.downloadable);
  const now = Date.now();

  // ── The one next step ──
  const open = views.find(
    (v) => v.editable && v.cutoff && +new Date(v.cutoff) > now && v.status !== 'SUBMITTED',
  );
  let next: Step;
  if (!t)
    next =
      e?.registrationStatus === 'OPEN'
        ? {
            title: 'Join or create a team',
            text: 'You need a team before you can submit.',
            to: `${base}/team`,
            action: 'Go to My team',
          }
        : {
            title: 'Ask to be placed in a team',
            text: 'Registration is closed, so new teams cannot be formed here.',
            to: `${base}/support`,
            action: 'Ask the organisers',
          };
  else if (!t.complete)
    next = {
      title: `Add ${t.min - t.size} more teammate${t.min - t.size === 1 ? '' : 's'}`,
      text: `Your team needs at least ${t.min} members. Share your invite code from My team.`,
      to: `${base}/team`,
      action: 'Go to My team',
    };
  else if (appStatus && appStatus !== 'ACCEPTED')
    next = {
      title: `Application: ${APPLICATION_TEXT[appStatus]?.label ?? appStatus}`,
      text: APPLICATION_TEXT[appStatus]?.text ?? '',
    };
  else if (open)
    next = {
      title: `Submit for ${open.round.name}`,
      text: `${open.status === 'DRAFT' ? 'You have a draft. ' : ''}Submit before your cutoff, ${formatDateTime(open.cutoff!, mine.timeZone)}.`,
      to: `${base}/submission/${open.round.id}`,
      action: open.status === 'DRAFT' ? 'Continue your draft' : 'Start your submission',
    };
  else if (published.length > 0)
    next = {
      title: 'Results are out',
      text: 'See how your team did and read the judges’ comments.',
      to: `${base}/results`,
      action: 'See results',
    };
  else if (
    views.some(
      (v) => v.status === 'SUBMITTED' || v.status === 'SUBMITTED_LATE' || v.status === 'LOCKED',
    )
  )
    next = {
      title: 'You have submitted',
      text: 'Nothing else is needed right now. Results will appear here when the organisers publish them.',
    };
  else
    next = {
      title: 'Read the guidebook',
      text: 'Rules, schedule and judging criteria are in the guidebook.',
      to: `${base}/guidebook`,
      action: 'Open the guidebook',
    };

  const updates = [
    ...(announcements.data ?? []).map((a) => ({
      id: `a-${a.id}`,
      title: a.title,
      at: a.createdAt,
    })),
    ...(inbox.data?.messages ?? []).map((m) => ({
      id: `m-${m.id}`,
      title: m.subject,
      at: m.createdAt,
    })),
  ]
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, 3);

  const upcoming = (rounds.data ?? [])
    .filter((r) => r.submissionDeadline && +new Date(r.submissionDeadline) > now)
    .slice(0, 2);

  return (
    <div className="flex flex-col gap-6">
      <HomeGreeting
        mine={mine}
        event={e}
        subtitle={
          t
            ? `You’re registered with team ${t.name}. Here’s what to do next.`
            : 'You’re registered. Here’s what to do next.'
        }
      />

      <section
        aria-labelledby="next-h"
        className="flex flex-wrap items-center gap-4 rounded-[14px] bg-blush p-5 sm:p-6"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-ember">
          <ArrowRight aria-hidden className="size-6 stroke-ink" />
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-xs font-bold tracking-eyebrow text-graphite uppercase">
            Your next step
          </p>
          <h3 id="next-h" className="mt-0.5 text-xl">
            {next.title}
          </h3>
          <p className="mt-0.5">{next.text}</p>
        </div>
        {next.to && (
          <Link
            to={next.to}
            className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-ember px-6 font-bold text-ink no-underline hover:brightness-95"
          >
            {next.action} <ArrowRight aria-hidden className="size-4" />
          </Link>
        )}
      </section>

      {upcoming.length > 0 && (
        <ul aria-label="Upcoming deadlines" className="grid gap-4 sm:grid-cols-2">
          {upcoming.map((r) => (
            <li key={r.id}>
              <Link
                to={`${base}/submission/${r.id}`}
                className="flex h-full items-center gap-4 rounded-[14px] border border-line/60 bg-white p-5 text-ink no-underline shadow-card hover:border-ember/60"
              >
                <CalendarClock aria-hidden className="size-9 shrink-0 stroke-ember" />
                <span className="min-w-0">
                  <span className="block text-sm">{r.name} deadline</span>
                  <span className="block font-display text-xl font-extrabold">
                    {formatDateTime(r.submissionDeadline!, mine.timeZone)}
                  </span>
                  <span className="block text-sm">
                    <Countdown until={r.submissionDeadline!} className="font-semibold text-ink" />{' '}
                    left
                    {r.graceMinutes ? ` · ${r.graceMinutes} min grace` : ''}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-[14px] border border-line/60">
          <h3>Team</h3>
          {t ? (
            <>
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <Link to={`${base}/team`} className="font-bold">
                  {t.name}
                </Link>
                {t.complete ? (
                  <Badge tone="success">Complete</Badge>
                ) : (
                  <Badge tone="warning">Needs {t.min - t.size} more</Badge>
                )}
              </p>
              <p className="mt-1 text-sm">
                {t.size} of {t.max} members · team number {t.teamCode}
              </p>
              {appStatus && (
                <p className="mt-2">
                  <strong>Application:</strong> {APPLICATION_TEXT[appStatus]?.label ?? appStatus}.{' '}
                  {APPLICATION_TEXT[appStatus]?.text}
                  {application.data?.team?.applicationNote && (
                    <span className="block">“{application.data.team.applicationNote}”</span>
                  )}
                </p>
              )}
            </>
          ) : (
            <p className="mt-2">You are not in a team yet.</p>
          )}
        </Card>

        <Card className="rounded-[14px] border border-line/60">
          <h3>Submissions</h3>
          {(rounds.data?.length ?? 0) === 0 && (
            <p className="mt-2">No rounds have been announced yet.</p>
          )}
          <ul className="mt-2 flex flex-col gap-4">
            {rounds.data?.map((r, i) => {
              const s = subs[i];
              const v = s?.data;
              return (
                <li key={r.id}>
                  <p className="flex flex-wrap items-center gap-2">
                    <Link to={`${base}/submission/${r.id}`} className="font-bold">
                      {r.name}
                    </Link>
                    {v ? (
                      <Badge tone={tone[v.status]}>{v.statusLabel}</Badge>
                    ) : !t ? (
                      <Badge tone="info">Needs a team</Badge>
                    ) : s?.isError ? (
                      <Badge tone="warning">Couldn’t load: open the round</Badge>
                    ) : (
                      <Badge tone="info">Loading</Badge>
                    )}
                  </p>
                  {v?.blockedReason && <p className="mt-1 text-sm">{v.blockedReason}</p>}
                  <DeadlineLines
                    compact
                    deadline={r.submissionDeadline ?? null}
                    graceMinutes={r.graceMinutes}
                    extensionDeadline={v?.extensionDeadline ?? null}
                    timeZone={mine.timeZone}
                  />
                  {v?.editable && v.cutoff && +new Date(v.cutoff) > now && (
                    <p className="text-sm">
                      Time left: <Countdown until={v.cutoff} className="font-semibold text-ink" />
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="rounded-[14px] border border-line/60">
          <div className="flex items-center justify-between gap-2">
            <h3>Announcements</h3>
            <Link to={`${base}/updates`} className="text-sm">
              All announcements
            </Link>
          </div>
          {updates.length === 0 ? (
            <p className="mt-2">No announcements yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {updates.map((u) => (
                <li key={u.id}>
                  <Link to={`${base}/updates`}>{u.title}</Link>
                  <span className="block text-sm">{formatDateTime(u.at, mine.timeZone)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {(published.length > 0 || certs.length > 0) && (
          <Card className="rounded-[14px] border border-line/60">
            <h3>Results &amp; certificates</h3>
            {published.map((p) => (
              <p key={p.roundId} className="mt-2">
                <Link to={`${base}/results`}>{p.roundName} results</Link>
                {p.own?.rank ? ` · your team placed ${p.own.rank}` : ''}
              </p>
            ))}
            {certs.length > 0 && (
              <p className="mt-2">
                <Link to={`${base}/certificates`}>
                  {certs.length} certificate{certs.length === 1 ? '' : 's'} ready to download
                </Link>
              </p>
            )}
          </Card>
        )}
      </div>
      {results.isError && certificates.isError && (
        <Alert tone="warning" title="Some information could not load. Refresh to try again." />
      )}
    </div>
  );
}
