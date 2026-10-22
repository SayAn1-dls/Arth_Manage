import { JOIN_CODE_ALPHABET, type TeamDto } from '@arthakram/shared';
import { randomInt } from 'node:crypto';
import type { Db } from '../../db/client.js';
import { AppError } from '../../http/errors.js';
import { writeAudit, type AuditClient } from '../../audit/audit.js';
import type { Event, Prisma } from '../../generated/prisma/client.js';
import { effectiveRegistration } from '../events/registrationState.js';

type Tx = Prisma.TransactionClient;

export function newJoinCode(): string {
  let c = '';
  for (let i = 0; i < 8; i++) c += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  return c;
}

export const padTeamCode = (n: number) => `T-${String(n).padStart(4, '0')}`;

export function isUniqueViolation(err: unknown, constraintHint?: string): boolean {
  if (typeof err !== 'object' || !err) return false;
  const e = err as { code?: string; message?: string; meta?: { target?: unknown } };
  if (e.code !== 'P2002' && !(e.message ?? '').includes('duplicate key')) return false;
  return constraintHint
    ? JSON.stringify(e).includes(constraintHint) || (e.message ?? '').includes(constraintHint)
    : true;
}

/** Allocates the next immutable team code atomically; codes are never reused (PRD FR-052). */
async function nextTeamCode(tx: Tx, eventId: string): Promise<string> {
  const rows = await tx.$queryRaw<
    { teamCodeSeq: number }[]
  >`UPDATE "Event" SET "teamCodeSeq" = "teamCodeSeq" + 1 WHERE id = ${eventId} RETURNING "teamCodeSeq"`;
  return padTeamCode(rows[0]!.teamCodeSeq);
}

async function uniqueJoinCode(tx: Tx, eventId: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = newJoinCode();
    if (!(await tx.team.findUnique({ where: { eventId_joinCode: { eventId, joinCode: code } } })))
      return code;
  }
  throw new Error('Could not allocate a join code');
}

export async function createTeamTx(tx: Tx, event: Event, leaderMembershipId: string, name: string) {
  const team = await tx.team.create({
    data: {
      eventId: event.id,
      teamCode: await nextTeamCode(tx, event.id),
      name,
      joinCode: await uniqueJoinCode(tx, event.id),
    },
  });
  await tx.teamMember.create({
    data: { teamId: team.id, eventId: event.id, membershipId: leaderMembershipId, role: 'LEADER' },
  });
  return team;
}

/** Events with a maximum team size of 1 turn each registrant into a solo team automatically (PRD FR-014). */
export async function createSoloTeam(tx: Tx, event: Event, membershipId: string, fullName: string) {
  let name = fullName.length >= 3 ? fullName.slice(0, 40) : `${fullName} team`.slice(0, 40);
  for (
    let n = 2;
    await tx.$queryRaw<
      unknown[]
    >`SELECT 1 FROM "Team" WHERE "eventId" = ${event.id} AND lower(name) = lower(${name}) AND status <> 'DISSOLVED'`.then(
      (r) => r.length > 0,
    );
    n++
  ) {
    name = `${fullName.slice(0, 34)} ${n}`;
  }
  return createTeamTx(tx, event, membershipId, name);
}

export async function activeTeamOf(db: Db | Tx, eventId: string, membershipId: string) {
  const m = await db.teamMember.findFirst({
    where: { eventId, membershipId, leftAt: null, team: { status: { not: 'DISSOLVED' } } },
    include: { team: true },
  });
  return m ?? null;
}

export interface Viewer {
  /** 'ADMIN' sees everything; participants see their own team including teammate emails. */
  role: 'ADMIN' | 'PARTICIPANT';
  membershipId: string;
}

/** Builds the team DTO with the PRD's visibility rules (11.4): emails only for teammates and admins; join code for members while open. */
export async function teamDto(
  db: Db | Tx,
  event: Event,
  teamId: string,
  viewer: Viewer,
): Promise<TeamDto> {
  const team = await db.team.findFirstOrThrow({
    where: { id: teamId, eventId: event.id },
    include: {
      members: {
        where: { leftAt: null },
        include: { membership: { include: { user: true, registration: true } } },
        orderBy: { joinedAt: 'asc' },
      },
    },
  });
  const isMember = team.members.some((m) => m.membershipId === viewer.membershipId);
  const seeEmail = viewer.role === 'ADMIN' || isMember;
  const open = effectiveRegistration(event) === 'OPEN';
  return {
    id: team.id,
    teamCode: team.teamCode,
    name: team.name,
    status: team.status,
    disqualifiedReason: viewer.role === 'ADMIN' || isMember ? team.disqualifiedReason : undefined,
    trackId: team.trackId,
    problemId: team.problemId,
    joinCode: isMember && open ? team.joinCode : undefined,
    version: team.version,
    members: team.members.map((m) => ({
      membershipId: m.membershipId,
      name: m.membership.registration?.fullName ?? m.membership.user.name,
      institution: m.membership.registration?.institution ?? '',
      role: m.role,
      isYou: m.membershipId === viewer.membershipId,
      ...(seeEmail ? { email: m.membership.user.email } : {}),
    })),
    size: team.members.length,
    min: event.teamMin,
    max: event.teamMax,
    complete: team.members.length >= event.teamMin,
  };
}

const CLOSED_MSG = 'Registration is closed. Contact the organisers to change your team.';

export function assertRegistrationOpen(event: Event) {
  if (effectiveRegistration(event) !== 'OPEN')
    throw AppError.conflict('registration_closed', CLOSED_MSG);
}

/** Moves a member out of a team; dissolves it when empty; refuses to orphan a team's leader (PRD FR-054). */
export async function removeMemberTx(
  tx: Tx,
  event: Event,
  teamId: string,
  membershipId: string,
  opts: { actorId: string; reason?: string; allowLeaderRemoval?: boolean },
) {
  const member = await tx.teamMember.findFirst({
    where: { teamId, eventId: event.id, membershipId, leftAt: null },
  });
  if (!member) throw AppError.notFound();
  const others = await tx.teamMember.count({
    where: { teamId, leftAt: null, NOT: { id: member.id } },
  });
  if (member.role === 'LEADER' && others > 0 && !opts.allowLeaderRemoval) {
    throw AppError.conflict(
      'leader_must_transfer',
      'The leader cannot leave while other members remain. Transfer leadership first.',
    );
  }
  await tx.teamMember.update({ where: { id: member.id }, data: { leftAt: new Date() } });
  if (others === 0) {
    await tx.team.update({
      where: { id: teamId },
      data: { status: 'DISSOLVED', joinCode: null, version: { increment: 1 } },
    });
    await writeAudit(tx, {
      eventId: event.id,
      actorId: opts.actorId,
      action: 'team.dissolved',
      entityType: 'Team',
      entityId: teamId,
    });
  } else if (member.role === 'LEADER') {
    // Admin removed the leader: the earliest remaining member takes over so a team never has no leader.
    const next = await tx.teamMember.findFirstOrThrow({
      where: { teamId, leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });
    await tx.teamMember.update({ where: { id: next.id }, data: { role: 'LEADER' } });
  }
  return { dissolved: others === 0 };
}

export type { AuditClient };
