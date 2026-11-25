import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight, CircleAlert } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../lib/api.js';
import { eventApi } from '../lib/events.js';
import { formatDateTime } from '../lib/format.js';
import { judgingApi } from '../lib/judging.js';
import { opsApi } from '../lib/ops.js';
import { cn } from '../ui/cn.js';
import { activeGroupId, navFor, segmentOf, type NavGroup } from './nav.js';

export interface PanelItem {
  key: string;
  label: string;
  /** Absolute path; items without one are plain information. */
  to?: string;
  tone?: 'error' | 'warning' | 'info';
  /** Shortcut rows render as compact action links. */
  action?: boolean;
}
export interface PanelSection {
  id: string;
  title: string;
  items: PanelItem[];
}

/** Contextual shortcuts per Core Admin domain (approved §13): each opens a real workspace. */
const SHORTCUTS: Record<string, { label: string; to: string }[]> = {
  configuration: [
    { label: 'Add a problem statement', to: 'structure#problems' },
    { label: 'Add a round', to: 'rounds#new-round' },
    { label: 'Edit deadlines', to: 'rounds' },
  ],
  people: [
    { label: 'Search teams', to: 'teams' },
    { label: 'Review applications', to: 'applications' },
    { label: 'Invite a judge', to: 'people' },
  ],
  judging: [
    { label: 'Assign judges', to: 'judging' },
    { label: 'Review pending evaluations', to: 'judging' },
    { label: 'Configure the rubric', to: 'rubric' },
  ],
  operations: [
    { label: 'Open check-in', to: 'checkin' },
    { label: 'Report an issue', to: 'issues' },
    { label: 'Assign a staff task', to: 'tasks' },
  ],
  communication: [
    { label: 'Write a message', to: 'communication' },
    { label: 'Answer questions', to: 'support?tab=general' },
  ],
  records: [
    { label: 'Approve and publish results', to: 'results' },
    { label: 'Release certificates', to: 'certificates' },
    { label: 'Download the impact report', to: 'report' },
  ],
};

/**
 * The contextual right panel (UX spec v1.0 §3C, §10): concise, actionable summaries for the current role,
 * lifecycle stage and page, each linking to the page where the work happens. It never repeats a page's
 * table and never shows a number it did not read from the API. Returns no sections when nothing is useful,
 * so the page can use the full width.
 */
