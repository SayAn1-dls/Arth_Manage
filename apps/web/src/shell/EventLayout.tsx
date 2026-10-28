import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation, useParams } from 'react-router';
import { api, request } from '../lib/api.js';
import { ROLE_LABEL } from '../lib/format.js';
import { Alert, Badge, CollapsibleNav, Spinner } from '../ui/index.js';
import { activeGroupId, navFor, navItems, type NavGroup } from './nav.js';

/** Event workspace: header with role badge plus the navigation for the caller's role in this event. */
export function EventLayout() {
  const { eventId = '' } = useParams();
  const { pathname } = useLocation();
  useEffect(() => {
    const pulse = () =>
      void request('POST', `/events/${eventId}/workspace/activity`, {
        guidebook: pathname.includes('/guidebook'),
      }).catch(() => {});
    pulse();
    const timer = window.setInterval(pulse, 300000);
    return () => window.clearInterval(timer);
  }, [eventId, pathname]);
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
  const sponsor = mine.accessLevel === 'SPONSOR_VIEWER';
  const groups: NavGroup[] = sponsor
    ? [
        {
          id: 'report',
          label: 'Impact report',
          flat: true,
          items: [{ to: 'report', label: 'Impact report' }],
        },
      ]
    : navFor(mine.role);
  const items = navItems(groups);
  if (mine.accessLevel === 'SPONSOR_VIEWER' && !pathname.endsWith('/report'))
    return <Navigate to={`/events/${eventId}/report`} replace />;
  // A screen outside the caller's role is not rendered at all; the API enforces this independently (PRD §8.1).
  const section = pathname.split('/')[3] ?? '';
  const allowed = !section || items.some((i) => i.to.split('/')[0] === section);

  return (
    <div className="mx-auto max-w-content px-4 pb-16 sm:px-8">
      <div className="flex flex-wrap items-center gap-3 py-6">
        <h1 className="text-[1.75rem] sm:text-[2.25rem]">{mine.name}</h1>
        <Badge>
          {mine.accessLevel === 'SPONSOR_VIEWER' ? 'Sponsor viewer' : ROLE_LABEL[mine.role]}
        </Badge>
      </div>
      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <CollapsibleNav
          label="Event"
          groups={groups}
          activeGroupId={activeGroupId(groups, section)}
          pageKey={pathname}
          currentLabel={items.find((i) => i.to.split('/')[0] === section)?.label}
          scope={`${sponsor ? 'SPONSOR' : mine.role}:${eventId}`}
        />
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
