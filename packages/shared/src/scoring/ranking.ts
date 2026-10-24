import type { Decimal } from 'decimal.js';

export interface RankInput {
  teamId: string;
  /** Team score T at 4 dp. */
  score: Decimal;
  /** Ranking group, e.g. a track id when ranking per track; one group otherwise. */
  group: string;
}

export interface RankedTeam {
  teamId: string;
  group: string;
  score: Decimal;
  /** Standard competition rank: 1, 1, 3 (PRD FR-150). */
  rank: number;
  /** Ties are flagged, never broken automatically (PRD FR-151, DECISIONS D-18). */
  tied: boolean;
}

/** Rank teams within each group by T descending (4 dp), using standard competition ranking. */
export function rankTeams(inputs: RankInput[]): RankedTeam[] {
  const groups = new Map<string, RankInput[]>();
  for (const i of inputs) groups.set(i.group, [...(groups.get(i.group) ?? []), i]);
  const out: RankedTeam[] = [];
  for (const [group, items] of groups) {
    const sorted = [...items].sort(
      (a, b) => b.score.comparedTo(a.score) || a.teamId.localeCompare(b.teamId),
    );
    sorted.forEach((item, idx) => {
      const prev = out.filter((o) => o.group === group)[idx - 1];
      const rank = prev && prev.score.equals(item.score) ? prev.rank : idx + 1;
      out.push({ teamId: item.teamId, group, score: item.score, rank, tied: false });
    });
    const groupOut = out.filter((o) => o.group === group);
    for (const o of groupOut) o.tied = groupOut.filter((x) => x.rank === o.rank).length > 1;
  }
  return out;
}
