import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { eventApi, useEvent } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import type { SubmissionView } from '../../lib/participant.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  DateTimeField,
  Dialog,
  EmptyState,
  Input,
  Select,
  Spinner,
  Table,
  TBody,
  Td,
  THead,
  Th,
  Tr,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';
import { useListState } from '../../lib/useListState.js';

interface Row {
  teamId: string;
  teamCode: string;
  name: string;
  size: number;
  complete: boolean;
  disqualified: boolean;
  status: string;
  statusLabel: string;
  lastVersionNo: number;
  lastSubmittedAt: string | null;
  lateMinutes: number;
  extensionDeadline: string | null;
  minSizeOverride: boolean;
}
const tone: Record<string, 'info' | 'warning' | 'success' | 'error'> = {
  NOT_STARTED: 'info',
  DRAFT: 'warning',
  SUBMITTED: 'success',
  SUBMITTED_LATE: 'warning',
  LOCKED: 'success',
  NOT_SUBMITTED: 'error',
};

/** Per-round submission monitoring: who has not started, who has a draft, who is locked (PRD FR-028, FR-073). */
export function SubmissionsMonitorPage() {
  const mine = useOutletContext<MyEvent>();
  const rounds = useQuery({
    queryKey: ['rounds', mine.eventId],
    queryFn: () => eventApi.rounds(mine.eventId),
  });
  const list = useListState({ sort: 'teamCode' });
  const roundId = list.get('round') || rounds.data?.[0]?.id || '';
  const [q, setQ] = useState(list.get('q'));
  const res = useQuery({
    queryKey: ['submissions', mine.eventId, roundId, list.get('status'), list.get('q')],
    queryFn: () =>
      request<{ rows: Row[]; total: number }>(
        'GET',
        `/events/${mine.eventId}/rounds/${roundId}/submissions?status=${list.get('status')}&q=${encodeURIComponent(list.get('q'))}`,
      ),
    enabled: Boolean(roundId),
  });
  if (rounds.isPending) return <Spinner label="Loading rounds" />;
  const counts =
    res.data?.rows.reduce<Record<string, number>>(
      (a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }),
      {},
    ) ?? {};

  return (
    <div className="flex flex-col gap-4">
      <h2>Submissions</h2>
      <Card>
        <form
          className="grid gap-3 sm:grid-cols-3"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            list.set({ q });
          }}
        >
          {(rounds.data?.length ?? 0) > 1 && (
            <Select
              label="Round"
              value={roundId}
              onChange={(e) => list.set({ round: e.target.value })}
            >
              {rounds.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
          <Input
            label="Search teams"
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
            <option value="NOT_STARTED">Not started</option>
            <option value="DRAFT">Draft</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="SUBMITTED_LATE">Submitted late</option>
            <option value="LOCKED">Locked</option>
            <option value="NOT_SUBMITTED">Not submitted</option>
          </Select>
        </form>
      </Card>
      {Object.keys(counts).length > 0 && (
        <p className="text-sm">
          {Object.entries(counts)
            .map(([k, n]) => `${n} ${k.toLowerCase().replace('_', ' ')}`)
            .join(' · ')}
        </p>
      )}
      {res.isPending && <Spinner label="Loading submissions" />}
      {res.data?.rows.length === 0 && (
        <EmptyState title="No teams match">Teams appear here once they exist.</EmptyState>
      )}
      {res.data && res.data.rows.length > 0 && (
        <Table caption="Submissions">
          <THead>
            <Tr>
              <Th>Team</Th>
              <Th>Members</Th>
              <Th>Status</Th>
              <Th>Version</Th>
              <Th>Last submitted</Th>
              <Th>Notes</Th>
            </Tr>
          </THead>
          <TBody>
            {res.data.rows.map((r) => (
              <Tr key={r.teamId}>
                <Td>
                  <Link to={`${roundId}/${r.teamId}`}>
                    {r.teamCode} {r.name}
                  </Link>
                </Td>
                <Td>
                  {r.size} {!r.complete && <Badge tone="warning">Incomplete</Badge>}
                </Td>
                <Td>
                  <Badge tone={tone[r.status] ?? 'info'}>{r.statusLabel}</Badge>
                </Td>
                <Td>{r.lastVersionNo || '—'}</Td>
                <Td>
                  {r.lastSubmittedAt ? formatDateTime(r.lastSubmittedAt, mine.timeZone) : '—'}
                </Td>
                <Td>
                  {[
                    r.lateMinutes ? `${r.lateMinutes} min late` : '',
                    r.extensionDeadline ? 'Extended' : '',
                    r.minSizeOverride ? 'Size override' : '',
                    r.disqualified ? 'Disqualified' : '',
                  ]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

export function SubmissionDetailPage() {
  const mine = useOutletContext<MyEvent>();
  const { roundId = '', teamId = '' } = useParams();
  const qc = useQueryClient();
  const event = useEvent(mine.eventId);
  const errors = useFormErrors();
  const [ext, setExt] = useState<{ deadline: string | null; reason: string } | null>(null);
  const [override, setOverride] = useState<{ enabled: boolean; reason: string } | null>(null);
  const url = `/events/${mine.eventId}/rounds/${roundId}/submissions/${teamId}`;
  const q = useQuery({
    queryKey: ['submission-admin', mine.eventId, roundId, teamId],
    queryFn: () => request<SubmissionView>('GET', url),
  });
  const refresh = () =>
    qc.invalidateQueries({ queryKey: ['submission-admin', mine.eventId, roundId, teamId] });
  const extend = useMutation({
    mutationFn: () =>
      request('PUT', `${url}/extension`, { deadline: ext!.deadline, reason: ext!.reason }),
    onSuccess: async () => {
      setExt(null);
      errors.clear();
      await refresh();
    },
    onError: errors.capture,
  });
  const setOv = useMutation({
    mutationFn: () => request('PUT', `${url}/override`, override),
    onSuccess: async () => {
      setOverride(null);
      errors.clear();
      await refresh();
    },
    onError: errors.capture,
  });
  if (q.isPending || event.isPending) return <Spinner label="Loading submission" />;
  if (q.isError) return <Alert tone="error" title="We couldn't load that submission" />;
  const s = q.data;
  const tz = mine.timeZone;
  const fieldLabel = (id: string) => s.fields.find((f) => f.id === id);

  return (
    <div className="flex flex-col gap-4">
      <Link to="../.." relative="path" className="text-sm">
        Back to submissions
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h2>
          {s.team.teamCode} {s.team.name}
        </h2>
        <Badge tone={tone[s.status] ?? 'info'}>{s.statusLabel}</Badge>
      </div>
      {errors.formError && <Alert tone="error" title={errors.formError} />}
      <Card footerLabel="Controls">
        <p>
          Cutoff: {s.cutoff ? formatDateTime(s.cutoff, tz) : 'none'}{' '}
          {s.extensionDeadline && <Badge tone="info">Team extension</Badge>}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              setExt({ deadline: s.extensionDeadline ?? s.cutoff ?? null, reason: '' })
            }
          >
            Extend deadline for this team
          </Button>
          <Button
            variant="secondary"
            onClick={() => setOverride({ enabled: !s.minSizeOverride, reason: '' })}
          >
            {s.minSizeOverride
              ? 'Remove team-size override'
              : 'Allow submission below minimum size'}
          </Button>
        </div>
        <p className="mt-2 text-sm">
          Team has {s.team.size} of at least {s.team.min} members. Admins cannot upload or edit a
          team's work; extend the deadline instead.
        </p>
      </Card>

      <Card footerLabel="Submitted versions (read only)">
        {s.versions.length === 0 && <p>This team has not submitted yet.</p>}
        <ul className="flex flex-col gap-4">
          {s.versions.map((v, i) => (
            <li key={v.versionNo} className="border-b border-line pb-4 last:border-0 last:pb-0">
              <p className="font-bold text-ink">
                Version {v.versionNo} {i === 0 && <Badge tone="success">Judged</Badge>}{' '}
                {v.lateMinutes > 0 && <Badge tone="warning">{v.lateMinutes} min late</Badge>}
              </p>
              <p className="text-sm">
                {formatDateTime(v.submittedAt, tz)} by {v.submittedBy}
              </p>
              <p className="mt-2 font-semibold text-ink">{v.title}</p>
              <p className="whitespace-pre-line">{v.summary}</p>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {Object.entries(v.values)
                  .filter(([, val]) => val)
                  .map(([id, val]) => {
                    const f = fieldLabel(id);
                    const file = s.files.find((x) => x.id === val);
                    return (
                      <div key={id}>
                        <dt className="text-xs font-bold uppercase tracking-eyebrow text-ink">
                          {f?.label ?? 'Field'}
                        </dt>
                        <dd className="break-words">
                          {f?.type === 'FILE' && file ? (
                            <a href={`/api/v1/events/${mine.eventId}/files/${file.id}`}>
                              <Download aria-hidden className="mr-1 inline size-4" />
                              {file.name}
                            </a>
                          ) : f && f.type.endsWith('URL') ? (
                            <a href={val} target="_blank" rel="noopener noreferrer">
                              {val}
                            </a>
                          ) : (
                            val
                          )}
                        </dd>
                      </div>
                    );
                  })}
              </dl>
            </li>
          ))}
        </ul>
      </Card>

      <Dialog
        open={ext !== null}
        title="Extend the deadline for this team"
        onClose={() => setExt(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setExt(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => extend.mutate()}
              loading={extend.isPending}
              disabled={!ext?.deadline || (ext?.reason.trim().length ?? 0) < 3}
            >
              Save extension
            </Button>
          </>
        }
      >
        {ext && (
          <div className="flex flex-col gap-3">
            <DateTimeField
              label="New cutoff"
              value={ext.deadline}
              timeZone={event.data!.timeZone}
              onChange={(v) => setExt({ ...ext, deadline: v })}
            />
            <Input
              label="Reason"
              value={ext.reason}
              onChange={(e) => setExt({ ...ext, reason: e.target.value })}
              hint="Recorded in the audit history."
            />
          </div>
        )}
      </Dialog>
      <Dialog
        open={override !== null}
        title={
          override?.enabled
            ? 'Allow this team to submit below the minimum size?'
            : 'Remove the override?'
        }
        onClose={() => setOverride(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setOverride(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => setOv.mutate()}
              loading={setOv.isPending}
              disabled={(override?.reason.trim().length ?? 0) < 3}
            >
              Confirm
            </Button>
          </>
        }
      >
        {override && (
          <Input
            label="Reason"
            value={override.reason}
            onChange={(e) => setOverride({ ...override, reason: e.target.value })}
            hint="Recorded in the audit history."
          />
        )}
      </Dialog>
    </div>
  );
}
