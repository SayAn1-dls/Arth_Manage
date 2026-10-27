import { useEffect, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { judgeScoreExact, validateScores, type MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { judgingApi, type Workspace, type RubricCriterionDto } from '../../lib/judging.js';
import { Alert, Button, Input, Markdown, Spinner, Textarea, Badge } from '../../ui/index.js';
import { JudgeLinks, SimplePanel, GlossaryText, type Briefing } from './JudgeTools.js';
const control = 'block w-full rounded-lg border border-line-strong bg-white px-3 py-2';
export function JudgeBriefingPage() {
  const mine = useOutletContext<MyEvent>();
  const cache = useQueryClient();
  const [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['judge-briefing', mine.eventId],
    queryFn: () => request<Briefing>('GET', `/events/${mine.eventId}/judge/briefing`),
  });
  if (q.isPending) return <Spinner label="Loading judge briefing" />;
  if (q.error) return <Alert tone="error" title={q.error.message} />;
  const { briefing, glossary, tracks } = q.data;
  return (
    <div className="space-y-5">
      <h2>Judge briefing · pinned</h2>
      {mine.role === 'JUDGE' && <JudgeLinks eventId={mine.eventId} />}
      {error && <Alert tone="error" title={error} />}{' '}
      {saved && <Alert tone="success" title="Briefing saved" />}
      {mine.role === 'ADMIN' ? (
        <>
          <SimplePanel>
            <form
              key={briefing.version}
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                setBusy(true);
                setError('');
                try {
                  await request('PUT', `/events/${mine.eventId}/judge/briefing`, {
                    body: d.get('body'),
                    examples: d.get('examples'),
                    contact: d.get('contact'),
                    version: briefing.version,
                  });
                  await cache.invalidateQueries({ queryKey: ['judge-briefing', mine.eventId] });
                  setSaved(true);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Textarea
                name="body"
                label="Rubric explained and judge instructions (Markdown)"
                defaultValue={briefing.body}
                maxLength={20000}
              />
              <Textarea
                name="examples"
                label="Example scored teams (use fictional examples)"
                defaultValue={briefing.examples}
                maxLength={12000}
              />
              <Input
                name="contact"
                label="Who to contact"
                defaultValue={briefing.contact}
                maxLength={1000}
              />
              <Button type="submit" loading={busy}>
                Publish briefing
              </Button>
            </form>
          </SimplePanel>
          <GlossaryEditor initial={glossary} tracks={tracks} eventId={mine.eventId} />
        </>
      ) : (
        <>
          <SimplePanel>
            <h3>The rubric explained</h3>
            <Markdown source={briefing.body} />
          </SimplePanel>
          <SimplePanel>
            <h3>Example scored teams</h3>
            <Markdown source={briefing.examples} />
          </SimplePanel>
          <SimplePanel>
            <h3>Who to contact</h3>
            <p className="whitespace-pre-wrap">{briefing.contact}</p>
            <Link to={`/events/${mine.eventId}/helpdesk`}>Ask Admin</Link>
          </SimplePanel>
        </>
      )}
      <SimplePanel>
        <h3>Keyboard shortcuts</h3>
        <ul className="list-disc pl-5">
          <li>0–9: enter a score for the current criterion when focus is outside an input.</li>
          <li>Tab / Shift+Tab: move between score fields and other controls.</li>
          <li>
            N: next team when not typing in a field. Pending evaluation and scratchpad saves finish
            before navigation.
          </li>
          <li>For 10 or higher values, type directly into the score input.</li>
        </ul>
        <p>Shortcuts pause while a confirmation dialog is open.</p>
      </SimplePanel>
      {mine.role === 'JUDGE' && (
        <SimplePanel>
          <h3>Track glossary</h3>
          {glossary.map((g) => (
            <p key={g.id}>
              <strong>{g.term}</strong>{' '}
              {g.trackId ? `(${tracks.find((t) => t.id === g.trackId)?.name})` : ''}: {g.definition}
            </p>
          ))}
          {!glossary.length && <p>No terms have been added yet.</p>}
        </SimplePanel>
      )}
    </div>
  );
}
function GlossaryEditor({
  initial,
  tracks,
  eventId,
}: {
  initial: Briefing['glossary'];
  tracks: Briefing['tracks'];
  eventId: string;
}) {
  const [terms, setTerms] = useState(
      initial.map(({ term, definition, trackId }) => ({ term, definition, trackId })),
    ),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const cache = useQueryClient();
  return (
    <SimplePanel>
      <h3>Track-specific glossary</h3>
      <p>
        Terms appear on hover and keyboard focus in submission summaries, rubric descriptions, and
        compare mode.
      </p>
      {terms.map((t, i) => (
        <div key={i} className="grid gap-3 border-b border-line py-3 sm:grid-cols-2">
          <Input
            label="Term"
            value={t.term}
            maxLength={80}
            onChange={(e) =>
              setTerms(terms.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)))
            }
          />
          <label>
            Track
            <select
              className={control}
              value={t.trackId ?? ''}
              onChange={(e) =>
                setTerms(
                  terms.map((x, j) => (j === i ? { ...x, trackId: e.target.value || null } : x)),
                )
              }
            >
              <option value="">All tracks</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <Textarea
            label="Definition"
            value={t.definition}
            maxLength={1500}
            onChange={(e) =>
              setTerms(terms.map((x, j) => (j === i ? { ...x, definition: e.target.value } : x)))
            }
          />
          <Button variant="ghost" onClick={() => setTerms(terms.filter((_, j) => j !== i))}>
            Remove term
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={terms.length >= 100}
          onClick={() => setTerms([...terms, { term: '', definition: '', trackId: null }])}
        >
          Add term
        </Button>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await request('PUT', `/events/${eventId}/judge/glossary`, { terms });
              await cache.invalidateQueries({ queryKey: ['judge-briefing', eventId] });
              setMessage('Glossary saved');
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save glossary
        </Button>
      </div>
      <p role="status">{message}</p>
    </SimplePanel>
  );
}
export function JudgeComparePage() {
  const mine = useOutletContext<MyEvent>(),
    { roundId = '' } = useParams();
  const [left, setLeft] = useState(''),
    [right, setRight] = useState('');
  const q = useQuery({
    queryKey: ['judge-compare-teams', mine.eventId, roundId],
    queryFn: () => judgingApi.judgeTeams(mine.eventId, roundId, ''),
  });
  if (q.isPending) return <Spinner label="Loading assigned teams" />;
  if (q.error) return <Alert tone="error" title={q.error.message} />;
  const teams = q.data.rows.filter((r) => r.assignmentStatus === 'ACTIVE'),
    a = left || teams[0]?.teamId || '',
    b = right || teams[1]?.teamId || '';
  return (
    <div className="space-y-5">
      <h2>Compare assigned teams</h2>
      <JudgeLinks eventId={mine.eventId} />
      <p>
        Read-only comparison of source submissions and your own evaluations. Other judges’ scores
        are never shown.
      </p>
      <div className="grid gap-5 xl:grid-cols-2">
        {[
          { side: 'Left', value: a, set: setLeft },
          { side: 'Right', value: b, set: setRight },
        ].map((s) => (
          <div key={s.side} className="min-w-0 space-y-4">
            <label>
              {s.side} team
              <select className={control} value={s.value} onChange={(e) => s.set(e.target.value)}>
                <option value="">Select team</option>
                {teams.map((t) => (
                  <option key={t.teamId} value={t.teamId}>
                    {t.teamCode} · {t.name}
                  </option>
                ))}
              </select>
            </label>
            {s.value && <ComparePane eventId={mine.eventId} roundId={roundId} teamId={s.value} />}
          </div>
        ))}
      </div>
      {teams.length < 2 && (
        <Alert tone="info" title="Two active assignments are needed for comparison" />
      )}
    </div>
  );
}
function ComparePane({
  eventId,
  roundId,
  teamId,
}: {
  eventId: string;
  roundId: string;
  teamId: string;
}) {
  const q = useQuery({
    queryKey: ['workspace', eventId, roundId, teamId],
    queryFn: () => judgingApi.workspace(eventId, roundId, teamId),
  });
  if (q.isPending) return <Spinner label="Loading team" />;
  if (q.error) return <Alert tone="error" title={q.error.message} />;
  const d: Workspace = q.data;
  return (
    <SimplePanel>
      <h3>{d.team.name}</h3>
      {d.locked ? (
        <Alert tone="info" title={d.locked} />
      ) : (
        <>
          <p>
            <strong>{d.submission?.title ?? 'No submitted project'}</strong>
          </p>
          {d.submission && (
            <>
              <Badge tone="info">Version {d.submission.versionNo}</Badge>
              {d.submission.lateMinutes > 0 && (
                <Badge tone="warning">Late {d.submission.lateMinutes} min</Badge>
              )}
              <p className="whitespace-pre-wrap">
                <GlossaryText text={d.submission.summary} eventId={eventId} track={d.track} />
              </p>
              {d.submission.fields
                .filter((f) => f.file || f.value)
                .map((f) => (
                  <div className="break-words" key={f.id}>
                    <strong>{f.label}: </strong>
                    {f.file ? (
                      <>
                        <a
                          href={`/api/v1/events/${eventId}/files/${f.file.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {f.file.name}
                        </a>
                        {f.file.contentType === 'application/pdf' && (
                          <iframe
                            className="mt-3 h-96 w-full rounded-lg border border-line"
                            title={`${d.team.name} deck`}
                            src={`/api/v1/events/${eventId}/files/${f.file.id}?inline=1`}
                          />
                        )}
                      </>
                    ) : f.type.endsWith('URL') ? (
                      <a href={f.value} target="_blank" rel="noreferrer">
                        {f.value}
                      </a>
                    ) : (
                      f.value
                    )}
                  </div>
                ))}
            </>
          )}
          <h4 className="font-bold">Your evaluation</h4>
          <p>
            {d.evaluation?.status ?? 'Not started'} · {d.evaluation?.weightedScore ?? 'Incomplete'}
          </p>
          {d.rubric?.criteria.map((c) => (
            <p key={c.id}>
              {c.name}: {d.evaluation?.scores[c.id] ?? '—'} / {c.max}
            </p>
          ))}
          <p className="whitespace-pre-wrap">{d.evaluation?.teamComment}</p>
          <Link to={`/events/${eventId}/judge/${roundId}/${teamId}`}>Open scoring workspace</Link>
        </>
      )}
    </SimplePanel>
  );
}
export function JudgePracticePage() {
  const mine = useOutletContext<MyEvent>();
  const q = useQuery({
    queryKey: ['judge-practice', mine.eventId],
    queryFn: () =>
      request<{ title: string; summary: string; readme: string; criteria: RubricCriterionDto[] }>(
        'GET',
        `/events/${mine.eventId}/judge/practice`,
      ),
  });
  if (q.isPending) return <Spinner label="Loading practice team" />;
  if (q.error) return <Alert tone="error" title={q.error.message} />;
  return <Practice key={mine.eventId} data={q.data} eventId={mine.eventId} />;
}
function Practice({
  data,
  eventId,
}: {
  data: { title: string; summary: string; readme: string; criteria: RubricCriterionDto[] };
  eventId: string;
}) {
  const [scores, setScores] = useState<Record<string, number>>({}),
    [note, setNote] = useState(''),
    [feedback, setFeedback] = useState(''),
    [submitted, setSubmitted] = useState(false),
    [star, setStar] = useState(false);
  const complete = validateScores(data.criteria, scores).ok;
  const total = complete ? judgeScoreExact(data.criteria, scores).toFixed(2) : null;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest('input,textarea,select,[contenteditable]') ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      if (/^[0-9]$/.test(e.key) && !submitted) {
        const c = data.criteria.find((c) => scores[c.id] === undefined) ?? data.criteria[0];
        if (c && Number(e.key) >= c.min && Number(e.key) <= c.max) {
          e.preventDefault();
          setScores((s) => ({ ...s, [c.id]: Number(e.key) }));
          document.getElementById(`practice-${c.id}`)?.focus();
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [data.criteria, scores, submitted]);
  return (
    <div className="space-y-5">
      <h2>{data.title}</h2>
      <JudgeLinks eventId={eventId} />
      <Alert tone="info" title="Practice only · no real data changes">
        This fictional submission uses a copy of an active event rubric when available. Notes, stars
        and scores stay in memory and disappear when you leave.
      </Alert>
      <div className="grid gap-5 xl:grid-cols-2">
        <SimplePanel>
          <h3>Fake submission · RiverWatch</h3>
          <Badge tone="info">Demo version 1 · on time</Badge>
          <p>{data.summary}</p>
          <h4 className="font-bold">README highlights</h4>
          <p>{data.readme}</p>
          <p>Demo deck: problem → sensor simulator → dashboard → limitations.</p>
          <Button variant="secondary" aria-pressed={star} onClick={() => setStar(!star)}>
            {star ? '★ Revisit' : '☆ Revisit later'}
          </Button>
          <Textarea
            label="Practice scratchpad"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </SimplePanel>
        <SimplePanel>
          <h3>Practice evaluation</h3>
          {data.criteria.map((c) => (
            <Input
              key={c.id}
              id={`practice-${c.id}`}
              type="number"
              label={`${c.name} (${c.weight}%)`}
              min={c.min}
              max={c.max}
              step={1}
              disabled={submitted}
              hint={c.description}
              value={scores[c.id] ?? ''}
              onChange={(e) =>
                setScores((old) => {
                  const next = { ...old };
                  if (e.target.value === '') delete next[c.id];
                  else next[c.id] = Number(e.target.value);
                  return next;
                })
              }
            />
          ))}
          <Textarea
            label="Practice feedback"
            value={feedback}
            disabled={submitted}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <p>Weighted score: {total ?? 'Complete all criteria'}</p>
          <Button disabled={!complete || submitted} onClick={() => setSubmitted(true)}>
            Submit practice evaluation
          </Button>
          {submitted && <Alert tone="success" title="Practice submitted · no live score saved" />}
          <Button
            variant="secondary"
            onClick={() => {
              setScores({});
              setNote('');
              setFeedback('');
              setStar(false);
              setSubmitted(false);
            }}
          >
            Reset practice
          </Button>
        </SimplePanel>
      </div>
    </div>
  );
}
