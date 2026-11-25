import { useRef, type KeyboardEvent } from 'react';
import { Link, NavLink } from 'react-router';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { Role } from '@arthakram/shared';
import { Logo } from '../ui/index.js';
import { cn } from '../ui/cn.js';
import { ALL_AREAS, navFor, sidebarFor, type SidebarEntry } from './nav.js';
import { navIcon } from './navIcons.js';

const SIDEBAR_KEY = 'ak.sidebar.v1';

export function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return false;
  }
}
export function saveSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    /* storage unavailable: the choice still applies for this visit */
  }
}

/** Arrow keys move between sidebar links, Home/End jump to the ends; Tab still leaves the list. */
function onListKeys(e: KeyboardEvent<HTMLUListElement>) {
  const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>('a[data-nav]')];
  const i = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (i < 0) return;
  const to =
    e.key === 'ArrowDown'
      ? links[(i + 1) % links.length]
      : e.key === 'ArrowUp'
        ? links[(i - 1 + links.length) % links.length]
        : e.key === 'Home'
          ? links[0]
          : e.key === 'End'
            ? links.at(-1)
            : null;
  if (to) {
    e.preventDefault();
    to.focus();
  }
}

function SidebarLink({
  entry,
  base,
  active,
  collapsed,
  onNavigate,
}: {
  entry: SidebarEntry;
  base: string;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = navIcon(entry.id);
  return (
    <li className="group/link relative">
      <NavLink
        data-nav
        to={entry.to === '' ? base : `${base}/${entry.to}`}
        end
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? entry.label : undefined}
        className={cn(
          'relative flex min-h-11 items-center gap-3 rounded-card px-3 text-[0.95rem] no-underline transition-colors',
          collapsed && 'justify-center px-0',
          active
            ? 'bg-blush font-bold text-ink'
            : 'font-medium text-graphite hover:bg-blush/60 hover:text-ink',
        )}
      >
        {active && (
          <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-ember" />
        )}
        <Icon
          aria-hidden
          className={cn('size-5 shrink-0', active ? 'stroke-ember' : 'text-graphite')}
        />
        {!collapsed && <span className="truncate">{entry.label}</span>}
      </NavLink>
      {collapsed && (
        <span
          role="tooltip"
          className="pointer-events-none absolute top-1/2 left-full z-40 ml-2 hidden -translate-y-1/2 rounded-pill bg-ink px-2.5 py-1 text-sm whitespace-nowrap text-white group-focus-within/link:block group-hover/link:block"
        >
          {entry.label}
        </span>
      )}
    </li>
  );
}

/**
 * Persistent sidebar (approved decision 1): one entry per domain for Core Admins, the primary pages for
 * other roles. Never a tree: a domain opens its landing page, where its tasks live. Collapses to icons
 * with tooltips; the choice is remembered on this device.
 */
export function Sidebar({
  role,
  base,
  section,
  groupId,
  collapsed,
  onToggle,
  sponsor,
}: {
  role: Role;
  base: string;
  section: string;
  groupId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  sponsor: boolean;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const entries = sponsor ? [] : sidebarFor(role);
  const admin = role === 'ADMIN' && !sponsor;
  const settingsActive = section === 'integrations';
  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-paper transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[4.75rem]' : 'w-64',
      )}
    >
      <Link
        to="/events"
        aria-label="Arthakram, my events"
        className={cn('flex h-20 shrink-0 items-center', collapsed ? 'justify-center' : 'px-6')}
      >
        {collapsed ? <Logo mark width={34} /> : <Logo width={124} />}
      </Link>
      <nav aria-label="Event sections" className="flex-1 overflow-y-auto px-3 pt-2">
        <ul ref={listRef} className="flex flex-col gap-1" onKeyDown={onListKeys}>
          {entries.map((e) => (
            <SidebarLink
              key={e.id}
              entry={e}
              base={base}
              collapsed={collapsed}
              active={e.match(section, groupId)}
            />
          ))}
        </ul>
      </nav>
      <div className="flex flex-col gap-1 border-t border-line px-3 py-3">
        {admin ? (
          <ul>
            <SidebarLink
              entry={{
                id: 'settings',
                label: 'Integrations & settings',
                to: 'integrations',
                match: () => settingsActive,
              }}
              base={base}
              collapsed={collapsed}
              active={settingsActive}
            />
          </ul>
        ) : (
          !sponsor &&
          navFor(role).some((g) => g.items.some((i) => !i.primary)) && (
            <ul>
              <SidebarLink
                entry={{ id: 'more', label: 'More', to: ALL_AREAS, match: () => false }}
                base={base}
                collapsed={collapsed}
                active={section === ALL_AREAS}
              />
            </ul>
          )
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex min-h-11 cursor-pointer items-center gap-3 rounded-card px-3 text-sm font-medium text-graphite hover:bg-blush/60 hover:text-ink',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? (
            <ChevronsRight aria-hidden className="size-5" />
          ) : (
            <>
              <ChevronsLeft aria-hidden className="size-5" /> Collapse sidebar
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
