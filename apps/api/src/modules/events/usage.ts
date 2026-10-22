import type { Db } from '../../db/client.js';
import { AppError } from '../../http/errors.js';

/** Deleting a track that teams selected is blocked until those teams are moved (PRD FR-010). */
export async function assertTrackUnused(db: Db, trackId: string): Promise<void> {
  const teams = await db.team.findMany({
    where: { trackId, status: { not: 'DISSOLVED' } },
    select: { teamCode: true, name: true },
    take: 5,
  });
  if (teams.length) {
    throw AppError.conflict(
      'track_in_use',
      `Teams have selected this track (${teams.map((t) => `${t.teamCode} ${t.name}`).join(', ')}). Move them first.`,
    );
  }
}

/** Same rule for problem statements (PRD FR-011). */
export async function assertProblemUnused(db: Db, problemId: string): Promise<void> {
  const teams = await db.team.findMany({
    where: { problemId, status: { not: 'DISSOLVED' } },
    select: { teamCode: true, name: true },
    take: 5,
  });
  if (teams.length) {
    throw AppError.conflict(
      'problem_in_use',
      `Teams have selected this problem statement (${teams.map((t) => `${t.teamCode} ${t.name}`).join(', ')}). Move them first.`,
    );
  }
}

/** A round holds submissions once any team has started one; its deadline changes then need a reason (PRD FR-012). */
export async function roundHasSubmissions(db: Db, roundId: string): Promise<boolean> {
  return (await db.submission.count({ where: { roundId } })) > 0;
}

/** Certificates arrive in Phase 6; until then no participant can hold one, so profile edits are never locked by it. */
export async function hasCertificate(_db: Db, _membershipId: string): Promise<boolean> {
  return false;
}
