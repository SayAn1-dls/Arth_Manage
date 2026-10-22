import type { Event } from '../../generated/prisma/client.js';

export type EffectiveRegistration = 'NOT_OPEN' | 'OPEN' | 'CLOSED';

/**
 * Registration state as of `now`. The manual status is authoritative; optional scheduled times move it
 * (PRD FR-005): a NOT_OPEN event opens once its open time passes, and an OPEN one closes when its close
 * time passes. Only published events can be open.
 */
export function effectiveRegistration(
  event: Pick<
    Event,
    'status' | 'registrationStatus' | 'registrationOpensAt' | 'registrationClosesAt'
  >,
  now = new Date(),
): EffectiveRegistration {
  if (event.status !== 'PUBLISHED') return event.status === 'DRAFT' ? 'NOT_OPEN' : 'CLOSED';
  let status = event.registrationStatus;
  if (status === 'NOT_OPEN' && event.registrationOpensAt && event.registrationOpensAt <= now)
    status = 'OPEN';
  if (status === 'OPEN' && event.registrationOpensAt && event.registrationOpensAt > now)
    status = 'NOT_OPEN';
  if (status === 'OPEN' && event.registrationClosesAt && event.registrationClosesAt <= now)
    status = 'CLOSED';
  return status;
}
