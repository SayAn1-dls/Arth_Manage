import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import {
  Bell,
  CalendarDays,
  ChevronDown,
  LogOut,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Search,
  UserRound,
} from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { eventApi } from '../lib/events.js';
import { formatDateTime, ROLE_LABEL } from '../lib/format.js';
import { opsApi } from '../lib/ops.js';
import { Logo, Popover } from '../ui/index.js';
import { cn } from '../ui/cn.js';
import { useSession } from './session.js';

const seenKey = (eventId: string) => `ak.seen.v1:${eventId}`;
const readSeen = (eventId: string) => {
  try {
    return window.localStorage.getItem(seenKey(eventId)) ?? '';
  } catch {
    return '';
  }
};

interface Note {
  key: string;
  label: string;
  to: string;
  at?: string;
  tone?: 'error' | 'warning' | 'info';
}

/**
 * Notifications: what needs the person, from data the app already loads for them. Core Admins see the
 * event's attention items; everyone else sees the latest announcements, with a dot for ones they have not
 * opened this menu since.
 */
function Notifications({ mine }: { mine: MyEvent }) {
  const base = `/events/${mine.eventId}`;
  const admin = mine.role === 'ADMIN';
  const [seen, setSeen] = useState(() => readSeen(mine.eventId));
  const dashboard = useQuery({
    queryKey: ['dashboard', mine.eventId],
    queryFn: () => opsApi.dashboard(mine.eventId),
    enabled: admin,
  });
  const announcements = useQuery({
    queryKey: ['announcements', mine.eventId],
    queryFn: () => eventApi.announcements(mine.eventId),
    enabled: !admin,
  });
  const life =
    dashboard.data && !('error' in dashboard.data.lifecycle) ? dashboard.data.lifecycle : null;
  const notes: Note[] = admin
    ? (life?.attention ?? []).slice(0, 6).map((a) => ({
        key: a.key,
        label: a.label,
        to: `${base}/${a.to}`,
        tone: a.tone,
      }))
    : (announcements.data ?? []).slice(0, 6).map((a) => ({
        key: a.id,
        label: a.title,
        to: `${base}/updates`,
        at: a.createdAt,
      }));
  const unread = admin
    ? notes.some((n) => n.tone !== 'info')
    : notes.some((n) => (n.at ?? '') > seen);
  const markSeen = () => {
    const latest = notes[0]?.at;
    if (!latest) return;
    setSeen(latest);
    try {
      window.localStorage.setItem(seenKey(mine.eventId), latest);
    } catch {
      /* storage unavailable */
    }
  };
  const total = admin ? (life?.attention.length ?? 0) : notes.length;
  return (
    <Popover
      label={unread ? 'Notifications, new items' : 'Notifications'}
      button={
        <span className="relative flex size-7 items-center justify-center" onClick={markSeen}>
          <Bell aria-hidden className="size-5" />
          {unread && (
            <span aria-hidden className="absolute top-0.5 right-0.5 size-2 rounded-full bg-ember" />
          )}
        </span>
      }
      panelClassName="w-80"
    >
      {(close) => (
        <div>
          <p className="px-2 pt-1 pb-2 font-bold text-ink">
            {admin ? 'Needs your attention' : 'Latest announcements'}
          </p>
          {notes.length === 0 ? (
            <p className="px-2 pb-2 text-sm">
              {admin ? 'Nothing needs your attention right now.' : 'No announcements yet.'}
            </p>
          ) : (
            <ul className="flex flex-col">
              {notes.map((n) => (
                <li key={n.key}>
                  <Link
                    to={n.to}
                    onClick={close}
                    className="flex gap-2 rounded-card px-2 py-2 text-sm text-ink no-underline hover:bg-blush"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        n.tone === 'error'
                          ? 'bg-error-fg'
                          : n.tone === 'warning'
                            ? 'bg-ember'
                            : 'bg-line-strong',
                      )}
                    />
                    <span>
                      {n.label}
                      {n.at && (
                        <span className="block text-xs text-graphite">
                          {formatDateTime(n.at, mine.timeZone)}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {admin && total > notes.length && (
            <Link
              to={base}
              onClick={close}
              className="mt-1 block px-2 py-2 text-sm font-semibold text-ink"
            >
              See all {total} on the Command Centre
            </Link>
          )}
          {!admin && notes.length > 0 && (
            <Link
              to={`${base}/updates`}
              onClick={close}
              className="mt-1 block px-2 py-2 text-sm font-semibold text-ink"
            >
              All announcements
            </Link>
          )}
        </div>
      )}
    </Popover>
  );
}

/**
 * Global header (approved layout §6A): current event and role with the event switcher, search, notifications
 * and the account menu. Compact: one row on every screen size.
 */
export function TopBar({
  mine,
  events,
  sponsor,
  onOpenSearch,
  onOpenDrawer,
  panel,
}: {
  mine: MyEvent;
  events: MyEvent[];
  sponsor: boolean;
  onOpenSearch: () => void;
  onOpenDrawer: () => void;
  panel: { available: boolean; open: boolean; toggle: () => void };
}) {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const others = events.filter((e) => e.eventId !== mine.eventId);
  const first = user?.name.split(' ')[0] ?? '';
  const roleLabel = sponsor ? 'Sponsor viewer' : ROLE_LABEL[mine.role];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
      <div className="flex h-16 items-center gap-2 px-3 sm:px-6 lg:gap-4 lg:px-8">
        {!sponsor && (
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="Open navigation"
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-pill text-ink hover:bg-blush lg:hidden"
          >
            <Menu aria-hidden className="size-6" />
          </button>
        )}
        <Link to="/events" aria-label="Arthakram, my events" className="shrink-0 lg:hidden">
          <Logo mark width={30} />
        </Link>

        <Popover
          label={`${mine.name}, ${roleLabel}. Switch event`}
          align="left"
          className="min-w-0"
          button={
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-display text-lg font-extrabold tracking-section text-ink sm:text-xl">
                {mine.name}
              </span>
              <span className="hidden shrink-0 rounded-pill bg-blush px-2.5 py-0.5 text-xs font-bold text-ink sm:inline">
                {roleLabel}
              </span>
              <ChevronDown aria-hidden className="size-4 shrink-0" />
            </span>
          }
        >
          {(close) => (
            <div>
              <p className="px-2 pt-1 text-xs font-bold tracking-eyebrow text-graphite uppercase">
                Current event
              </p>
              <p className="px-2 pt-1 font-bold text-ink">{mine.name}</p>
              <p className="flex items-center gap-1.5 px-2 pb-2 text-sm">
                <CalendarDays aria-hidden className="size-4" />
                {formatDateTime(mine.startsAt, mine.timeZone)}
              </p>
              {others.length > 0 && (
                <>
                  <p className="border-t border-line px-2 pt-2 text-xs font-bold tracking-eyebrow text-graphite uppercase">
                    Switch to
                  </p>
                  <ul className="max-h-64 overflow-y-auto py-1">
                    {others.map((e) => (
                      <li key={e.eventId}>
                        <Link
                          to={`/events/${e.eventId}`}
                          onClick={close}
                          className="flex items-center justify-between gap-2 rounded-card px-2 py-2 text-sm text-ink no-underline hover:bg-blush"
                        >
                          <span className="truncate font-semibold">{e.name}</span>
                          <span className="shrink-0 text-xs">{ROLE_LABEL[e.role]}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <Link
                to="/events"
                onClick={close}
                className="block border-t border-line px-2 pt-2 pb-1 text-sm font-semibold text-ink"
              >
                All my events
              </Link>
            </div>
          )}
        </Popover>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {!sponsor && (
            <button
              type="button"
              onClick={onOpenSearch}
              aria-label="Search"
              aria-keyshortcuts="Control+K Meta+K"
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-pill text-graphite hover:bg-blush max-md:w-11 max-md:justify-center md:w-64 md:border md:border-line md:bg-white md:px-4 xl:w-80"
            >
              <Search aria-hidden className="size-5 shrink-0 text-ink" />
              <span className="hidden flex-1 text-left text-sm md:inline">Search anything…</span>
              <kbd className="hidden rounded border border-line bg-paper px-1.5 text-xs md:inline">
                ⌘K
              </kbd>
            </button>
          )}
          {!sponsor && <Notifications mine={mine} />}
          {panel.available && (
            <button
              type="button"
              aria-pressed={panel.open}
              onClick={panel.toggle}
              aria-label={panel.open ? 'Hide side panel' : 'Show side panel'}
              title={panel.open ? 'Hide side panel' : 'Show side panel'}
              className="hidden size-11 cursor-pointer items-center justify-center rounded-pill text-ink hover:bg-blush xl:flex"
            >
              {panel.open ? (
                <PanelRightClose aria-hidden className="size-5" />
              ) : (
                <PanelRightOpen aria-hidden className="size-5" />
              )}
            </button>
          )}
          <span aria-hidden className="mx-1 hidden h-8 w-px bg-line sm:block" />
          <Popover
            label="Account"
            button={
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex size-9 items-center justify-center rounded-full bg-peach font-bold text-ink"
                >
                  {first.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-[8rem] truncate font-semibold sm:inline">
                  {first}
                </span>
                <ChevronDown aria-hidden className="hidden size-4 sm:block" />
              </span>
            }
          >
            {(close) => (
              <div>
                <p className="px-2 pt-1 font-bold text-ink">{user?.name}</p>
                <p className="truncate px-2 pb-2 text-sm">{user?.email}</p>
                <ul className="border-t border-line pt-1">
                  {mine.role === 'PARTICIPANT' && (
                    <li>
                      <Link
                        to={`/events/${mine.eventId}/profile`}
                        onClick={close}
                        className="flex min-h-11 items-center gap-2 rounded-card px-2 text-sm text-ink no-underline hover:bg-blush"
                      >
                        <UserRound aria-hidden className="size-4" /> My details
                      </Link>
                    </li>
                  )}
                  <li>
                    <Link
                      to="/events"
                      onClick={close}
                      className="flex min-h-11 items-center gap-2 rounded-card px-2 text-sm text-ink no-underline hover:bg-blush"
                    >
                      <CalendarDays aria-hidden className="size-4" /> My events
                    </Link>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={async () => {
                        close();
                        // Leave the event first, so the next person to sign in is not sent back here.
                        navigate('/login', { replace: true });
                        await signOut();
                      }}
                      className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-card px-2 text-sm text-ink hover:bg-blush"
                    >
                      <LogOut aria-hidden className="size-4" /> Sign out
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </Popover>
        </div>
      </div>
    </header>
  );
}
