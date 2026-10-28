import { createHash } from 'node:crypto';
import { Decimal, rankTeams, teamScore, type ScoringCriterion } from '@arthakram/shared';
import type { Db } from '../../db/client.js';
import type { Round } from '../../generated/prisma/client.js';
import { judgedVersions, toCriteria } from '../judging/common.js';

export type TeamState =
  'RANKED' | 'DISQUALIFIED' | 'DID_NOT_SUBMIT' | 'NOT_RANKED' | 'NO_EVALUATIONS';

export interface BreakdownRow {
  assignmentId: string;
  judgeName: string;
  weightedScore: string;
  scores: Record<string, number>;
}

export interface TeamResult {
  teamId: string;
  teamCode: string;
  name: string;
  trackName: string;
  group: string;
  state: TeamState;
  reason: string | null;
  counted: number;
  required: number;
  /** counted >= required */
  complete: boolean;
  /** Active or conflicted assignments that have no submitted evaluation yet. */
  pending: number;
  rawScore?: string | null;
  score: string | null;
  rank: number | null;
  /** Equal score within the ranking group and not (yet) resolved. */
  tied: boolean;
  tieResolved: boolean;
  needsResolution: boolean;
  breakdown: BreakdownRow[];
  excluded: { assignmentId: string; judgeName: string; status: string; reason: string | null }[];
}

export interface ResultsReview {
  criteria: { id: string; name: string; weight: number; max: number }[];
  results: TeamResult[];
  checklist: {
    judgingClosed: boolean;
    hasRubric: boolean;
    missing: {
      teamId: string;
      teamCode: string;
      name: string;
      counted: number;
      required: number;
      pending: number;
    }[];
    unresolvedTies: { group: string; rank: number; teams: { teamId: string; name: string }[] }[];
  };
  canApprove: boolean;
  fingerprint: string;
}

const NO_TRACK = 'No track';

/**
 * Derives the full review for a round from the current evaluations (PRD FR-154: never stored by hand).
 * Counted = submitted, on an active assignment, in a judged team. T is the plain mean of exact J values at 4 dp.
 */
