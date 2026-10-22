import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { formatDateTime } from '../../lib/format.js';
import { opsApi, type Dashboard } from '../../lib/ops.js';
import { Alert, Badge, Button, Card, Skeleton } from '../../ui/index.js';

function isError(x: unknown): x is { error: string } {
  return typeof x === 'object' && x !== null && 'error' in x;
}

function Stat({ value, label, to }: { value: number | string; label: string; to?: string }) {
  const inner = (
    <>
      <span className="font-display text-3xl font-extrabold text-ink">{value}</span>
      <span className="block text-sm">{label}</span>
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

/** Operational dashboard for core admins: every number comes from persisted data and links to its list (PRD FR-043). */
export function DashboardCards({ mine }: { mine: MyEvent }) {
  const q = useQuery({
    queryKey: ['dashboard', mine.eventId],
    queryFn: () => opsApi.dashboard(mine.eventId),
  });
  const base = `/events/${mine.eventId}`;
  if (q.isPending)
    return (
      <div className="grid gap-4 sm:grid-cols-2">
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
  const fail = (c: unknown) => (isError(c) ? <Alert tone="warning" title={c.error} /> : null);
  return (
    <section aria-labelledby="dash-h" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="dash-h">Event dashboard</h3>
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
      {!isError(d.issues) && d.issues.urgent.length > 0 && (
        <Alert
          tone="error"
          title={`${d.issues.urgent.length} urgent issue${d.issues.urgent.length === 1 ? '' : 's'}`}
        >
          <ul className="list-disc pl-5">
            {d.issues.urgent.map((i) => (
              <li key={i.id}>{i.description}</li>
            ))}
          </ul>
          <Link to={`${base}/issues`}>Open the issue queue</Link>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card footerLabel="Participants">
          {fail(d.participants) ??
            (!isError(d.participants) && (
              <div className="grid grid-cols-3 gap-3">
                <Stat
                  value={d.participants.registered}
                  label="registered"
                  to={`${base}/participants`}
                />
                <Stat
                  value={d.participants.inTeam}
                  label="in a team"
                  to={`${base}/participants?team=in`}
                />
                <Stat
                  value={d.participants.noTeam}
                  label="no team"
                  to={`${base}/participants?team=none`}
                />
              </div>
            ))}
        </Card>
        <Card footerLabel="Teams">
          {fail(d.teams) ??
            (!isError(d.teams) && (
              <div className="grid grid-cols-3 gap-3">
                <Stat value={d.teams.complete} label="complete" to={`${base}/teams?complete=yes`} />
                <Stat
                  value={d.teams.incomplete}
                  label="incomplete"
                  to={`${base}/teams?complete=no`}
                />
                <Stat
                  value={d.teams.disqualified}
                  label="disqualified"
                  to={`${base}/teams?status=DISQUALIFIED`}
                />
              </div>
            ))}
        </Card>
        <Card footerLabel="Check-in">
          {fail(d.checkin) ??
            (!isError(d.checkin) && (
              <div className="grid grid-cols-3 gap-3">
                <Stat
                  value={`${d.checkin.checkedIn}/${d.checkin.participants}`}
                  label="people"
                  to={`${base}/checkin`}
                />
                <Stat value={d.checkin.teams.checkedIn} label="teams in" />
                <Stat value={d.checkin.teams.partial} label="partial" />
              </div>
            ))}
        </Card>
        <Card footerLabel="Submissions">
          {fail(d.submissions) ??
            (!isError(d.submissions) && (
              <ul className="flex flex-col gap-2">
                {d.submissions.map((r) => (
                  <li key={r.roundId}>
                    <strong>{r.name}</strong>:{' '}
                    {Object.entries(r.counts)
                      .map(([k, n]) => `${n} ${k.toLowerCase().replace(/_/g, ' ')}`)
                      .join(', ') || 'no teams'}{' '}
                    <Link to={`${base}/submissions`}>View</Link>
                  </li>
                ))}
              </ul>
            ))}
        </Card>
        <Card footerLabel="Judging">
          {fail(d.judging) ??
            (!isError(d.judging) && (
              <ul className="flex flex-col gap-2">
                {d.judging.map((r) => (
                  <li key={r.roundId}>
                    <strong>{r.name}</strong>: {r.submitted} of {r.assigned} evaluations{' '}
                    <Badge tone={r.status === 'OPEN' ? 'success' : 'info'}>
                      {r.status.replace('_', ' ').toLowerCase()}
                    </Badge>{' '}
                    <Link to={`${base}/judging`}>Open</Link>
                  </li>
                ))}
              </ul>
            ))}
        </Card>
        <Card footerLabel="Operations">
          {fail(d.issues) ??
            (!isError(d.issues) && !isError(d.tasks) && (
              <div className="grid grid-cols-3 gap-3">
                <Stat value={d.issues.open} label="open issues" to={`${base}/issues`} />
                <Stat
                  value={d.tasks.blocked}
                  label="blocked tasks"
                  to={`${base}/tasks?status=BLOCKED`}
                />
                <Stat value={d.tasks.open} label="open tasks" to={`${base}/tasks`} />
              </div>
            ))}
        </Card>
        <Card footerLabel="Next deadlines">
          {fail(d.deadlines) ??
            (!isError(d.deadlines) &&
              (d.deadlines.length === 0 ? (
                <p>No upcoming deadlines.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {d.deadlines.map((x) => (
                    <li key={x.label}>
                      <strong>{x.label}</strong>: {formatDateTime(x.at, mine.timeZone)}
                    </li>
                  ))}
                </ul>
              )))}
        </Card>
        <Card footerLabel="Integrations">
          {fail(d.integrations) ??
            (!isError(d.integrations) && (
              <>
                <p>
                  Google Sheets:{' '}
                  <Badge
                    tone={
                      d.integrations.status === 'CONNECTED'
                        ? 'success'
                        : d.integrations.status === 'NOT_CONNECTED'
                          ? 'info'
                          : 'error'
                    }
                  >
                    {
                      {
                        NOT_CONNECTED: 'Not connected',
                        CONNECTED: 'Connected',
                        FAILING: 'Last sync failed',
                        NEEDS_REAUTH: 'Needs reconnecting',
                      }[d.integrations.status]
                    }
                  </Badge>
                </p>
                {d.integrations.lastSuccessAt && (
                  <p className="mt-1 text-sm">
                    Last synced {formatDateTime(d.integrations.lastSuccessAt, mine.timeZone)}
                  </p>
                )}
                {d.integrations.lastError && (
                  <p className="mt-1 text-sm">{d.integrations.lastError}</p>
                )}
                <p className="mt-2 text-sm">
                  <Link to={`${base}/integrations`}>Integrations</Link> ·{' '}
                  <a href={`/api/v1/events/${mine.eventId}/exports/participants.csv`}>Export CSV</a>
                </p>
              </>
            ))}
        </Card>
      </div>
    </section>
  );
}
