import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CalendarDays } from 'lucide-react';
import type { EventDto, MyEvent } from '@arthakram/shared';
import type { DashboardLifecycle } from '../../lib/ops.js';
import { useSession } from '../../shell/session.js';
import { cn } from '../../ui/cn.js';

/** White surface used by every dashboard block: soft corners, a warm hairline, no heavy shadow. */
export function Panel({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
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

export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** "14 – 15 Feb, 2027" in the event's time zone, collapsing shared month/year. */
export function dateRange(startIso: string, endIso: string, timeZone: string) {
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
export function shortDateTime(iso: string, timeZone: string) {
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
export function liveStatus(e: EventDto, now = Date.now()) {
  if (e.status === 'DRAFT') return { label: 'Draft', tone: 'muted' as const };
  if (e.status === 'CONCLUDED') return { label: 'Concluded', tone: 'muted' as const };
  if (e.status === 'ARCHIVED') return { label: 'Archived', tone: 'muted' as const };
  if (now >= +new Date(e.startsAt) && now <= +new Date(e.endsAt))
    return { label: 'Live', tone: 'live' as const };
  if (now < +new Date(e.startsAt)) return { label: 'Published', tone: 'live' as const };
  return { label: 'Event ended', tone: 'muted' as const };
}

export function EventGlance({
  e,
  life,
  admin = false,
}: {
  e: EventDto;
  life?: DashboardLifecycle | null;
  admin?: boolean;
}) {
  const status = liveStatus(e);
  const stage = life?.stages.find((s) => s.key === life.stage)?.label;
  // Admins finish a draft in setup; everyone else only ever sees a published event.
  const published = e.status !== 'DRAFT' || !admin;
  return (
    <Panel
      aria-labelledby="glance-h"
      className="flex flex-wrap items-center gap-x-6 gap-y-4 py-4 sm:py-5"
    >
      <div className="min-w-0 flex-1 basis-56">
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

/**
 * The top of every role's home: a time-appropriate greeting with the person's first name, a one-line
 * purpose, and the event at a glance. Shared so all four homes read as one product.
 */
export function HomeGreeting({
  mine,
  event,
  subtitle,
  life,
}: {
  mine: MyEvent;
  event: EventDto | undefined;
  subtitle: ReactNode;
  life?: DashboardLifecycle | null;
}) {
  const { user } = useSession();
  const first = user?.name.split(' ')[0] ?? '';
  return (
    <div className="grid items-center gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,37rem)] [&>*]:min-w-0">
      <div>
        <h2 className="text-3xl sm:text-[2.4rem] 2xl:text-[2.6rem]">
          {greeting()}
          {first ? `, ${first}` : ''}!{' '}
          <span aria-hidden className="font-sans">
            👋
          </span>
        </h2>
        <p className="mt-1 text-lg">{subtitle}</p>
      </div>
      {event && <EventGlance e={event} life={life} admin={mine.role === 'ADMIN'} />}
    </div>
  );
}
