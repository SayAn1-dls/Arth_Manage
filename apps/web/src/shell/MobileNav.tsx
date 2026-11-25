import { useEffect, useRef } from 'react';
import { Link, NavLink } from 'react-router';
import { LayoutGrid, X } from 'lucide-react';
import type { Role } from '@arthakram/shared';
import { Logo } from '../ui/index.js';
import { cn } from '../ui/cn.js';
import { areaPath, bottomBarFor, navFor } from './nav.js';
import { navIcon } from './navIcons.js';

/** Small-screen bottom bar (approved decision 5): four destinations for the role, then More (the drawer). */
export function BottomBar({
  role,
  base,
  section,
  groupId,
  onMore,
  drawerOpen,
}: {
  role: Role;
  base: string;
  section: string;
  groupId: string | null;
  onMore: () => void;
  drawerOpen: boolean;
}) {
  const items = bottomBarFor(role);
  const short = (label: string) =>
    label
      .replace('Command Centre', 'Home')
      .replace('My dashboard', 'Home')
      .replace('My event', 'Home')
      .replace('Judging & Evaluation', 'Judging')
      .replace('Live Operations', 'Live ops')
      .replace('Assigned teams', 'Teams')
      .replace('Rubric & briefing', 'Rubric')
      .replace('Announcements', 'Updates');
  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex">
        {items.map((i) => {
          const Icon = navIcon(i.id);
          const active = i.match(section, groupId);
          return (
            <li key={i.id} className="min-w-0 flex-1">
              <NavLink
                to={i.to === '' ? base : `${base}/${i.to}`}
                end
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-xs leading-tight no-underline',
                  active ? 'font-bold text-ink' : 'font-medium text-graphite',
                )}
              >
                <Icon aria-hidden className={cn('size-5', active && 'stroke-ember')} />
                <span className="truncate">{short(i.label)}</span>
              </NavLink>
            </li>
          );
        })}
        <li className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onMore}
            aria-expanded={drawerOpen}
            className="flex min-h-16 w-full cursor-pointer flex-col items-center justify-center gap-1 text-xs font-medium text-graphite"
          >
            <LayoutGrid aria-hidden className="size-5" />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}

/**
 * Full navigation drawer (approved decision 5): everything the role may open, grouped, so nothing is lost on
 * a phone. Built on the native <dialog> for focus trapping and Escape.
 */
export function NavDrawer({
  role,
  base,
  open,
  onClose,
}: {
  role: Role;
  base: string;
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  const groups = navFor(role);
  const admin = role === 'ADMIN';
  const link = (to: string) => (to === '' ? base : `${base}/${to}`);
  return (
    <dialog
      ref={ref}
      aria-label="Navigation"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 h-dvh max-h-dvh w-[min(22rem,88vw)] bg-paper p-0 text-graphite backdrop:bg-graphite/40"
    >
      <div className="flex h-16 items-center justify-between border-b border-line px-4">
        <Link to="/events" onClick={onClose} aria-label="Arthakram, my events">
          <Logo width={124} />
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="flex size-11 cursor-pointer items-center justify-center rounded-pill text-ink hover:bg-blush"
        >
          <X aria-hidden className="size-6" />
        </button>
      </div>
      <nav aria-label="All sections" className="flex flex-col gap-4 overflow-y-auto p-4">
        {groups.map((g) => {
          const Icon = navIcon(g.id);
          return (
            <section key={g.id} aria-labelledby={`drawer-${g.id}`}>
              {admin ? (
                <Link
                  id={`drawer-${g.id}`}
                  to={link(areaPath(g.id))}
                  onClick={onClose}
                  className="flex min-h-11 items-center gap-3 font-display text-lg font-bold text-ink no-underline"
                >
                  <Icon aria-hidden className="size-5 stroke-ember" />
                  {g.label}
                </Link>
              ) : (
                <h2
                  id={`drawer-${g.id}`}
                  className="text-xs font-bold tracking-eyebrow text-graphite uppercase"
                >
                  {g.label}
                </h2>
              )}
              {!(admin && g.flat) && (
                <ul className={cn('flex flex-col', admin && 'ml-8 border-l border-line pl-3')}>
                  {g.items.map((i) => (
                    <li key={i.to}>
                      <NavLink
                        to={link(i.to)}
                        end
                        onClick={onClose}
                        className={({ isActive }) =>
                          cn(
                            'flex min-h-11 items-center rounded-card px-2 text-[0.95rem] no-underline',
                            isActive ? 'bg-blush font-bold text-ink' : 'text-graphite',
                          )
                        }
                      >
                        {i.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </nav>
    </dialog>
  );
}
