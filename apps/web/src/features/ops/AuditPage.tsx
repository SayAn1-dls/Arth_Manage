import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { formatDateTime } from '../../lib/format.js';
import { useListState } from '../../lib/useListState.js';
import { opsApi } from '../../lib/ops.js';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Input,
  Pagination,
  Select,
  Spinner,
  Table,
  TBody,
  Td,
  THead,
  Th,
  Tr,
} from '../../ui/index.js';

/** Read-only audit history with filters, kept in the URL (PRD FR-046). */
export function AuditPage() {
  const mine = useOutletContext<MyEvent>();
  const list = useListState({ sort: 'at' });
  const [action, setAction] = useState(list.get('action'));
  const qs = new URLSearchParams({
    entityType: list.get('entityType'),
    action: list.get('action'),
    from: list.get('from'),
    to: list.get('to'),
    page: String(list.page),
    pageSize: '50',
  });
  const q = useQuery({
    queryKey: ['audit', mine.eventId, qs.toString()],
    queryFn: () => opsApi.audit(mine.eventId, qs.toString()),
    placeholderData: (p) => p,
  });
  const csv = new URLSearchParams({
    entityType: list.get('entityType'),
    action: list.get('action'),
    from: list.get('from'),
    to: list.get('to'),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>Audit history</h2>
        <a
          href={`/api/v1/events/${mine.eventId}/audit.csv?${csv}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-strong bg-white px-5 font-bold text-ink no-underline hover:bg-blush"
        >
          <Download aria-hidden className="size-4" /> Export CSV
        </a>
      </div>
      <p>
        Every important action is recorded here with who did it and when. Entries cannot be edited
        or deleted by anyone.
      </p>
      <Card>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            list.set({ action });
          }}
        >
          <Select
            label="Type"
            value={list.get('entityType')}
            onChange={(e) => list.set({ entityType: e.target.value })}
          >
            <option value="">All</option>
            {q.data?.entityTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
          <Input
            label="Action contains"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            onBlur={() => action !== list.get('action') && list.set({ action })}
            hint="For example judging or results"
          />
          <Input
            type="date"
            label="From"
            value={list.get('from')}
            onChange={(e) => list.set({ from: e.target.value })}
          />
          <Input
            type="date"
            label="To"
            value={list.get('to')}
            onChange={(e) => list.set({ to: e.target.value ? `${e.target.value}T23:59:59` : '' })}
          />
        </form>
      </Card>
      {q.isPending && <Spinner label="Loading history" />}
      {q.isError && <Alert tone="error" title="We couldn't load the audit history" />}
      {q.data?.rows.length === 0 && (
        <EmptyState title="No matching entries">
          {list.queryString() ? 'Try clearing the filters.' : 'Actions appear here as they happen.'}
          <div className="mt-3">
            <Button
              variant="secondary"
              onClick={() => {
                setAction('');
                list.set({ entityType: null, action: null, from: null, to: null });
              }}
            >
              Clear filters
            </Button>
          </div>
        </EmptyState>
      )}
      {q.data && q.data.rows.length > 0 && (
        <>
          <Table caption="Audit history">
            <THead>
              <Tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Details</Th>
              </Tr>
            </THead>
            <TBody>
              {q.data.rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(r.at, mine.timeZone)}</Td>
                  <Td>{r.actor}</Td>
                  <Td>
                    <code className="text-sm">{r.action}</code>
                  </Td>
                  <Td>{r.entityType}</Td>
                  <Td className="max-w-md text-sm">
                    {r.reason && (
                      <span className="block">
                        <strong>Reason:</strong> {r.reason}
                      </span>
                    )}
                    {r.after ? (
                      <span className="block break-words">
                        {JSON.stringify(r.after).slice(0, 200)}
                      </span>
                    ) : null}
                    {r.before ? (
                      <span className="block break-words text-graphite/80">
                        was {JSON.stringify(r.before).slice(0, 160)}
                      </span>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={q.data.page}
            pageSize={q.data.pageSize}
            total={q.data.total}
            onPage={(p) => list.set({ page: p })}
          />
        </>
      )}
    </div>
  );
}
