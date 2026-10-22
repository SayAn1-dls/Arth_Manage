import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { eventApi, useEvent, type Round } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  DateTimeField,
  EmptyState,
  FormErrorSummary,
  Input,
  Select,
  Spinner,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

const blank = (): Omit<Round, 'id' | 'order' | 'version'> => ({
  name: '',
  opensAt: null,
  submissionDeadline: null,
  graceMinutes: 0,
  latePolicy: 'REJECT',
  judgingDeadline: null,
  rankingScope: 'OVERALL',
  requiredEvaluations: 2,
  awardPositions: 3,
});

const IDS: Record<string, string> = {
  name: 'rd-name',
  opensAt: 'rd-opens',
  submissionDeadline: 'rd-deadline',
  judgingDeadline: 'rd-judging',
  graceMinutes: 'rd-grace',
  requiredEvaluations: 'rd-evals',
  awardPositions: 'rd-awards',
  reason: 'rd-reason',
};

export function RoundsPage() {
  const mine = useOutletContext<MyEvent>();
  const isAdmin = mine.role === 'ADMIN';
  const event = useEvent(mine.eventId);
  const rounds = useQuery({
    queryKey: ['rounds', mine.eventId],
    queryFn: () => eventApi.rounds(mine.eventId),
  });
  const [editing, setEditing] = useState<Round | 'new' | null>(null);
  if (rounds.isPending || event.isPending) return <Spinner label="Loading rounds" />;
  const tz = event.data?.timeZone ?? mine.timeZone;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>Rounds and deadlines</h2>
        {isAdmin && editing === null && (
          <Button onClick={() => setEditing('new')}>Add round</Button>
        )}
      </div>
      {editing !== null && event.data && (
        <RoundForm
          key={editing === 'new' ? 'new' : editing.id}
          eventId={mine.eventId}
          timeZone={tz}
          round={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}
      {rounds.data?.length === 0 && (
        <EmptyState title="No rounds yet">Every event needs at least one round.</EmptyState>
      )}
      <ul className="flex flex-col gap-4">
        {rounds.data?.map((r) => (
          <li key={r.id}>
            <Card footerLabel={`Round ${r.order}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3>{r.name}</h3>
                {isAdmin && editing === null && (
                  <Button variant="secondary" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                )}
              </div>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                <Fact
                  label="Submissions open"
                  value={r.opensAt ? formatDateTime(r.opensAt, tz) : 'Immediately'}
                />
                <Fact
                  label="Submission deadline"
                  value={
                    r.submissionDeadline ? formatDateTime(r.submissionDeadline, tz) : 'Not set'
                  }
                  warn={!r.submissionDeadline}
                />
                <Fact label="Grace period" value={`${r.graceMinutes} min`} />
                <Fact
                  label="Late submissions"
                  value={r.latePolicy === 'REJECT' ? 'Rejected' : 'Accepted and flagged'}
                />
                {isAdmin && (
                  <Fact
                    label="Judging deadline"
                    value={r.judgingDeadline ? formatDateTime(r.judgingDeadline, tz) : 'Not set'}
                  />
                )}
                {isAdmin && (
                  <Fact
                    label="Ranking"
                    value={`${r.rankingScope === 'OVERALL' ? 'Overall' : 'Per track'}, ${r.awardPositions} award positions, ${r.requiredEvaluations} evaluations per team`}
                  />
                )}
              </dl>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-eyebrow text-ink">{label}</dt>
      <dd>{warn ? <Badge tone="warning">{value}</Badge> : value}</dd>
    </div>
  );
}

function RoundForm({
  eventId,
  timeZone,
  round,
  onDone,
}: {
  eventId: string;
  timeZone: string;
  round: Round | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [d, setD] = useState(round ? { ...round } : blank());
  const [reason, setReason] = useState('');
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: d.name,
        opensAt: d.opensAt,
        submissionDeadline: d.submissionDeadline,
        graceMinutes: d.graceMinutes,
        latePolicy: d.latePolicy,
        judgingDeadline: d.judgingDeadline,
        rankingScope: d.rankingScope,
        requiredEvaluations: d.requiredEvaluations,
        awardPositions: d.awardPositions,
        ...(reason ? { reason } : {}),
      };
      return round
        ? request('PATCH', `/events/${eventId}/rounds/${round.id}`, body)
        : request('POST', `/events/${eventId}/rounds`, body);
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['rounds', eventId] }),
        qc.invalidateQueries({ queryKey: ['publish-checks', eventId] }),
      ]);
      onDone();
    },
    onError: errors.capture,
  });
  const remove = useMutation({
    mutationFn: () => request('DELETE', `/events/${eventId}/rounds/${round!.id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rounds', eventId] });
      onDone();
    },
    onError: errors.capture,
  });

  return (
    <Card footerLabel={round ? `Editing ${round.name}` : 'New round'}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          errors.clear();
          save.mutate();
        }}
      >
        {errors.formError && <Alert tone="error" title={errors.formError} />}
        <FormErrorSummary issues={errors.issues(IDS)} />
        <Input
          id="rd-name"
          label="Round name"
          required
          value={d.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.fields.name}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <DateTimeField
            id="rd-opens"
            label="Submissions open (optional)"
            value={d.opensAt}
            timeZone={timeZone}
            onChange={(v) => set('opensAt', v)}
            error={errors.fields.opensAt}
          />
          <DateTimeField
            id="rd-deadline"
            label="Submission deadline"
            value={d.submissionDeadline}
            timeZone={timeZone}
            onChange={(v) => set('submissionDeadline', v)}
            error={errors.fields.submissionDeadline}
          />
          <DateTimeField
            id="rd-judging"
            label="Judging deadline"
            value={d.judgingDeadline}
            timeZone={timeZone}
            onChange={(v) => set('judgingDeadline', v)}
            error={errors.fields.judgingDeadline}
          />
          <Input
            id="rd-grace"
            type="number"
            min={0}
            max={60}
            label="Grace period (minutes)"
            hint="0 to 60. Submissions inside the grace period count as on time."
            value={d.graceMinutes}
            onChange={(e) => set('graceMinutes', Number(e.target.value))}
            error={errors.fields.graceMinutes}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Late submissions"
            value={d.latePolicy}
            onChange={(e) => set('latePolicy', e.target.value as typeof d.latePolicy)}
          >
            <option value="REJECT">Reject</option>
            <option value="ACCEPT_AND_FLAG">Accept and flag</option>
          </Select>
          <Select
            label="Ranking scope"
            value={d.rankingScope}
            onChange={(e) => set('rankingScope', e.target.value as typeof d.rankingScope)}
          >
            <option value="OVERALL">Overall</option>
            <option value="PER_TRACK">Per track</option>
          </Select>
          <Input
            id="rd-evals"
            type="number"
            min={1}
            max={5}
            label="Evaluations required per team"
            value={d.requiredEvaluations}
            onChange={(e) => set('requiredEvaluations', Number(e.target.value))}
            error={errors.fields.requiredEvaluations}
          />
          <Input
            id="rd-awards"
            type="number"
            min={1}
            max={10}
            label="Award positions"
            value={d.awardPositions}
            onChange={(e) => set('awardPositions', Number(e.target.value))}
            error={errors.fields.awardPositions}
          />
        </div>
        {round && (
          <Input
            id="rd-reason"
            label="Reason for changing a deadline"
            hint="Required if submissions already exist. Recorded in the audit history."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={errors.fields.reason}
          />
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={save.isPending}>
            {round ? 'Save round' : 'Add round'}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          {round && (
            <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
              Delete round
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
