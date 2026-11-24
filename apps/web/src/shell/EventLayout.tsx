import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { ChevronRight, LayoutGrid, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { api, request } from '../lib/api.js';
import { ROLE_LABEL } from '../lib/format.js';
import { Alert, Badge, Spinner } from '../ui/index.js';
import { cn } from '../ui/cn.js';
import { PanelSections, useContextSections } from './ContextPanel.js';
import {
  ALL_AREAS,
  activeGroupId,
  activeItem,
  areaPath,
  bottomBarFor,
  LEGACY_REDIRECTS,
  navFor,
  type NavGroup,
} from './nav.js';

const PANEL_KEY = 'ak.panel.v1';
const readPanel = () => {
  try {
    return window.localStorage.getItem(PANEL_KEY) !== 'closed';
  } catch {
    return true;
  }
};
/** Stand-in while the event list loads, so the panel hook can run before any early return. */
const LOADING: MyEvent = {
  eventId: '',
  name: '',
  role: 'PARTICIPANT',
  status: 'DRAFT',
  timeZone: 'Asia/Kolkata',
  accessLevel: 'SPONSOR_VIEWER',
} as unknown as MyEvent;

/**
 * Event workspace (UX spec v1.0 §3): no permanent sidebar. A compact event bar carries the breadcrumbs,
 * the event switcher, a Dashboard shortcut and All areas; the page uses the full width, with a contextual
 * right panel when it has something useful to say. Small screens get a bottom bar and the panel as a
 * fold-out section.
 */
export function EventLayout() {
  const { eventId = '' } = useParams();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const [panelOpen, setPanelOpen] = useState(readPanel);
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
  const mine = events.data?.find((e) => e.eventId === eventId);
  const sponsor = mine?.accessLevel === 'SPONSOR_VIEWER';
  const groups: NavGroup[] = !mine
    ? []
    : sponsor
      ? [
          {
            id: 'report',
            label: 'Sponsor overview',
            flat: true,
            items: [{ to: 'report', label: 'Sponsor overview' }],
          },
        ]
      : navFor(mine.role);
  const segments = pathname.split('/');
  const section = segments[3] ?? '';
  const areaId = section === 'area' ? (segments[4] ?? '') : null;
  const groupId = areaId ?? activeGroupId(groups, section);
  const sections = useContextSections(mine ?? LOADING, section, groupId);

  if (events.isPending)
    return (
      <div className="p-8">
        <Spinner label="Loading event" />
      </div>
    );
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
  if (sponsor && !pathname.endsWith('/report'))
    return <Navigate to={`/events/${eventId}/report`} replace />;

  // Pages merged into a consolidated destination keep working: the old list path redirects with its query.
  const legacy = segments.length === 4 && LEGACY_REDIRECTS[mine.role]?.[section];
  if (legacy) {
    const [path, query = ''] = legacy.split('?');
    const params = new URLSearchParams(query);
    new URLSearchParams(search).forEach((v, k) => params.set(k, v));
    const qs = params.toString();
    return <Navigate to={`/events/${eventId}/${path}${qs ? `?${qs}` : ''}`} replace />;
  }

  const base = `/events/${eventId}`;
  const current = activeItem(groups, section);
  const group = groups.find((g) => g.id === groupId);
  const isAreas = section === ALL_AREAS || section === 'area';
  // A screen outside the caller's role is not rendered at all; the API enforces this independently (PRD §8.1).
  const allowed =
    !section ||
    Boolean(current) ||
    (section === ALL_AREAS && !sponsor) ||
    (section === 'area' && mine.role === 'ADMIN' && !sponsor && Boolean(group));
  const bottom = sponsor ? [] : bottomBarFor(mine.role, groups);
  const others = (events.data ?? []).filter((e) => e.eventId !== eventId);
  const showPanel = allowed && sections.length > 0;
  const panelCount = sections.reduce((n, s) => n + s.items.length, 0);
  const togglePanel = () => {
    const next = !panelOpen;
    setPanelOpen(next);
    try {
      window.localStorage.setItem(PANEL_KEY, next ? 'open' : 'closed');
    } catch {
      /* storage unavailable: the choice still applies for this visit */
    }
  };

  // Breadcrumbs: Event › Division (or area) › Page › Details.
  const crumbs: { label: string; to?: string }[] = [{ label: mine.name, to: base }];
  if (section === ALL_AREAS) crumbs.push({ label: 'All areas' });
  else if (section === 'area' && group) crumbs.push({ label: group.label });
  else if (section && current) {
    if (group && !group.flat)
      crumbs.push({
        label: group.label,
        to: mine.role === 'ADMIN' ? `${base}/${areaPath(group.id)}` : `${base}/${ALL_AREAS}`,
      });
    const detail = segments.length > 4 && segments[4] !== '';
    crumbs.push({ label: current.label, to: detail ? `${base}/${current.to}` : undefined });
    if (detail) crumbs.push({ label: 'Details' });
  } else if (!section) crumbs.push({ label: groups[0]?.items[0]?.label ?? 'Dashboard' });

  const pill =
    'inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-strong px-4 font-bold text-ink no-underline hover:bg-blush';

  return (
    <div className={cn(bottom.length ? 'pb-24 lg:pb-12' : 'pb-12')}>
      <div className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-workspace flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
          <nav aria-label="Breadcrumb" className="w-full min-w-0 xl:w-auto xl:flex-1">
            <ol className="flex flex-wrap items-center gap-1">
              {crumbs.map((c, i) => (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight aria-hidden className="size-4 shrink-0 text-graphite" />}
                  {c.to ? (
                    <Link to={c.to} className={cn(i === 0 && 'font-bold text-ink')}>
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="font-semibold text-ink">
                      {c.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <Badge>{sponsor ? 'Sponsor viewer' : ROLE_LABEL[mine.role]}</Badge>
          {!sponsor && (
            <div className="hidden items-center gap-2 lg:flex">
              {section !== '' && (
                <Link to={base} className={pill}>
                  Dashboard
                </Link>
              )}
              <Link to={`${base}/${ALL_AREAS}`} className={pill}>
                <LayoutGrid aria-hidden className="size-4" /> All areas
              </Link>
              {showPanel && (
                <button
                  type="button"
                  aria-pressed={panelOpen}
                  onClick={togglePanel}
                  className={pill}
                >
                  {panelOpen ? (
                    <PanelRightClose aria-hidden className="size-4" />
                  ) : (
                    <PanelRightOpen aria-hidden className="size-4" />
                  )}
                  {panelOpen ? 'Hide panel' : 'Show panel'}
                </button>
              )}
            </div>
          )}
          {others.length > 0 && (
            <select
              aria-label="Switch event"
              className="min-h-11 max-w-56 rounded-card border border-line-strong bg-white px-3 text-ink"
              value=""
              onChange={(e) => e.target.value && navigate(`/events/${e.target.value}`)}
            >
              <option value="">Switch event…</option>
              {others.map((e) => (
                <option key={e.eventId} value={e.eventId}>
                  {e.name} ({ROLE_LABEL[e.role]})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div
        className={cn(
          'mx-auto grid max-w-workspace gap-6 px-4 py-6 sm:px-8',
          showPanel && panelOpen && 'lg:grid-cols-[minmax(0,1fr)_minmax(17rem,26%)]',
        )}
      >
        <main className="min-w-0">
          <h1 className="sr-only">{mine.name}</h1>
          {showPanel && (
            <details className="mb-6 rounded-card border border-line bg-white p-4 lg:hidden">
              <summary className="min-h-11 cursor-pointer content-center font-bold text-ink">
                What matters here ({panelCount})
              </summary>
              <div className="mt-3">
                <PanelSections sections={sections} />
              </div>
            </details>
          )}
          {allowed ? (
            <Outlet context={mine} />
          ) : (
            <Alert tone="info" title="This page isn't available">
              It may have moved, or it isn't part of your role in this event.{' '}
              <Link to={base}>Go to the event home</Link>
            </Alert>
          )}
        </main>
        {showPanel && panelOpen && (
          <aside
            aria-label="What matters here"
            className="hidden self-start rounded-card border border-line bg-white p-5 lg:sticky lg:top-4 lg:block"
          >
            <PanelSections sections={sections} />
          </aside>
        )}
      </div>

      {bottom.length > 0 && (
        <nav
          aria-label="Quick links"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper lg:hidden"
        >
          <ul className="mx-auto flex max-w-workspace">
            {bottom.map((i) => (
              <li key={i.to} className="min-w-0 flex-1">
                <NavLink
                  to={i.to === '' ? base : `${base}/${i.to}`}
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
              <Link
                to={`${base}/${ALL_AREAS}`}
                aria-current={isAreas ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 border-t-4 text-sm text-ink no-underline',
                  isAreas ? 'border-ember font-bold' : 'border-transparent font-medium',
                )}
              >
                <LayoutGrid aria-hidden className="size-4" />
                All areas
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
