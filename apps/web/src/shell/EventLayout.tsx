import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useParams } from 'react-router';
import { api } from '../lib/api.js';
import { ROLE_LABEL } from '../lib/format.js';
import { Alert, Badge, cn, Spinner } from '../ui/index.js';
import { navFor } from './nav.js';

/** Event workspace: header with role badge plus the navigation for the caller's role in this event. */
export function EventLayout() {
  const { eventId = '' } = useParams();
  const { pathname } = useLocation();
  const events = useQuery({ queryKey: ['my-events'], queryFn: api.myEvents });

  if (events.isPending)
    return (
      <div className="p-8">
        <Spinner label="Loading event" />
      </div>
    );
  const mine = events.data?.find((e) => e.eventId === eventId);
  if (!mine) {
    return (
      <main className="mx-auto max-w-content px-4 py-10 sm:px-8">
        <Alert tone="error" title="We couldn't find that event">
          It may not exist, or you may not have access to it.
        </Alert>
      </main>
    );
  }
  const items = navFor(mine.role);
  // A screen outside the caller's role is not rendered at all; the API enforces this independently (PRD §8.1).
  const section = pathname.split('/')[3] ?? '';
  const allowed = !section || items.some((i) => i.to.split('/')[0] === section);

  return (
    <div className="mx-auto max-w-content px-4 pb-16 sm:px-8">
      <div className="flex flex-wrap items-center gap-3 py-6">
        <h1 className="text-[1.75rem] sm:text-[2.25rem]">{mine.name}</h1>
        <Badge>{ROLE_LABEL[mine.role]}</Badge>
      </div>
      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Event" className="flex gap-1 overflow-x-auto lg:flex-col">
          {items.map((i, idx) => (
            <Fragment key={i.to}>
              {i.group && items[idx - 1]?.group !== i.group && (
                <p className="hidden px-4 pt-3 text-xs font-bold uppercase tracking-eyebrow text-ink lg:block">
                  {i.group}
                </p>
              )}
              <NavLink
                to={i.to}
                end={i.end}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-4 px-4 text-ink no-underline hover:bg-blush lg:border-b-0 lg:border-l-4',
                    isActive ? 'border-ember bg-blush font-bold' : 'border-transparent font-medium',
                  )
                }
              >
                {i.label}
              </NavLink>
            </Fragment>
          ))}
        </nav>
        <main className="min-w-0">
          {allowed ? (
            <Outlet context={mine} />
          ) : (
            <Alert tone="info" title="This page isn't available to you">
              Use the menu to open the screens for your role in this event.
            </Alert>
          )}
        </main>
      </div>
    </div>
  );
}
