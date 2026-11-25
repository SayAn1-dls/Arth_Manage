import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  CircleAlert,
  FileText,
  Gavel,
  Heart,
  Megaphone,
  RefreshCw,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react';
import type { EventDto, MyEvent } from '@arthakram/shared';
import { useSession } from '../../shell/session.js';
import { useEvent } from '../../lib/events.js';
import { opsApi, type Dashboard, type DashboardLifecycle } from '../../lib/ops.js';
import { Alert, Button, Skeleton } from '../../ui/index.js';
import { AreaChart, Sparkline, type ChartPoint } from '../../ui/AreaChart.js';
import { cn } from '../../ui/cn.js';

type CardData<T> = T | { error: string };
const ok = <T,>(x: CardData<T>): T | null =>
  typeof x === 'object' && x !== null && 'error' in x ? null : (x as T);

/** White surface used by every dashboard block: soft corners, a warm hairline, no heavy shadow. */
function Panel({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'rounded-[14px] border border-line/60 bg-white p-5 shadow-card sm:p-6',
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** "14 – 15 Feb, 2027" in the event's time zone, collapsing shared month/year. */
function dateRange(startIso: string, endIso: string, timeZone: string) {
  const part = (iso: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone, ...o }).format(new Date(iso));
  const [sd, sm, sy] = [
    part(startIso, { day: 'numeric' }),
    part(startIso, { month: 'short' }),
    part(startIso, { year: 'numeric' }),
  ];
  const [ed, em, ey] = [
    part(endIso, { day: 'numeric' }),
    part(endIso, { month: 'short' }),
    part(endIso, { year: 'numeric' }),
  ];
  if (sy !== ey) return `${sd} ${sm} ${sy} – ${ed} ${em} ${ey}`;
  if (sm !== em) return `${sd} ${sm} – ${ed} ${em}, ${ey}`;
  if (sd === ed) return `${sd} ${sm}, ${sy}`;
  return `${sd} – ${ed} ${sm}, ${sy}`;
}

/** "14 Feb, 10:00 AM" in the event's time zone. */
function shortDateTime(iso: string, timeZone: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(
    d,
  );
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
  return `${day}, ${time}`;
}

/** What the event is doing right now, from its stored status and dates. */
function liveStatus(e: EventDto, now = Date.now()) {
  if (e.status === 'DRAFT') return { label: 'Draft', tone: 'muted' as const };
  if (e.status === 'CONCLUDED') return { label: 'Concluded', tone: 'muted' as const };
  if (e.status === 'ARCHIVED') return { label: 'Archived', tone: 'muted' as const };
  if (now >= +new Date(e.startsAt) && now <= +new Date(e.endsAt))
    return { label: 'Live', tone: 'live' as const };
  if (now < +new Date(e.startsAt)) return { label: 'Published', tone: 'live' as const };
  return { label: 'Event ended', tone: 'muted' as const };
}

/**
 * Core Admin Command Centre (approved reference: "Arthakram Event Command Centre"). Greeting and event at a
 * glance, four metrics, the registration trend, quick access, what needs attention and the next deadlines.
 * Every figure is read from the API; trends appear only where stored history supports them.
 */
export function CommandCentre({ mine }: { mine: MyEvent }) {
  const { user } = useSession();
  const event = useEvent(mine.eventId);
  const q = useQuery({
    queryKey: ['dashboard', mine.eventId],
    queryFn: () => opsApi.dashboard(mine.eventId),
  });
  const base = `/events/${mine.eventId}`;
  const first = user?.name.split(' ')[0] ?? '';

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-center gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,37rem)]">
        <div>
          <h2 className="text-3xl sm:text-[2.4rem] 2xl:text-[2.6rem]">
            {greeting()}
            {first ? `, ${first}` : ''}!{' '}
            <span aria-hidden className="font-sans">
              👋
            </span>
          </h2>
          <p className="mt-1 text-lg">Here’s what’s happening with your event.</p>
        </div>
        {event.data && <EventGlance e={event.data} life={q.data ? ok(q.data.lifecycle) : null} />}
      </div>

      {q.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
          <Skeleton className="h-72 sm:col-span-2 xl:col-span-3" />
          <Skeleton className="h-72" />
        </div>
      ) : q.isError || !q.data ? (
        <Alert tone="error" title="We couldn't load the Command Centre">
          <Button variant="secondary" className="mt-2" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </Alert>
      ) : (
        <Body
          d={q.data}
          mine={mine}
          base={base}
          refetch={() => void q.refetch()}
          fetching={q.isFetching}
        />
      )}

      <footer className="mt-4 flex items-center gap-2 border-t border-line pt-5 text-sm">
        <Heart aria-hidden className="size-4 fill-ember stroke-ember" />
        <span>{mine.name}</span>
        <span aria-hidden>•</span>
        <span>Powered by Arthakram</span>
      </footer>
    </div>
  );
}

