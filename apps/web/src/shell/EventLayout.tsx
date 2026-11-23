import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { Menu as MenuIcon } from 'lucide-react';
import { api, request } from '../lib/api.js';
import { ROLE_LABEL } from '../lib/format.js';
import { Alert, Badge, CollapsibleNav, Spinner } from '../ui/index.js';
import { cn } from '../ui/cn.js';
import {
  activeGroupId,
  activeItem,
  bottomBarFor,
  LEGACY_REDIRECTS,
  navFor,
  type NavGroup,
} from './nav.js';

/** Event workspace: header with role badge, the navigation for the caller's role and a small-screen bottom bar. */
export function EventLayout() {
  const { eventId = '' } = useParams();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const menuId = useId();
  const [menu, setMenu] = useState({ open: false, pageKey: pathname });
  const menuOpen = menu.open && menu.pageKey === pathname; // choosing a page closes the menu
  useEffect(() => {
    const pulse = () =>
      void request('POST', `/events/${eventId}/workspace/activity`, {
        guidebook: pathname.includes('/guidebook'),
      }).catch(() => {});
    pulse();
    const timer = window.setInterval(pulse, 300000);
    return () => window.clearInterval(timer);
  }, [eventId, pathname]);
  // Deep links such as setup#conclude: scroll to the section once the page has rendered it.
  useEffect(() => {
    if (!hash) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el || ++tries > 20) {
        window.clearInterval(timer);
        el?.scrollIntoView({ block: 'start' });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [pathname, hash]);
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
          It may not exist, or you may not have access to it.{' '}
          <Link to="/events">Go to my events</Link>
        </Alert>
      </main>
    );
  }
  const sponsor = mine.accessLevel === 'SPONSOR_VIEWER';
  const groups: NavGroup[] = sponsor
    ? [
        {
          id: 'report',
          label: 'Sponsor overview',
          flat: true,
          items: [{ to: 'report', label: 'Sponsor overview' }],
        },
      ]
    : navFor(mine.role);
  if (sponsor && !pathname.endsWith('/report'))
    return <Navigate to={`/events/${eventId}/report`} replace />;

  const segments = pathname.split('/');
  const section = segments[3] ?? '';
  // Pages merged into a consolidated destination keep working: the old list path redirects with its query.
  const legacy = segments.length === 4 && LEGACY_REDIRECTS[mine.role]?.[section];
  const target = legacy;
  if (target) {
    const [path, query = ''] = target.split('?');
    const params = new URLSearchParams(query);
    new URLSearchParams(search).forEach((v, k) => params.set(k, v));
    const qs = params.toString();
    return <Navigate to={`/events/${eventId}/${path}${qs ? `?${qs}` : ''}`} replace />;
  }

  // A screen outside the caller's role is not rendered at all; the API enforces this independently (PRD §8.1).
  const current = activeItem(groups, section);
  const allowed = !section || Boolean(current);
  const bottom = sponsor ? [] : bottomBarFor(mine.role, groups);
  const others = (events.data ?? []).filter((e) => e.eventId !== eventId);

  return (
    <div
      className={cn(
        'mx-auto max-w-content px-4 sm:px-8',
        bottom.length ? 'pb-28 lg:pb-16' : 'pb-16',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[1.75rem] sm:text-[2.25rem]">{mine.name}</h1>
          <Badge>{sponsor ? 'Sponsor viewer' : ROLE_LABEL[mine.role]}</Badge>
        </div>
        {others.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <span>Switch event</span>
            <select
              className="min-h-11 rounded-card border border-line-strong bg-white px-3"
              value=""
              onChange={(e) => e.target.value && navigate(`/events/${e.target.value}`)}
            >
              <option value="">Choose…</option>
              {others.map((e) => (
                <option key={e.eventId} value={e.eventId}>
                  {e.name} ({ROLE_LABEL[e.role]})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <CollapsibleNav
          label="Event"
          groups={groups}
          activeGroupId={activeGroupId(groups, section)}
          pageKey={pathname}
          currentLabel={current?.label}
          scope={`${sponsor ? 'SPONSOR' : mine.role}:${eventId}`}
          menuOpen={menuOpen}
          onMenuOpenChange={(open) => setMenu({ open, pageKey: pathname })}
          menuId={menuId}
        />
        <main className="min-w-0">
          {allowed ? (
            <Outlet context={mine} />
          ) : (
            <Alert tone="info" title="This page isn't available">
              It may have moved, or it isn't part of your role in this event.{' '}
              <Link to={`/events/${eventId}`}>Go to the event home</Link>
            </Alert>
          )}
        </main>
      </div>
      {bottom.length > 0 && (
        <nav
          aria-label="Quick links"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper lg:hidden"
        >
          <ul className="mx-auto flex max-w-content">
            {bottom.map((i) => (
              <li key={i.to} className="min-w-0 flex-1">
                <NavLink
                  to={i.to === '' ? `/events/${eventId}` : `/events/${eventId}/${i.to}`}
                  end={i.end}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-14 items-center justify-center border-t-4 px-1 text-center text-sm leading-tight text-ink no-underline',
                      isActive ? 'border-ember font-bold' : 'border-transparent font-medium',
                    )
                  }
                >
                  {i.to === '' ? 'Home' : i.label}
                </NavLink>
              </li>
            ))}
            <li className="min-w-0 flex-1">
              <button
                type="button"
                aria-expanded={menuOpen}
                aria-controls={menuId}
                onClick={() => {
                  setMenu({ open: !menuOpen, pageKey: pathname });
                  window.scrollTo({ top: 0 });
                }}
                className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 border-t-4 border-transparent text-sm font-medium text-ink"
              >
                <MenuIcon aria-hidden className="size-4" />
                More
              </button>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
