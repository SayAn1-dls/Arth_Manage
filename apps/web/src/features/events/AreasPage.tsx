import { useState, type ReactNode } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, ChevronDown, Circle, CircleAlert } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { opsApi, type Dashboard, type DashboardLifecycle } from '../../lib/ops.js';
import { activeGroupId, navFor, segmentOf, type NavEntry, type NavGroup } from '../../shell/nav.js';
import { navIcon, taskIcon } from '../../shell/navIcons.js';
import { Alert, Skeleton } from '../../ui/index.js';
import { cn } from '../../ui/cn.js';

type CardData<T> = T | { error: string };
const ok = <T,>(x: CardData<T> | undefined): T | null =>
  !x || (typeof x === 'object' && 'error' in x) ? null : (x as T);

export type TaskStatus =
  'Not configured' | 'Needs attention' | 'In progress' | 'Complete' | 'Awaiting approval';

const STATUS_STYLE: Record<TaskStatus, { dot: string; text: string }> = {
  'Not configured': { dot: 'bg-graphite/50', text: 'text-graphite' },
  'Needs attention': { dot: 'bg-ember', text: 'text-ink' },
  'In progress': { dot: 'bg-sunrise', text: 'text-ink' },
  Complete: { dot: 'bg-success-fg', text: 'text-success-fg' },
  'Awaiting approval': { dot: 'bg-ember', text: 'text-ink' },
};

/** A quiet status label: a dot and sentence-case text, never colour alone. */
export function StatusTag({ status }: { status: TaskStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold whitespace-nowrap',
        s.text,
      )}
    >
      <span aria-hidden className={cn('size-2 rounded-full', s.dot)} />
      {status}
    </span>
  );
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * What the app knows about one task, from the dashboard payload only: a status label where the state is
 * clear, and one fact worth knowing before opening it. Nothing is estimated; unknown means no label.
 */
