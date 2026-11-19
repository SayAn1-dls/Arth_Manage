import { useId, useState } from 'react';
import { NavLink } from 'react-router';
import { cn } from './cn.js';
import { isGroupOpen, useNavChoices } from './navState.js';

export interface CollapsibleNavItem {
  to: string;
  label: string;
  end?: boolean;
}

export interface CollapsibleNavGroup {
  /** Stable identifier: used for persistence, never the visible label. */
  id: string;
  label: string;
  items: CollapsibleNavItem[];
  /** Render the links directly, without a heading (single-destination menus). */
  flat?: boolean;
}

export interface CollapsibleNavProps {
  label: string;
  groups: CollapsibleNavGroup[];
  /** Group that holds the current page; opened by default and revealed again on each navigation. */
  activeGroupId: string | null;
  /** Identifies the current page so a navigation re-reveals its group. */
  pageKey: string;
  /** Persistence scope, e.g. role + event, so preferences never leak between them. */
  scope: string;
  /** Name of the current page, shown on the small-screen menu button. */
  currentLabel?: string;
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex min-h-11 items-center border-l-4 py-2 pl-7 pr-4 text-ink no-underline hover:bg-blush',
    isActive ? 'border-ember bg-blush font-bold' : 'border-transparent font-medium',
  );

/** Role-agnostic collapsible sidebar. Role definitions live elsewhere; this only renders and remembers. */
export function CollapsibleNav({
  label,
  groups,
  activeGroupId,
  pageKey,
  scope,
  currentLabel,
}: CollapsibleNavProps) {
  const base = useId();
  // Below lg the whole menu folds behind one button so it never pushes the page out of view.
  const [menu, setMenu] = useState({ open: false, pageKey });
  const menuOpen = menu.open && menu.pageKey === pageKey; // choosing a page closes it
  const menuId = `${base}-menu`;
  const { choices, toggle } = useNavChoices(
    scope,
    groups.map((g) => g.id),
    `${activeGroupId ?? ''}\u0000${pageKey}`,
  );
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        onClick={() => setMenu({ open: !menuOpen, pageKey })}
        className="flex min-h-11 w-full items-center justify-between gap-2 border border-ink bg-white px-4 text-left font-bold text-ink hover:bg-blush focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink lg:hidden"
      >
        <span>
          Menu{currentLabel ? <span className="font-medium"> · {currentLabel}</span> : null}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={cn(
            'h-3 w-3 shrink-0 fill-none stroke-current stroke-[2] motion-safe:transition-transform motion-safe:duration-150',
            menuOpen && 'rotate-180',
          )}
        >
          <path d="M2 4.25 6 8.25l4-4" strokeLinecap="square" />
        </svg>
      </button>
      <div id={menuId} className={cn('flex-col gap-1', menuOpen ? 'flex' : 'hidden lg:flex')}>
        {groups.map((g) => {
          if (g.flat)
            return g.items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.end}
                className={(s) => linkClass(s).replace('pl-7', 'pl-4')}
              >
                {i.label}
              </NavLink>
            ));
          const open = isGroupOpen(choices, g.id, activeGroupId);
          const panelId = `${base}-${g.id}`;
          return (
            <div key={g.id}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(g.id, open)}
                className="group flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left text-xs font-bold uppercase tracking-eyebrow text-ink hover:bg-blush focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-ink"
              >
                <span>{g.label}</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 12 12"
                  className={cn(
                    'h-3 w-3 shrink-0 fill-none stroke-current stroke-[2] motion-safe:transition-transform motion-safe:duration-150',
                    open && 'rotate-180',
                  )}
                >
                  <path d="M2 4.25 6 8.25l4-4" strokeLinecap="square" />
                </svg>
              </button>
              {/* `hidden` removes collapsed links from the tab order and the accessibility tree. */}
              <div id={panelId} role="group" aria-label={g.label} hidden={!open}>
                {g.items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end} className={linkClass}>
                    {i.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
