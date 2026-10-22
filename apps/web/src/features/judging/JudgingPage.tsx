import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyEvent } from '@arthakram/shared';
import { eventApi } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import { judgingApi, type JudgingOverview, type OverviewAssignment } from '../../lib/judging.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
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

const statusTone = { NOT_OPEN: 'info', OPEN: 'success', CLOSED: 'warning' } as const;
const statusLabel = {
  NOT_OPEN: 'Judging not open',
  OPEN: 'Judging open',
  CLOSED: 'Judging closed',
} as const;
const evalLabel = (a: OverviewAssignment) =>
  a.status === 'CONFLICT'
    ? 'Conflict'
    : a.status === 'EXCLUDED'
      ? 'Excluded'
      : a.status === 'UNASSIGNED'
        ? 'Unassigned (kept)'
        : !a.evaluation
          ? 'Not started'
          : a.evaluation.status === 'SUBMITTED'
            ? 'Submitted'
            : a.evaluation.status === 'REOPENED'
              ? 'Reopened'
              : 'Draft';
const evalTone = (a: OverviewAssignment) =>
  (a.status === 'CONFLICT'
    ? 'error'
    : a.status !== 'ACTIVE'
      ? 'warning'
      : a.evaluation?.status === 'SUBMITTED'
        ? 'success'
        : a.evaluation
          ? 'warning'
          : 'info') as 'error' | 'warning' | 'success' | 'info';

/** Judging control room: status, assignments, per-judge progress, missing evaluations and corrections (PRD FR-026..031). */
export function JudgingPage() {
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
        <h2>Judging</h2>
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
      <JudgingRound key={rid} mine={mine} roundId={rid} />
    </div>
  );
}