export function taskState(
  to: string,
  d: Dashboard | undefined,
  life: DashboardLifecycle | null,
): { status: TaskStatus | null; fact: string | null; attention: DashboardLifecycle['attention'] } {
  const seg = segmentOf(to);
  const attention = life?.attention.filter((a) => segmentOf(a.to) === seg) ?? [];
  const config = ok(d?.config);
  const records = ok(d?.records);
  const people = ok(d?.people);
  const participants = ok(d?.participants);
  const teams = ok(d?.teams);
  const judging = ok(d?.judging);
  const checkin = ok(d?.checkin);
  const issues = ok(d?.issues);
  const tasks = ok(d?.tasks);
  const integrations = ok(d?.integrations);
  const submissions = ok(d?.submissions);
  let status: TaskStatus | null = attention.some((a) => a.tone !== 'info')
    ? 'Needs attention'
    : null;
  let fact: string | null = null;
  const needs = (s: TaskStatus | null) => status ?? s;

  // Shortcuts into a section or filtered view describe that section only, never the whole page's state.
  const partial = /[?#]/.test(to);
  if (partial) status = null;
  switch (to) {
    case 'setup':
      if (config) {
        status = needs(config.eventStatus === 'DRAFT' ? 'In progress' : 'Complete');
        fact =
          config.eventStatus === 'DRAFT'
            ? 'Draft: not public yet'
            : `Published · registration ${config.registration.toLowerCase().replace('_', ' ')}`;
      }
      break;
    case 'rounds':
      if (config) {
        const noDeadline = config.rounds.filter((r) => !r.submissionDeadline).length;
        status = needs(
          config.rounds.length === 0
            ? 'Not configured'
            : noDeadline
              ? 'Needs attention'
              : 'Complete',
        );
        fact =
          config.rounds.length === 0
            ? 'No rounds yet'
            : noDeadline
              ? `${plural(noDeadline, 'round')} without a deadline`
              : plural(config.rounds.length, 'round');
      }
      break;
    case 'structure':
      if (config) {
        status = needs(
          config.problems === 0
            ? 'Not configured'
            : config.emptyTracks
              ? 'Needs attention'
              : 'Complete',
        );
        fact = config.emptyTracks
          ? `${plural(config.emptyTracks, 'track')} without a problem statement`
          : `${plural(config.tracks, 'track')} · ${plural(config.problems, 'problem statement')}`;
      }
      break;
    case 'guidebook':
      if (config) {
        status = needs(config.guidebookPublished ? 'Complete' : 'Not configured');
        fact = config.guidebookPublished ? 'Published' : 'Not published yet';
      }
      break;
    case 'setup#registration-questions':
      if (config)
        fact = config.registrationQuestions
          ? plural(config.registrationQuestions, 'custom question')
          : 'Only the standard questions';
      break;
    case 'setup#publishing':
      if (config) fact = `Registration ${config.registration.toLowerCase().replace('_', ' ')}`;
      break;
    case 'integrations':
      if (integrations && seg === 'integrations') {
        if (integrations.status === 'CONNECTED') status = needs('Complete');
        if (integrations.status === 'FAILING' || integrations.status === 'NEEDS_REAUTH')
          status = 'Needs attention';
        fact =
          integrations.status === 'NOT_CONNECTED'
            ? 'Optional · CSV exports always available'
            : integrations.status === 'CONNECTED'
              ? 'Google Sheets connected'
              : integrations.status === 'NEEDS_REAUTH'
                ? 'Google needs to be reconnected'
                : 'The last sync failed';
      }
      break;
    case 'teams':
      if (teams && participants)
        fact = `${plural(teams.total, 'team')} · ${plural(participants.noTeam, 'participant')} without a team`;
      break;
    case 'applications':
      if (config && !config.applicationReview) fact = 'Screening is off: teams are accepted';
      break;
    case 'people':
      if (people)
        fact = `${plural(people.judges, 'judge')}${people.judgeInvites ? ` (+${people.judgeInvites} invited)` : ''} · ${people.staff} staff · ${plural(people.admins, 'organiser')}`;
      break;
    case 'rubric':
      if (config) {
        const active = config.rounds.filter((r) => r.rubric && r.rubric !== 'DRAFT').length;
        status = needs(
          config.rounds.length === 0 || active === 0
            ? 'Not configured'
            : active < config.rounds.length
              ? 'In progress'
              : 'Complete',
        );
        fact = config.rounds.length
          ? `${active} of ${config.rounds.length} rounds have an active rubric`
          : 'Add a round first';
      }
      break;
    case 'submissions': {
      const latest = submissions?.at(-1);
      if (latest) {
        const total = Object.values(latest.counts).reduce((n, c) => n + c, 0);
        const done =
          (latest.counts.SUBMITTED ?? 0) + (latest.counts.LATE ?? 0) + (latest.counts.LOCKED ?? 0);
        fact = `${latest.name}: ${done} of ${plural(total, 'team')} submitted`;
      }
      break;
    }
    case 'judging': {
      const open = judging?.find((r) => r.status === 'OPEN');
      if (open) {
        status = needs('In progress');
        fact = `${open.name}: ${open.submitted} of ${plural(open.assigned, 'evaluation')} submitted`;
      } else if (judging?.length && judging.every((r) => r.status === 'CLOSED')) {
        status = needs('Complete');
        fact = 'Judging is closed for every round';
      } else if (judging?.length) fact = 'Judging has not opened yet';
      break;
    }
    case 'checkin':
      if (checkin)
        fact = `${checkin.checkedIn} of ${plural(checkin.participants, 'person', 'people')} checked in`;
      break;
    case 'support': {
      const open = life?.attention
        .filter((a) => ['exceptions', 'questions'].includes(a.key))
        .reduce((n, a) => n + a.count, 0);
      fact = open ? `${plural(open, 'open request')}` : 'No open requests';
      break;
    }
    case 'issues':
      if (issues) fact = issues.open ? `${plural(issues.open, 'open issue')}` : 'No open issues';
      break;
    case 'tasks':
      if (tasks)
        fact = `${tasks.open} open · ${tasks.blocked} blocked · ${tasks.unassigned} unassigned`;
      break;
    case 'communication':
      fact = attention.length ? null : 'All messages delivered';
      break;
    case 'results':
      if (records?.results.length) {
        const awaiting = records.results.filter((r) => r.state === 'AWAITING_APPROVAL').length;
        const published = records.results.filter((r) => r.state === 'PUBLISHED').length;
        const approved = records.results.filter((r) => r.state === 'APPROVED').length;
        status = awaiting
          ? 'Awaiting approval'
          : published === records.results.length
            ? 'Complete'
            : approved
              ? 'In progress'
              : status;
        fact = `${published} of ${plural(records.results.length, 'round')} published`;
      }
      break;
    case 'feedback':
      if (records) fact = plural(records.feedbackResponses, 'survey response');
      break;
    case 'certificates':
      if (records) {
        const released = records.certificates.RELEASED ?? 0;
        const generated = records.certificates.GENERATED ?? 0;
        if (released && !generated) status = needs('Complete');
        else if (generated) status = needs('In progress');
        fact =
          released || generated
            ? `${released} released · ${generated} awaiting release`
            : 'None generated yet';
      }
      break;
    case 'audit':
      if (records) fact = plural(records.auditEntries, 'recorded change');
      break;
  }
  if (fact && attention.some((a) => a.label === fact)) fact = null;
  return { status, fact, attention };
}

function useDashboard(mine: MyEvent) {
  const q = useQuery({
    queryKey: ['dashboard', mine.eventId],
    queryFn: () => opsApi.dashboard(mine.eventId),
    enabled: mine.role === 'ADMIN',
  });
  const life = q.data ? ok(q.data.lifecycle) : null;
  return { d: q.data, life, pending: q.isPending, error: q.isError };
}

/** A task card. Critical tasks get the larger treatment with an icon; others are compact. */
function TaskCard({
  base,
  entry,
  d,
  life,
  featured,
}: {
  base: string;
  entry: NavEntry;
  d: Dashboard | undefined;
  life: DashboardLifecycle | null;
  featured?: boolean;
}) {
  const { status, fact, attention } = taskState(entry.to, d, life);
  const to = entry.to === '' ? base : `${base}/${entry.to}`;
  const Icon = taskIcon(entry.to);
  const urgent = attention.some((a) => a.tone === 'error');
  return (
    <Link
      to={to}
      aria-label={`${entry.label}${status ? `, ${status}` : ''}`}
      className={cn(
        'group flex h-full flex-col gap-3 rounded-[14px] border bg-white text-graphite no-underline shadow-card transition-colors hover:border-ember/60',
        featured ? 'p-5 sm:p-6' : 'p-4 sm:p-5',
        urgent ? 'border-error-fg/60' : 'border-line/60',
      )}
    >
      <span className="flex items-start gap-3">
        {featured && (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-card bg-blush">
            <Icon aria-hidden className="size-6 stroke-ember" />
          </span>
        )}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className={cn('font-display font-bold text-ink', featured ? 'text-xl' : 'text-lg')}>
            {entry.label}
          </span>
          {status && <StatusTag status={status} />}
        </span>
      </span>
      <span>{entry.description}</span>
      {(fact || attention.length > 0) && (
        <span className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
          {attention.slice(0, 2).map((a) => (
            <span key={a.key} className="flex items-start gap-1.5 font-semibold text-ink">
              <CircleAlert
                aria-hidden
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  a.tone === 'error' ? 'stroke-error-fg' : 'stroke-ember',
                )}
              />
              {a.label}
            </span>
          ))}
          {fact && <span className="font-semibold text-ink">{fact}</span>}
        </span>
      )}
      <span className="mt-auto inline-flex items-center gap-1.5 pt-1 font-bold text-ink">
        Open{' '}
        <ArrowRight
          aria-hidden
          className="size-4 stroke-ember transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}

/** One number worth knowing on a domain page, linking to where it comes from. */
function Stat({ label, value, to }: { label: string; value: ReactNode; to?: string }) {
  const body = (
    <>
      <span className="block font-display text-2xl font-extrabold text-ink">{value}</span>
      <span className="block text-sm">{label}</span>
    </>
  );
  return (
    <li className="min-w-0">
      {to ? (
        <Link to={to} className="block rounded-card px-1 no-underline hover:bg-blush/50">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

interface StatItem {
  label: string;
  value: string | number;
  to?: string;
}
type MaybeStat = StatItem | null | undefined | false;

/** Live figures for each domain, all from the dashboard payload. */
function domainStats(
  id: string,
  d: Dashboard | undefined,
  base: string,
  life: DashboardLifecycle | null,
): MaybeStat[] {
  const count = (key: string) => life?.attention.find((a) => a.key === key)?.count ?? 0;
  const config = ok(d?.config);
  const setup = ok(d?.setup);
  const participants = ok(d?.participants);
  const teams = ok(d?.teams);
  const judging = ok(d?.judging);
  const checkin = ok(d?.checkin);
  const issues = ok(d?.issues);
  const tasks = ok(d?.tasks);
  const records = ok(d?.records);
  const people = ok(d?.people);
  switch (id) {
    case 'configuration':
      return [
        setup && { label: 'Setup complete', value: `${setup.percent}%` },
        config && { label: 'Rounds', value: config.rounds.length, to: `${base}/rounds` },
        config && { label: 'Problem statements', value: config.problems, to: `${base}/structure` },
        config && {
          label: 'Tracks without problems',
          value: config.emptyTracks,
          to: `${base}/structure`,
        },
      ];
    case 'people':
      return [
        participants && {
          label: 'Registered',
          value: participants.registered,
          to: `${base}/teams?view=participants`,
        },
        teams && { label: 'Teams', value: teams.total, to: `${base}/teams` },
        participants && {
          label: 'Without a team',
          value: participants.noTeam,
          to: `${base}/teams?view=participants&team=none`,
        },
        teams && {
          label: 'Teams below minimum size',
          value: teams.incomplete,
          to: `${base}/teams?complete=no`,
        },
        people && { label: 'Judges', value: people.judges, to: `${base}/people` },
      ];
    case 'judging': {
      const open = judging?.find((r) => r.status === 'OPEN') ?? judging?.at(-1);
      return [
        open && {
          label: `${open.name} evaluations submitted`,
          value: `${open.submitted}/${open.assigned}`,
          to: `${base}/judging?round=${open.roundId}`,
        },
        open && { label: 'Teams with submitted work', value: open.teamsWithWork },
        config && {
          label: 'Active rubrics',
          value: `${config.rounds.filter((r) => r.rubric && r.rubric !== 'DRAFT').length}/${config.rounds.length}`,
          to: `${base}/rubric`,
        },
        { label: 'Correction requests', value: count('corrections'), to: `${base}/judging` },
      ];
    }
    case 'operations':
      return [
        checkin && {
          label: 'Checked in',
          value: `${checkin.checkedIn}/${checkin.participants}`,
          to: `${base}/checkin`,
        },
        {
          label: 'Open requests',
          value: count('exceptions') + count('questions'),
          to: `${base}/support`,
        },
        issues && { label: 'Open issues', value: issues.open, to: `${base}/issues` },
        tasks && { label: 'Open staff tasks', value: tasks.open, to: `${base}/tasks` },
      ];
    case 'communication':
      return [
        {
          label: 'Undelivered messages',
          value: count('failed-messages'),
          to: `${base}/communication?history=targeted&delivery=FAILED`,
        },
        {
          label: 'Unanswered questions',
          value: count('questions'),
          to: `${base}/support?tab=general`,
        },
      ];
    case 'records':
      return records
        ? [
            {
              label: 'Rounds with published results',
              value: `${records.results.filter((r) => r.state === 'PUBLISHED').length}/${records.results.length}`,
              to: `${base}/results`,
            },
            {
              label: 'Certificates released',
              value: records.certificates.RELEASED ?? 0,
              to: `${base}/certificates`,
            },
            { label: 'Survey responses', value: records.feedbackResponses, to: `${base}/feedback` },
          ]
        : [];
  }
  return [];
}

/** The configuration checklist: required steps with progress, optional ones after. */
function SetupChecklist({ d, base }: { d: Dashboard | undefined; base: string }) {
  const setup = ok(d?.setup);
  if (!setup) return null;
  return (
    <section
      aria-labelledby="checklist-h"
      className="rounded-[14px] border border-line/60 bg-white p-5 shadow-card sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="checklist-h" className="text-xl">
          Setup checklist
        </h3>
        <span className="text-sm font-semibold text-ink">
          {setup.done} of {setup.total} required steps done
        </span>
      </div>
      <span
        role="progressbar"
        aria-label="Setup complete"
        aria-valuenow={setup.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-3 block h-2 w-full overflow-hidden rounded-full bg-blush"
      >
        <span
          className="block h-full rounded-full bg-ember"
          style={{ width: `${setup.percent}%` }}
        />
      </span>
      <ul className="mt-4 grid gap-x-6 gap-y-1 md:grid-cols-2">
        {[...setup.items.filter((i) => !i.done), ...setup.items.filter((i) => i.done)].map((s) => (
          <li key={s.key}>
            <Link
              to={`${base}/${s.to}`}
              className="flex min-h-11 items-start gap-2.5 rounded-card px-2 py-2 text-ink no-underline hover:bg-blush/60"
            >
              {s.done ? (
                <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 stroke-success-fg" />
              ) : (
                <Circle aria-hidden className="mt-0.5 size-5 shrink-0 stroke-graphite" />
              )}
              <span>
                <span className="sr-only">{s.done ? 'Done: ' : 'To do: '}</span>
                <span
                  className={cn(
                    s.done ? 'text-graphite line-through decoration-graphite/40' : 'font-semibold',
                  )}
                >
                  {s.label}
                </span>
                {s.optional && <span className="text-sm text-graphite"> · optional</span>}
                {!s.done && s.hint && <span className="block text-sm text-graphite">{s.hint}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Domain landing page (approved decision 2): title and purpose, live figures, what needs attention here,
 * critical tasks first as larger cards, everyday tasks after, advanced tools folded away, and shortcuts into
 * related workspaces. Every status comes from stored state.
 */
export function DivisionPage() {
  const mine = useOutletContext<MyEvent>();
  const { groupId = '' } = useParams();
  const { d, life, pending, error } = useDashboard(mine);
  const [moreOpen, setMoreOpen] = useState(false);
  const base = `/events/${mine.eventId}`;
  const groups = navFor('ADMIN');
  const group = groups.find((g) => g.id === groupId && g.id !== 'command');
  if (!group)
    return (
      <Alert tone="info" title="That area doesn't exist">
        <Link to={base}>Go to the Command Centre</Link>
      </Alert>
    );
  const Icon = navIcon(group.id);
  const critical = group.items.filter((i) => i.priority === 'critical');
  const everyday = [
    ...group.items.filter((i) => i.priority === 'important'),
    ...(group.shortcuts ?? []),
  ];
  const advanced = group.items.filter((i) => i.priority === 'advanced');
  const attention =
    life?.attention.filter((a) => activeGroupId(groups, segmentOf(a.to)) === group.id) ?? [];
  const stats = domainStats(group.id, d, base, life).filter((s): s is StatItem => Boolean(s));

  return (
    <div className="@container flex flex-col gap-6">
      <header className="flex flex-wrap items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-blush">
          <Icon aria-hidden className="size-6 stroke-ember" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-3xl">{group.label}</h2>
          <p className="mt-1 max-w-measure text-lg">{group.description}</p>
        </div>
      </header>

      {error && (
        <Alert tone="warning" title="Live status could not load. The tasks still open normally." />
      )}
      {pending ? (
        <Skeleton className="h-20" />
      ) : (
        stats.length > 0 && (
          <ul
            aria-label={`${group.label} at a glance`}
            className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-6 gap-y-4 rounded-[14px] border border-line/60 bg-white px-5 py-4 shadow-card sm:px-6"
          >
            {stats.map((s) => (
              <Stat key={s.label} {...s} />
            ))}
          </ul>
        )
      )}

      {attention.length > 0 && (
        <section aria-labelledby="here-h" className="rounded-[14px] bg-blush p-5 sm:p-6">
          <h3 id="here-h" className="flex items-center gap-2 text-xl">
            <CircleAlert aria-hidden className="size-6 stroke-ember" /> Needs attention
          </h3>
          <ul className="mt-3 flex flex-col divide-y divide-ember/15">
            {attention.map((a) => (
              <li key={a.key}>
                <Link
                  to={`${base}/${a.to}`}
                  className="flex min-h-11 items-center justify-between gap-3 py-2 text-ink no-underline hover:underline"
                >
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
                  <ArrowRight aria-hidden className="size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {group.id === 'configuration' && <SetupChecklist d={d} base={base} />}

      <section aria-labelledby="critical-h" className="flex flex-col gap-3">
        <h3
          id="critical-h"
          className="text-sm font-bold tracking-eyebrow text-graphite uppercase font-sans"
        >
          {group.id === 'communication' ? 'Workspace' : 'Start here'}
        </h3>
        <ul
          className={cn(
            'grid gap-4',
            critical.length > 1 && '@xl:grid-cols-2',
            critical.length > 2 && '@4xl:grid-cols-3',
          )}
        >
          {critical.map((i) => (
            <li key={i.to}>
              <TaskCard base={base} entry={i} d={d} life={life} featured />
            </li>
          ))}
        </ul>
      </section>

      {everyday.length > 0 && (
        <section aria-labelledby="everyday-h" className="flex flex-col gap-3">
          <h3
            id="everyday-h"
            className="text-sm font-bold tracking-eyebrow text-graphite uppercase font-sans"
          >
            {group.id === 'communication' ? 'Go straight to' : 'Also here'}
          </h3>
          <ul className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
            {everyday.map((i) => (
              <li key={i.to}>
                <TaskCard base={base} entry={i} d={d} life={life} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {advanced.length > 0 && (
        <section aria-labelledby="advanced-h">
          <button
            type="button"
            id="advanced-h"
            aria-expanded={moreOpen}
            aria-controls="advanced-list"
            onClick={() => setMoreOpen((o) => !o)}
            className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-[14px] border border-line/60 bg-white/60 px-5 text-left"
          >
            <span>
              <span className="font-bold text-ink">Advanced tools</span>{' '}
              <span className="text-sm">{advanced.map((a) => a.label).join(' · ')}</span>
            </span>
            <ChevronDown
              aria-hidden
              className={cn('size-5 shrink-0 transition-transform', moreOpen && 'rotate-180')}
            />
          </button>
          {moreOpen && (
            <ul id="advanced-list" className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {advanced.map((i) => (
                <li key={i.to}>
                  <TaskCard base={base} entry={i} d={d} life={life} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * More (all areas): every destination the caller's role can open. Core Admins see the seven domains; other
 * roles see their pages grouped by purpose, so nothing outside the sidebar is ever out of reach.
 */
export function AreasPage() {
  const mine = useOutletContext<MyEvent>();
  const base = `/events/${mine.eventId}`;
  const groups: NavGroup[] = navFor(mine.role);
  const admin = mine.role === 'ADMIN';
  return (
    <div className="@container flex flex-col gap-6">
      <div>
        <h2 className="text-3xl">{admin ? 'All domains' : 'Everything in this event'}</h2>
        <p className="mt-1 text-lg">
          {admin
            ? 'Every part of running the event, by domain.'
            : 'Every page you can open, including those not in the sidebar.'}
        </p>
      </div>
      {admin ? (
        <ul className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
          {groups.map((g) => {
            const Icon = navIcon(g.id);
            return (
              <li key={g.id}>
                <Link
                  to={g.id === 'command' ? base : `${base}/area/${g.id}`}
                  className="flex h-full flex-col gap-2 rounded-[14px] border border-line/60 bg-white p-5 text-graphite no-underline shadow-card hover:border-ember/60"
                >
                  <span className="flex items-center gap-3">
                    <Icon aria-hidden className="size-6 stroke-ember" />
                    <span className="font-display text-xl font-bold text-ink">{g.label}</span>
                  </span>
                  <span>{g.description}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        groups.map((g) => (
          <section key={g.id} aria-labelledby={`area-${g.id}`} className="flex flex-col gap-3">
            <h3
              id={`area-${g.id}`}
              className="font-sans text-sm font-bold tracking-eyebrow text-graphite uppercase"
            >
              {g.label}
            </h3>
            <ul className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
              {g.items.map((i) => (
                <li key={i.to}>
                  <TaskCard base={base} entry={i} d={undefined} life={null} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
