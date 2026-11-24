import { Link, useLocation, useOutletContext } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { eventApi } from '../../lib/events.js';
import { useListState } from '../../lib/useListState.js';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Pagination,
  Select,
  SortHeader,
  Spinner,
  Table,
  TBody,
  Td,
  THead,
  Tr,
} from '../../ui/index.js';

interface TeamRow {
  id: string;
  teamCode: string;
  name: string;
  status: 'ACTIVE' | 'DISSOLVED' | 'DISQUALIFIED';
  leader: string;
  size: number;
  complete: boolean;
  trackName: string;
  problemTitle: string;
  submissionStatus: string;
  submissionLabel: string;
  members: string[];
}
const subTone: Record<string, 'info' | 'warning' | 'success' | 'error'> = {
  NOT_STARTED: 'info',
  DRAFT: 'warning',
  SUBMITTED: 'success',
  SUBMITTED_LATE: 'warning',
  LOCKED: 'success',
  NOT_SUBMITTED: 'error',
};

/** Teams view of Teams & participants: filters, sortable table with member names. Search lives on the page. */
export function TeamsView() {
  const mine = useOutletContext<MyEvent>();
  const location = useLocation();
  const list = useListState({ sort: 'teamCode' });
  const tracks = useQuery({
    queryKey: ['tracks', mine.eventId],
    queryFn: () => eventApi.tracks(mine.eventId),
  });
  const qs = new URLSearchParams({
    q: list.get('q'),
    complete: list.get('complete'),
    trackId: list.get('trackId'),
    status: list.get('status'),
    submission: list.get('submission'),
    sort: list.sort,
    dir: list.dir,
    page: String(list.page),
    pageSize: '25',
  });
  const hasFilter = ['q', 'complete', 'trackId', 'status', 'submission'].some((k) => list.get(k));
  const res = useQuery({
    queryKey: ['teams', mine.eventId, qs.toString()],
    queryFn: () =>
      request<{
        total: number;
        page: number;
        pageSize: number;
        round: { name: string } | null;
        rows: TeamRow[];
      }>('GET', `/events/${mine.eventId}/teams?${qs}`),
    placeholderData: (prev) => prev,
  });
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Team filters"
          onSubmit={(e) => e.preventDefault()}
        >
          <Select
            label="Completeness"
            value={list.get('complete')}
            onChange={(e) => list.set({ complete: e.target.value })}
          >
            <option value="">All</option>
            <option value="yes">Complete</option>
            <option value="no">Incomplete</option>
          </Select>
          {(tracks.data?.length ?? 0) > 0 && (
            <Select
              label="Track"
              value={list.get('trackId')}
              onChange={(e) => list.set({ trackId: e.target.value })}
            >
              <option value="">All tracks</option>
              {tracks.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
          <Select
            label="Submission"
            value={list.get('submission')}
            onChange={(e) => list.set({ submission: e.target.value })}
          >
            <option value="">Any</option>
            <option value="NOT_STARTED">Not started</option>
            <option value="DRAFT">Draft</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="SUBMITTED_LATE">Submitted late</option>
            <option value="LOCKED">Locked</option>
            <option value="NOT_SUBMITTED">Not submitted</option>
          </Select>
          <Select
            label="Team status"
            value={list.get('status')}
            onChange={(e) => list.set({ status: e.target.value })}
          >
            <option value="">Current teams</option>
            <option value="ACTIVE">Active</option>
            <option value="DISQUALIFIED">Disqualified</option>
            <option value="DISSOLVED">Dissolved</option>
          </Select>
        </form>
      </Card>
      {res.isPending && <Spinner label="Loading teams" />}
      {res.isError && <Alert tone="error" title="We couldn't load teams" />}
      {res.data && res.data.rows.length === 0 && (
        <EmptyState title={hasFilter ? 'No teams match' : 'No teams yet'}>
          {hasFilter
            ? 'Try another search or clear the filters.'
            : 'Teams appear here as participants create them.'}
        </EmptyState>
      )}
      {res.data && res.data.rows.length > 0 && (
        <>
          <Table caption="Teams">
            <THead>
              <Tr>
                <SortHeader
                  label="Team ID"
                  field="teamCode"
                  sort={list.sort}
                  dir={list.dir}
                  onSort={list.toggleSort}
                />
                <SortHeader
                  label="Name"
                  field="name"
                  sort={list.sort}
                  dir={list.dir}
                  onSort={list.toggleSort}
                />
                <SortHeader
                  label="Leader"
                  field="leader"
                  sort={list.sort}
                  dir={list.dir}
                  onSort={list.toggleSort}
                />
                <SortHeader
                  label="Members"
                  field="size"
                  sort={list.sort}
                  dir={list.dir}
                  onSort={list.toggleSort}
                />
                <SortHeader
                  label="Track"
                  field="trackName"
                  sort={list.sort}
                  dir={list.dir}
                  onSort={list.toggleSort}
                />
                <SortHeader
                  label={`Submission${res.data.round ? ` (${res.data.round.name})` : ''}`}
                  field="submissionStatus"
                  sort={list.sort}
                  dir={list.dir}
                  onSort={list.toggleSort}
                />
              </Tr>
            </THead>
            <TBody>
              {res.data.rows.map((t) => (
                <Tr key={t.id}>
                  <Td>{t.teamCode}</Td>
                  <Td>
                    <Link
                      to={`/events/${mine.eventId}/teams/${t.id}`}
                      state={{ from: `${location.pathname}${location.search}` }}
                    >
                      {t.name}
                    </Link>{' '}
                    {t.status === 'DISQUALIFIED' && <Badge tone="error">Disqualified</Badge>}
                    {t.status === 'DISSOLVED' && <Badge tone="info">Dissolved</Badge>}
                    {t.members.length > 0 && (
                      <span className="mt-1 block text-sm">{t.members.join(', ')}</span>
                    )}
                    {t.problemTitle && (
                      <span className="block text-sm">Problem: {t.problemTitle}</span>
                    )}
                  </Td>
                  <Td>{t.leader}</Td>
                  <Td>
                    {t.size}{' '}
                    {t.complete ? (
                      <Badge tone="success">Complete</Badge>
                    ) : (
                      <Badge tone="warning">Incomplete</Badge>
                    )}
                  </Td>
                  <Td>{t.trackName || '—'}</Td>
                  <Td>
                    <Badge tone={subTone[t.submissionStatus] ?? 'info'}>{t.submissionLabel}</Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={res.data.page}
            pageSize={res.data.pageSize}
            total={res.data.total}
            onPage={(p) => list.set({ page: p })}
          />
        </>
      )}
    </div>
  );
}
