import type { ScoringCriterion } from '@arthakram/shared';
import type { Db } from '../../db/client.js';
import { AppError } from '../../http/errors.js';
import type { EventContext } from '../../http/context.js';
import type { Prisma, Round } from '../../generated/prisma/client.js';
import { cutoffFor } from '../submissions/logic.js';
import { roundTiming } from '../submissions/service.js';

export type Tx = Prisma.TransactionClient;

export async function loadRound(db: Db | Tx, ctx: EventContext, roundId: string): Promise<Round> {
  const round = await db.round.findFirst({ where: { id: roundId, eventId: ctx.event.id } });
  if (!round) throw AppError.notFound();
  return round;
}

export function isAdmin(ctx: EventContext) {
  return ctx.membership.role === 'ADMIN';
}

export function adminOnly(ctx: EventContext) {
  if (!isAdmin(ctx)) throw AppError.notFound();
}

export function judgeOnly(ctx: EventContext) {
  if (ctx.membership.role !== 'JUDGE') throw AppError.notFound();
}

export function toCriteria(
  rows: { id: string; weight: number; min: number; max: number }[],
): ScoringCriterion[] {
  return rows.map((c) => ({ id: c.id, weight: c.weight, min: c.min, max: c.max }));
}

/** Has the round's submission window (deadline plus grace) closed? Judging may only open after (PRD FR-029). */
export function submissionsClosed(round: Round, now = new Date()): boolean {
  const cutoff = cutoffFor(roundTiming(round), null);
  return Boolean(cutoff && now > cutoff);
}

/**
 * A team's judged version: the last submitted one. Teams with no submitted version are "Did not submit":
 * their assignments are Not required (derived, so granting an extension restores them) (PRD C intro).
 */
export async function judgedVersions(db: Db | Tx, roundId: string) {
  const subs = await db.submission.findMany({
    where: { roundId, lastVersionNo: { gt: 0 } },
    select: { id: true, teamId: true, lastVersionNo: true },
  });
  return new Map(subs.map((s) => [s.teamId, s]));
}

/** A judge may see a team's submission only if assigned and judging has opened (PRD §8.1). */
export async function judgeMayViewTeam(
  db: Db | Tx,
  judgeMembershipId: string,
  roundId: string,
  teamId: string,
): Promise<boolean> {
  const a = await db.judgeAssignment.findUnique({
    where: { roundId_teamId_judgeMembershipId: { roundId, teamId, judgeMembershipId } },
    include: { round: true },
  });
  return Boolean(a && a.status !== 'UNASSIGNED' && a.round.judgingStatus !== 'NOT_OPEN');
}
