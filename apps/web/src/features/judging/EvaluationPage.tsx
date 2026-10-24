import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ExternalLink, FileText, ShieldAlert } from 'lucide-react';
import { judgeScoreExact, validateScores, type MyEvent } from '@arthakram/shared';
import { ApiError } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { judgingApi, type Workspace } from '../../lib/judging.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  Input,
  Markdown,
  Spinner,
  Textarea,
} from '../../ui/index.js';

export function EvaluationPage() {
  const mine = useOutletContext<MyEvent>();
  const { roundId = '', teamId = '' } = useParams();
  const q = useQuery({
    queryKey: ['workspace', mine.eventId, roundId, teamId],
    queryFn: () => judgingApi.workspace(mine.eventId, roundId, teamId),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  if (q.isPending) return <Spinner label="Loading the workspace" />;
  if (q.isError)
    return (
      <Alert tone="error" title="We couldn't open this team">
        It may not be assigned to you.
      </Alert>
    );
  return <Workspace key={teamId} data={q.data} mine={mine} roundId={roundId} />;
}

type Save = 'saved' | 'dirty' | 'saving' | 'failed';

function Workspace({ data, mine, roundId }: { data: Workspace; mine: MyEvent; roundId: string }) {
  const qc = useQueryClient();
  const eventId = mine.eventId;
  const criteria = data.rubric?.criteria ?? [];
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(data.evaluation?.scores ?? {}).map(([k, v]) => [k, String(v)]),
    ),
  );
  const [teamComment, setTeamComment] = useState(data.evaluation?.teamComment ?? '');
  const [privateNote, setPrivateNote] = useState(data.evaluation?.privateNote ?? '');
  const [state, setState] = useState<Save>('saved');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ score: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [conflictReason, setConflictReason] = useState('');
  const [reported, setReported] = useState(false);
  const [correction, setCorrection] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const version = useRef(data.evaluation?.version ?? 0);
  const latest = useRef({ scores, teamComment, privateNote });
  latest.current = { scores, teamComment, privateNote };
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editable = Boolean(data.editable) && !done;
  const base = `/events/${eventId}/judge/${roundId}`;

  const save = useCallback(() => {
    const toPayload = () => ({
      scores: Object.fromEntries(
        criteria.map((c) => [
          c.id,
          latest.current.scores[c.id] === undefined || latest.current.scores[c.id] === ''
            ? null
            : Number(latest.current.scores[c.id]),
        ]),
      ),
      teamComment: latest.current.teamComment,
      privateNote: latest.current.privateNote,
      version: version.current,
    });
    const run = async () => {
      setState('saving');
      try {
        const r = await judgingApi.saveEvaluation(eventId, data.assignmentId, toPayload());
        version.current = r.version;
        setFieldErrors({});
        setState((s) => (s === 'dirty' ? 'dirty' : 'saved'));
      } catch (e) {
        if (e instanceof ApiError && e.status === 422) {
          setFieldErrors(e.fields);
          setState('failed');
        } else if (
          e instanceof ApiError &&
          [
            'stale_version',
            'already_submitted',
            'judging_closed',
            'conflict_declared',
            'not_assigned',
          ].includes(e.code)
        ) {
          setNotice({ tone: 'error', text: e.message });
          setState('failed');
        } else setState('failed');
      }
    };
    chain.current = chain.current.then(run, run);
    return chain.current;
  }, [eventId, data.assignmentId]);

  const touch = () => {
    setState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1500);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state === 'dirty' || state === 'failed') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state]);
  useEffect(() => {
    if (state !== 'failed' || Object.keys(fieldErrors).length) return;
    const t = setTimeout(() => void save(), 6000);
    return () => clearTimeout(t);
  }, [state, fieldErrors, save]);

  const numeric = Object.fromEntries(
    criteria
      .filter((c) => scores[c.id] !== undefined && scores[c.id] !== '')
      .map((c) => [c.id, Number(scores[c.id])]),
  );
  const check = validateScores(criteria, numeric);
  const live = check.ok ? judgeScoreExact(criteria, numeric).toDecimalPlaces(2).toFixed(2) : null;
  const scored = criteria.filter((c) => numeric[c.id] !== undefined).length;

  async function submit() {
    setSubmitting(true);
    setNotice(null);
    try {
      if (timer.current) clearTimeout(timer.current);
      await save();
      const r = await judgingApi.submitEvaluation(eventId, data.assignmentId, version.current);
      setConfirm(false);
      setDone({ score: Number(r.weightedScore).toFixed(2) });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['judge-teams', eventId] }),
        qc.invalidateQueries({ queryKey: ['judge-rounds', eventId] }),
      ]);
    } catch (e) {
      setConfirm(false);
      if (e instanceof ApiError) {
        setFieldErrors(e.fields);
        setNotice({ tone: 'error', text: e.code === 'already_submitted' ? e.message : e.message });
      } else
        setNotice({
          tone: 'error',
          text: 'We could not submit. Check your connection and try again.',
        });
    } finally {
      setSubmitting(false);
    }
  }

  async function declareConflict() {
    try {
      await judgingApi.assignmentAction(eventId, data.assignmentId, 'conflict', {
        reason: conflictReason,
      });
      setConflict(false);
      await qc.invalidateQueries({ queryKey: ['workspace', eventId, roundId, data.team.id] });
      window.location.reload();
    } catch (e) {
      setConflict(false);
      setNotice({ tone: 'error', text: (e as Error).message });
    }
  }
  async function reportMissing(fileName: string) {
    try {
      await judgingApi.reportFile(eventId, roundId, data.team.id, `File: ${fileName}`);
      setReported(true);
      setNotice({ tone: 'success', text: 'The organisers have been told about the file.' });
    } catch (e) {
      setNotice({ tone: 'error', text: (e as Error).message });
    }
  }
  async function requestCorrection() {
    try {
      await judgingApi.evaluationAction(
        eventId,
        data.assignmentId,
        'request-correction',
        correctionReason,
      );
      setCorrection(false);
      setNotice({
        tone: 'success',
        text: 'Correction requested. An organiser will reopen or decline it.',
      });
    } catch (e) {
      setCorrection(false);
      setNotice({ tone: 'error', text: (e as Error).message });
    }
  }

  const ev = data.evaluation;
  const sub = data.submission;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={base} className="text-sm">
            All teams
          </Link>
          <h2 className="mt-1">
            {data.team.name} <Badge tone="info">{data.team.teamCode}</Badge>
          </h2>
        </div>
        <div className="flex gap-2">
          {data.prevTeamId && (
            <Link
              to={`${base}/${data.prevTeamId}`}
              className="inline-flex min-h-11 items-center gap-1 rounded-pill border border-line-strong bg-white px-4 font-bold text-ink no-underline"
            >
              <ArrowLeft aria-hidden className="size-4" /> Previous
            </Link>
          )}
          {data.nextTeamId && (
            <Link
              to={`${base}/${data.nextTeamId}`}
              className="inline-flex min-h-11 items-center gap-1 rounded-pill border border-line-strong bg-white px-4 font-bold text-ink no-underline"
            >
              Next <ArrowRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
      </div>

      {data.locked && (
        <Alert tone="info" title={data.locked}>
          Your assigned team is {data.team.name}. You will see its work and the rubric here once
          judging opens.
        </Alert>
      )}
      {data.assignmentStatus === 'CONFLICT' && (
        <Alert tone="warning" title="You declared a conflict of interest for this team">
          {data.conflictReason}. An organiser will reassign it.
        </Alert>
      )}
      {notice && <Alert tone={notice.tone} title={notice.text} />}
      {ev?.correctionDeclinedReason && (
        <Alert tone="info" title="Your correction request was declined">
          {ev.correctionDeclinedReason}
        </Alert>
      )}

      {!data.locked && (
        <div className="grid gap-4 xl:grid-cols-[1fr_26rem] xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <Card
              footerLabel={`Version ${sub?.versionNo ?? '—'}${sub ? ` · ${formatDateTime(sub.submittedAt, mine.timeZone)}` : ''}`}
            >
              {!sub && (
                <Alert tone="warning" title="This team did not submit">
                  {data.notEditableReason}
                </Alert>
              )}
              {sub && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3>{sub.title}</h3>
                    {sub.lateMinutes > 0 && (
                      <Badge tone="warning">Late by {sub.lateMinutes} min</Badge>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-line">{sub.summary}</p>
                  <dl className="mt-4 grid gap-3">
                    {sub.fields
                      .filter((f) => f.value || f.file)
                      .map((f) => (
                        <div key={f.id}>
                          <dt className="text-xs font-bold uppercase tracking-eyebrow text-ink">
                            {f.label}
                          </dt>
                          <dd className="break-words">
                            {f.file ? (
                              <a href={`/api/v1/events/${eventId}/files/${f.file.id}`}>
                                <FileText aria-hidden className="mr-1 inline size-4" />
                                {f.file.name}
                              </a>
                            ) : f.type.endsWith('URL') ? (
                              <a href={f.value} target="_blank" rel="noopener noreferrer">
                                {f.value} <ExternalLink aria-hidden className="inline size-3.5" />
                              </a>
                            ) : (
                              f.value
                            )}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </>
              )}
            </Card>
            {sub?.fields
              .filter((f) => f.file?.contentType === 'application/pdf')
              .map((f) => (
                <Card key={f.id} footerLabel={`${f.label}: ${f.file!.name}`}>
                  <iframe
                    title={`${f.label}: ${f.file!.name}`}
                    src={`/api/v1/events/${eventId}/files/${f.file!.id}?inline=1#toolbar=0`}
                    className="h-[34rem] w-full rounded-card border border-line bg-white"
                  />
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    The file did not load?{' '}
                    <a href={`/api/v1/events/${eventId}/files/${f.file!.id}`}>Download it</a>
                    <Button
                      variant="ghost"
                      onClick={() => void reportMissing(f.file!.name)}
                      disabled={reported}
                    >
                      {reported ? 'Reported to the organisers' : 'Report a missing file'}
                    </Button>
                  </p>
                </Card>
              ))}
            <Card footerLabel="About the team">
              <p>
                <strong>Members:</strong>{' '}
                {data.members?.map((m) => `${m.name} (${m.institution})`).join(', ')}
              </p>
              {data.track && (
                <p className="mt-1">
                  <strong>Track:</strong> {data.track}
                </p>
              )}
              {data.problem && (
                <details className="mt-2">
                  <summary className="cursor-pointer font-bold text-ink">
                    Problem statement: {data.problem.title}
                  </summary>
                  <Markdown source={data.problem.description} className="mt-2" />
                </details>
              )}
            </Card>
          </div>

          <div className="flex flex-col gap-4 xl:sticky xl:top-4">
            <Card
              footerLabel={
                editable
                  ? state === 'saved'
                    ? 'All changes saved'
                    : state === 'failed'
                      ? 'Not saved. Retrying'
                      : 'Saving…'
                  : 'Scoring'
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3>Your evaluation</h3>
                {ev && (
                  <Badge tone={ev.status === 'SUBMITTED' ? 'success' : 'warning'}>
                    {ev.status === 'SUBMITTED'
                      ? 'Submitted'
                      : ev.status === 'REOPENED'
                        ? 'Reopened'
                        : 'Draft'}
                  </Badge>
                )}
              </div>
              {!editable && !done && data.notEditableReason && (
                <Alert className="mt-3" tone="info" title={data.notEditableReason} />
              )}
              {done && (
                <Alert
                  className="mt-3"
                  tone="success"
                  title={`Submitted. Weighted score ${done.score}`}
                >
                  {data.nextTeamId ? (
                    <Link to={`${base}/${data.nextTeamId}`}>Next team</Link>
                  ) : (
                    <Link to={base}>Back to your teams</Link>
                  )}
                </Alert>
              )}
              <ul className="mt-3 flex flex-col gap-4">
                {criteria.map((c) => {
                  const err = fieldErrors[c.id];
                  return (
                    <li key={c.id}>
                      <Input
                        id={`score-${c.id}`}
                        type="number"
                        inputMode="numeric"
                        step={1}
                        min={c.min}
                        max={c.max}
                        disabled={!editable}
                        label={`${c.name} (${c.weight}%)`}
                        hint={`${c.description ? `${c.description} ` : ''}Whole number ${c.min} to ${c.max}.`}
                        value={scores[c.id] ?? ''}
                        error={err}
                        onChange={(e) => {
                          setScores((s) => ({ ...s, [c.id]: e.target.value }));
                          touch();
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-lg font-bold text-ink" role="status" aria-live="polite">
                {live
                  ? `Weighted score: ${live} / 100`
                  : `Weighted score appears when all ${criteria.length} criteria are scored (${scored} of ${criteria.length})`}
              </p>
              {data.rubric?.teamCommentMode !== 'OFF' && (
                <div className="mt-3">
                  <Textarea
                    id="teamComment"
                    label={`Feedback for the team${data.rubric?.teamCommentMode === 'REQUIRED' ? '' : ' (optional)'}`}
                    required={data.rubric?.teamCommentMode === 'REQUIRED'}
                    disabled={!editable}
                    value={teamComment}
                    maxLength={2000}
                    error={fieldErrors.teamComment}
                    onChange={(e) => {
                      setTeamComment(e.target.value);
                      touch();
                    }}
                    hint="May be shared with the team after the organisers release it, without your name."
                  />
                </div>
              )}
              <div className="mt-3">
                <Textarea
                  label="Private note to organisers (optional)"
                  disabled={!editable}
                  value={privateNote}
                  maxLength={2000}
                  onChange={(e) => {
                    setPrivateNote(e.target.value);
                    touch();
                  }}
                  hint="Never shared with teams."
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                {editable && (
                  <Button onClick={() => setConfirm(true)} disabled={!live} loading={submitting}>
                    Submit evaluation
                  </Button>
                )}
                {editable &&
                  data.assignmentStatus === 'ACTIVE' &&
                  !ev?.status.includes('SUBMITTED') && (
                    <Button
                      variant="ghost"
                      icon={<ShieldAlert aria-hidden className="size-4" />}
                      onClick={() => setConflict(true)}
                    >
                      I have a conflict of interest
                    </Button>
                  )}
                {(ev?.status === 'SUBMITTED' || done) && !ev?.correctionRequested && (
                  <Button variant="secondary" onClick={() => setCorrection(true)}>
                    Request a correction
                  </Button>
                )}
              </div>
              {ev?.correctionRequested && (
                <p className="mt-2 text-sm">
                  Correction requested: “{ev.correctionReason}”. Waiting for an organiser.
                </p>
              )}
            </Card>
          </div>
        </div>
      )}

      <Dialog
        open={confirm}
        title={`Submit evaluation for ${data.team.name}?`}
        onClose={() => setConfirm(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Keep editing
            </Button>
            <Button onClick={() => void submit()} loading={submitting}>
              Submit evaluation
            </Button>
          </>
        }
      >
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {criteria.map((c) => (
            <li key={c.id}>
              {c.name}: <strong>{scores[c.id]}</strong> / {c.max}
            </li>
          ))}
        </ul>
        <p>
          Weighted score <strong>{live}</strong>. You can't edit it after submitting; you can ask an
          organiser to reopen it.
        </p>
      </Dialog>
      <Dialog
        open={conflict}
        title="Declare a conflict of interest"
        onClose={() => setConflict(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConflict(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={conflictReason.trim().length < 10}
              onClick={() => void declareConflict()}
            >
              Declare conflict
            </Button>
          </>
        }
      >
        <p>Scoring is disabled for this team and organisers are told so they can reassign it.</p>
        <div className="mt-3">
          <Textarea
            label="Reason (at least 10 characters)"
            value={conflictReason}
            onChange={(e) => setConflictReason(e.target.value)}
          />
        </div>
      </Dialog>
      <Dialog
        open={correction}
        title="Request a correction"
        onClose={() => setCorrection(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setCorrection(false)}>
              Cancel
            </Button>
            <Button
              disabled={correctionReason.trim().length < 3}
              onClick={() => void requestCorrection()}
            >
              Send request
            </Button>
          </>
        }
      >
        <Textarea
          label="What needs correcting?"
          value={correctionReason}
          onChange={(e) => setCorrectionReason(e.target.value)}
          hint="An organiser decides. You cannot change a submitted evaluation yourself."
        />
      </Dialog>
    </div>
  );
}
