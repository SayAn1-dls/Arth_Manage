import { Link, useLocation, useOutletContext } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
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
  Th,
} from '../../ui/index.js';

export interface ParticipantRow {
  membershipId: string;
  name: string;
  email: string;
  phone: string;
  institution: string;
  status: 'Registered' | 'In team' | 'Withdrawn' | 'Removed';
  teamId: string | null;
  teamCode: string;
  teamName: string;
  registeredAt: string;
}
const tone = {
  Registered: 'info',
  'In team': 'success',
  Withdrawn: 'warning',
  Removed: 'error',
} as const;

/** Participants view of Teams & participants (PRD FR-016, FR-020). Search lives on the page. */
export function ParticipantsView() {
  const mine = useOutletContext<MyEvent>();
  const location = useLocation();
  const list = useListState({ sort: 'name' });
  const qs = new URLSearchParams({
    q: list.get('q'),
    status: list.get('status'),
    team: list.get('team'),
    sort: list.sort,
    dir: list.dir,
    page: String(list.page),
    pageSize: '25',
  });
  const hasFilter = ['q', 'status', 'team'].some((k) => list.get(k));
  const res = useQuery({
    queryKey: ['participants', mine.eventId, qs.toString()],
    queryFn: () =>
      request<{ total: number; page: number; pageSize: number; rows: ParticipantRow[] }>(
        'GET',
        `/events/${mine.eventId}/participants?${qs}`,
      ),
    placeholderData: (prev) => prev,
  });
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form
          className="grid gap-3 sm:grid-cols-2"
          aria-label="Participant filters"
          onSubmit={(e) => e.preventDefault()}
        >
          <Select
            label="Status"
            value={list.get('status')}
            onChange={(e) => list.set({ status: e.target.value })}
          >
            <option value="">All</option>
            <option>Registered</option>
            <option>In team</option>
            <option>Withdrawn</option>
            <option>Removed</option>
          </Select>
          <Select
            label="Team"
            value={list.get('team')}
            onChange={(e) => list.set({ team: e.target.value })}
          >
            <option value="">Any</option>
            <option value="in">In a team</option>
            <option value="none">No team</option>
          </Select>
        </form>
      </Card>
      {res.isPending && <Spinner label="Loading participants" />}
      {res.isError && <Alert tone="error" title="We couldn't load participants" />}
      {res.data && res.data.rows.length === 0 && (
        <EmptyState title={hasFilter ? 'No participants match' : 'No participants yet'}>
          {hasFilter
            ? 'Try another search or clear the filters.'
            : 'People appear here as they register.'}
        </EmptyState>
      )}
      {res.data && res.data.rows.length > 0 && (
        <>
          <Table caption="Participants">
            <THead>
              <Tr>
                <SortHeader
                  label="Name"
                  field="name"
                  sort={list.sort}
                  dir={list.dir}
                  onSort={list.toggleSort}
                />
                <SortHeader
                  label="Email"
                  field="email"
                  sort={list.sort}
                  dir={list.dir}
                  onSort={list.toggleSort}
                />
                <SortHeader
                  label="Institution"
                  field="institution"
                  sort={list.sort}
                  dir={list.dir}
                  onSort={list.toggleSort}
                />
                <SortHeader
                  label="Status"
                  field="status"
                  sort={list.sort}
                  dir={list.dir}
                  onSort={list.toggleSort}
                />
                <SortHeader
                  label="Team"
                  field="teamCode"
                  sort={list.sort}
                  dir={list.dir}
                  onSort={list.toggleSort}
                />
                <Th>Phone</Th>
              </Tr>
            </THead>
            <TBody>
              {res.data.rows.map((r) => (
                <Tr key={r.membershipId}>
                  <Td>
                    <Link
                      to={`/events/${mine.eventId}/participants/${r.membershipId}`}
                      state={{ from: `${location.pathname}${location.search}` }}
                    >
                      {r.name}
                    </Link>
                  </Td>
                  <Td>{r.email}</Td>
                  <Td>{r.institution}</Td>
                  <Td>
                    <Badge tone={tone[r.status]}>{r.status}</Badge>
                  </Td>
                  <Td>
                    {r.teamId ? (
                      <Link
                        to={`/events/${mine.eventId}/teams/${r.teamId}`}
                        state={{ from: `${location.pathname}${location.search}` }}
                      >
                        {r.teamCode} {r.teamName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>{r.phone || '—'}</Td>
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
