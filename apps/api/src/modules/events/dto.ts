import type { EventDto, RoundDto } from '@arthakram/shared';
import type { Event, Round } from '../../generated/prisma/client.js';

export function eventDto(e: Event): EventDto {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    type: e.type,
    mode: e.mode,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    timeZone: e.timeZone,
    institution: e.institution,
    contactEmail: e.contactEmail,
    venue: e.venue,
    description: e.description,
    eligibility: e.eligibility,
    status: e.status,
    registrationStatus: e.registrationStatus,
    registrationOpensAt: e.registrationOpensAt?.toISOString() ?? null,
    registrationClosesAt: e.registrationClosesAt?.toISOString() ?? null,
    teamMin: e.teamMin,
    teamMax: e.teamMax,
    declarations: e.declarations,
    trackRequired: e.trackRequired,
    showWinners: e.showWinners,
    showOwnRank: e.showOwnRank,
    showOwnScores: e.showOwnScores,
    certParticipationRule: e.certParticipationRule,
    certWinnersAlsoParticipate: e.certWinnersAlsoParticipate,
    ownerId: e.ownerId,
    version: e.version,
    publishedAt: e.publishedAt?.toISOString() ?? null,
  };
}

export function roundDto(r: Round): RoundDto & { id: string } {
  return {
    id: r.id,
    order: r.order,
    version: r.version,
    name: r.name,
    opensAt: r.opensAt?.toISOString() ?? null,
    submissionDeadline: r.submissionDeadline?.toISOString() ?? null,
    graceMinutes: r.graceMinutes,
    latePolicy: r.latePolicy,
    judgingDeadline: r.judgingDeadline?.toISOString() ?? null,
    rankingScope: r.rankingScope,
    requiredEvaluations: r.requiredEvaluations,
    awardPositions: r.awardPositions,
  };
}

/** Fields whose before/after values go to the audit log, so entries stay small and free of secrets. */
export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

export function changed<T extends object>(before: T, after: T, keys: readonly (keyof T)[]) {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const k of keys) {
    const x = before[k];
    const y = after[k];
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      b[k] = x;
      a[k] = y;
    }
  }
  return { before: b, after: a, any: Object.keys(a).length > 0 };
}
