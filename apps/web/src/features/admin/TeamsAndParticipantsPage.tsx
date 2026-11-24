import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { useListState } from '../../lib/useListState.js';
import { Alert, Button, Card, Input } from '../../ui/index.js';
import { cn } from '../../ui/cn.js';
import { ParticipantsView } from './ParticipantsPage.js';
import { TeamsView } from './TeamsPage.js';

type View = 'teams' | 'participants';

/**
 * Teams & participants (navigation audit consolidation 1): one destination for team membership. Teams is the
 * default view; a Participants view keeps every participant-level record and action. One search box works
 * in both views and says how many matches the other view has, so finding a person never depends on knowing
 * their team.
 */
export function TeamsAndParticipantsPage() {
  const mine = useOutletContext<MyEvent>();
  const list = useListState({ sort: 'teamCode' });
  const view: View = list.get('view') === 'participants' ? 'participants' : 'teams';
  const q = list.get('q');
  const [draft, setDraft] = useState(q);
  const other: View = view === 'teams' ? 'participants' : 'teams';

  const count = (path: string, extra: Record<string, string>) =>
    request<{ total: number }>(
      'GET',
      `/events/${mine.eventId}/${path}?${new URLSearchParams({ ...extra, pageSize: '1' })}`,
    ).then((r) => r.total);
  const otherMatches = useQuery({
    queryKey: ['tp-other', mine.eventId, other, q],
    queryFn: () => count(other, { q }),
    enabled: Boolean(q),
  });
  const unassigned = useQuery({
    queryKey: ['tp-unassigned', mine.eventId],
    queryFn: () => count('participants', { team: 'none', status: 'Registered' }),
  });

  // Switching view keeps the search but drops filters and sorting that belong to the other list.
  const switchTo = (v: View) =>
    list.set({
      view: v === 'teams' ? null : v,
      sort: null,
      dir: null,
      status: null,
      team: null,
      complete: null,
      trackId: null,
      submission: null,
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>Teams &amp; participants</h2>
        <a
          href={`/api/v1/events/${mine.eventId}/exports/${view}.csv`}
          className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-strong bg-white px-5 py-2 font-bold text-ink no-underline hover:bg-blush"
        >
          <Download aria-hidden className="size-4" /> Export {view} CSV
        </a>
      </div>

      <Card>
        <form
          role="search"
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            list.set({ q: draft.trim() });
          }}
        >
          <div className="flex-1">
            <Input
              label="Search teams and participants"
              hint="Team name or ID, participant name, email, phone, institution or participant ID"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <div className="flex gap-2 sm:mb-6">
            <Button type="submit">Search</Button>
            {q && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDraft('');
                  list.set({ q: null });
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </form>
        <div role="tablist" aria-label="Show" className="mt-2 flex gap-2">
          {(['teams', 'participants'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => view !== v && switchTo(v)}
              className={cn(
                'min-h-11 rounded-pill border px-5 font-bold text-ink',
                view === v ? 'border-ink bg-blush' : 'border-line-strong bg-white hover:bg-blush',
              )}
            >
              {v === 'teams' ? 'Teams' : 'Participants'}
            </button>
          ))}
        </div>
        {q && otherMatches.data !== undefined && otherMatches.data > 0 && (
          <p className="mt-3">
            {otherMatches.data} {other === 'teams' ? 'team' : 'participant'}
            {otherMatches.data === 1 ? ' also matches' : 's also match'} “{q}”.{' '}
            <button type="button" className="font-bold underline" onClick={() => switchTo(other)}>
              Show {other}
            </button>
          </p>
        )}
      </Card>

      {view === 'teams' && unassigned.data !== undefined && unassigned.data > 0 && (
        <Alert
          tone="info"
          title={`${unassigned.data} registered participant${unassigned.data === 1 ? ' is' : 's are'} not in a team`}
        >
          <Link to={`?view=participants&team=none&status=Registered`}>Show them</Link>
        </Alert>
      )}

      <div role="tabpanel" aria-label={view === 'teams' ? 'Teams' : 'Participants'}>
        {view === 'teams' ? <TeamsView /> : <ParticipantsView />}
      </div>
    </div>
  );
}
