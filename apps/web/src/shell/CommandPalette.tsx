import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ArrowRight, Search, UserRound, Users, Gavel, LayoutGrid } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../lib/api.js';
import { cn } from '../ui/cn.js';
import { navFor } from './nav.js';

interface Result {
  key: string;
  kind: 'Workspace' | 'Team' | 'Participant' | 'Judge' | 'Event';
  label: string;
  detail?: string;
  to: string;
}

const KIND_ICON = {
  Workspace: LayoutGrid,
  Team: Users,
  Participant: UserRound,
  Judge: Gavel,
  Event: LayoutGrid,
} as const;

/** Debounce typing so record searches hit the API at most a few times per query. */
function useDebounced(value: string, ms = 220) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Global search (⌘K / Ctrl+K). Workspaces come from the caller's own navigation, so nothing outside the role
 * is ever offered. Core Admins also search teams, participants and judges through the same list endpoints
 * the pages use; the API enforces access on each of them, and other roles never call them.
 */
export function CommandPalette({
  mine,
  events,
  open,
  onClose,
}: {
  mine: MyEvent;
  events: MyEvent[];
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const term = useDebounced(q.trim());
  const base = `/events/${mine.eventId}`;
  const admin = mine.role === 'ADMIN' && mine.accessLevel !== 'SPONSOR_VIEWER';

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setQ('');
      setActive(0);
      window.setTimeout(() => input.current?.focus(), 0);
    }
    if (!open && el.open) el.close();
  }, [open]);

  const records = useQuery({
    queryKey: ['global-search', mine.eventId, term],
    enabled: open && admin && term.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const qs = (extra: Record<string, string>) =>
        new URLSearchParams({ q: term, pageSize: '5', ...extra }).toString();
      const [teams, people, members] = await Promise.all([
        request<{ rows: { id: string; teamCode: string; name: string; members: string[] }[] }>(
          'GET',
          `/events/${mine.eventId}/teams?${qs({})}`,
        ).catch(() => ({ rows: [] })),
        request<{
          rows: { membershipId: string; name: string; email: string; teamName: string }[];
        }>('GET', `/events/${mine.eventId}/participants?${qs({})}`).catch(() => ({ rows: [] })),
        request<{ members: { membershipId: string; name: string; email: string; role: string }[] }>(
          'GET',
          `/events/${mine.eventId}/members`,
        ).catch(() => ({ members: [] })),
      ]);
      const needle = term.toLowerCase();
      const out: Result[] = [
        ...teams.rows.map((t) => ({
          key: `t-${t.id}`,
          kind: 'Team' as const,
          label: `${t.name}`,
          detail: [t.teamCode, t.members.slice(0, 3).join(', ')].filter(Boolean).join(' · '),
          to: `${base}/teams/${t.id}`,
        })),
        ...people.rows.map((p) => ({
          key: `p-${p.membershipId}`,
          kind: 'Participant' as const,
          label: p.name,
          detail: [p.email, p.teamName].filter(Boolean).join(' · '),
          to: `${base}/participants/${p.membershipId}`,
        })),
        ...members.members
          .filter(
            (m) =>
              m.role === 'JUDGE' &&
              (m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle)),
          )
          .slice(0, 5)
          .map((m) => ({
            key: `j-${m.membershipId}`,
            kind: 'Judge' as const,
            label: m.name,
            detail: m.email,
            to: `${base}/people`,
          })),
      ];
      return out;
    },
  });

  const workspaces = useMemo<Result[]>(() => {
    const groups = navFor(mine.role);
    const all = groups.flatMap((g) =>
      [...g.items, ...(g.shortcuts ?? [])].map((i) => ({
        key: `w-${g.id}-${i.to}`,
        kind: 'Workspace' as const,
        label: i.label,
        detail: g.flat ? i.description : `${g.label} · ${i.description ?? ''}`,
        to: i.to === '' ? base : `${base}/${i.to}`,
      })),
    );
    const eventsList = events
      .filter((e) => e.eventId !== mine.eventId)
      .map((e) => ({
        key: `e-${e.eventId}`,
        kind: 'Event' as const,
        label: e.name,
        detail: 'Switch to this event',
        to: `/events/${e.eventId}`,
      }));
    const needle = q.trim().toLowerCase();
    const list = [...all, ...eventsList];
    if (!needle) return all.filter((r) => !r.to.includes('?') && !r.to.includes('#')).slice(0, 8);
    return list
      .filter((r) => `${r.label} ${r.detail ?? ''}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [mine, events, q, base]);

  const results = [...workspaces, ...(term === q.trim() ? (records.data ?? []) : [])];
  const go = (r: Result | undefined) => {
    if (!r) return;
    onClose();
    navigate(r.to);
  };

  return (
    <dialog
      ref={ref}
      aria-label="Search"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="mx-auto mt-[10vh] w-[min(40rem,calc(100vw-2rem))] rounded-card bg-white p-0 text-graphite shadow-card backdrop:bg-graphite/40"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search aria-hidden className="size-5 shrink-0" />
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={results[active] ? `palette-${results[active].key}` : undefined}
          aria-label={admin ? 'Search workspaces, teams, participants and judges' : 'Search'}
          placeholder={admin ? 'Search workspaces, teams, participants, judges…' : 'Search…'}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(results[active]);
            }
          }}
          className="min-h-14 flex-1 bg-transparent text-base text-ink outline-none"
        />
        <kbd className="hidden rounded border border-line px-1.5 text-xs sm:inline">Esc</kbd>
      </div>
      <ul id="palette-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
        {results.length === 0 && (
          <li className="px-3 py-6 text-center">
            {records.isFetching ? 'Searching…' : 'No matches. Try a team code, name or email.'}
          </li>
        )}
        {results.map((r, i) => {
          const Icon = KIND_ICON[r.kind];
          return (
            <li
              key={r.key}
              id={`palette-${r.key}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              className={cn(
                'flex min-h-12 cursor-pointer items-center gap-3 rounded-card px-3 py-2',
                i === active && 'bg-blush',
              )}
            >
              <Icon aria-hidden className="size-4 shrink-0 text-graphite" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{r.label}</span>
                {r.detail && <span className="block truncate text-sm">{r.detail}</span>}
              </span>
              <span className="hidden text-xs font-semibold uppercase tracking-wider sm:inline">
                {r.kind}
              </span>
              {i === active && <ArrowRight aria-hidden className="size-4 shrink-0" />}
            </li>
          );
        })}
        {admin && q.trim().length === 1 && (
          <li className="px-3 py-2 text-sm">Type one more character to search records.</li>
        )}
      </ul>
    </dialog>
  );
}