function JudgingRound({ mine, roundId }: { mine: MyEvent; roundId: string }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const eventId = mine.eventId;
  const q = useQuery({
    queryKey: ['judging', eventId, roundId],
    queryFn: () => judgingApi.overview(eventId, roundId),
  });
  const [selJudges, setSelJudges] = useState<string[]>([]);
  const [selTeams, setSelTeams] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [confirmUnassign, setConfirmUnassign] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<{
    id: string;
    action: 'exclude' | 'conflict/override' | 'evaluation/reopen' | 'evaluation/decline-correction';
    title: string;
  } | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['judging', eventId, roundId] }),
      qc.invalidateQueries({ queryKey: ['evaluations', eventId, roundId] }),
    ]);
  const fail = (e: unknown) => errors.capture(e);

  const setStatus = useMutation({
    mutationFn: (s: string) => judgingApi.setStatus(eventId, roundId, s),
    onSuccess: async () => {
      errors.clear();
      await refresh();
    },
    onError: fail,
  });
  const assign = useMutation({
    mutationFn: () =>
      judgingApi.assign(eventId, roundId, { judgeMembershipIds: selJudges, teamIds: selTeams }),
    onSuccess: async (r) => {
      errors.clear();
      setResult(
        `${r.created} assigned, ${r.restored} restored, ${r.alreadyAssigned} already assigned${r.skippedDisqualified.length ? `. Skipped disqualified teams: ${r.skippedDisqualified.join(', ')}` : ''}.`,
      );
      await refresh();
    },
    onError: fail,
  });
  const balance = useMutation({
    mutationFn: () => judgingApi.autoBalance(eventId, roundId, selJudges),
    onSuccess: async (r) => {
      errors.clear();
      setResult(`Balanced: ${r.created} new assignments.`);
      await refresh();
    },
    onError: fail,
  });
  const unassign = useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: boolean }) =>
      judgingApi.unassign(eventId, id, confirm),
    onSuccess: async () => {
      setConfirmUnassign(null);
      errors.clear();
      await refresh();
    },
    onError: (e, v) => {
      if ((e as { code?: string }).code === 'confirm_required') setConfirmUnassign(v.id);
      else fail(e);
    },
  });
  const withReason = useMutation({
    mutationFn: () =>
      judgingApi.assignmentAction(eventId, reasonFor!.id, reasonFor!.action, { reason }),
    onSuccess: async () => {
      setReasonFor(null);
      setReason('');
      errors.clear();
      await refresh();
    },
    onError: (e) => {
      setReasonFor(null);
      fail(e);
    },
  });
  const restore = useMutation({
    mutationFn: (id: string) => judgingApi.assignmentAction(eventId, id, 'restore'),
    onSuccess: refresh,
    onError: fail,
  });

  if (q.isPending) return <Spinner label="Loading judging" />;
  if (q.isError) return <Alert tone="error" title="We couldn't load judging for this round" />;
  const o: JudgingOverview = q.data;
  const toggle = (list: string[], id: string, set: (v: string[]) => void) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const corrections = o.teams.flatMap((t) =>
    t.assignments.filter((a) => a.evaluation?.correctionRequested).map((a) => ({ team: t, a })),
  );

  return (
    <div className="flex flex-col gap-6">
      {errors.formError && <Alert tone="error" title={errors.formError} />}
      <Card footerLabel="Round status">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={statusTone[o.round.judgingStatus]}>
            {statusLabel[o.round.judgingStatus]}
          </Badge>
          <span className="text-sm">
            {o.round.requiredEvaluations} evaluations required per team
            {o.round.judgingDeadline
              ? ` · judging deadline ${formatDateTime(o.round.judgingDeadline, mine.timeZone)}`
              : ''}
          </span>
        </div>
        {!o.rubric && (
          <Alert className="mt-3" tone="warning" title="No rubric yet">
            <Link to="../rubric">Create the rubric</Link> before opening judging.
          </Alert>
        )}
        {o.rubric?.state === 'DRAFT' && (
          <Alert className="mt-3" tone="warning" title="The rubric is still a draft">
            <Link to="../rubric">Activate it</Link> to open judging.
          </Alert>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {o.round.judgingStatus !== 'OPEN' && (
            <Button
              onClick={() => setStatus.mutate('OPEN')}
              loading={setStatus.isPending}
              disabled={!o.canOpen}
            >
              {o.round.judgingStatus === 'CLOSED' ? 'Reopen judging' : 'Open judging'}
            </Button>
          )}
          {o.round.judgingStatus === 'OPEN' && (
            <Button variant="secondary" onClick={() => setStatus.mutate('CLOSED')}>
              Close judging
            </Button>
          )}
        </div>
        {!o.canOpen && o.round.judgingStatus !== 'OPEN' && (
          <p className="mt-2 text-sm">
            Judging can open once the rubric is active and the submission deadline (plus grace) has
            passed.
          </p>
        )}
      </Card>

      {corrections.length > 0 && (
        <Card footerLabel="Correction requests">
          <ul className="flex flex-col gap-3">
            {corrections.map(({ team, a }) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <strong>{a.judgeName}</strong> asks to correct their evaluation of {team.teamCode}{' '}
                  {team.name}: “{a.evaluation?.correctionReason}”
                </span>
                <span className="flex gap-2">
                  <Button
                    onClick={() =>
                      setReasonFor({
                        id: a.id,
                        action: 'evaluation/reopen',
                        title: 'Reopen this evaluation?',
                      })
                    }
                  >
                    Reopen
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setReasonFor({
                        id: a.id,
                        action: 'evaluation/decline-correction',
                        title: 'Decline this request?',
                      })
                    }
                  >
                    Decline
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section aria-labelledby="judges-h" className="flex flex-col gap-3">
        <h3 id="judges-h">Judges</h3>
        {o.judges.length === 0 && (
          <EmptyState title="No judges yet">
            Invite judges on the <Link to="../people">People</Link> page.
          </EmptyState>
        )}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {o.judges.map((j) => (
            <li key={j.membershipId} className="rounded-card bg-white p-4 shadow-card">
              <Checkbox
                label={j.name}
                checked={selJudges.includes(j.membershipId)}
                onChange={() => toggle(selJudges, j.membershipId, setSelJudges)}
              />
              <p className="mt-2 text-sm">
                {j.submitted} of {j.assigned} submitted
                {j.drafts ? ` · ${j.drafts} in progress` : ''}
              </p>
              {o.judgesAtRisk.includes(j.membershipId) && (
                <Badge tone="warning">No progress, deadline within an hour</Badge>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="teams-h" className="flex flex-col gap-3">
        <h3 id="teams-h">Teams and assignments</h3>
        <Card>
          <p className="text-sm">
            Tick judges above and teams below, then assign. Or let the system balance the load.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => assign.mutate()}
              loading={assign.isPending}
              disabled={!selJudges.length || !selTeams.length}
            >
              Assign {selJudges.length} judge(s) to {selTeams.length} team(s)
            </Button>
            <Button
              variant="secondary"
              onClick={() => balance.mutate()}
              loading={balance.isPending}
              disabled={selJudges.length < o.round.requiredEvaluations}
            >
              Auto-balance chosen judges
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                setSelTeams(selTeams.length === o.teams.length ? [] : o.teams.map((t) => t.teamId))
              }
            >
              {selTeams.length === o.teams.length ? 'Clear teams' : 'Select all teams'}
            </Button>
          </div>
          {result && <Alert className="mt-3" tone="success" title={result} />}
        </Card>
        {o.teams.length === 0 && (
          <EmptyState title="No teams yet">Teams appear here once they exist.</EmptyState>
        )}
        {o.teams.length > 0 && (
          <Table caption="Teams and their judges">
            <THead>
              <Tr>
                <Th>
                  <span className="sr-only">Select</span>
                </Th>
                <Th>Team</Th>
                <Th>Work</Th>
                <Th>Counted</Th>
                <Th>Judges</Th>
              </Tr>
            </THead>
            <TBody>
              {o.teams.map((t) => (
                <Tr key={t.teamId}>
                  <Td>
                    <input
                      type="checkbox"
                      className="size-5 accent-ember"
                      aria-label={`Select ${t.name}`}
                      checked={selTeams.includes(t.teamId)}
                      onChange={() => toggle(selTeams, t.teamId, setSelTeams)}
                    />
                  </Td>
                  <Td>
                    {t.teamCode} {t.name}{' '}
                    {t.disqualified && <Badge tone="error">Disqualified</Badge>}
                  </Td>
                  <Td>
                    {t.submitted ? (
                      <Badge tone="success">Submitted</Badge>
                    ) : (
                      <Badge tone="warning">Did not submit</Badge>
                    )}
                  </Td>
                  <Td>
                    {t.counted} of {t.required}{' '}
                    {t.complete ? (
                      <Badge tone="success">Complete</Badge>
                    ) : t.submitted ? (
                      <Badge tone="warning">Incomplete</Badge>
                    ) : null}
                  </Td>
                  <Td>
                    <ul className="flex flex-col gap-1">
                      {t.assignments.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center gap-2">
                          <span>{a.judgeName}</span>
                          <Badge tone={evalTone(a)}>{evalLabel(a)}</Badge>
                          {a.status === 'ACTIVE' && (
                            <button
                              type="button"
                              className="text-sm underline"
                              onClick={() =>
                                setReasonFor({
                                  id: a.id,
                                  action: 'exclude',
                                  title: 'Exclude this assignment?',
                                })
                              }
                            >
                              Exclude
                            </button>
                          )}
                          {(a.status === 'EXCLUDED' || a.status === 'UNASSIGNED') && (
                            <button
                              type="button"
                              className="text-sm underline"
                              onClick={() => restore.mutate(a.id)}
                            >
                              Restore
                            </button>
                          )}
                          {a.status === 'CONFLICT' && (
                            <button
                              type="button"
                              className="text-sm underline"
                              onClick={() =>
                                setReasonFor({
                                  id: a.id,
                                  action: 'conflict/override',
                                  title: 'Override the conflict?',
                                })
                              }
                            >
                              Override
                            </button>
                          )}
                          {a.status !== 'UNASSIGNED' && (
                            <button
                              type="button"
                              className="text-sm underline"
                              onClick={() => unassign.mutate({ id: a.id, confirm: false })}
                            >
                              Unassign
                            </button>
                          )}
                          {a.reason && <span className="text-sm">({a.reason})</span>}
                        </li>
                      ))}
                      {t.assignments.length === 0 && (
                        <li className="text-sm">No judges assigned</li>
                      )}
                    </ul>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="missing-h" className="flex flex-col gap-3">
        <h3 id="missing-h">Missing evaluations</h3>
        {o.missing.length === 0 ? (
          <Alert tone="success" title="No team is waiting on evaluations">
            Every team that submitted has all its required counted evaluations.
          </Alert>
        ) : (
          <ul className="flex flex-col gap-2">
            {o.missing.map((m) => (
              <li key={m.teamId} className="rounded-card bg-white p-3 shadow-card">
                <strong>
                  {m.teamCode} {m.name}
                </strong>
                : {m.counted} of {m.required} counted. Needs {m.shortfall} more, by assigning a
                judge or excluding a missing assignment with a reason.
              </li>
            ))}
          </ul>
        )}
      </section>

      <Evaluations eventId={eventId} roundId={roundId} />

      <Dialog
        open={confirmUnassign !== null}
        title="Unassign a judge who already submitted?"
        onClose={() => setConfirmUnassign(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmUnassign(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => unassign.mutate({ id: confirmUnassign!, confirm: true })}
            >
              Unassign
            </Button>
          </>
        }
      >
        <p>
          Their evaluation is kept but no longer counted. Re-assigning the same judge restores it.
          Any approved result for this round becomes invalid.
        </p>
      </Dialog>
      <Dialog
        open={reasonFor !== null}
        title={reasonFor?.title ?? ''}
        onClose={() => setReasonFor(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setReasonFor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => withReason.mutate()}
              loading={withReason.isPending}
              disabled={reason.trim().length < 3}
            >
              Confirm
            </Button>
          </>
        }
      >
        <Input
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Recorded in the audit history."
        />
      </Dialog>
    </div>
  );
}

function Evaluations({ eventId, roundId }: { eventId: string; roundId: string }) {
  const q = useQuery({
    queryKey: ['evaluations', eventId, roundId],
    queryFn: () => judgingApi.evaluations(eventId, roundId),
  });
  if (q.isPending) return null;
  const { criteria, evaluations } = q.data!;
  return (
    <section aria-labelledby="evals-h" className="flex flex-col gap-3">
      <h3 id="evals-h">Evaluations</h3>
      <p className="text-sm">
        Only core admins and the judge who wrote an evaluation can see its scores, comments and
        private notes.
      </p>
      {evaluations.length === 0 && (
        <EmptyState title="No evaluations yet">
          Scores appear here as judges save and submit them.
        </EmptyState>
      )}
      {evaluations.length > 0 && (
        <Table caption="Evaluations">
          <THead>
            <Tr>
              <Th>Team</Th>
              <Th>Judge</Th>
              <Th>Status</Th>
              {criteria.map((c) => (
                <Th key={c.id}>{c.name}</Th>
              ))}
              <Th>Score</Th>
              <Th>Comments</Th>
            </Tr>
          </THead>
          <TBody>
            {evaluations.map((e) => (
              <Tr key={e.assignmentId}>
                <Td>
                  {e.teamCode} {e.teamName}
                </Td>
                <Td>{e.judgeName}</Td>
                <Td>
                  <Badge
                    tone={
                      e.status === 'SUBMITTED'
                        ? e.assignmentStatus === 'ACTIVE'
                          ? 'success'
                          : 'warning'
                        : 'info'
                    }
                  >
                    {e.status === 'SUBMITTED' && e.assignmentStatus !== 'ACTIVE'
                      ? 'Submitted, not counted'
                      : e.status.toLowerCase()}
                  </Badge>
                </Td>
                {criteria.map((c) => (
                  <Td key={c.id}>
                    {e.scores[c.id] ?? '—'} / {c.max}
                  </Td>
                ))}
                <Td>
                  <strong>{e.weightedScore ? Number(e.weightedScore).toFixed(2) : '—'}</strong>
                </Td>
                <Td className="max-w-xs">
                  <span className="block whitespace-pre-line">{e.teamComment}</span>
                  {e.privateNote && (
                    <span className="mt-1 block text-sm">
                      <strong>Private:</strong> {e.privateNote}
                    </span>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}
