import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Download } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { eventApi } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import {
  opsApi,
  type PublishedRound,
  type ResultsReviewDto,
  type ReviewResult,
} from '../../lib/ops.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Select,
  Spinner,
  Table,
  TBody,
  Td,
  THead,
  Th,
  Textarea,
  Tr,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

export function ResultsPage() {
  const mine = useOutletContext<MyEvent>();
  return mine.role === 'ADMIN' ? <AdminResults mine={mine} /> : <PublishedResults mine={mine} />;
}

/** What participants see: only the published snapshot, shaped by the organiser's visibility choices (PRD FR-074, FR-035). */
function PublishedResults({ mine }: { mine: MyEvent }) {
  const q = useQuery({
    queryKey: ['published-results', mine.eventId],
    queryFn: () => opsApi.published(mine.eventId),
  });
  if (q.isPending) return <Spinner label="Loading results" />;
  if (q.data?.rounds.length === 0)
    return (
      <EmptyState title="Results will appear here once published">
        The organisers publish results after judging and review. Scores stay private until then.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-4">
      <h2>Results</h2>
      {q.data?.rounds.map((r) => (
        <PublishedCard key={r.roundId} r={r} tz={mine.timeZone} visibility={q.data!.visibility} />
      ))}
    </div>
  );
}

