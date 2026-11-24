import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Circle, CircleAlert, RefreshCw } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { formatDateTime } from '../../lib/format.js';
import { opsApi, type Dashboard, type DashboardLifecycle } from '../../lib/ops.js';
import { DivisionCards } from '../events/AreasPage.js';
import { Alert, Button, Card, Skeleton } from '../../ui/index.js';
import { cn } from '../../ui/cn.js';

type CardData<T> = T | { error: string };
function isError(x: unknown): x is { error: string } {
  return typeof x === 'object' && x !== null && 'error' in x;
}
const ok = <T,>(x: CardData<T>): T | null => (isError(x) ? null : x);

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
        life && <StageStrip life={life} />
      )}

      {/* The seven divisions are the primary way in (UX spec v1.0 §6); this card set is the other six. */}
      <section aria-labelledby="divisions-h" className="flex flex-col gap-3">
        <h3 id="divisions-h">Manage the event</h3>
        <DivisionCards mine={mine} status={divisionStatus(d, life)} />
      </section>

      {life && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Attention life={life} base={base} />
          <NextSteps life={life} base={base} />
        </div>
      )}

      <Deadlines d={d} mine={mine} />
    </div>
  );
}

/** One short, real status line per division card; nothing is shown when there is nothing useful to say. */
function divisionStatus(
  d: Dashboard,
  life: DashboardLifecycle | null,
): Record<string, string | null> {
  const participants = ok(d.participants);
  const teams = ok(d.teams);
  const issues = ok(d.issues);
  const judging = ok(d.judging);
  const setupLeft =
    life?.stage === 'setup' ? life.nextSteps.filter((s) => !s.done && !s.optional).length : 0;
  const openRound = judging?.find((r) => r.status === 'OPEN');
  return {
    setup:
      setupLeft > 0
        ? `${setupLeft} required step${setupLeft === 1 ? '' : 's'} before publishing`
        : null,
    registrations: participants
      ? `${participants.registered} registered${participants.noTeam ? ` · ${participants.noTeam} without a team` : ''}${teams ? ` · ${teams.total} teams` : ''}`
      : null,
    operations:
      issues && issues.open > 0 ? `${issues.open} open issue${issues.open === 1 ? '' : 's'}` : null,
    evaluation: openRound
      ? `${openRound.name}: ${openRound.submitted} of ${openRound.assigned} evaluations submitted`
      : null,
    results: null,
    administration: null,
  };
}

function Deadlines({ d, mine }: { d: Dashboard; mine: MyEvent }) {
  const deadlines = ok(d.deadlines);
  if (!deadlines?.length) return null;
  return (
    <section aria-labelledby="deadlines-h" className="flex flex-col gap-3">
      <h3 id="deadlines-h">Upcoming deadlines</h3>
      <Card>
        <ul className="flex flex-col gap-1">
          {deadlines.map((x) => (
            <li key={x.label}>
              <strong>{x.label}</strong>: {formatDateTime(x.at, mine.timeZone)}
            </li>
          ))}
        </ul>
      </Card>
    </section>
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
