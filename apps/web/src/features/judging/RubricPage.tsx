import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from 'lucide-react';
import { MAX_CRITERIA, weightsTotal, type MyEvent } from '@arthakram/shared';
import { eventApi } from '../../lib/events.js';
import { judgingApi, type RubricDto } from '../../lib/judging.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

type Row = {
  id?: string;
  name: string;
  description: string;
  weight: number;
  min: number;
  max: number;
};
const stateTone = { DRAFT: 'info', ACTIVE: 'success', LOCKED: 'warning' } as const;
const stateText = { DRAFT: 'Draft', ACTIVE: 'Active', LOCKED: 'Locked' } as const;

/** Per-round rubric: pick a template or build one, watch the weight total, activate, lock, unlock (PRD FR-023..025, FR-140..145). */
export function RubricPage() {
  const mine = useOutletContext<MyEvent>();
  const rounds = useQuery({
    queryKey: ['rounds', mine.eventId],
    queryFn: () => eventApi.rounds(mine.eventId),
  });
  const [roundId, setRoundId] = useState<string | null>(null);
  if (rounds.isPending) return <Spinner label="Loading rounds" />;
  const rid = roundId ?? rounds.data?.[0]?.id ?? '';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>Rubric</h2>
        {(rounds.data?.length ?? 0) > 1 && (
          <div className="w-60">
            <Select label="Round" value={rid} onChange={(e) => setRoundId(e.target.value)}>
              {rounds.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      <RubricEditor key={rid} eventId={mine.eventId} roundId={rid} />
    </div>
  );
}

function RubricEditor({ eventId, roundId }: { eventId: string; roundId: string }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const q = useQuery({
    queryKey: ['rubric', eventId, roundId],
    queryFn: () => judgingApi.rubric(eventId, roundId),
  });
  const templates = useQuery({
    queryKey: ['rubric-templates', eventId, roundId],
    queryFn: () => judgingApi.templates(eventId, roundId),
  });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<RubricDto['teamCommentMode']>('OPTIONAL');
  const [notice, setNotice] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [reason, setReason] = useState('');
  const rubric = q.data;

  useEffect(() => {
    if (rubric) {
      setRows(
        rubric.criteria.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          weight: c.weight,
          min: c.min,
          max: c.max,
        })),
      );
      setName(rubric.name);
      setMode(rubric.teamCommentMode);
    } else if (q.isSuccess) setRows(null);
  }, [rubric, q.isSuccess]);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['rubric', eventId, roundId] }),
      qc.invalidateQueries({ queryKey: ['judging', eventId, roundId] }),
    ]);
  const ok = (msg?: string) => async () => {
    errors.clear();
    setNotice(msg ?? null);
    await refresh();
  };
  const apply = useMutation({
    mutationFn: (key: string) => judgingApi.applyTemplate(eventId, roundId, key),
    onSuccess: ok('Template copied. Review it, then activate.'),
    onError: errors.capture,
  });
  const save = useMutation({
    mutationFn: () =>
      judgingApi.saveRubric(eventId, roundId, {
        name,
        teamCommentMode: mode,
        criteria: rows!.map((r) => ({
          ...(r.id ? { id: r.id } : {}),
          name: r.name,
          description: r.description,
          weight: Number(r.weight),
          min: Number(r.min),
          max: Number(r.max),
        })),
      }),
    onSuccess: ok('Draft saved'),
    onError: errors.capture,
  });
  const act = useMutation({
    mutationFn: (a: 'activate' | 'deactivate') => judgingApi.rubricAction(eventId, roundId, a),
    onSuccess: ok(),
    onError: errors.capture,
  });
  const unlock = useMutation({
    mutationFn: () => judgingApi.rubricAction(eventId, roundId, 'unlock', { reason }),
    onSuccess: async (r) => {
      setUnlocking(false);
      setReason('');
      await ok(
        `Rubric unlocked. ${r.reopened ?? 0} submitted evaluations were reopened for judges to re-score.`,
      )();
    },
    onError: (e) => {
      setUnlocking(false);
      errors.capture(e);
    },
  });
  const describe = useMutation({
    mutationFn: (c: { id: string; description: string }) =>
      import('../../lib/api.js').then(({ request }) =>
        request('PATCH', `/events/${eventId}/rounds/${roundId}/rubric/criteria/${c.id}`, {
          description: c.description,
        }),
      ),
    onSuccess: ok('Description updated'),
    onError: errors.capture,
  });

  if (q.isPending) return <Spinner label="Loading the rubric" />;
  if (!rubric) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState title="No rubric for this round yet">
          Start from a ready-made rubric that activates without edits, or build your own below.
        </EmptyState>
        {errors.formError && <Alert tone="error" title={errors.formError} />}
        <div className="grid gap-4 sm:grid-cols-2">
          {templates.data?.map((t) => (
            <Card key={t.key} footerLabel="Template">
              <h3>{t.name}</h3>
              <ul className="mt-2 text-sm">
                {t.criteria.map((c) => (
                  <li key={c.name}>
                    {c.name} · {c.weight}%
                  </li>
                ))}
              </ul>
              <Button
                className="mt-3"
                onClick={() => apply.mutate(t.key)}
                loading={apply.isPending}
              >
                Use this template
              </Button>
            </Card>
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setRows([{ name: '', description: '', weight: 100, min: 1, max: 10 }]);
            setName('Custom rubric');
            save.reset();
          }}
        >
          Build a custom rubric
        </Button>
        {rows && (
          <Builder
            rows={rows}
            setRows={setRows}
            name={name}
            setName={setName}
            mode={mode}
            setMode={setMode}
            errors={errors}
            editable
            onSave={() => save.mutate()}
            saving={save.isPending}
          />
        )}
      </div>
    );
  }

  const editable = rubric.state === 'DRAFT';
  const total = rows ? weightsTotal(rows.map((r) => ({ weight: Number(r.weight) || 0 }))) : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={stateTone[rubric.state]}>
          {rubric.state === 'LOCKED' && <Lock aria-hidden className="mr-1 size-3" />}
          {stateText[rubric.state]}
        </Badge>
        {rubric.sourceTemplate && (
          <span className="text-sm">
            From the {rubric.sourceTemplate === 'HACKATHON' ? 'hackathon' : 'case competition'}{' '}
            template
          </span>
        )}
      </div>
      {notice && <Alert tone="success" title={notice} />}
      {errors.formError && (
        <Alert tone="error" title={errors.formError}>
          {(errors.code === 'rubric_invalid' || rubric.problems.length > 0) &&
            rubric.state === 'DRAFT' && (
              <ul className="mt-1 list-disc pl-5">
                {rubric.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
        </Alert>
      )}
      {rubric.state === 'DRAFT' && rubric.problems.length > 0 && !errors.formError && (
        <Alert tone="warning" title="Fix these before activating">
          {
            <ul className="list-disc pl-5">
              {rubric.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          }
        </Alert>
      )}
      {rows && (
        <Builder
          rows={rows}
          setRows={setRows}
          name={name}
          setName={setName}
          mode={mode}
          setMode={setMode}
          errors={errors}
          editable={editable}
          total={total}
          onSave={() => save.mutate()}
          saving={save.isPending}
          onDescribe={
            rubric.state === 'LOCKED'
              ? (id, d) => describe.mutate({ id, description: d })
              : undefined
          }
        />
      )}
      <div className="flex flex-wrap gap-3">
        {rubric.state === 'DRAFT' && (
          <Button
            onClick={() => act.mutate('activate')}
            loading={act.isPending}
            disabled={rubric.problems.length > 0}
          >
            Activate rubric
          </Button>
        )}
        {rubric.state === 'ACTIVE' && (
          <Button
            variant="secondary"
            onClick={() => act.mutate('deactivate')}
            loading={act.isPending}
          >
            Deactivate to edit
          </Button>
        )}
        {rubric.state === 'LOCKED' && (
          <Button variant="secondary" onClick={() => setUnlocking(true)}>
            Unlock rubric
          </Button>
        )}
      </div>
      {rubric.state === 'ACTIVE' && (
        <p className="text-sm">
          The rubric locks automatically when the first evaluation is submitted. Activating does not
          open judging; do that on the Judging page.
        </p>
      )}
      <Dialog
        open={unlocking}
        title="Unlock this rubric?"
        onClose={() => setUnlocking(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setUnlocking(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => unlock.mutate()}
              loading={unlock.isPending}
              disabled={reason.trim().length < 3}
            >
              Unlock and reopen evaluations
            </Button>
          </>
        }
      >
        <p>
          Every submitted evaluation is reopened and judges must re-score; unchanged criteria stay
          pre-filled. Any approved result for this round becomes invalid.
        </p>
        <div className="mt-3">
          <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Dialog>
    </div>
  );
}

function Builder({
  rows,
  setRows,
  name,
  setName,
  mode,
  setMode,
  errors,
  editable,
  total,
  onSave,
  saving,
  onDescribe,
}: {
  rows: Row[];
  setRows: (r: Row[]) => void;
  name: string;
  setName: (n: string) => void;
  mode: RubricDto['teamCommentMode'];
  setMode: (m: RubricDto['teamCommentMode']) => void;
  errors: ReturnType<typeof useFormErrors>;
  editable: boolean;
  total?: number;
  onSave: () => void;
  saving: boolean;
  onDescribe?: (id: string, description: string) => void;
}) {
  const sum = total ?? weightsTotal(rows.map((r) => ({ weight: Number(r.weight) || 0 })));
  const set = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const n = [...rows];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j]!, n[i]!];
    setRows(n);
  };
  return (
    <Card footerLabel="Criteria">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Rubric name"
          value={name}
          disabled={!editable}
          onChange={(e) => setName(e.target.value)}
        />
        <Select
          label="Feedback for the team"
          value={mode}
          disabled={!editable}
          onChange={(e) => setMode(e.target.value as typeof mode)}
          hint="A comment judges may share with the team after release."
        >
          <option value="OFF">Off</option>
          <option value="OPTIONAL">Optional</option>
          <option value="REQUIRED">Required</option>
        </Select>
      </div>
      <ul className="mt-4 flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={r.id ?? i} className="rounded-card border border-line p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem_6rem]">
              <Input
                label="Criterion"
                value={r.name}
                disabled={!editable}
                maxLength={60}
                onChange={(e) => set(i, { name: e.target.value })}
                error={errors.fields[`criteria.${i}.name`]}
              />
              <Input
                type="number"
                label="Weight %"
                value={r.weight}
                disabled={!editable}
                onChange={(e) => set(i, { weight: Number(e.target.value) })}
                error={errors.fields[`criteria.${i}.weight`]}
              />
              <Input
                type="number"
                label="Lowest"
                value={r.min}
                disabled={!editable}
                onChange={(e) => set(i, { min: Number(e.target.value) })}
                error={errors.fields[`criteria.${i}.min`]}
              />
              <Input
                type="number"
                label="Highest"
                value={r.max}
                disabled={!editable}
                onChange={(e) => set(i, { max: Number(e.target.value) })}
                error={errors.fields[`criteria.${i}.max`]}
              />
            </div>
            <div className="mt-3">
              <Textarea
                label="Guidance for judges"
                rows={2}
                value={r.description}
                disabled={!editable && !onDescribe}
                maxLength={500}
                onChange={(e) => set(i, { description: e.target.value })}
                onBlur={() => r.id && onDescribe?.(r.id, r.description)}
              />
            </div>
            {editable && (
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  aria-label="Move criterion up"
                  icon={<ArrowUp aria-hidden className="size-4" />}
                  onClick={() => move(i, -1)}
                />
                <Button
                  variant="secondary"
                  aria-label="Move criterion down"
                  icon={<ArrowDown aria-hidden className="size-4" />}
                  onClick={() => move(i, 1)}
                />
                <Button
                  variant="ghost"
                  icon={<Trash2 aria-hidden className="size-4" />}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p
        role="status"
        className={`mt-4 text-lg font-bold ${sum === 100 ? 'text-success-fg' : 'text-error-fg'}`}
      >
        Total: {sum}% {sum === 100 ? '(ready)' : '(must equal 100%)'}
      </p>
      {editable && (
        <div className="mt-3 flex flex-wrap gap-3">
          <Button
            variant="secondary"
            icon={<Plus aria-hidden className="size-4" />}
            disabled={rows.length >= MAX_CRITERIA}
            onClick={() =>
              setRows([...rows, { name: '', description: '', weight: 1, min: 1, max: 10 }])
            }
          >
            Add criterion
          </Button>
          <Button onClick={onSave} loading={saving}>
            Save draft
          </Button>
        </div>
      )}
    </Card>
  );
}