function PublishedCard({
  r,
  tz,
  visibility,
}: {
  r: PublishedRound;
  tz: string;
  visibility: { winners: boolean; ownRank: boolean; ownScores: boolean };
}) {
  return (
    <Card
      footerLabel={`${r.updated ? 'Updated' : 'Published'} ${formatDateTime(r.publishedAt, tz)}`}
    >
      <h3>{r.roundName}</h3>
      {r.own && (
        <Alert
          className="mt-3"
          tone="info"
          title={
            r.own.ranked
              ? r.own.rank
                ? `${r.own.name} finished in position ${r.own.rank}${r.own.score ? ` with ${Number(r.own.score).toFixed(2)}` : ''}`
                : `${r.own.name} was ranked in this round`
              : r.own.notRanked
                ? `${r.own.name} was not ranked in this round`
                : `${r.own.name} has no result in this round`
          }
        >
          {!visibility.ownRank &&
            r.own.ranked &&
            'The organisers have not chosen to show individual ranks.'}
        </Alert>
      )}
      {r.winners && (
        <ol className="mt-3 flex flex-col gap-2">
          {r.winners.map((w) => (
            <li key={`${w.group}-${w.teamCode}`} className="flex flex-wrap items-center gap-3">
              <Badge>{ordinal(w.rank)}</Badge>
              <strong>{w.name}</strong>
              <span className="text-sm">
                {w.teamCode}
                {r.scope === 'PER_TRACK' ? ` · ${w.group}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
      {!r.winners && !r.own && (
        <p className="mt-2">
          Results for this round are published, but the organisers are not showing a public list.
        </p>
      )}
    </Card>
  );
}
const ordinal = (n: number) =>
  `${n}${['th', 'st', 'nd', 'rd'][((n % 100) >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]}`;

function AdminResults({ mine }: { mine: MyEvent }) {
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
        <h2>Results</h2>
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
      <ReviewRound key={rid} mine={mine} roundId={rid} />
    </div>
  );
}

type Dialogs =
  | { kind: 'tie'; group: string; rank: number; teams: { teamId: string; name: string }[] }
  | { kind: 'notRanked'; teamId: string; name: string }
  | { kind: 'unpublish' }
  | null;

function ReviewRound({ mine, roundId }: { mine: MyEvent; roundId: string }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const ev = mine.eventId;
  const q = useQuery({
    queryKey: ['results-review', ev, roundId],
    queryFn: () => opsApi.review(ev, roundId),
  });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [mode, setMode] = useState<'SHARE' | 'ORDER'>('SHARE');
  const [order, setOrder] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['results-review', ev, roundId] }),
      qc.invalidateQueries({ queryKey: ['published-results', ev] }),
    ]);
  const done = (msg?: string) => async () => {
    errors.clear();
    setNotice(msg ?? null);
    setDialog(null);
    setReason('');
    await refresh();
  };

  const approve = useMutation({
    mutationFn: () => opsApi.approve(ev, roundId),
    onSuccess: (r) => done(`Approved as version ${r.versionNo}. Publish it when you are ready.`)(),
    onError: errors.capture,
  });
  const publish = useMutation({
    mutationFn: () => opsApi.publish(ev, roundId),
    onSuccess: (r) => done(`Version ${r.versionNo} is now visible to participants.`)(),
    onError: errors.capture,
  });
  const unpublish = useMutation({
    mutationFn: () => opsApi.unpublish(ev, roundId, reason),
    onSuccess: done('Results are hidden from participants.'),
    onError: (e) => {
      setDialog(null);
      errors.capture(e);
    },
  });
  const saveTie = useMutation({
    mutationFn: () => {
      const d = dialog as Extract<Dialogs, { kind: 'tie' }>;
      return opsApi.putTie(ev, roundId, {
        group: d.group,
        rank: d.rank,
        teamIds: d.teams.map((t) => t.teamId),
        mode,
        order: mode === 'ORDER' ? order : [],
        reason,
      });
    },
    onSuccess: done('Tie decision saved.'),
    onError: (e) => {
      errors.capture(e);
      setDialog(null);
    },
  });
  const saveNotRanked = useMutation({
    mutationFn: () =>
      opsApi.putNotRanked(ev, roundId, {
        teamId: (dialog as Extract<Dialogs, { kind: 'notRanked' }>).teamId,
        reason,
      }),
    onSuccess: done('Marked as not ranked.'),
    onError: (e) => {
      errors.capture(e);
      setDialog(null);
    },
  });
  const clearTie = useMutation({
    mutationFn: (id: string) => opsApi.deleteTie(ev, roundId, id),
    onSuccess: done(),
    onError: errors.capture,
  });
  const clearMark = useMutation({
    mutationFn: (id: string) => opsApi.deleteNotRanked(ev, roundId, id),
    onSuccess: done(),
    onError: errors.capture,
  });

  if (q.isPending) return <Spinner label="Calculating results" />;
  if (q.isError) return <Alert tone="error" title="We couldn't load the results review" />;
  const r: ResultsReviewDto = q.data;
  const published = r.snapshots.find((s) => s.publishedAt && !s.unpublishedAt);
  const latest = r.snapshots[0];
  const stale =
    latest &&
    latest.status === 'INVALIDATED' &&
    !r.approvedVersion &&
    latest.invalidatedReason &&
    !latest.invalidatedReason.startsWith('Superseded');
  const checks = [
    { ok: r.checklist.hasRubric, label: 'The round has a rubric' },
    {
      ok: r.checklist.judgingClosed,
      label: 'Judging is closed',
      link: <Link to="../judging">Judging page</Link>,
    },
    {
      ok: r.checklist.missing.length === 0,
      label: r.checklist.missing.length
        ? `${r.checklist.missing.length} team(s) lack counted evaluations (${r.checklist.missing.map((m) => m.teamCode).join(', ')})`
        : 'Every team has its counted evaluations, or an excluded assignment with a reason',
    },
    {
      ok: r.checklist.unresolvedTies.length === 0,
      label: r.checklist.unresolvedTies.length
        ? `${r.checklist.unresolvedTies.length} tie(s) inside the ${r.round.awardPositions} award positions need a decision`
        : 'No unresolved ties inside the award positions',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {errors.formError && <Alert tone="error" title={errors.formError} />}
      {notice && <Alert tone="success" title={notice} />}
      {stale && (
        <Alert tone="warning" title="The previous approval was withdrawn">
          {latest?.invalidatedReason}.{' '}
          {published
            ? `Participants still see version ${published.versionNo} until you approve and publish a corrected version.`
            : ''}
        </Alert>
      )}

      <Card footerLabel="Approval checklist">
        <ul className="flex flex-col gap-2">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2">
              {c.ok ? (
                <CheckCircle2
                  aria-label="Done"
                  className="mt-0.5 size-5 shrink-0 text-success-fg"
                />
              ) : (
                <Circle aria-label="Not done" className="mt-0.5 size-5 shrink-0" />
              )}
              <span>
                {c.label} {!c.ok && c.link}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            onClick={() => approve.mutate()}
            loading={approve.isPending}
            disabled={!r.canApprove}
          >
            {r.approvedVersion ? 'Approve again as a new version' : 'Approve results'}
          </Button>
          {r.approvedVersion && <Badge tone="success">Version {r.approvedVersion} approved</Badge>}
          {r.approvedVersion && !(published && published.versionNo === r.approvedVersion) && (
            <Button
              variant="secondary"
              onClick={() => publish.mutate()}
              loading={publish.isPending}
            >
              Publish version {r.approvedVersion}
            </Button>
          )}
          {published && (
            <>
              <Badge tone="success">Version {published.versionNo} is published</Badge>
              <Button variant="ghost" onClick={() => setDialog({ kind: 'unpublish' })}>
                Unpublish
              </Button>
            </>
          )}
          {latest && (
            <a
              href={`/api/v1/events/${ev}/rounds/${roundId}/results/export.csv`}
              className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-strong bg-white px-4 font-bold text-ink no-underline hover:bg-blush"
            >
              <Download aria-hidden className="size-4" /> Export CSV
            </a>
          )}
        </div>
        <p className="mt-3 text-sm">
          Approval creates an unchangeable snapshot. If an evaluation, assignment, disqualification
          or decision changes afterwards the approval is withdrawn and you review again.
          Participants see nothing until you publish.
        </p>
      </Card>

      {r.results.length === 0 && (
        <EmptyState title="Nothing to rank yet">
          Results appear once teams submit and judges score them.
        </EmptyState>
      )}
      {r.results.length > 0 && (
        <Table caption="Review of results">
          <THead>
            <Tr>
              <Th>Rank</Th>
              <Th>Team</Th>
              {r.round.rankingScope === 'PER_TRACK' && <Th>Group</Th>}
              <Th>Score</Th>
              <Th>Evaluations</Th>
              <Th>Flags</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {r.results.map((t) => (
              <ResultRow
                key={t.teamId}
                t={t}
                r={r}
                open={openRow === t.teamId}
                toggle={() => setOpenRow(openRow === t.teamId ? null : t.teamId)}
                onTie={() => {
                  const g = r.checklist.unresolvedTies.find((x) =>
                    x.teams.some((tm) => tm.teamId === t.teamId),
                  ) ?? {
                    group: t.group,
                    rank: t.rank!,
                    teams: r.results
                      .filter((x) => x.group === t.group && x.rank === t.rank)
                      .map((x) => ({ teamId: x.teamId, name: x.name })),
                  };
                  setOrder(g.teams.map((x) => x.teamId));
                  setMode('SHARE');
                  setDialog({ kind: 'tie', ...g });
                }}
                onNotRanked={() => setDialog({ kind: 'notRanked', teamId: t.teamId, name: t.name })}
                onClearMark={() => clearMark.mutate(t.teamId)}
              />
            ))}
          </TBody>
        </Table>
      )}

      {r.ties.length > 0 && (
        <Card footerLabel="Tie decisions">
          <ul className="flex flex-col gap-2">
            {r.ties.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>
                    {t.group}, position {t.rank}:
                  </strong>{' '}
                  {t.mode === 'SHARE' ? 'shared' : 'ordered manually'}. “{t.reason}”
                </span>
                <Button variant="ghost" onClick={() => clearTie.mutate(t.id)}>
                  Clear
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card footerLabel="Snapshot history">
        {r.snapshots.length === 0 ? (
          <p>No snapshots yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {r.snapshots.map((s) => (
              <li key={s.id}>
                <strong>Version {s.versionNo}</strong> · approved{' '}
                {formatDateTime(s.approvedAt, mine.timeZone)} ·{' '}
                <Badge tone={s.status === 'APPROVED' ? 'success' : 'warning'}>
                  {s.status === 'APPROVED' ? 'Valid' : 'Withdrawn'}
                </Badge>{' '}
                {s.publishedAt && !s.unpublishedAt && <Badge tone="success">Published</Badge>}{' '}
                {s.invalidatedReason && <span className="text-sm">({s.invalidatedReason})</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={dialog?.kind === 'tie'}
        title="Resolve this tie"
        onClose={() => setDialog(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveTie.mutate()}
              loading={saveTie.isPending}
              disabled={reason.trim().length < 10}
            >
              Save decision
            </Button>
          </>
        }
      >
        {dialog?.kind === 'tie' && (
          <div className="flex flex-col gap-3">
            <p>
              Tied teams: {dialog.teams.map((t) => t.name).join(', ')} (position {dialog.rank}).
            </p>
            <Select
              label="Decision"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="SHARE">Share the position</option>
              <option value="ORDER">Order manually</option>
            </Select>
            {mode === 'ORDER' && (
              <ol className="flex flex-col gap-2">
                {order.map((id, i) => (
                  <li key={id} className="flex items-center gap-2">
                    <span>{i + 1}.</span>
                    <strong>{dialog.teams.find((t) => t.teamId === id)?.name}</strong>
                    <Button
                      variant="ghost"
                      disabled={i === 0}
                      onClick={() => {
                        const n = [...order];
                        [n[i - 1], n[i]] = [n[i]!, n[i - 1]!];
                        setOrder(n);
                      }}
                    >
                      Up
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={i === order.length - 1}
                      onClick={() => {
                        const n = [...order];
                        [n[i + 1], n[i]] = [n[i]!, n[i + 1]!];
                        setOrder(n);
                      }}
                    >
                      Down
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            <Textarea
              label="Reason (at least 10 characters)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              hint="Kept with the approved snapshot."
            />
          </div>
        )}
      </Dialog>
      <Dialog
        open={dialog?.kind === 'notRanked'}
        title={`Mark ${dialog?.kind === 'notRanked' ? dialog.name : ''} as not ranked?`}
        onClose={() => setDialog(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveNotRanked.mutate()}
              loading={saveNotRanked.isPending}
              disabled={reason.trim().length < 10}
            >
              Mark not ranked
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason (at least 10 characters)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Dialog>
      <Dialog
        open={dialog?.kind === 'unpublish'}
        title="Unpublish these results?"
        onClose={() => setDialog(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => unpublish.mutate()}
              loading={unpublish.isPending}
              disabled={reason.trim().length < 3}
            >
              Unpublish
            </Button>
          </>
        }
      >
        <p>Participants stop seeing results immediately.</p>
        <div className="mt-3">
          <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Dialog>
    </div>
  );
}

const stateLabel: Record<ReviewResult['state'], string> = {
  RANKED: 'Ranked',
  DISQUALIFIED: 'Disqualified',
  DID_NOT_SUBMIT: 'Did not submit',
  NOT_RANKED: 'Not ranked',
  NO_EVALUATIONS: 'No counted evaluations',
};

function ResultRow({
  t,
  r,
  open,
  toggle,
  onTie,
  onNotRanked,
  onClearMark,
}: {
  t: ReviewResult;
  r: ResultsReviewDto;
  open: boolean;
  toggle: () => void;
  onTie: () => void;
  onNotRanked: () => void;
  onClearMark: () => void;
}) {
  const spans = r.round.rankingScope === 'PER_TRACK' ? 7 : 6;
  return (
    <>
      <Tr>
        <Td>
          <strong>{t.rank ?? '—'}</strong>
        </Td>
        <Td>
          {t.teamCode} {t.name}
        </Td>
        {r.round.rankingScope === 'PER_TRACK' && <Td>{t.group}</Td>}
        <Td>{t.score ? <strong>{Number(t.score).toFixed(2)}</strong> : '—'}</Td>
        <Td>
          {t.counted} of {t.required}
        </Td>
        <Td>
          <span className="flex flex-wrap gap-1">
            {t.state !== 'RANKED' && (
              <Badge tone={t.state === 'DISQUALIFIED' ? 'error' : 'warning'}>
                {stateLabel[t.state]}
              </Badge>
            )}
            {t.tied && !t.tieResolved && <Badge tone="warning">Tie</Badge>}
            {t.tieResolved && <Badge tone="info">Tie decided</Badge>}
            {t.needsResolution && <Badge tone="error">Needs a decision</Badge>}
            {t.state === 'RANKED' && !t.complete && <Badge tone="warning">Incomplete</Badge>}
            {t.excluded.length > 0 && <Badge tone="info">{t.excluded.length} excluded</Badge>}
          </span>
        </Td>
        <Td>
          <span className="flex flex-wrap gap-1">
            {(t.breakdown.length > 0 || t.reason) && (
              <Button variant="secondary" onClick={toggle} aria-expanded={open}>
                {open ? 'Hide' : 'Details'}
              </Button>
            )}
            {t.tied && (
              <Button variant="secondary" onClick={onTie}>
                {t.tieResolved ? 'Change decision' : 'Resolve tie'}
              </Button>
            )}
            {(t.state === 'NO_EVALUATIONS' || (t.state === 'RANKED' && !t.complete)) && (
              <Button variant="ghost" onClick={onNotRanked}>
                Mark not ranked
              </Button>
            )}
            {t.state === 'NOT_RANKED' && (
              <Button variant="ghost" onClick={onClearMark}>
                Rank again
              </Button>
            )}
          </span>
        </Td>
      </Tr>
      {open && (
        <Tr>
          <Td colSpan={spans} className="bg-paper">
            {t.reason && (
              <p className="mb-2">
                <strong>Reason:</strong> {t.reason}
              </p>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="py-1 text-left">Judge</th>
                  {r.criteria.map((c) => (
                    <th key={c.id} className="py-1 text-left">
                      {c.name}
                    </th>
                  ))}
                  <th className="py-1 text-left">Judge score</th>
                </tr>
              </thead>
              <tbody>
                {t.breakdown.map((b) => (
                  <tr key={b.assignmentId}>
                    <td className="py-1">{b.judgeName}</td>
                    {r.criteria.map((c) => (
                      <td key={c.id} className="py-1">
                        {b.scores[c.id] ?? '—'} / {c.max}
                      </td>
                    ))}
                    <td className="py-1">
                      <strong>{Number(b.weightedScore).toFixed(2)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {t.excluded.map((x) => (
              <p key={x.assignmentId} className="mt-2 text-sm">
                Excluded: {x.judgeName} ({x.status.toLowerCase()}){x.reason ? `, ${x.reason}` : ''}
              </p>
            ))}
            <p className="mt-2 text-sm">
              Team score = plain mean of the counted judge scores, rounded half-up to 4 decimals (
              {t.score}).
            </p>
          </Td>
        </Tr>
      )}
    </>
  );
}
