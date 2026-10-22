import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyEvent, TeamDto } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { eventApi } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import type { ParticipantRow } from './ParticipantsPage.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

type TeamDetail = Omit<TeamDto, 'members'> & {
  members: (TeamDto['members'][number] & { phone: string | null })[];
  history: { action: string; at: string; before: unknown; after: unknown; reason: string | null }[];
};

export function TeamDetailPage() {
  const mine = useOutletContext<MyEvent>();
  const { teamId = '' } = useParams();
  const qc = useQueryClient();
  const errors = useFormErrors();
  const q = useQuery({
    queryKey: ['team', mine.eventId, teamId],
    queryFn: () => request<TeamDetail>('GET', `/events/${mine.eventId}/teams/${teamId}`),
  });
  const free = useQuery({
    queryKey: ['unassigned', mine.eventId],
    queryFn: () =>
      request<{ rows: ParticipantRow[] }>(
        'GET',
        `/events/${mine.eventId}/participants?team=none&status=Registered&pageSize=200`,
      ),
  });
  const tracks = useQuery({
    queryKey: ['tracks', mine.eventId],
    queryFn: () => eventApi.tracks(mine.eventId),
  });
  const problems = useQuery({
    queryKey: ['problems', mine.eventId],
    queryFn: () => eventApi.problems(mine.eventId),
  });
  const [add, setAdd] = useState('');
  const [name, setName] = useState<string | null>(null);
  const [dq, setDq] = useState<'disqualify' | 'reinstate' | null>(null);
  const [reason, setReason] = useState('');
  const base = `/events/${mine.eventId}/teams/${teamId}`;
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['team', mine.eventId, teamId] }),
      qc.invalidateQueries({ queryKey: ['unassigned', mine.eventId] }),
      qc.invalidateQueries({ queryKey: ['teams', mine.eventId] }),
    ]);
  const run = <T,>(fn: () => Promise<T>) => ({
    mutationFn: fn,
    onSuccess: () => {
      errors.clear();
      return refresh();
    },
    onError: errors.capture,
  });

  const addMember = useMutation(
    run(() => request('POST', `${base}/members`, { membershipId: add })),
  );
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request('PATCH', base, { version: q.data!.version, ...body }),
    onSuccess: () => {
      errors.clear();
      setName(null);
      return refresh();
    },
    onError: errors.capture,
  });
  const dqAct = useMutation({
    mutationFn: () => request('POST', `${base}/${dq}`, { reason }),
    onSuccess: () => {
      setDq(null);
      setReason('');
      errors.clear();
      return refresh();
    },
    onError: (e) => {
      setDq(null);
      errors.capture(e);
    },
  });
  const leader = useMutation({
    mutationFn: (id: string) => request('POST', `${base}/leader`, { membershipId: id }),
    onSuccess: refresh,
    onError: errors.capture,
  });
  const remove = useMutation({
    mutationFn: (id: string) => request('DELETE', `${base}/members/${id}`),
    onSuccess: refresh,
    onError: errors.capture,
  });

  if (q.isPending) return <Spinner label="Loading team" />;
  if (q.isError) return <Alert tone="error" title="We couldn't find that team" />;
  const t = q.data;
  const trackProblems = (problems.data ?? []).filter((p) => !p.trackId || p.trackId === t.trackId);

  return (
    <div className="flex flex-col gap-4">
      <Link to=".." className="text-sm">
        Back to teams
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h2>{t.name}</h2>
        <Badge tone="info">{t.teamCode}</Badge>
        {t.status === 'DISQUALIFIED' ? (
          <Badge tone="error">Disqualified</Badge>
        ) : t.complete ? (
          <Badge tone="success">Complete</Badge>
        ) : (
          <Badge tone="warning">
            Incomplete ({t.size}/{t.min})
          </Badge>
        )}
      </div>
      {t.status === 'DISQUALIFIED' && (
        <Alert tone="error" title="Excluded from rankings and winner certificates">
          {t.disqualifiedReason}
        </Alert>
      )}
      {errors.formError && (
        <Alert tone="error" title={errors.formError}>
          {errors.code === 'stale_version' && (
            <Button variant="secondary" className="mt-2" onClick={() => void refresh()}>
              Reload latest
            </Button>
          )}
        </Alert>
      )}

      <Card footerLabel="Members">
        <ul className="divide-y divide-line">
          {t.members.map((m) => (
            <li
              key={m.membershipId}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div>
                <p className="font-bold text-ink">
                  <Link to={`../../participants/${m.membershipId}`}>{m.name}</Link>{' '}
                  {m.role === 'LEADER' && <Badge>Leader</Badge>}
                </p>
                <p className="text-sm">
                  {m.email} · {m.phone ?? 'no phone'} · {m.institution}
                </p>
              </div>
              <div className="flex gap-2">
                {m.role !== 'LEADER' && (
                  <Button variant="secondary" onClick={() => leader.mutate(m.membershipId)}>
                    Make leader
                  </Button>
                )}
                <Button variant="ghost" onClick={() => remove.mutate(m.membershipId)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {t.size < t.max && (
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (add) addMember.mutate();
            }}
          >
            <div className="min-w-60 flex-1">
              <Select
                label="Add a registered participant"
                value={add}
                onChange={(e) => setAdd(e.target.value)}
                hint={`${t.size} of ${t.max}. People already in a team are not listed.`}
              >
                <option value="">Choose a participant</option>
                {free.data?.rows.map((p) => (
                  <option key={p.membershipId} value={p.membershipId}>
                    {p.name} ({p.email})
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" loading={addMember.isPending} disabled={!add}>
              Add to team
            </Button>
          </form>
        )}
      </Card>

      <Card footerLabel="Team details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Team name"
                value={name ?? t.name}
                onChange={(e) => setName(e.target.value)}
                error={errors.fields.name}
              />
            </div>
            <Button
              variant="secondary"
              disabled={name === null || name === t.name}
              onClick={() => patch.mutate({ name })}
              loading={patch.isPending}
            >
              Rename
            </Button>
          </div>
          <p className="self-end text-sm">
            Join code: <code className="font-mono font-bold text-ink">{t.joinCode ?? 'none'}</code>
          </p>
          {(tracks.data?.length ?? 0) > 0 && (
            <Select
              label="Track"
              value={t.trackId ?? ''}
              onChange={(e) => patch.mutate({ trackId: e.target.value || null, problemId: null })}
            >
              <option value="">None</option>
              {tracks.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
          {(problems.data?.length ?? 0) > 0 && (
            <Select
              label="Problem statement"
              value={t.problemId ?? ''}
              onChange={(e) => patch.mutate({ problemId: e.target.value || null })}
            >
              <option value="">None</option>
              {trackProblems.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="mt-4">
          {t.status === 'ACTIVE' && (
            <Button variant="danger" onClick={() => setDq('disqualify')}>
              Disqualify team
            </Button>
          )}
          {t.status === 'DISQUALIFIED' && (
            <Button variant="secondary" onClick={() => setDq('reinstate')}>
              Reinstate team
            </Button>
          )}
        </div>
      </Card>

      <Card footerLabel="History">
        <ul className="flex flex-col gap-2 text-sm">
          {t.history.length === 0 && <li>No changes recorded yet.</li>}
          {t.history.map((h, i) => (
            <li key={i}>
              <strong>{h.action.replace(/[._]/g, ' ')}</strong> ·{' '}
              {formatDateTime(h.at, mine.timeZone)}
              {h.reason ? ` · ${h.reason}` : ''}
            </li>
          ))}
        </ul>
      </Card>

      <Dialog
        open={dq !== null}
        title={dq === 'disqualify' ? 'Disqualify this team?' : 'Reinstate this team?'}
        onClose={() => setDq(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDq(null)}>
              Cancel
            </Button>
            <Button
              variant={dq === 'disqualify' ? 'danger' : 'primary'}
              loading={dqAct.isPending}
              disabled={reason.trim().length < 3}
              onClick={() => dqAct.mutate()}
            >
              {dq === 'disqualify' ? 'Disqualify' : 'Reinstate'}
            </Button>
          </>
        }
      >
        <p>
          {dq === 'disqualify'
            ? 'The team is excluded from rankings and winner certificates. You can reverse this later.'
            : 'The team returns to the rankings.'}
        </p>
        <div className="mt-3">
          <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Dialog>
    </div>
  );
}