export function useContextSections(mine: MyEvent, section: string, groupId: string | null) {
  const base = `/events/${mine.eventId}`;
  const sponsor = mine.accessLevel === 'SPONSOR_VIEWER';
  const admin = mine.role === 'ADMIN' && !sponsor;
  // On every role's home the main page already carries this information.
  const home = section === '';

  const dashboard = useQuery({
    queryKey: ['dashboard', mine.eventId],
    queryFn: () => opsApi.dashboard(mine.eventId),
    enabled: admin && !home,
  });
  const judgeRounds = useQuery({
    queryKey: ['judge-rounds', mine.eventId],
    queryFn: () => judgingApi.judgeRounds(mine.eventId),
    enabled: mine.role === 'JUDGE' && !home,
  });
  const rounds = useQuery({
    queryKey: ['rounds', mine.eventId],
    queryFn: () => eventApi.rounds(mine.eventId),
    enabled: mine.role === 'PARTICIPANT' && !home,
  });
  const announcements = useQuery({
    queryKey: ['announcements', mine.eventId],
    queryFn: () => eventApi.announcements(mine.eventId),
    enabled:
      (mine.role === 'PARTICIPANT' || mine.role === 'JUDGE') && !home && section !== 'updates',
  });
  const summary = useQuery({
    queryKey: ['checkin-summary', mine.eventId],
    queryFn: () => opsApi.checkinSummary(mine.eventId),
    enabled: mine.role === 'STAFF' && !home && section !== 'checkin',
  });
  const tasks = useQuery({
    queryKey: ['staff-tasks', mine.eventId, ''],
    queryFn: () => opsApi.tasks(mine.eventId),
    enabled: mine.role === 'STAFF' && !home && section !== 'tasks',
  });
  const inbox = useQuery({
    queryKey: ['inbox', mine.eventId],
    queryFn: () =>
      request<{ messages: { id: string; subject: string; createdAt: string }[] }>(
        'GET',
        `${base}/workspace/inbox`,
      ),
    enabled: mine.role === 'PARTICIPANT' && !home && section !== 'updates',
  });

  if (sponsor || home) return [];
  const sections: PanelSection[] = [];
  const at = (iso: string) => formatDateTime(iso, mine.timeZone);

  if (admin) {
    const life =
      dashboard.data && !('error' in dashboard.data.lifecycle) ? dashboard.data.lifecycle : null;
    const groups: NavGroup[] = navFor('ADMIN');
    const divisionOf = (to: string) => activeGroupId(groups, segmentOf(to));
    // A domain landing page already lists its attention items and steps; the panel adds only what is elsewhere.
    const landing = section === 'area';
    if (life && groupId && !landing) {
      const here = life.attention.filter((a) => divisionOf(a.to) === groupId);
      const elsewhere = life.attention.length - here.length;
      if (here.length)
        sections.push({
          id: 'attention',
          title: 'Needs attention here',
          items: here.map((a) => ({
            key: a.key,
            label: a.label,
            to: `${base}/${a.to}`,
            tone: a.tone,
          })),
        });
      const todo = life.nextSteps.filter((s) => !s.done && divisionOf(s.to) === groupId);
      if (todo.length)
        sections.push({
          id: 'todo',
          title: 'Still to do',
          items: todo.map((s) => ({
            key: s.key,
            label: `${s.label}${s.optional ? ' (optional)' : ''}`,
            to: `${base}/${s.to}`,
          })),
        });
      if (elsewhere > 0)
        sections.push({
          id: 'elsewhere',
          title: 'Elsewhere in the event',
          items: [
            {
              key: 'elsewhere',
              label: `${elsewhere} other item${elsewhere === 1 ? ' needs' : 's need'} attention`,
              to: base,
            },
          ],
        });
    }
    const deadlines =
      dashboard.data && !('error' in dashboard.data.deadlines) ? dashboard.data.deadlines : [];
    if (
      deadlines.length &&
      ['configuration', 'judging', 'operations', 'people'].includes(groupId ?? '')
    )
      sections.push({
        id: 'deadlines',
        title: 'Coming up',
        items: deadlines
          .slice(0, 4)
          .map((d) => ({ key: d.label, label: `${d.label}: ${at(d.at)}` })),
      });
    const shortcuts = (SHORTCUTS[groupId ?? ''] ?? []).filter(
      (sc) => sc.to.split(/[?#]/)[0] !== section,
    );
    if (shortcuts.length)
      sections.push({
        id: 'shortcuts',
        title: 'Shortcuts',
        items: shortcuts.map((sc) => ({
          key: sc.label,
          label: sc.label,
          to: `${base}/${sc.to}`,
          action: true,
        })),
      });
  }

  if (mine.role === 'PARTICIPANT') {
    const now = Date.now();
    const next = rounds.data?.find(
      (r) => r.submissionDeadline && +new Date(r.submissionDeadline) > now,
    );
    if (next?.submissionDeadline)
      sections.push({
        id: 'deadline',
        title: 'Next deadline',
        items: [
          {
            key: 'deadline',
            label: `${next.name}: ${at(next.submissionDeadline)}${next.graceMinutes ? ` (+${next.graceMinutes} min grace)` : ''}`,
            to: section === 'submission' ? undefined : `${base}/submission/${next.id}`,
          },
        ],
      });
    const latest = [
      ...(announcements.data ?? []).map((a) => ({
        key: `a-${a.id}`,
        label: a.title,
        at: a.createdAt,
      })),
      ...(inbox.data?.messages ?? []).map((m) => ({
        key: `m-${m.id}`,
        label: m.subject,
        at: m.createdAt,
      })),
    ]
      .sort((x, y) => y.at.localeCompare(x.at))
      .slice(0, 3);
    if (latest.length)
      sections.push({
        id: 'updates',
        title: 'Latest updates',
        items: latest.map((u) => ({ key: u.key, label: u.label, to: `${base}/updates` })),
      });
  }

  if (mine.role === 'JUDGE') {
    const open = (judgeRounds.data ?? []).filter((r) => r.judgingStatus === 'OPEN');
    if (open.length)
      sections.push({
        id: 'progress',
        title: 'Your judging',
        items: open.flatMap((r) => {
          const left = Math.max(r.toEvaluate - r.submitted, 0);
          return [
            {
              key: `left-${r.roundId}`,
              label:
                left === 0
                  ? `${r.name}: all your evaluations are submitted`
                  : `${r.name}: ${left} of ${r.toEvaluate} left to evaluate`,
              to: section === 'judge' ? undefined : `${base}/judge/${r.roundId}`,
              tone: left > 0 ? ('warning' as const) : undefined,
            },
            ...(r.judgingDeadline
              ? [{ key: `dl-${r.roundId}`, label: `Judging deadline: ${at(r.judgingDeadline)}` }]
              : []),
          ];
        }),
      });
    if (announcements.data?.length)
      sections.push({
        id: 'updates',
        title: 'Latest updates',
        items: announcements.data
          .slice(0, 2)
          .map((a) => ({ key: a.id, label: a.title, to: `${base}/updates` })),
      });
  }

  if (mine.role === 'STAFF') {
    const open = (tasks.data ?? []).filter((t) => t.status !== 'DONE');
    const overdue = open.filter((t) => t.overdue).length;
    if (tasks.data)
      sections.push({
        id: 'tasks',
        title: 'Your tasks',
        items: [
          {
            key: 'open',
            label:
              open.length === 0
                ? 'All your tasks are done'
                : `${open.length} to do${overdue ? `, ${overdue} overdue` : ''}`,
            to: `${base}/tasks`,
            tone: overdue ? 'error' : undefined,
          },
        ],
      });
    if (summary.data)
      sections.push({
        id: 'checkin',
        title: 'Check-in',
        items: [
          {
            key: 'checkin',
            label: `${summary.data.checkedIn} of ${summary.data.participants} people checked in`,
            to: `${base}/checkin`,
          },
        ],
      });
  }
  return sections;
}

/** Renders panel sections; the layout decides whether it is a side column or a fold-out on small screens. */
export function PanelSections({ sections }: { sections: PanelSection[] }) {
  return (
    <div className="flex flex-col gap-6">
      {sections.map((s) => (
        <section key={s.id} aria-labelledby={`panel-${s.id}`}>
          <h2
            id={`panel-${s.id}`}
            className="font-sans text-xs font-bold tracking-eyebrow text-graphite uppercase"
          >
            {s.title}
          </h2>
          <ul className="mt-2 flex flex-col">
            {s.items.map((i) => (
              <li key={i.key}>
                {i.action && i.to ? (
                  <Link
                    to={i.to}
                    className="flex min-h-10 items-center justify-between gap-2 rounded-card px-2 text-sm font-semibold text-ink no-underline hover:bg-blush"
                  >
                    {i.label}
                    <ArrowRight aria-hidden className="size-4 shrink-0 stroke-ember" />
                  </Link>
                ) : (
                  <span className="flex items-start gap-2 px-2 py-1.5 text-sm">
                    {i.tone ? (
                      <CircleAlert
                        aria-hidden
                        className={cn(
                          'mt-0.5 size-4 shrink-0',
                          i.tone === 'error'
                            ? 'text-error-fg'
                            : i.tone === 'warning'
                              ? 'text-warning-fg'
                              : 'text-graphite',
                        )}
                      />
                    ) : (
                      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ember" />
                    )}
                    <span>
                      {i.tone === 'error' && <span className="sr-only">Urgent: </span>}
                      {i.to ? (
                        <Link to={i.to} className="text-ink">
                          {i.label}
                        </Link>
                      ) : (
                        i.label
                      )}
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
