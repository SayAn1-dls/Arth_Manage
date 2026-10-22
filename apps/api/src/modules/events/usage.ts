import type { Db } from '../../db/client.js';

/**
 * "Is this record in use?" checks that block deletion (PRD FR-010/011/012). Teams and submissions are
 * introduced in Phase 3; this module is where those checks are implemented, so until then nothing can be
 * in use and the checks pass. Phase 3 replaces the bodies and adds the matching tests.
 */
export async function assertTrackUnused(_db: Db, _trackId: string): Promise<void> {}
export async function assertProblemUnused(_db: Db, _problemId: string): Promise<void> {}
export async function roundHasSubmissions(_db: Db, _roundId: string): Promise<boolean> {
  return false;
}
