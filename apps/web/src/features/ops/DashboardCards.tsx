import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Circle, CircleAlert, RefreshCw } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { formatDateTime } from '../../lib/format.js';
import { opsApi, type Dashboard, type DashboardLifecycle } from '../../lib/ops.js';
import { navFor } from '../../shell/nav.js';
import { Alert, Button, Card, Skeleton } from '../../ui/index.js';
import { cn } from '../../ui/cn.js';

type CardData<T> = T | { error: string };
function isError(x: unknown): x is { error: string } {
  return typeof x === 'object' && x !== null && 'error' in x;
}
const ok = <T,>(x: CardData<T>): T | null => (isError(x) ? null : x);

const SUBMISSION_LABEL: Record<string, string> = {
  NOT_STARTED: 'not started',
  DRAFT: 'drafting',
  SUBMITTED: 'submitted',
  SUBMITTED_LATE: 'submitted late',
  LOCKED: 'locked',
  NOT_SUBMITTED: 'did not submit',
};
const JUDGING_LABEL: Record<string, string> = {
  NOT_OPEN: 'Not open',
  OPEN: 'Open',
  CLOSED: 'Closed',
};

function Stat({ value, label, to }: { value: number | string; label: string; to?: string }) {
  const inner = (
    <>
      <span className="font-display text-3xl font-extrabold text-ink">{value}</span>
      <span className="block">{label}</span>
    </>
  );
  return to ? (
    <Link to={to} className="block no-underline hover:underline">
      {inner}
    </Link>
  ) : (
    <div>{inner}</div>
  );
}

/**
 * Core Admin dashboard (PRD FR-043, §11.6 "next required action"): the event's stage, what needs attention,
 * the next steps for this stage and an entry card for each division. Every number comes from persisted data
 * and links to the list it summarises; nothing is a placeholder.
 */
