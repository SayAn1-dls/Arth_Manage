import { Link, useOutletContext, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { opsApi, type DashboardLifecycle } from '../../lib/ops.js';
import {
  activeGroupId,
  areaPath,
  navFor,
  segmentOf,
  type NavEntry,
  type NavGroup,
  type Priority,
} from '../../shell/nav.js';
import { Alert, Card } from '../../ui/index.js';
import { cn } from '../../ui/cn.js';

const PRIORITY_LABEL: Record<Priority, string> = {
  critical: 'Critical',
  important: 'Important',
  advanced: 'Advanced',
};

/** What the dashboard knows about one task: open attention items and unfinished steps that link to it. */
function taskStatus(life: DashboardLifecycle | null, entry: NavEntry) {
  if (!life) return { attention: [], todo: [] };
  const seg = segmentOf(entry.to);
  return {
    attention: life.attention.filter((a) => segmentOf(a.to) === seg),
    todo: life.nextSteps.filter((s) => !s.done && segmentOf(s.to) === seg),
  };
}

function useLifecycle(mine: MyEvent) {
  const q = useQuery({
    queryKey: ['dashboard', mine.eventId],
    queryFn: () => opsApi.dashboard(mine.eventId),
    enabled: mine.role === 'ADMIN',
  });
  const life = q.data && !('error' in q.data.lifecycle) ? q.data.lifecycle : null;
  return { life, error: q.isError };
}

/** One task card: name, what it is for, live status and priority, and a clear way in. */
function TaskCard({
  base,
  entry,
  life,
}: {
  base: string;
  entry: NavEntry;
  life: DashboardLifecycle | null;
}) {
  const { attention, todo } = taskStatus(life, entry);
  const to = entry.to === '' ? base : `${base}/${entry.to}`;
  return (
    <Card
      className={cn('h-full', attention.some((a) => a.tone === 'error') && 'ring-2 ring-error-fg')}
    >
      <div className="flex h-full flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-lg">
            <Link to={to} className="text-ink">
              {entry.label}
            </Link>
          </h3>
          {entry.priority === 'critical' && (
            <span className="rounded-pill border border-ink px-2 py-0.5 text-xs font-bold text-ink">
              {PRIORITY_LABEL.critical}
            </span>
          )}
        </div>
        {entry.description && <p>{entry.description}</p>}
        {(attention.length > 0 || todo.length > 0) && (
          <ul className="flex flex-col gap-1 text-sm">
            {attention.map((a) => (
              <li key={a.key} className="font-semibold text-ink">
                <span className="sr-only">Needs attention: </span>
                {a.label}
              </li>
            ))}
            {todo.map((s) => (
              <li key={s.key}>
                To do: {s.label}
                {s.optional ? ' (optional)' : ''}
              </li>
            ))}
          </ul>
        )}
        <Link
          to={to}
          className="mt-auto inline-flex min-h-11 items-center gap-2 self-start font-bold"
          aria-label={`Open ${entry.label}`}
        >
          Open <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </Card>
  );
}

/** Tasks in order, advanced ones folded behind a disclosure unless one of them needs attention. */
function TaskGrid({
  base,
  items,
  life,
}: {
  base: string;
  items: NavEntry[];
  life: DashboardLifecycle | null;
}) {
  const main = items.filter((i) => i.priority !== 'advanced');
  const advanced = items.filter((i) => i.priority === 'advanced');
  const advancedNeedsYou = advanced.some((i) => taskStatus(life, i).attention.length > 0);
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {main.map((i) => (
          <li key={i.to}>
            <TaskCard base={base} entry={i} life={life} />
          </li>
        ))}
      </ul>
      {advanced.length > 0 && (
        <details open={advancedNeedsYou} className="rounded-card border border-line bg-paper p-4">
          <summary className="min-h-11 cursor-pointer content-center font-bold text-ink">
            Advanced tools ({advanced.length}): {advanced.map((a) => a.label).join(', ')}
          </summary>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {advanced.map((i) => (
              <li key={i.to}>
                <TaskCard base={base} entry={i} life={life} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Division landing page (Core Admin, UX spec v1.0 §6): the division's tasks as cards, grouped by section,
 * critical tasks marked, advanced tools folded away. Only this division's tasks appear.
 */
export function DivisionPage() {
  const mine = useOutletContext<MyEvent>();
  const { groupId = '' } = useParams();
  const { life } = useLifecycle(mine);
  const base = `/events/${mine.eventId}`;
  const group = navFor('ADMIN').find((g) => g.id === groupId && g.id !== 'dashboard');
  if (!group)
    return (
      <Alert tone="info" title="That area doesn't exist">
        <Link to={`${base}/areas`}>See all areas</Link>
      </Alert>
    );
  const sections = [...new Set(group.items.map((i) => i.section ?? ''))];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2>{group.label}</h2>
        <p className="mt-1">{group.description}</p>
      </div>
      {sections.map((name) => {
        const items = group.items.filter((i) => (i.section ?? '') === name);
        return (
          <section key={name} aria-labelledby={`sec-${name}`} className="flex flex-col gap-3">
            {sections.length > 1 && (
              <h3 id={`sec-${name}`} className="text-base font-bold text-ink">
                {name}
              </h3>
            )}
            <TaskGrid base={base} items={items} life={life} />
          </section>
        );
      })}
    </div>
  );
}

/** Division cards (Core Admin): title, purpose, a short live status, and a way in. Shared with the dashboard. */
export function DivisionCards({
  mine,
  status,
}: {
  mine: MyEvent;
  status?: Record<string, string | null>;
}) {
  const { life } = useLifecycle(mine);
  const base = `/events/${mine.eventId}`;
  const groups = navFor('ADMIN');
  const divisions = groups.filter((g) => g.id !== 'dashboard');
  const attentionIn = (g: NavGroup) =>
    life?.attention.filter((a) => activeGroupId(groups, segmentOf(a.to)) === g.id) ?? [];
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {divisions.map((g) => {
        const needs = attentionIn(g);
        const urgent = needs.some((a) => a.tone === 'error');
        return (
          <li key={g.id}>
            <Card className={cn('h-full', urgent && 'ring-2 ring-error-fg')}>
              <div className="flex h-full flex-col gap-2">
                <h3 className="text-xl">
                  <Link to={`${base}/${areaPath(g.id)}`} className="text-ink">
                    {g.label}
                  </Link>
                </h3>
                <p>{g.description}</p>
                {status?.[g.id] && <p className="font-semibold text-ink">{status[g.id]}</p>}
                {needs.length > 0 && (
                  <p className="font-semibold text-ink">
                    {urgent && <span className="sr-only">Urgent: </span>}
                    {needs.length} item{needs.length === 1 ? ' needs' : 's need'} attention
                  </p>
                )}
                <Link
                  to={`${base}/${areaPath(g.id)}`}
                  className="mt-auto inline-flex min-h-11 items-center gap-2 self-start font-bold"
                  aria-label={`Open ${g.label}`}
                >
                  Open <ArrowRight aria-hidden className="size-4" />
                </Link>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * All areas: every destination the caller's role can open, in one place (UX spec v1.0 §12 "All areas").
 * Core Admins see the division cards; other roles see their task cards grouped by purpose.
 */
export function AreasPage() {
  const mine = useOutletContext<MyEvent>();
  const base = `/events/${mine.eventId}`;
  if (mine.role === 'ADMIN')
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2>All areas</h2>
          <p className="mt-1">Every part of running the event, grouped by division.</p>
        </div>
        <DivisionCards mine={mine} />
      </div>
    );
  const groups = navFor(mine.role);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2>All areas</h2>
        <p className="mt-1">Everything you can open in this event.</p>
      </div>
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`area-${g.id}`} className="flex flex-col gap-3">
          <h3 id={`area-${g.id}`} className="text-base font-bold text-ink">
            {g.label}
          </h3>
          <TaskGrid base={base} items={g.items} life={null} />
        </section>
      ))}
    </div>
  );
}
