import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyEvent } from '@arthakram/shared';
import { engageApi, type MyFeedback } from '../../lib/engage.js';
import { useFormErrors } from '../auth/useFormErrors.js';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../ui/index.js';

/** The one feedback form a participant or judge may answer, once, plus released judge comments for teams. */
export function FeedbackPage() {
  const mine = useOutletContext<MyEvent>();
  const q = useQuery({
    queryKey: ['feedback-mine', mine.eventId],
    queryFn: () => engageApi.mine(mine.eventId),
  });
  return (
    <div className="flex flex-col gap-6">
      <h2>Feedback</h2>
      {q.isPending && <Spinner label="Loading feedback form" />}
      {q.isError && <Alert tone="error" title="We couldn't load the feedback form" />}
      {q.data && (
        <FeedbackForm key={q.data.submitted ? 's' : 'o'} eventId={mine.eventId} data={q.data} />
      )}
      {mine.role === 'PARTICIPANT' && <TeamComments eventId={mine.eventId} />}
    </div>
  );
}

function FeedbackForm({ eventId, data }: { eventId: string; data: MyFeedback }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const submit = useMutation({
    mutationFn: () => engageApi.submit(eventId, answers),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback-mine', eventId] }),
    onError: errors.capture,
  });
  if (data.submitted)
    return (
      <Alert tone="success" title="Thank you, your feedback is in">
        You can't change it now, so the organisers see exactly what you wrote.
      </Alert>
    );
  if (!data.available)
    return (
      <EmptyState title="Feedback isn't open yet">
        The organisers will open it after the event. Come back then.
      </EmptyState>
    );
  if (!data.open)
    return (
      <EmptyState title="Feedback has closed">
        The organisers are no longer collecting responses.
      </EmptyState>
    );
  const set = (id: string, v: string | number | undefined) =>
    setAnswers((a) => {
      const n = { ...a };
      if (v === undefined || v === '') delete n[id];
      else n[id] = v;
      return n;
    });
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        errors.clear();
        submit.mutate();
      }}
    >
      <p>
        {data.confidential
          ? 'Your answers are confidential: the organisers will not see your name next to them.'
          : 'The organisers will see your name next to your answers.'}{' '}
        You can submit once.
      </p>
      {errors.formError && <Alert tone="error" title={errors.formError} />}
      {data.questions.map((q) => (
        <Card key={q.id}>
          {q.type === 'RATING' && (
            <fieldset aria-describedby={errors.fields[q.id] ? `${q.id}-err` : undefined}>
              <legend className="font-semibold text-ink">
                {q.text}
                {q.required ? <span className="text-graphite"> (required)</span> : null}
              </legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label
                    key={n}
                    className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-pill border px-4 font-bold text-ink has-[:focus-visible]:outline-2 ${
                      answers[q.id] === n ? 'border-ink bg-ember' : 'border-line-strong bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      className="sr-only"
                      checked={answers[q.id] === n}
                      onChange={() => set(q.id, n)}
                    />
                    {n}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-sm">1 is poor, 5 is excellent</p>
              {errors.fields[q.id] && (
                <p id={`${q.id}-err`} className="mt-1 text-sm font-semibold text-error-fg">
                  {errors.fields[q.id]}
                </p>
              )}
            </fieldset>
          )}
          {q.type === 'CHOICE' && (
            <Select
              label={q.text}
              required={q.required}
              value={String(answers[q.id] ?? '')}
              onChange={(e) => set(q.id, e.target.value)}
              error={errors.fields[q.id]}
            >
              <option value="">Choose…</option>
              {q.options?.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
          )}
          {q.type === 'SHORT_TEXT' && (
            <Input
              label={q.text}
              required={q.required}
              maxLength={200}
              value={String(answers[q.id] ?? '')}
              onChange={(e) => set(q.id, e.target.value)}
              error={errors.fields[q.id]}
            />
          )}
          {q.type === 'LONG_TEXT' && (
            <Textarea
              label={q.text}
              required={q.required}
              maxLength={2000}
              value={String(answers[q.id] ?? '')}
              onChange={(e) => set(q.id, e.target.value)}
              error={errors.fields[q.id]}
            />
          )}
        </Card>
      ))}
      <div>
        <Button type="submit" loading={submit.isPending}>
          Submit feedback
        </Button>
      </div>
    </form>
  );
}

function TeamComments({ eventId }: { eventId: string }) {
  const q = useQuery({
    queryKey: ['team-comments', eventId],
    queryFn: () => engageApi.teamComments(eventId),
  });
  if (!q.data?.rounds.length) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="jc-h">
      <h3 id="jc-h">Comments from the judges</h3>
      {q.data.rounds.map((r) => (
        <Card key={r.roundId} footerLabel={r.roundName}>
          {r.comments.length === 0 ? (
            <p>The judges did not leave a comment for your team in this round.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {r.comments.map((c) => (
                <li key={c.label} className="rounded-card bg-blush p-3">
                  <p className="text-sm font-bold text-ink">{c.label}</p>
                  <p className="mt-1 whitespace-pre-wrap text-ink">{c.comment}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </section>
  );
}