export function DashboardCards({ mine, identity }: { mine: MyEvent; identity?: ReactNode }) {
  const q = useQuery({
    queryKey: ['dashboard', mine.eventId],
    queryFn: () => opsApi.dashboard(mine.eventId),
  });
  const base = `/events/${mine.eventId}`;
  if (q.isPending)
    return (
      <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <Alert tone="error" title="We couldn't load the dashboard">
        <Button variant="secondary" className="mt-2" onClick={() => void q.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  const d: Dashboard = q.data;
  const life = ok(d.lifecycle);
  const stage = life?.stage ?? 'event';
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2>Dashboard</h2>
          {identity}
        </div>
        <span className="flex items-center gap-3 text-sm">
          Updated {formatDateTime(d.generatedAt, mine.timeZone)}
          <Button
            variant="secondary"
            icon={<RefreshCw aria-hidden className="size-4" />}
            onClick={() => void q.refetch()}
            loading={q.isFetching}
          >
            Refresh
          </Button>
        </span>
      </div>

      {isError(d.lifecycle) ? (
        <Alert tone="warning" title={d.lifecycle.error} />
      ) : (
        life && (
          <>
            <StageStrip life={life} />
            <div className="grid gap-6 lg:grid-cols-2">
              <Attention life={life} base={base} />
              <NextSteps life={life} base={base} />
            </div>
          </>
        )
      )}

      <LiveNumbers d={d} stage={stage} base={base} mine={mine} />
      <Divisions d={d} base={base} />
    </div>
  );
}

function StageStrip({ life }: { life: DashboardLifecycle }) {
  const current = life.stages.findIndex((s) => s.key === life.stage);
  return (
    <section aria-labelledby="stage-h">
      <h3 id="stage-h" className="sr-only">
        Event stage
      </h3>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {life.stages.map((s, i) => (
          <li
            key={s.key}
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'rounded-card border px-3 py-2',
              i === current
                ? 'border-ink bg-white font-bold text-ink'
                : 'border-line bg-paper text-graphite',
            )}
          >
            <span className="block text-xs font-semibold">
              {i < current ? 'Done' : i === current ? 'Current stage' : 'Later'}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Attention({ life, base }: { life: DashboardLifecycle; base: string }) {
  return (
    <Card>
      <h3 id="attention-h">Needs attention</h3>
      {life.attention.length === 0 ? (
        <p className="mt-2">Nothing needs your attention right now.</p>
      ) : (
        <ul aria-labelledby="attention-h" className="mt-3 flex flex-col divide-y divide-line">
          {life.attention.map((a) => (
            <li key={a.key} className="py-2 first:pt-0">
              <Link
                to={`${base}/${a.to}`}
                className="flex min-h-11 items-center justify-between gap-3 text-ink"
              >
                <span className="flex items-start gap-2">
                  <CircleAlert
                    aria-hidden
                    className={cn(
                      'mt-0.5 size-5 shrink-0',
                      a.tone === 'error'
                        ? 'text-error-fg'
                        : a.tone === 'warning'
                          ? 'text-warning-fg'
                          : '',
                    )}
                  />
                  <span>
                    <span className="sr-only">
                      {a.tone === 'error'
                        ? 'Urgent: '
                        : a.tone === 'warning'
                          ? 'Action needed: '
                          : ''}
                    </span>
                    {a.label}
                  </span>
                </span>
                <ArrowRight aria-hidden className="size-4 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NextSteps({ life, base }: { life: DashboardLifecycle; base: string }) {
  const stageLabel = life.stages.find((s) => s.key === life.stage)?.label ?? '';
  const next = life.nextSteps.find((s) => !s.done && !s.optional);
  return (
    <Card>
      <h3>Next steps · {stageLabel}</h3>
      {next && (
        <p className="mt-2">
          <strong>Next:</strong> <Link to={`${base}/${next.to}`}>{next.label}</Link>
        </p>
      )}
      <ul className="mt-3 flex flex-col gap-1">
        {life.nextSteps.map((s) => (
          <li key={s.key} className="flex items-start gap-2">
            {s.done ? (
              <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success-fg" />
            ) : (
              <Circle aria-hidden className="mt-0.5 size-5 shrink-0" />
            )}
            <span>
              <span className="sr-only">{s.done ? 'Done: ' : 'To do: '}</span>
              <Link to={`${base}/${s.to}`} className={s.done ? 'text-graphite' : undefined}>
                {s.label}
              </Link>
              {s.optional && <span className="text-sm"> (optional)</span>}
              {!s.done && s.hint && <span className="block text-sm">{s.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The few live numbers that matter at this stage; everything else lives on its own page. */
function LiveNumbers({
  d,
  stage,
  base,
  mine,
}: {
  d: Dashboard;
  stage: string;
  base: string;
  mine: MyEvent;
}) {
  const participants = ok(d.participants);
  const teams = ok(d.teams);
  const checkin = ok(d.checkin);
  const submissions = ok(d.submissions);
  const judging = ok(d.judging);
  const deadlines = ok(d.deadlines);
  const integrations = ok(d.integrations);
  const show = (...stages: string[]) => stages.includes(stage);
  const cards = [
    show('registration', 'event') && participants && teams && (
      <Card key="reg">
        <h3>Registrations</h3>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Stat
            value={participants.registered}
            label="registered"
            to={`${base}/teams?view=participants`}
          />
          <Stat
            value={participants.noTeam}
            label="without a team"
            to={`${base}/teams?view=participants&team=none`}
          />
          <Stat value={teams.complete} label="complete teams" to={`${base}/teams?complete=yes`} />
        </div>
      </Card>
    ),
    show('event') && checkin && (
      <Card key="checkin">
        <h3>Check-in</h3>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Stat
            value={`${checkin.checkedIn}/${checkin.participants}`}
            label="people checked in"
            to={`${base}/checkin`}
          />
          <Stat value={checkin.teams.checkedIn} label="teams fully in" to={`${base}/checkin`} />
          <Stat value={checkin.teams.partial} label="teams partly in" to={`${base}/checkin`} />
        </div>
      </Card>
    ),
    show('event', 'judging') && submissions && submissions.length > 0 && (
      <Card key="subs">
        <h3>Submissions</h3>
        <ul className="mt-3 flex flex-col gap-2">
          {submissions.map((r) => (
            <li key={r.roundId}>
              <Link to={`${base}/submissions?round=${r.roundId}`} className="font-bold">
                {r.name}
              </Link>
              :{' '}
              {Object.entries(r.counts)
                .map(([k, n]) => `${n} ${SUBMISSION_LABEL[k] ?? k.toLowerCase()}`)
                .join(', ') || 'no teams yet'}
            </li>
          ))}
        </ul>
      </Card>
    ),
    show('judging', 'results') && judging && judging.length > 0 && (
      <Card key="judging">
        <h3>Judging</h3>
        <ul className="mt-3 flex flex-col gap-2">
          {judging.map((r) => (
            <li key={r.roundId}>
              <Link to={`${base}/judging?round=${r.roundId}`} className="font-bold">
                {r.name}
              </Link>
              : {r.submitted} of {r.assigned} evaluations submitted ·{' '}
              {JUDGING_LABEL[r.status] ?? r.status}
            </li>
          ))}
        </ul>
      </Card>
    ),
    show('registration', 'event', 'judging') && deadlines && deadlines.length > 0 && (
      <Card key="deadlines">
        <h3>Coming up</h3>
        <ul className="mt-3 flex flex-col gap-1">
          {deadlines.map((x) => (
            <li key={x.label}>
              <strong>{x.label}</strong>: {formatDateTime(x.at, mine.timeZone)}
            </li>
          ))}
        </ul>
      </Card>
    ),
    integrations &&
      (integrations.status === 'FAILING' || integrations.status === 'NEEDS_REAUTH') && (
        <Alert
          key="integrations"
          tone="error"
          title={
            integrations.status === 'FAILING'
              ? 'The last Google Sheets sync failed'
              : 'Google needs reconnecting'
          }
        >
          {integrations.lastError && <p>{integrations.lastError}</p>}
          <Link to={`${base}/integrations`}>Open integrations</Link>
        </Alert>
      ),
  ].filter(Boolean);
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="live-h" className="flex flex-col gap-3">
      <h3 id="live-h">At a glance</h3>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards}</div>
    </section>
  );
}

/** One entry card per division (the sidebar's seven divisions, minus this dashboard). */
function Divisions({ d, base }: { d: Dashboard; base: string }) {
  const participants = ok(d.participants);
  const issues = ok(d.issues);
  const judging = ok(d.judging);
  const status: Record<string, string | null> = {
    registrations: participants ? `${participants.registered} registered` : null,
    operations:
      issues && issues.open > 0 ? `${issues.open} open issue${issues.open === 1 ? '' : 's'}` : null,
    evaluation: judging && judging.some((r) => r.status === 'OPEN') ? 'Judging is open' : null,
  };
  const divisions = navFor('ADMIN').filter((g) => g.id !== 'dashboard');
  return (
    <section aria-labelledby="divisions-h" className="flex flex-col gap-3">
      <h3 id="divisions-h">Manage the event</h3>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {divisions.map((g) => {
          const first = g.items[0]!;
          return (
            <li key={g.id}>
              <Card className="h-full">
                <h4 className="font-display text-lg font-bold">
                  <Link to={`${base}/${first.to}`} className="text-ink">
                    {g.label}
                  </Link>
                </h4>
                <p className="mt-1">{g.description}</p>
                {status[g.id] && <p className="mt-2 font-semibold">{status[g.id]}</p>}
                <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {g.items.map((i) => (
                    <li key={i.to}>
                      <Link to={`${base}/${i.to}`}>{i.label}</Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
