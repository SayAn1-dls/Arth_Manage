import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, Plus, Trash2 } from 'lucide-react';
import { MAX_QUESTIONS, type FeedbackQuestion, type MyEvent } from '@arthakram/shared';
import { eventApi, useEvent } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import { engageApi, type Audience, type FeedbackFormDto } from '../../lib/engage.js';
import { useListState } from '../../lib/useListState.js';
import { cn } from '../../ui/cn.js';
import { useFormErrors } from '../auth/useFormErrors.js';
import {
  PageHeader,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DateTimeField,
  Dialog,
  EmptyState,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../ui/index.js';

const AUDIENCE_LABEL: Record<Audience, string> = {
  PARTICIPANT: 'Participant feedback',
  JUDGE: 'Judge feedback',
};
const TYPE_LABEL: Record<FeedbackQuestion['type'], string> = {
  RATING: 'Rating 1 to 5',
  CHOICE: 'Choose one',
  SHORT_TEXT: 'Short answer',
  LONG_TEXT: 'Long answer',
};
const STATE_TONE = { DRAFT: 'info', OPEN: 'success', CLOSED: 'warning' } as const;

/** Feedback forms, their results and the controlled release of judges' comments (PRD Module H). */
const TABS = [
  {
    key: 'participants',
    label: 'Participant feedback',
    intro:
      'The participant survey: participants → organisers. Each participant answers once. A confidential survey never shows who wrote what, even in the CSV.',
  },
  {
    key: 'judges',
    label: 'Judge feedback',
    intro:
      'The judge survey: judges → organisers, about how the event and judging went. Each judge answers once.',
  },
  {
    key: 'comments',
    label: 'Team feedback / comments',
    intro:
      'Comments judges wrote about each team (judge → team). Teams see them only after the round’s results are published and you release them, labelled Judge 1, Judge 2 with no names. Hidden comments never reach the team. Judges’ private notes to organisers are never shown here or to teams.',
  },
] as const;

/**
 * Feedback & reviews (navigation audit consolidation 4): the participant survey, the judge survey and judges'
 * comments about teams, each in its own tab with its direction and visibility stated. Records stay separate;
 * only the page is shared.
 */
export function FeedbackAdminPage() {
  const mine = useOutletContext<MyEvent>();
  const list = useListState({ sort: 'date' });
  const tab = TABS.find((t) => t.key === list.get('tab')) ?? TABS[0];
  const forms = useQuery({
    queryKey: ['feedback-forms', mine.eventId],
    queryFn: () => engageApi.forms(mine.eventId),
  });
  const event = useEvent(mine.eventId);
  const audience = tab.key === 'judges' ? 'JUDGE' : 'PARTICIPANT';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Feedback & reviews"
        description="Participant and judge surveys, and judges’ comments for teams."
      />
      <div role="tablist" aria-label="Feedback source" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab.key === t.key}
            onClick={() => list.set({ tab: t.key === 'participants' ? null : t.key })}
            className={cn(
              'min-h-11 rounded-pill border px-5 font-bold text-ink',
              tab.key === t.key
                ? 'border-ink bg-blush'
                : 'border-line-strong bg-white hover:bg-blush',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p role="note">{tab.intro}</p>
      <div role="tabpanel" aria-label={tab.label} className="flex flex-col gap-6">
        {tab.key === 'comments' ? (
          <CommentsCard eventId={mine.eventId} />
        ) : (
          <>
            {forms.isPending && <Spinner label="Loading the survey" />}
            {forms.isError && <Alert tone="error" title="We couldn't load the survey" />}
            {forms.data?.forms
              .filter((f) => f.audience === audience)
              .map((f) => (
                <FormCard
                  key={`${f.audience}-${f.version}-${f.state}`}
                  eventId={mine.eventId}
                  form={f}
                  timeZone={event.data?.timeZone ?? 'Asia/Kolkata'}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}

function FormCard({
  eventId,
  form,
  timeZone,
}: {
  eventId: string;
  form: FeedbackFormDto;
  timeZone: string;
}) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [editing, setEditing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['feedback-forms', eventId] });
  const setState = useMutation({
    mutationFn: (s: string) => engageApi.formState(eventId, form.audience, s),
    onSuccess: async () => {
      errors.clear();
      await refresh();
    },
    onError: errors.capture,
  });
  return (
    <Card footerLabel={`${form.responses} of ${form.eligible} responded`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3>{AUDIENCE_LABEL[form.audience]}</h3>
        <Badge tone={STATE_TONE[form.state]}>{form.state.toLowerCase()}</Badge>
      </div>
      <p className="mt-2">
        {form.questions.length} questions · {form.confidential ? 'Confidential' : 'Named'}
        {form.closeAt ? ` · closes ${formatDateTime(form.closeAt, timeZone)}` : ''}
      </p>
      {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      <div className="mt-4 flex flex-wrap gap-3">
        {form.state !== 'OPEN' && (
          <Button onClick={() => setState.mutate('OPEN')} loading={setState.isPending}>
            {form.state === 'CLOSED' ? 'Reopen' : 'Open for responses'}
          </Button>
        )}
        {form.state === 'OPEN' && (
          <Button
            variant="secondary"
            onClick={() => setState.mutate('CLOSED')}
            loading={setState.isPending}
          >
            Close the form
          </Button>
        )}
        {form.state !== 'DRAFT' && form.responses === 0 && (
          <Button variant="ghost" onClick={() => setState.mutate('DRAFT')}>
            Back to draft
          </Button>
        )}
        <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Cancel editing' : 'Edit questions'}
        </Button>
        <Button variant="secondary" onClick={() => setShowResults((v) => !v)}>
          {showResults ? 'Hide results' : 'View results'}
        </Button>
      </div>
      {editing && (
        <FormEditor
          eventId={eventId}
          form={form}
          timeZone={timeZone}
          onSaved={async () => {
            setEditing(false);
            await refresh();
          }}
        />
      )}
      {showResults && <Results eventId={eventId} audience={form.audience} />}
    </Card>
  );
}

function FormEditor({
  eventId,
  form,
  timeZone,
  onSaved,
}: {
  eventId: string;
  form: FeedbackFormDto;
  timeZone: string;
  onSaved: () => void;
}) {
  const errors = useFormErrors();
  const locked = form.responses > 0;
  const [qs, setQs] = useState<FeedbackQuestion[]>(form.questions);
  const [confidential, setConfidential] = useState(form.confidential);
  const [closeAt, setCloseAt] = useState<string | null>(form.closeAt);
  const original = new Set(form.questions.map((q) => q.id));
  const patch = (i: number, p: Partial<FeedbackQuestion>) =>
    setQs((all) => all.map((q, j) => (j === i ? { ...q, ...p } : q)));
  const move = (i: number, d: number) =>
    setQs((all) => {
      const next = [...all];
      const [q] = next.splice(i, 1);
      next.splice(i + d, 0, q!);
      return next;
    });
  const save = useMutation({
    mutationFn: () =>
      engageApi.saveForm(eventId, form.audience, {
        confidential,
        closeAt,
        questions: qs.map((q) => ({
          ...q,
          options: q.type === 'CHOICE' ? (q.options ?? []).filter((o) => o.trim()) : undefined,
        })),
      }),
    onSuccess: onSaved,
    onError: errors.capture,
  });
  return (
    <form
      className="mt-5 flex flex-col gap-4 border-t border-line pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        errors.clear();
        save.mutate();
      }}
    >
      {locked && (
        <Alert tone="info" title="Responses exist">
          Existing questions cannot be deleted or change type, and new questions must be optional.
        </Alert>
      )}
      {errors.formError && <Alert tone="error" title={errors.formError} />}
      <Checkbox
        label="Confidential"
        hint="Responses are shown without the respondent's name."
        checked={confidential}
        disabled={locked}
        onChange={(e) => setConfidential(e.target.checked)}
      />
      <DateTimeField
        label="Closes automatically at (optional)"
        value={closeAt}
        timeZone={timeZone}
        onChange={setCloseAt}
      />
      <ol className="flex flex-col gap-3">
        {qs.map((q, i) => {
          const isNew = !original.has(q.id);
          return (
            <li key={q.id} className="rounded-card border border-line bg-paper p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                <Input
                  label={`Question ${i + 1}`}
                  value={q.text}
                  onChange={(e) => patch(i, { text: e.target.value })}
                  error={errors.fields[`questions.${i}.text`]}
                />
                <Select
                  label="Answer type"
                  value={q.type}
                  disabled={locked && !isNew}
                  onChange={(e) =>
                    patch(i, {
                      type: e.target.value as FeedbackQuestion['type'],
                      options:
                        e.target.value === 'CHOICE' ? (q.options ?? ['Yes', 'No']) : undefined,
                    })
                  }
                >
                  {Object.entries(TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </div>
              {q.type === 'CHOICE' && (
                <Textarea
                  className="mt-3"
                  label="Options, one per line"
                  rows={3}
                  value={(q.options ?? []).join('\n')}
                  onChange={(e) => patch(i, { options: e.target.value.split('\n') })}
                  error={errors.fields[`questions.${i}`]}
                />
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <Checkbox
                  label="Required"
                  checked={q.required}
                  disabled={locked && isNew}
                  onChange={(e) => patch(i, { required: e.target.checked })}
                />
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    aria-label={`Move question ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    icon={<ArrowUp aria-hidden className="size-4" />}
                  />
                  <Button
                    variant="secondary"
                    aria-label={`Move question ${i + 1} down`}
                    disabled={i === qs.length - 1}
                    onClick={() => move(i, 1)}
                    icon={<ArrowDown aria-hidden className="size-4" />}
                  />
                  <Button
                    variant="secondary"
                    aria-label={`Delete question ${i + 1}`}
                    disabled={locked && !isNew}
                    onClick={() => setQs((all) => all.filter((_, j) => j !== i))}
                    icon={<Trash2 aria-hidden className="size-4" />}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={qs.length >= MAX_QUESTIONS}
          icon={<Plus aria-hidden className="size-4" />}
          onClick={() =>
            setQs((all) => [
              ...all,
              {
                id: `q${Date.now().toString(36)}`,
                type: 'RATING',
                text: '',
                required: false,
              },
            ])
          }
        >
          Add question
        </Button>
        <Button type="submit" loading={save.isPending}>
          Save form
        </Button>
      </div>
    </form>
  );
}

function Results({ eventId, audience }: { eventId: string; audience: Audience }) {
  const q = useQuery({
    queryKey: ['feedback-results', eventId, audience],
    queryFn: () => engageApi.results(eventId, audience),
  });
  if (q.isPending) return <Spinner label="Loading results" />;
  if (q.isError || !q.data) return <Alert tone="error" title="We couldn't load the results" />;
  const r = q.data;
  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold text-ink">
          {r.responses} of {r.eligible} responded ({Math.round(r.rate * 100)}%)
        </p>
        <a
          href={`/api/v1/events/${eventId}/feedback/results/${audience}/export.csv`}
          className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-strong bg-white px-5 font-bold text-ink no-underline hover:bg-blush"
        >
          <Download aria-hidden className="size-4" /> Export CSV
        </a>
      </div>
      {r.responses === 0 && <EmptyState title="No responses yet" />}
      {r.responses > 0 &&
        r.questions.map((x) => (
          <div key={x.id}>
            <h4 className="font-bold text-ink">{x.text}</h4>
            {x.type === 'RATING' && (
              <>
                <p className="text-sm">
                  Average {x.average ?? '–'} from {x.count} answers
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {x.distribution?.map((n, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <span className="w-14">
                        {i + 1} star{i ? 's' : ''}
                      </span>
                      <span
                        className="h-3 rounded-pill bg-ember"
                        style={{
                          width: `${x.count ? (n / x.count) * 100 : 0}%`,
                          minWidth: n ? 6 : 0,
                        }}
                        aria-hidden
                      />
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {x.type === 'CHOICE' && (
              <ul className="mt-1 text-sm">
                {Object.entries(x.counts ?? {}).map(([o, n]) => (
                  <li key={o}>
                    {o}: <strong>{n}</strong>
                  </li>
                ))}
              </ul>
            )}
            {(x.type === 'SHORT_TEXT' || x.type === 'LONG_TEXT') && (
              <ul className="mt-2 flex flex-col gap-2">
                {x.answers?.map((a, i) => (
                  <li key={i} className="rounded-card bg-blush px-3 py-2 text-sm text-ink">
                    {a}
                  </li>
                ))}
                {!x.answers?.length && <li className="text-sm">No answers.</li>}
              </ul>
            )}
          </div>
        ))}
    </div>
  );
}

function CommentsCard({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const rounds = useQuery({
    queryKey: ['rounds', eventId],
    queryFn: () => eventApi.rounds(eventId),
  });
  const [picked, setPicked] = useState('');
  const roundId = picked || rounds.data?.[0]?.id || '';
  const q = useQuery({
    queryKey: ['round-comments', eventId, roundId],
    queryFn: () => engageApi.comments(eventId, roundId),
    enabled: Boolean(roundId),
  });
  const [hiding, setHiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<null | 'release' | 'withdraw'>(null);
  const [find, setFind] = useState('');
  const [shown, setShown] = useState<'all' | 'visible' | 'hidden'>('all');
  const refresh = () => qc.invalidateQueries({ queryKey: ['round-comments', eventId, roundId] });
  const toggle = useMutation({
    mutationFn: (release: boolean) =>
      release
        ? engageApi.releaseComments(eventId, roundId)
        : engageApi.withdrawComments(eventId, roundId),
    onSuccess: async () => {
      errors.clear();
      setConfirm(null);
      await refresh();
    },
    onError: (e) => {
      setConfirm(null);
      errors.capture(e);
    },
  });
  const visibility = useMutation({
    mutationFn: (v: { id: string; hidden: boolean }) =>
      engageApi.commentVisibility(eventId, v.id, v.hidden, v.hidden ? reason : undefined),
    onSuccess: async () => {
      errors.clear();
      setHiding(null);
      setReason('');
      await refresh();
    },
    onError: errors.capture,
  });
  if (!rounds.data?.length) return null;
  return (
    <Card>
      <h3>Judges’ comments about teams</h3>
      {rounds.data.length > 1 && (
        <div className="mt-3 w-60">
          <Select label="Round" value={roundId} onChange={(e) => setPicked(e.target.value)}>
            {rounds.data.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      {q.data && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Badge tone={q.data.released ? 'success' : 'info'}>
              {q.data.released ? 'Released to teams' : 'Not released'}
            </Badge>
            {!q.data.released && (
              <Button
                onClick={() => setConfirm('release')}
                disabled={!q.data.resultsPublished || q.data.comments.length === 0}
              >
                Release comments…
              </Button>
            )}
            {q.data.released && (
              <Button variant="secondary" onClick={() => setConfirm('withdraw')}>
                Withdraw comments…
              </Button>
            )}
            {!q.data.resultsPublished && !q.data.released && (
              <span className="text-sm">Publish this round's results first.</span>
            )}
          </div>
          {q.data.comments.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Input
                label="Find a team or judge"
                value={find}
                onChange={(e) => setFind(e.target.value)}
              />
              <Select
                label="Visibility"
                value={shown}
                onChange={(e) => setShown(e.target.value as typeof shown)}
              >
                <option value="all">All comments</option>
                <option value="visible">
                  {q.data.released ? 'Visible to teams' : 'Will be visible when released'}
                </option>
                <option value="hidden">Hidden from teams</option>
              </Select>
            </div>
          )}
          <ul className="mt-4 flex flex-col gap-3">
            {q.data.comments
              .filter(
                (c) =>
                  (shown === 'all' || (shown === 'hidden') === Boolean(c.hiddenReason)) &&
                  `${c.teamCode} ${c.teamName} ${c.judgeName}`
                    .toLowerCase()
                    .includes(find.trim().toLowerCase()),
              )
              .map((c) => (
                <li key={c.evaluationId} className="rounded-card border border-line bg-paper p-3">
                  <p className="text-sm font-bold text-ink">
                    About {c.teamCode} {c.teamName} · written by {c.judgeName} (name never shown to
                    the team)
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-ink">{c.comment}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {c.hiddenReason ? (
                      <>
                        <Badge tone="warning">Hidden</Badge>
                        <span className="text-sm">{c.hiddenReason}</span>
                        <Button
                          variant="secondary"
                          onClick={() => visibility.mutate({ id: c.evaluationId, hidden: false })}
                        >
                          Show again
                        </Button>
                      </>
                    ) : (
                      <Button variant="secondary" onClick={() => setHiding(c.evaluationId)}>
                        Hide from team
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            {q.data.comments.length === 0 && <li>No team comments were written for this round.</li>}
          </ul>
        </>
      )}
      <Dialog
        open={confirm !== null}
        title={confirm === 'release' ? 'Release comments to teams?' : 'Withdraw released comments?'}
        onClose={() => setConfirm(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm === 'withdraw' ? 'danger' : 'primary'}
              loading={toggle.isPending}
              onClick={() => toggle.mutate(confirm === 'release')}
            >
              {confirm === 'release' ? 'Release to teams' : 'Withdraw from teams'}
            </Button>
          </>
        }
      >
        {q.data && confirm === 'release' && (
          <p>
            {q.data.comments.filter((c) => !c.hiddenReason).length} comment
            {q.data.comments.filter((c) => !c.hiddenReason).length === 1 ? '' : 's'} become visible
            to the teams they are about, right away, labelled Judge 1, Judge 2 with no names.{' '}
            {q.data.comments.filter((c) => c.hiddenReason).length} hidden comment
            {q.data.comments.filter((c) => c.hiddenReason).length === 1 ? ' stays' : 's stay'}{' '}
            hidden. Read them first: teams may already have seen them before you withdraw.
          </p>
        )}
        {confirm === 'withdraw' && (
          <p>
            Teams stop seeing this round’s comments immediately. Anyone who already read them may
            remember them; nothing is deleted.
          </p>
        )}
      </Dialog>
      <Dialog
        open={hiding !== null}
        title="Hide this comment from the team"
        onClose={() => {
          setHiding(null);
          setReason('');
        }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setHiding(null)}>
              Cancel
            </Button>
            <Button
              loading={visibility.isPending}
              onClick={() => hiding && visibility.mutate({ id: hiding, hidden: true })}
            >
              Hide comment
            </Button>
          </>
        }
      >
        <p>The judge's words are kept, but the team will not see this comment.</p>
        <Textarea
          className="mt-3"
          label="Reason (recorded in the audit history)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={errors.fields.reason}
        />
      </Dialog>
    </Card>
  );
}
