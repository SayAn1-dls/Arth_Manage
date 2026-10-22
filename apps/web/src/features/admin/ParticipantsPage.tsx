import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { useListState } from '../../lib/useListState.js';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Input,
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

/** Searchable, sortable participant list with filters kept in the URL (PRD FR-016, FR-020). */
export function ParticipantsPage() {
  const mine = useOutletContext<MyEvent>();
  const list = useListState({ sort: 'name' });
  const [q, setQ] = useState(list.get('q'));
  const qs = new URLSearchParams({
    q: list.get('q'),
    status: list.get('status'),
    team: list.get('team'),
    sort: list.sort,
    dir: list.dir,
    page: String(list.page),
    pageSize: '25',
  });
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>Participants</h2>
        <a
          href={`/api/v1/events/${mine.eventId}/exports/participants.csv`}
          className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-strong bg-white px-5 py-2 font-bold text-ink no-underline hover:bg-blush"
        >
          <Download aria-hidden className="size-4" /> Export CSV
        </a>
      </div>
      <Card>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            list.set({ q });
          }}
          role="search"
        >
          <Input
            label="Search"
            hint="Name, email, phone, institution, team name or ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => q !== list.get('q') && list.set({ q })}
          />
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
        <EmptyState title="No matches">
          {list.queryString()
            ? 'Try clearing the filters.'
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
                    <Link to={`${r.membershipId}`}>{r.name}</Link>
                  </Td>
                  <Td>{r.email}</Td>
                  <Td>{r.institution}</Td>
                  <Td>
                    <Badge tone={tone[r.status]}>{r.status}</Badge>
                  </Td>
                  <Td>
                    {r.teamId ? (
                      <Link to={`../teams/${r.teamId}`}>
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