function EventGlance({ e, life }: { e: EventDto; life: DashboardLifecycle | null }) {
  const status = liveStatus(e);
  const stage = life?.stages.find((s) => s.key === life.stage)?.label;
  const published = e.status !== 'DRAFT';
  return (
    <Panel
      aria-labelledby="glance-h"
      className="flex flex-wrap items-center gap-x-6 gap-y-4 py-4 sm:py-5"
    >
      <div className="min-w-[14rem] flex-1">
        <p id="glance-h" className="flex items-center gap-2 font-semibold text-ink">
          <CalendarDays aria-hidden className="size-5 stroke-ember" /> Event at a glance
        </p>
        <p className="mt-1 truncate font-display text-xl font-extrabold text-ink">{e.name}</p>
        <p className="truncate text-[0.95rem]">
          {dateRange(e.startsAt, e.endsAt, e.timeZone)}
          {e.venue ? ` • ${e.venue}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-4 sm:border-l sm:border-line sm:pl-6">
        <span className="flex flex-col items-start gap-1">
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-pill px-3 py-1.5 text-sm font-bold',
              status.tone === 'live' ? 'bg-success-bg text-success-fg' : 'bg-blush text-ink',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-2 rounded-full',
                status.tone === 'live' ? 'bg-success-fg' : 'bg-graphite',
              )}
            />
            {status.label}
          </span>
          {stage && <span className="pl-1 text-xs">Stage: {stage}</span>}
        </span>
        <Link
          to={published ? `/e/${e.slug}` : `/events/${e.id}/setup`}
          className="inline-flex min-h-11 items-center gap-1.5 font-bold text-ink no-underline hover:underline"
        >
          {published ? 'View event' : 'Edit event'}
          <ArrowRight aria-hidden className="size-4 stroke-ember" />
        </Link>
      </div>
    </Panel>
  );
}

/** Daily counts → cumulative points for the chosen range, filling days with no new records. */
function cumulative(
  daily: { date: string; count: number }[],
  today: string,
  range: '7d' | '30d' | 'all',
): ChartPoint[] {
  const dayMs = 86400000;
  const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
  const end = toDate(today);
  const firstDay = daily[0] ? toDate(daily[0].date) : end;
  const span =
    range === '7d'
      ? 7
      : range === '30d'
        ? 30
        : Math.max(2, Math.round((+end - +firstDay) / dayMs) + 1);
  const start = new Date(+end - (span - 1) * dayMs);
  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const byDay = new Map(daily.map((d) => [d.date, d.count]));
  let running = daily.filter((d) => toDate(d.date) < start).reduce((n, d) => n + d.count, 0);
  const out: ChartPoint[] = [];
  for (let t = +start; t <= +end; t += dayMs) {
    const key = new Date(t).toISOString().slice(0, 10);
    running += byDay.get(key) ?? 0;
    out.push({ label: fmt.format(new Date(t)), value: running });
  }
  return out;
}

/** The last 14 days of a daily series as a running total, for card sparklines. */
const recentTotals = (daily: { date: string; count: number }[], today: string) =>
  cumulative(daily, today, 'all')
    .slice(-14)
    .map((p) => p.value);

function Body({
  d,
  mine,
  base,
  refetch,
  fetching,
}: {
  d: Dashboard;
  mine: MyEvent;
  base: string;
  refetch: () => void;
  fetching: boolean;
}) {
  const teams = ok(d.teams);
  const participants = ok(d.participants);
  const people = ok(d.people);
  const setup = ok(d.setup);
  const trend = ok(d.trend);
  const life = ok(d.lifecycle);
  const deadlines = ok(d.deadlines) ?? [];
  const thisWeek = (n: number | undefined) =>
    n ? (
      <span className="text-sm font-semibold text-success-fg">
        <span aria-hidden>↑ </span>
        {n} this week
      </span>
    ) : null;

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={<Users aria-hidden className="size-9 stroke-ember" />}
          value={teams?.total}
          label="Teams"
          to={`${base}/teams`}
          note={thisWeek(trend?.teamsThisWeek)}
          spark={trend ? recentTotals(trend.teams, trend.today) : undefined}
        />
        <Metric
          icon={<UserPlus aria-hidden className="size-9 stroke-ember" />}
          value={participants?.registered}
          label="Registrations"
          to={`${base}/teams?view=participants`}
          note={thisWeek(trend?.registrationsThisWeek)}
          spark={trend ? recentTotals(trend.registrations, trend.today) : undefined}
        />
        <Metric
          icon={<Gavel aria-hidden className="size-9 stroke-ember" />}
          value={people?.judges}
          label="Judges"
          to={`${base}/people`}
          note={
            people?.judgeInvites ? (
              <span className="text-sm">{people.judgeInvites} invited</span>
            ) : (
              thisWeek(people?.judgesThisWeek)
            )
          }
        />
        <li>
          <Link
            to={`${base}/area/configuration`}
            className="flex h-full items-center gap-4 rounded-[14px] border border-line/60 bg-white p-5 text-ink no-underline shadow-card transition-colors hover:border-ember/50"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-ember">
              <CheckCircle2 aria-hidden className="size-7 text-ink" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-3xl font-extrabold">
                {setup ? `${setup.percent}%` : '—'}
              </span>
              <span className="block">Setup complete</span>
              {setup && (
                <span
                  role="progressbar"
                  aria-label="Setup complete"
                  aria-valuenow={setup.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-blush"
                >
                  <span
                    className="block h-full rounded-full bg-ember"
                    style={{ width: `${setup.percent}%` }}
                  />
                </span>
              )}
              {setup && (
                <span className="mt-1 block text-xs">
                  {setup.done} of {setup.total} required steps
                </span>
              )}
            </span>
          </Link>
        </li>
      </ul>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,29rem)]">
        <RegistrationOverview trend={trend} base={base} mine={mine} />
        <QuickAccess base={base} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,29rem)]">
        <AttentionRequired life={life} base={base} />
        <Deadlines deadlines={deadlines} mine={mine} base={base} />
      </div>

      <p className="flex items-center justify-end gap-3 text-sm">
        Updated {shortDateTime(d.generatedAt, mine.timeZone)}
        <Button
          variant="ghost"
          className="min-h-9 px-3 text-sm"
          icon={<RefreshCw aria-hidden className="size-4" />}
          onClick={refetch}
          loading={fetching}
        >
          Refresh
        </Button>
      </p>
    </>
  );
}

function Metric({
  icon,
  value,
  label,
  to,
  note,
  spark,
}: {
  icon: ReactNode;
  value: number | undefined;
  label: string;
  to: string;
  note?: ReactNode;
  spark?: number[];
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex h-full items-center gap-4 rounded-[14px] border border-line/60 bg-white p-5 text-ink no-underline shadow-card transition-colors hover:border-ember/50"
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-3xl font-extrabold">
            {value === undefined ? '—' : value.toLocaleString()}
          </span>
          <span className="block">{label}</span>
        </span>
        <span className="flex flex-col items-end gap-1 self-stretch justify-between">
          {spark ? <Sparkline values={spark} /> : <span />}
          {note}
        </span>
      </Link>
    </li>
  );
}

const RANGES = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'all', label: 'All time' },
] as const;

function RegistrationOverview({
  trend,
  base,
  mine,
}: {
  trend: Extract<Dashboard['trend'], { today: string }> | null;
  base: string;
  mine: MyEvent;
}) {
  const [range, setRange] = useState<'7d' | '30d' | 'all'>('7d');
  const points = useMemo(
    () => (trend ? cumulative(trend.registrations, trend.today, range) : []),
    [trend, range],
  );
  const total = trend?.registrations.reduce((n, d) => n + d.count, 0) ?? 0;
  return (
    <Panel aria-labelledby="reg-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="reg-h" className="flex items-center gap-2 text-xl">
          <BarChart3 aria-hidden className="size-6 stroke-ember" /> Registration overview
        </h3>
        <div role="group" aria-label="Time range" className="flex rounded-pill bg-paper p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                'min-h-9 cursor-pointer rounded-pill px-4 text-sm font-semibold',
                range === r.key ? 'bg-ember text-ink' : 'text-graphite hover:text-ink',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {!trend ? (
        <p className="mt-6">Registration history could not load. Refresh to try again.</p>
      ) : total === 0 ? (
        <div className="mt-6 flex flex-col items-start gap-2 rounded-card bg-paper p-6">
          <p className="font-semibold text-ink">No registrations yet.</p>
          <p>The chart fills in as participants register. Share the registration link to start.</p>
          <Link to={`${base}/teams?add=1`} className="font-bold text-ink">
            Get the registration link
          </Link>
        </div>
      ) : (
        <div className="mt-4">
          <AreaChart
            points={points}
            unit="registrations"
            label={`Total registrations received by day, ${range === 'all' ? 'all time' : `last ${range === '7d' ? '7' : '30'} days`}, in ${mine.timeZone} time`}
          />
          <p className="mt-1 text-xs">
            Running total of registrations received, including any later withdrawn.
          </p>
        </div>
      )}
    </Panel>
  );
}

function QuickAccess({ base }: { base: string }) {
  const tiles = [
    {
      label: 'Send announcement',
      to: `${base}/communication?history=announcements#compose`,
      icon: Megaphone,
    },
    { label: 'Add deadline', to: `${base}/rounds#new-round`, icon: CalendarPlus },
    { label: 'Add participant', to: `${base}/teams?add=1`, icon: UserPlus },
    { label: 'View submissions', to: `${base}/submissions`, icon: FileText },
  ];
  return (
    <Panel aria-labelledby="quick-h">
      <h3 id="quick-h" className="flex items-center gap-2 text-xl">
        <Zap aria-hidden className="size-6 stroke-ember" /> Quick access
      </h3>
      <ul className="mt-4 grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <li key={t.label}>
            <Link
              to={t.to}
              className="flex h-full min-h-28 flex-col items-center justify-center gap-3 rounded-card border border-line/70 bg-paper/40 p-3 text-center font-semibold text-ink no-underline transition-colors hover:border-ember/50 hover:bg-blush/50"
            >
              <t.icon aria-hidden className="size-8 stroke-ember" />
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AttentionRequired({ life, base }: { life: DashboardLifecycle | null; base: string }) {
  const [all, setAll] = useState(false);
  const items = life?.attention ?? [];
  if (!life)
    return (
      <Panel>
        <p>What needs attention could not load. Refresh to try again.</p>
      </Panel>
    );
  if (items.length === 0)
    return (
      <section
        aria-labelledby="attention-h"
        className="flex items-center gap-4 rounded-[14px] bg-success-bg p-6"
      >
        <CheckCircle2 aria-hidden className="size-10 shrink-0 text-success-fg" />
        <div>
          <h3 id="attention-h" className="text-xl">
            Nothing needs attention
          </h3>
          <p>Every request, issue and judging task is handled for now.</p>
        </div>
      </section>
    );
  const [top, ...rest] = items;
  const shown = all ? rest : rest.slice(0, 3);
  const severity = (t: string) =>
    t === 'error' ? 'Urgent' : t === 'warning' ? 'Action needed' : 'For information';
  return (
    <section aria-labelledby="attention-h" className="rounded-[14px] bg-blush p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-ember">
          <CircleAlert aria-hidden className="size-7 text-ink" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="attention-h" className="text-xl">
            Attention required
            <span className="ml-2 align-middle text-sm font-semibold text-graphite">
              {items.length} item{items.length === 1 ? '' : 's'}
            </span>
          </h3>
          <p className="text-[1.05rem]">
            <span className="sr-only">{severity(top!.tone)}: </span>
            {top!.label}
          </p>
        </div>
        <Link
          to={`${base}/${top!.to}`}
          className="inline-flex min-h-12 items-center gap-2 rounded-pill border-2 border-ember bg-white/70 px-6 font-bold text-ink no-underline hover:bg-white sm:border-l"
        >
          Review <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
      {rest.length > 0 && (
        <>
          <ul className="mt-4 flex flex-col divide-y divide-ember/15 border-t border-ember/20">
            {shown.map((a) => (
              <li key={a.key}>
                <Link
                  to={`${base}/${a.to}`}
                  className="flex min-h-11 items-center justify-between gap-3 py-2 text-ink no-underline hover:underline"
                >
                  <span className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        'mt-2 size-2 shrink-0 rounded-full',
                        a.tone === 'error'
                          ? 'bg-error-fg'
                          : a.tone === 'warning'
                            ? 'bg-ember'
                            : 'bg-graphite/50',
                      )}
                    />
                    <span>
                      <span className="sr-only">{severity(a.tone)}: </span>
                      {a.label}
                    </span>
                  </span>
                  <ArrowRight aria-hidden className="size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
          {rest.length > 3 && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              aria-expanded={all}
              className="mt-2 min-h-11 cursor-pointer font-semibold text-ink underline"
            >
              {all ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Deadlines({
  deadlines,
  mine,
  base,
}: {
  deadlines: { label: string; at: string }[];
  mine: MyEvent;
  base: string;
}) {
  return (
    <Panel aria-labelledby="deadlines-h">
      <div className="flex items-center justify-between gap-3">
        <h3 id="deadlines-h" className="flex items-center gap-2 text-xl">
          <CalendarDays aria-hidden className="size-6 stroke-ember" /> Upcoming deadlines
        </h3>
        <Link
          to={`${base}/rounds`}
          className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-ink no-underline hover:underline"
        >
          View all <ArrowRight aria-hidden className="size-4 stroke-ember" />
        </Link>
      </div>
      {deadlines.length === 0 ? (
        <p className="mt-3">
          No upcoming deadlines. <Link to={`${base}/rounds#new-round`}>Add a round deadline</Link>.
        </p>
      ) : (
        <ul className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {deadlines.slice(0, 4).map((x) => (
            <li key={`${x.label}-${x.at}`} className="flex gap-3">
              <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-ember" />
              <span>
                <span className="block font-bold text-ink">
                  {shortDateTime(x.at, mine.timeZone)}
                </span>
                <span className="block text-sm">{x.label}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
