import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Download, Upload } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { SUMMARY_MAX, TITLE_MAX } from '@arthakram/shared';
import { ApiError } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import {
  participantApi,
  uploadSubmissionFile,
  type SubmissionView,
} from '../../lib/participant.js';
import { useUnsavedGuard } from '../../lib/useUnsavedGuard.js';
import { DeadlineLines } from './Deadline.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Countdown,
  Dialog,
  FormErrorSummary,
  Input,
  Spinner,
  Textarea,
} from '../../ui/index.js';

const tone = {
  NOT_STARTED: 'info',
  DRAFT: 'warning',
  SUBMITTED: 'success',
  SUBMITTED_LATE: 'warning',
  LOCKED: 'success',
  NOT_SUBMITTED: 'error',
} as const;

export function SubmissionPage() {
  const mine = useOutletContext<MyEvent>();
  const { roundId = '' } = useParams();
  const q = useQuery({
    queryKey: ['submission', mine.eventId, roundId],
    queryFn: () => participantApi.submission(mine.eventId, roundId),
    retry: false,
    staleTime: 0,
  });
  if (q.isPending) return <Spinner label="Loading your submission" />;
  if (q.isError) {
    const msg =
      q.error instanceof ApiError && q.error.code === 'no_team'
        ? 'Create or join a team first, then come back to start your submission.'
        : 'We could not load this submission.';
    return (
      <Alert tone="info" title="Submission">
        {msg}
      </Alert>
    );
  }
  return <SubmissionForm key={roundId} initial={q.data} mine={mine} roundId={roundId} />;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'failed';

/** Re-renders every 30 seconds so time-based copy (deadline passed or not) stays current. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * The team's extension, if any. Participants are not sent `extensionDeadline`, but the server's
 * cutoff is the extension when one exists, otherwise deadline + grace.
 */
export function extensionOf(view: SubmissionView): string | null {
  if (view.extensionDeadline !== undefined) return view.extensionDeadline;
  const d = view.round.submissionDeadline;
  if (!view.cutoff || !d) return null;
  const normal = +new Date(d) + view.round.graceMinutes * 60000;
  return +new Date(view.cutoff) === normal ? null : view.cutoff;
}

function SubmissionForm({
  initial,
  mine,
  roundId,
}: {
  initial: SubmissionView;
  mine: MyEvent;
  roundId: string;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState(initial);
  const [title, setTitle] = useState(initial.draft.title);
  const [summary, setSummary] = useState(initial.draft.summary);
  const [values, setValues] = useState<Record<string, string>>(initial.draft.values);
  const [state, setState] = useState<SaveState>('saved');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    tone: 'error' | 'success' | 'warning';
    text: string;
  } | null>(null);
  /** Why the last save failed when it was not a field problem (server message), for the status line. */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploads, setUploads] = useState<
    Record<string, { progress: number; error?: string; name?: string }>
  >({});
  const version = useRef(initial.draft.version);
  const latest = useRef({ title, summary, values });
  latest.current = { title, summary, values };
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tz = mine.timeZone;
  const blockedReason = view.blockedReason ?? null;
  const editable = view.editable && !blockedReason;
  const eventId = mine.eventId;
  const now = useNow();

  const reload = useCallback(async () => {
    const fresh = await participantApi.submission(eventId, roundId);
    setView(fresh);
    setTitle(fresh.draft.title);
    setSummary(fresh.draft.summary);
    setValues(fresh.draft.values);
    version.current = fresh.draft.version;
    setState('saved');
    setFieldErrors({});
    setSaveError(null);
    await qc.invalidateQueries({ queryKey: ['submission', eventId, roundId] });
  }, [eventId, roundId, qc]);

  /** Saves run one at a time so our own quick edits never trip the optimistic lock. */
  const save = useCallback(() => {
    const run = async () => {
      setState('saving');
      try {
        const r = await participantApi.saveDraft(eventId, roundId, {
          ...latest.current,
          version: version.current,
        });
        version.current = r.version;
        setFieldErrors({});
        setSaveError(null);
        setState((s) => (s === 'dirty' ? 'dirty' : 'saved'));
      } catch (e) {
        if (e instanceof ApiError && e.status === 422) {
          setFieldErrors(e.fields);
          setSaveError(null);
          setState('failed');
        } else if (e instanceof ApiError && e.code === 'stale_version') {
          setNotice({ tone: 'error', text: e.message });
          setSaveError(e.message);
          setState('failed');
        } else if (e instanceof ApiError && e.code === 'deadline_passed') {
          setNotice({ tone: 'error', text: e.message });
          setSaveError(e.message);
          setView((v) => ({ ...v, editable: false }));
          setState('failed');
        } else if (e instanceof ApiError && e.status === 403) {
          // Eligibility (screening, shortlist): the server says why; it is not a connection problem.
          setNotice({ tone: 'error', text: e.message });
          setSaveError(e.message);
          setState('failed');
        } else {
          setSaveError(null);
          setState('failed');
        }
      }
    };
    chain.current = chain.current.then(run, run);
    return chain.current;
  }, [eventId, roundId]);

  const touch = () => {
    if (!editable) return;
    setState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1200);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  // Never lose an edit on in-app navigation (audit P0-07): save now instead of waiting for the timer.
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return save();
  }, [save]);
  const guard = useUnsavedGuard({ dirty: editable && state !== 'saved', flush });
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state === 'dirty' || state === 'failed') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state]);

  async function pickFile(fieldId: string, file: File) {
    setUploads((u) => ({ ...u, [fieldId]: { progress: 0, name: file.name } }));
    await chain.current; // wait for any save in flight so the version we upload against is current
    try {
      const r = await uploadSubmissionFile(
        `/api/v1/events/${eventId}/rounds/${roundId}/submission/files/${fieldId}`,
        file,
        (p) => setUploads((u) => ({ ...u, [fieldId]: { progress: p, name: file.name } })),
      );
      version.current = r.version;
      setValues((v) => ({ ...v, [fieldId]: r.file.id }));
      setView((v) => ({
        ...v,
        files: [
          ...v.files,
          {
            id: r.file.id,
            fieldId,
            name: r.file.name,
            size: r.file.size,
            uploadedAt: new Date().toISOString(),
          },
        ],
      }));
      setUploads((u) => {
        const n = { ...u };
        delete n[fieldId];
        return n;
      });
      setFieldErrors((e) => {
        const n = { ...e };
        delete n[`values.${fieldId}`];
        return n;
      });
    } catch (e) {
      setUploads((u) => ({
        ...u,
        [fieldId]: { progress: 0, name: file.name, error: (e as Error).message },
      }));
    }
  }

  async function submit() {
    setSubmitting(true);
    setNotice(null);
    try {
      if (timer.current) clearTimeout(timer.current);
      await save();
      const r = await participantApi.submit(eventId, roundId, version.current);
      setConfirm(false);
      setNotice({
        tone: 'success',
        text: `Submitted version ${r.versionNo}${r.lateMinutes ? `, ${r.lateMinutes} min late` : ''}. A receipt is on its way to every teammate.`,
      });
      await reload();
    } catch (e) {
      setConfirm(false);
      if (e instanceof ApiError) {
        setFieldErrors(e.fields);
        setNotice({ tone: 'error', text: e.message });
      } else
        setNotice({
          tone: 'error',
          text: 'We could not submit. Check your connection and try again.',
        });
    } finally {
      setSubmitting(false);
    }
  }

  async function discard() {
    setDiscarding(true);
    const hadPendingSave = timer.current !== null;
    try {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      await chain.current; // let any save in flight land first so the discard is the last word
      await participantApi.discardDraft(eventId, roundId);
      setDiscardOpen(false);
      await reload();
    } catch (e) {
      setDiscardOpen(false);
      if (hadPendingSave) void save(); // nothing was discarded, so keep the edits that were waiting
      setNotice({
        tone: 'error',
        text:
          e instanceof ApiError
            ? e.message
            : 'We could not discard your changes. Check your connection and try again.',
      });
    } finally {
      setDiscarding(false);
    }
  }

  const last = view.versions[0];
  const changed = Boolean(
    last &&
    (title !== last.title ||
      summary !== last.summary ||
      JSON.stringify(values) !== JSON.stringify(last.values)),
  );
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const stateText = {
    saved: 'All changes saved',
    dirty: 'Saving…',
    saving: 'Saving…',
    failed: hasFieldErrors
      ? 'Not saved – fix the highlighted fields'
      : saveError
        ? `Not saved – ${saveError}`
        : 'Not saved – check your connection. Your changes stay in this tab.',
  }[state];
  const retryable = state === 'failed' && !hasFieldErrors && !saveError;
  // The cutoff is deadline + grace (or the team's extension): after it, work is late or closed.
  const cutoff = view.cutoff ?? view.round.submissionDeadline;
  const pastCutoff = Boolean(cutoff && now > +new Date(cutoff));
  const submittingLate = editable && pastCutoff && view.round.latePolicy === 'ACCEPT_AND_FLAG';
  const extension = extensionOf(view);

  return (
    <div className="flex flex-col gap-4">
      {blockedReason && (
        <Alert tone="warning" title="Your team cannot submit in this round">
          {blockedReason} Your saved draft is shown below, read-only.
        </Alert>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2>{view.round.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={tone[view.status]}>{view.statusLabel}</Badge>
            {editable && cutoff && !pastCutoff && (
              <span>
                Time left to submit on time:{' '}
                <Countdown until={cutoff} className="font-semibold text-ink" />
              </span>
            )}
            {editable && pastCutoff && (
              <span className="inline-flex items-center gap-1 font-semibold text-ink">
                <Clock aria-hidden className="size-4" />
                {submittingLate
                  ? 'Deadline passed: submissions are now marked late'
                  : 'Deadline passed: submissions are closed'}
              </span>
            )}
          </p>
          <div className="mt-2">
            <DeadlineLines
              compact
              deadline={view.round.submissionDeadline}
              graceMinutes={view.round.graceMinutes}
              extensionDeadline={extension}
              timeZone={tz}
            />
          </div>
        </div>
        <p role="status" aria-live="polite" className="text-sm">
          {editable ? stateText : ''}
        </p>
      </div>

      <Card footerLabel="Rules for this round">
        <ul className="list-disc pl-5 text-sm">
          <li>
            Team {view.team.name} ({view.team.teamCode}) needs at least {view.team.min} members to
            submit. {view.team.complete ? 'Your team is complete.' : `You have ${view.team.size}.`}
          </li>
          <li>
            {view.round.latePolicy === 'REJECT'
              ? `Submissions after the ${view.round.graceMinutes > 0 ? 'grace period' : 'deadline'} are not accepted.`
              : `Submissions after the ${view.round.graceMinutes > 0 ? 'grace period' : 'deadline'} are accepted and marked late.`}
          </li>
          <li>Drafts are never submitted for you. Press Submit before the deadline.</li>
        </ul>
      </Card>

      {!editable && view.closedReason && !blockedReason && (
        <Alert tone="warning" title={view.closedReason} />
      )}
      {changed ? (
        <Alert
          tone="info"
          title={`You have unsubmitted changes. Your last submitted version (v${last?.versionNo}) will be judged unless you resubmit.`}
        >
          {editable && (
            <Button className="mt-2" variant="secondary" onClick={() => setDiscardOpen(true)}>
              Discard changes
            </Button>
          )}
        </Alert>
      ) : null}
      {notice && (
        <Alert tone={notice.tone} title={notice.text}>
          {notice.tone === 'error' && notice.text.includes('Reload') && (
            <Button className="mt-2" variant="secondary" onClick={() => void reload()}>
              Reload latest
            </Button>
          )}
        </Alert>
      )}
      <FormErrorSummary
        issues={Object.entries(fieldErrors).map(([k, message]) => ({
          fieldId:
            k === 'title'
              ? 'sb-title'
              : k === 'summary'
                ? 'sb-summary'
                : `sb-${k.replace('values.', '')}`,
          message,
        }))}
      />

      <Card footerLabel="Your submission">
        <div className="flex flex-col gap-4">
          <Input
            id="sb-title"
            label="Project title"
            required
            maxLength={TITLE_MAX}
            disabled={!editable}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              touch();
            }}
            error={fieldErrors.title}
          />
          <Textarea
            id="sb-summary"
            label="Summary"
            required
            maxLength={SUMMARY_MAX}
            disabled={!editable}
            hint={`${summary.length} of ${SUMMARY_MAX} characters`}
            value={summary}
            onChange={(e) => {
              setSummary(e.target.value);
              touch();
            }}
            error={fieldErrors.summary}
          />
          {view.fields.map((f) => {
            const err = fieldErrors[`values.${f.id}`];
            if (f.type === 'FILE') {
              const fileId = values[f.id];
              const file = view.files.find((x) => x.id === fileId);
              const up = uploads[f.id];
              return (
                <div key={f.id} id={`sb-${f.id}`} className="flex flex-col gap-2">
                  <p className="text-sm font-semibold text-ink">
                    {f.label}
                    {f.required && <span aria-hidden> *</span>}
                  </p>
                  {f.helpText && <p className="text-sm">{f.helpText}</p>}
                  <div className="flex flex-wrap items-center gap-3">
                    <label
                      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border border-line-strong bg-white px-4 py-2 font-bold text-ink hover:bg-blush ${!editable ? 'pointer-events-none opacity-60' : ''}`}
                    >
                      <Upload aria-hidden className="size-4" />{' '}
                      {file ? 'Replace file' : 'Choose file'}
                      <input
                        type="file"
                        className="sr-only"
                        disabled={!editable}
                        accept={f.allowedExtensions.map((e) => `.${e}`).join(',')}
                        onChange={(e) => {
                          const x = e.target.files?.[0];
                          if (x) void pickFile(f.id, x);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {file && !up && (
                      <a
                        href={`/api/v1/events/${eventId}/files/${file.id}`}
                        className="inline-flex items-center gap-1"
                      >
                        <Download aria-hidden className="size-4" /> {file.name} (
                        {(file.size / 1048576).toFixed(1)} MB)
                      </a>
                    )}
                    <span className="text-sm">
                      {f.allowedExtensions.map((e) => e.toUpperCase()).join(', ')} up to {f.maxMb}{' '}
                      MB
                    </span>
                  </div>
                  {up && !up.error && (
                    <progress
                      className="w-full max-w-sm accent-ember"
                      value={up.progress}
                      max={1}
                      aria-label={`Uploading ${up.name}`}
                    />
                  )}
                  {up?.error && (
                    <Alert tone="error" title={up.error}>
                      <span className="text-sm">
                        Other answers are saved. Choose the file again to retry.
                      </span>
                    </Alert>
                  )}
                  {err && !up?.error && (
                    <p className="text-sm font-semibold text-error-fg">{err}</p>
                  )}
                </div>
              );
            }
            const common = {
              id: `sb-${f.id}`,
              label: f.label,
              required: f.required,
              hint: f.helpText ?? undefined,
              disabled: !editable,
              value: values[f.id] ?? '',
              error: err,
            };
            const change = (v: string) => {
              setValues((x) => ({ ...x, [f.id]: v }));
              touch();
            };
            return f.type === 'LONG_TEXT' ? (
              <Textarea key={f.id} {...common} onChange={(e) => change(e.target.value)} />
            ) : (
              <Input
                key={f.id}
                {...common}
                type={f.type === 'SHORT_TEXT' ? 'text' : 'url'}
                onChange={(e) => change(e.target.value)}
              />
            );
          })}
          {editable && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => setConfirm(true)}
                  loading={submitting}
                  disabled={Object.values(uploads).some((u) => !u.error)}
                >
                  {view.versions.length ? 'Resubmit' : 'Submit'}
                </Button>
                <span className="text-sm font-semibold text-ink">{stateText}</span>
                {retryable && (
                  <Button variant="ghost" onClick={() => void flush()}>
                    Try again
                  </Button>
                )}
              </div>
              <p className="text-sm">
                {submittingLate
                  ? 'The deadline has passed. Anything you submit now is recorded as late.'
                  : view.versions.length
                    ? `Submitting creates version ${view.versions[0]!.versionNo + 1}.`
                    : 'You can keep editing and resubmit until the deadline.'}
              </p>
            </div>
          )}
          {blockedReason && (
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled aria-describedby="sb-blocked-reason">
                Submit
              </Button>
              <span id="sb-blocked-reason" className="text-sm">
                {blockedReason}
              </span>
            </div>
          )}
        </div>
      </Card>

      {view.versions.length > 0 && (
        <Card footerLabel="Submitted versions">
          <ul className="divide-y divide-line">
            {view.versions.map((v, i) => (
              <li key={v.versionNo} className="py-3 first:pt-0 last:pb-0">
                <p className="font-bold text-ink">
                  Version {v.versionNo}
                  {i === 0 && (
                    <>
                      {' '}
                      <Badge tone="success">Current version (the one judges see)</Badge>
                    </>
                  )}
                  {v.lateMinutes > 0 && (
                    <>
                      {' '}
                      <Badge tone="warning">{v.lateMinutes} min late</Badge>
                    </>
                  )}
                </p>
                <p className="text-sm">
                  Submitted {formatDateTime(v.submittedAt, tz)} by {v.submittedBy}. “{v.title}”
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog
        open={confirm}
        title={view.versions.length ? 'Resubmit your project?' : 'Submit your project?'}
        onClose={() => setConfirm(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Keep editing
            </Button>
            <Button onClick={() => void submit()} loading={submitting}>
              {view.versions.length ? 'Resubmit' : 'Submit'}
            </Button>
          </>
        }
      >
        {submittingLate ? (
          <p>
            The deadline has passed, so this version will be <strong>recorded as late</strong>. The
            submitted version is read-only and is the one judges will see.
          </p>
        ) : (
          <p>
            The submitted version is read-only and is the one judges will see. You can resubmit
            until the deadline.
          </p>
        )}
      </Dialog>
      <Dialog
        open={discardOpen}
        title="Discard your unsubmitted changes?"
        onClose={() => {
          if (!discarding) setDiscardOpen(false);
        }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDiscardOpen(false)} disabled={discarding}>
              Keep my changes
            </Button>
            <Button variant="danger" onClick={() => void discard()} loading={discarding}>
              Discard changes
            </Button>
          </>
        }
      >
        <p>
          {last
            ? `This removes all unsubmitted changes by your team and goes back to version ${last.versionNo}.`
            : 'This removes all unsubmitted changes by your team and goes back to an empty draft.'}{' '}
          This cannot be undone.
        </p>
      </Dialog>
      {guard.dialog}
    </div>
  );
}