export async function computeReview(db: Db, round: Round): Promise<ResultsReview> {
  const [rubric, teams, assignments, judged, ties, notRanked] = await Promise.all([
    db.rubric.findUnique({
      where: { roundId: round.id },
      include: { criteria: { orderBy: { order: 'asc' } } },
    }),
    db.team.findMany({
      where: { eventId: round.eventId, status: { not: 'DISSOLVED' } },
      include: { track: true },
      orderBy: { teamCode: 'asc' },
    }),
    db.judgeAssignment.findMany({
      where: { roundId: round.id },
      include: { evaluation: { include: { scores: true } } },
    }),
    judgedVersions(db, round.id),
    db.tieResolution.findMany({ where: { roundId: round.id } }),
    db.notRankedMark.findMany({ where: { roundId: round.id } }),
  ]);
  const judges = await db.eventMembership.findMany({
    where: { id: { in: [...new Set(assignments.map((a) => a.judgeMembershipId))] } },
    include: { user: true },
  });
  const judgeName = (id: string) => judges.find((j) => j.id === id)?.user.name ?? 'Former judge';
  const criteria: ScoringCriterion[] = rubric ? toCriteria(rubric.criteria) : [];

  const valid = assignments.filter(
    (a) =>
      a.status === 'ACTIVE' &&
      a.evaluation?.status === 'SUBMITTED' &&
      a.evaluation.weightedScore !== null &&
      judged.has(a.teamId) &&
      teams.some((t) => t.id === a.teamId && t.status === 'ACTIVE'),
  );
  const panel = valid.length
    ? valid.reduce((s, a) => s + Number(a.evaluation!.weightedScore), 0) / valid.length
    : 0;
  const judgeMeans = new Map<string, number>();
  for (const id of new Set(valid.map((a) => a.judgeMembershipId))) {
    const scores = valid.filter((a) => a.judgeMembershipId === id);
    if (scores.length >= 3)
      judgeMeans.set(
        id,
        scores.reduce((s, a) => s + Number(a.evaluation!.weightedScore), 0) / scores.length,
      );
  }
  const entries = round.shortlistEnabled
    ? await db.roundEntry.findMany({ where: { roundId: round.id } })
    : [];
  const results: TeamResult[] = teams
    .filter((t) => !round.shortlistEnabled || entries.some((e) => e.teamId === t.id))
    .map((t) => {
      const mine = assignments.filter((a) => a.teamId === t.id);
      const counted = mine.filter(
        (a) => a.status === 'ACTIVE' && a.evaluation?.status === 'SUBMITTED',
      );
      const mark = notRanked.find((n) => n.teamId === t.id);
      const submitted = judged.has(t.id);
      const group = round.rankingScope === 'PER_TRACK' ? (t.track?.name ?? NO_TRACK) : 'Overall';
      let state: TeamState = 'RANKED';
      let reason: string | null = null;
      if (t.status === 'DISQUALIFIED') {
        state = 'DISQUALIFIED';
        reason = t.disqualifiedReason;
      } else if (!submitted) state = 'DID_NOT_SUBMIT';
      else if (mark) {
        state = 'NOT_RANKED';
        reason = mark.reason;
      } else if (counted.length === 0) state = 'NO_EVALUATIONS';

      const evals = counted.map((a) => ({
        criteria,
        scores: Object.fromEntries(a.evaluation!.scores.map((s) => [s.criterionId, s.score])),
      }));
      const raw: Decimal | null = state === 'RANKED' && criteria.length ? teamScore(evals) : null;
      const adjusted = counted.map((a) =>
        Math.min(
          100,
          Math.max(
            0,
            Number(a.evaluation!.weightedScore) +
              (judgeMeans.has(a.judgeMembershipId)
                ? panel - judgeMeans.get(a.judgeMembershipId)!
                : 0),
          ),
        ),
      );
      const score =
        round.normalisation && raw && adjusted.length
          ? new Decimal(adjusted.reduce((s, n) => s + n, 0) / adjusted.length)
          : raw;
      return {
        teamId: t.id,
        teamCode: t.teamCode,
        name: t.name,
        trackName: t.track?.name ?? '',
        group,
        state,
        reason,
        counted: counted.length,
        required: round.requiredEvaluations,
        complete: counted.length >= round.requiredEvaluations,
        pending: mine.filter(
          (a) =>
            (a.status === 'ACTIVE' && a.evaluation?.status !== 'SUBMITTED') ||
            a.status === 'CONFLICT',
        ).length,
        rawScore: raw ? raw.toFixed(4) : null,
        score: score ? score.toFixed(4) : null,
        rank: null,
        tied: false,
        tieResolved: false,
        needsResolution: false,
        breakdown: counted.map((a) => ({
          assignmentId: a.id,
          judgeName: judgeName(a.judgeMembershipId),
          weightedScore: Number(a.evaluation!.weightedScore!.toString()).toFixed(4),
          scores: Object.fromEntries(a.evaluation!.scores.map((s) => [s.criterionId, s.score])),
        })),
        excluded: mine
          .filter((a) => a.status === 'EXCLUDED' || a.status === 'UNASSIGNED')
          .map((a) => ({
            assignmentId: a.id,
            judgeName: judgeName(a.judgeMembershipId),
            status: a.status,
            reason: a.reason,
          })),
      };
    });

  // Rank, then apply stored tie decisions that still describe the same set of teams.
  const rankable = results.filter((r) => r.state === 'RANKED' && r.score);
  const ranked = rankTeams(
    rankable.map((r) => ({ teamId: r.teamId, score: new Decimal(r.score!), group: r.group })),
  );
  for (const r of ranked) {
    const row = results.find((x) => x.teamId === r.teamId)!;
    row.rank = r.rank;
    row.tied = r.tied;
  }
  const unresolvedTies: ResultsReview['checklist']['unresolvedTies'] = [];
  const groups = new Set(ranked.map((r) => r.group));
  for (const g of groups) {
    const inGroup = results.filter((r) => r.group === g && r.rank !== null);
    const ranks = new Set(inGroup.filter((r) => r.tied).map((r) => r.rank!));
    for (const rank of ranks) {
      const set = inGroup.filter((r) => r.rank === rank);
      const ids = set.map((s) => s.teamId).sort();
      const res = ties.find(
        (t) => t.group === g && t.rank === rank && [...t.teamIds].sort().join() === ids.join(),
      );
      if (res) {
        for (const s of set) s.tieResolved = true;
        if (res.mode === 'ORDER') {
          res.order.forEach((id, i) => {
            const row = set.find((s) => s.teamId === id)!;
            row.rank = rank + i;
            row.tied = false;
          });
        }
      } else if (rank <= round.awardPositions) {
        for (const s of set) s.needsResolution = true;
        unresolvedTies.push({
          group: g,
          rank,
          teams: set.map((s) => ({ teamId: s.teamId, name: s.name })),
        });
      }
    }
  }

  // A team is ready when it has all required evaluations, or no pending assignment and at least one counted (FR-149).
  const missing = results
    .filter(
      (r) =>
        (r.state === 'RANKED' || r.state === 'NO_EVALUATIONS') &&
        !(r.complete || (r.pending === 0 && r.counted >= 1)),
    )
    .map((r) => ({
      teamId: r.teamId,
      teamCode: r.teamCode,
      name: r.name,
      counted: r.counted,
      required: r.required,
      pending: r.pending,
    }));
  const judgingClosed = round.judgingStatus === 'CLOSED';
  const checklist = { judgingClosed, hasRubric: Boolean(rubric), missing, unresolvedTies };

  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        round: [
          round.normalisation,
          round.shortlistEnabled,
          round.rankingScope,
          round.awardPositions,
          round.requiredEvaluations,
        ],
        rubric: rubric ? [rubric.id, rubric.structureVersion] : null,
        teams: results.map((r) => [
          r.teamId,
          r.state,
          r.group,
          r.score,
          r.counted,
          r.pending,
          r.breakdown.map((b) => `${b.assignmentId}:${b.weightedScore}`),
          r.excluded.map((e) => `${e.assignmentId}:${e.status}`),
        ]),
        ties: ties.map((t) => [t.group, t.rank, [...t.teamIds].sort(), t.mode, t.order]).sort(),
        notRanked: notRanked.map((n) => n.teamId).sort(),
      }),
    )
    .digest('hex');

  results.sort(
    (a, b) =>
      (a.rank ?? 1e9) - (b.rank ?? 1e9) ||
      a.group.localeCompare(b.group) ||
      a.teamCode.localeCompare(b.teamCode, undefined, { numeric: true }),
  );
  return {
    criteria:
      rubric?.criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight, max: c.max })) ?? [],
    results,
    checklist,
    canApprove:
      judgingClosed && Boolean(rubric) && missing.length === 0 && unresolvedTies.length === 0,
    fingerprint,
  };
}
