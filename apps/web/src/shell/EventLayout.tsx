import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { ChevronRight, ListChecks, X } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { api, request } from '../lib/api.js';
import { Alert, Spinner } from '../ui/index.js';
import { cn } from '../ui/cn.js';
import { CommandPalette } from './CommandPalette.js';
import { PanelSections, useContextSections } from './ContextPanel.js';
import { BottomBar, NavDrawer } from './MobileNav.js';
import {
  ALL_AREAS,
  activeGroupId,
  activeItem,
  areaPath,
  LEGACY_AREAS,
  LEGACY_REDIRECTS,
  navFor,
  type NavGroup,
} from './nav.js';
import { readSidebarCollapsed, saveSidebarCollapsed, Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';

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
 * Event workspace (approved layout, Nov 2026): a persistent, collapsible sidebar with one entry per domain,
 * a compact global header, the main workspace and a contextual right panel that the user can hide. Small
 * screens get a bottom bar with More, a full navigation drawer and the panel as a fold-out section.
 */
export function EventLayout() {
  const { eventId = '' } = useParams();
  const { pathname, search, hash } = useLocation();
  const [panelOpen, setPanelOpen] = useState(readPanel);
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(false);

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
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
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
  // ⌘K / Ctrl+K opens search from anywhere in the event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Moving to another page closes the phone drawer and fold-out.
  useEffect(() => {
    setDrawer(false);
    setMobilePanel(false);
  }, [pathname]);

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

  const base = `/events/${eventId}`;
  // Pages merged into a consolidated destination keep working: the old list path redirects with its query.
  const legacy = segments.length === 4 && LEGACY_REDIRECTS[mine.role]?.[section];
  if (legacy) {
    const [path, query = ''] = legacy.split('?');
    const params = new URLSearchParams(query);
    new URLSearchParams(search).forEach((v, k) => params.set(k, v));
    const qs = params.toString();
    return <Navigate to={`${base}/${path}${qs ? `?${qs}` : ''}`} replace />;
  }
  // Domain landing pages renamed with the seven-domain structure.
  if (areaId && LEGACY_AREAS[areaId] && mine.role === 'ADMIN') {
    const target = areaPath(LEGACY_AREAS[areaId]);
    return <Navigate to={target ? `${base}/${target}` : base} replace />;
  }
  if (areaId === 'command') return <Navigate to={base} replace />;

  const current = activeItem(groups, section);
  const group = groups.find((g) => g.id === groupId);
  // A screen outside the caller's role is not rendered at all; the API enforces this independently (PRD §8.1).
  const allowed =
    !section ||
    Boolean(current) ||
    (section === ALL_AREAS && !sponsor) ||
    (section === 'area' && mine.role === 'ADMIN' && !sponsor && Boolean(group));
  const showPanel = allowed && sections.length > 0;
  const panelCount = sections.reduce((n, s) => n + s.items.filter((i) => !i.action).length, 0);
  const togglePanel = () => {
    const next = !panelOpen;
    setPanelOpen(next);
    try {
      window.localStorage.setItem(PANEL_KEY, next ? 'open' : 'closed');
    } catch {
      /* storage unavailable: the choice still applies for this visit */
    }
  };
  const toggleSidebar = () => {
    setCollapsed((c) => {
      saveSidebarCollapsed(!c);
      return !c;
    });
  };

  // Breadcrumbs on task pages only: Domain › Page › Details. Landing pages and dashboards have their own title.
  const crumbs: { label: string; to?: string }[] = [];
  if (section && section !== 'area' && section !== ALL_AREAS && current && !sponsor) {
    if (group && !group.flat)
      crumbs.push({
        label: group.label,
        to: mine.role === 'ADMIN' ? `${base}/${areaPath(group.id)}` : `${base}/${ALL_AREAS}`,
      });
    const detail = segments.length > 4 && segments[4] !== '';
    crumbs.push({ label: current.label, to: detail ? `${base}/${current.to}` : undefined });
    if (detail) crumbs.push({ label: 'Details' });
  }

  return (
    <div className="flex min-h-dvh bg-paper">
      <Sidebar
        role={mine.role}
        base={base}
        section={section}
        groupId={groupId}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        sponsor={sponsor}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          mine={mine}
          events={events.data ?? []}
          sponsor={sponsor}
          onOpenSearch={() => setPalette(true)}
          onOpenDrawer={() => setDrawer(true)}
          panel={{ available: showPanel, open: panelOpen, toggle: togglePanel }}
        />
        <div className="flex min-w-0 flex-1">
          <main
            className={cn(
              'min-w-0 flex-1 px-4 pt-5 sm:px-6 lg:px-8 lg:pt-7',
              sponsor ? 'pb-12' : 'pb-28 lg:pb-12',
            )}
          >
            <h1 className="sr-only">{mine.name}</h1>
            <div className="mx-auto max-w-workspace">
              {crumbs.length > 0 && (
                <nav aria-label="Breadcrumb" className="mb-4">
                  <ol className="flex flex-wrap items-center gap-1 text-sm">
                    {crumbs.map((c, i) => (
                      <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                        {i > 0 && (
                          <ChevronRight aria-hidden className="size-4 shrink-0 text-graphite" />
                        )}
                        {c.to ? (
                          <Link to={c.to} className="text-graphite">
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
              )}
              {showPanel && (
                <div className="mb-5 xl:hidden">
                  <button
                    type="button"
                    aria-expanded={mobilePanel}
                    aria-controls="context-foldout"
                    onClick={() => setMobilePanel((o) => !o)}
                    className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-card border border-line bg-white px-4 text-left font-semibold text-ink"
                  >
                    <span className="flex items-center gap-2">
                      <ListChecks aria-hidden className="size-5 stroke-ember" />
                      What matters here{panelCount > 0 ? ` (${panelCount})` : ''}
                    </span>
                    {mobilePanel ? (
                      <X aria-hidden className="size-4" />
                    ) : (
                      <ChevronRight aria-hidden className="size-4 rotate-90" />
                    )}
                  </button>
                  {mobilePanel && (
                    <div
                      id="context-foldout"
                      className="mt-2 rounded-card border border-line bg-white p-4"
                    >
                      <PanelSections sections={sections} />
                    </div>
                  )}
                </div>
              )}
              {allowed ? (
                <Outlet context={mine} />
              ) : (
                <Alert tone="info" title="This page isn't available">
                  It may have moved, or it isn't part of your role in this event.{' '}
                  <Link to={base}>Go to the event home</Link>
                </Alert>
              )}
            </div>
          </main>
          {showPanel && panelOpen && (
            <aside
              aria-label="What matters here"
              className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-80 shrink-0 overflow-y-auto border-l border-line bg-white/60 px-5 py-6 xl:block"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="font-display text-lg font-bold text-ink">What matters here</p>
                <button
                  type="button"
                  onClick={togglePanel}
                  aria-label="Hide side panel"
                  className="flex size-9 cursor-pointer items-center justify-center rounded-pill text-graphite hover:bg-blush"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              <PanelSections sections={sections} />
            </aside>
          )}
        </div>
      </div>
      {!sponsor && (
        <>
          <BottomBar
            role={mine.role}
            base={base}
            section={section}
            groupId={groupId}
            onMore={() => setDrawer(true)}
            drawerOpen={drawer}
          />
          <NavDrawer role={mine.role} base={base} open={drawer} onClose={() => setDrawer(false)} />
          <CommandPalette
            mine={mine}
            events={events.data ?? []}
            open={palette}
            onClose={() => setPalette(false)}
          />
        </>
      )}
    </div>
  );
}
