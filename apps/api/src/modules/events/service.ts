import {
  slugify,
  DEFAULT_GUIDEBOOK_SECTIONS,
  type CreateEventInput,
  type UpdateEventInput,
} from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { AppError } from '../../http/errors.js';
import { writeAudit } from '../../audit/audit.js';
import type { EventContext } from '../../http/context.js';
import type { Event, User } from '../../generated/prisma/client.js';
import { changed } from './dto.js';
import { createDefaultFormFields } from '../submissions/service.js';

const EVENT_AUDIT_KEYS = [
  'name',
  'slug',
  'type',
  'mode',
  'startsAt',
  'endsAt',
  'timeZone',
  'institution',
  'contactEmail',
  'venue',
  'description',
  'eligibility',
  'teamMin',
  'teamMax',
  'declarations',
  'trackRequired',
  'showWinners',
  'showOwnRank',
  'showOwnScores',
] as const;

/** Archived events are read-only for everyone except the owner (PRD FR-005/008). */
export function assertWritable(ctx: EventContext) {
  if (ctx.event.status === 'ARCHIVED' && ctx.event.ownerId !== ctx.membership.userId) {
    throw AppError.conflict(
      'event_archived',
      'This event is archived and can no longer be changed',
    );
  }
}

function isSlugCollision(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'P2002' &&
    JSON.stringify(err).includes('slug')
  );
}

export function createEventService({ db, logger }: Deps) {
  async function uniqueSlug(base: string): Promise<string> {
    let slug = base;
    for (let n = 2; await db.event.findUnique({ where: { slug } }); n++)
      slug = `${base}-${n}`.slice(0, 60);
    return slug;
  }

  /** Message for a stale optimistic-lock write, naming the last editor (PRD 6.0-3). */
  async function staleMessage(eventId: string): Promise<string> {
    const last = await db.auditLog.findFirst({
      where: { eventId, entityType: 'Event', action: { in: ['event.updated', 'event.created'] } },
      orderBy: { at: 'desc' },
    });
    const who = last?.actorId
      ? (await db.user.findUnique({ where: { id: last.actorId } }))?.name
      : null;
    const when = last ? last.at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'recently';
    return `This record was changed by ${who ?? 'someone else'} at ${when}. Reload to see the latest version.`;
  }

  return {
    staleMessage,

    /** Two organisers creating an event with the same name at the same instant both get a unique link. */
    async create(user: User, input: CreateEventInput) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.createOnce(user, input, attempt);
        } catch (err) {
          if (attempt < 4 && isSlugCollision(err)) continue;
          throw err;
        }
      }
    },

    async createOnce(user: User, input: CreateEventInput, attempt: number) {
      const base = input.slug ?? slugify(input.name);
      const slug = await uniqueSlug(
        attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`,
      );
      return db.$transaction(async (tx) => {
        const event = await tx.event.create({
          data: {
            slug,
            name: input.name,
            type: input.type,
            mode: input.mode,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            timeZone: input.timeZone,
            institution: input.institution,
            contactEmail: input.contactEmail,
            venue: input.venue ?? null,
            description: input.description ?? null,
            ownerId: user.id,
          },
        });
        await tx.eventMembership.create({
          data: { eventId: event.id, userId: user.id, role: 'ADMIN' },
        });
        const round1 = await tx.round.create({
          data: { eventId: event.id, order: 1, name: 'Round 1' },
        });
        await createDefaultFormFields(tx, round1.id, event.type);
        await tx.guidebook.create({
          data: {
            eventId: event.id,
            updatedById: user.id,
            sections: DEFAULT_GUIDEBOOK_SECTIONS.map((title, i) => ({
              id: `s${i + 1}`,
              title,
              body: '',
              hidden: false,
            })),
          },
        });
        await writeAudit(tx, {
          eventId: event.id,
          actorId: user.id,
          action: 'event.created',
          entityType: 'Event',
          entityId: event.id,
          after: { name: event.name, slug: event.slug },
        });
        return event;
      });
    },

    async update(ctx: EventContext, input: UpdateEventInput): Promise<Event> {
      assertWritable(ctx);
      const { version, confirmDateChange, ...rest } = input;
      const before = ctx.event;
      const data: Record<string, unknown> = { ...rest };

      if (rest.slug && rest.slug !== before.slug) {
        if (before.status !== 'DRAFT') {
          throw AppError.invalid('The event link cannot change after publication', {
            slug: 'The link is locked after publication',
          });
        }
        const taken = await db.event.findUnique({ where: { slug: rest.slug } });
        if (taken)
          throw AppError.invalid('That link is already taken', {
            slug: `Taken. Try "${await uniqueSlug(rest.slug)}"`,
          });
      }
      if (rest.startsAt) data.startsAt = new Date(rest.startsAt);
      if (rest.endsAt) data.endsAt = new Date(rest.endsAt);
      if (rest.teamMin !== undefined || rest.teamMax !== undefined) {
        const min = rest.teamMin ?? before.teamMin;
        const max = rest.teamMax ?? before.teamMax;
        if (max < min)
          throw AppError.invalid('Maximum team size must be at least the minimum', {
            teamMax: 'Must be at least the minimum',
          });
        if (max < before.teamMax) {
          // Reducing the maximum below an existing team is blocked, listing those teams (PRD FR-014).
          const teams = await db.team.findMany({
            where: { eventId: before.id, status: { not: 'DISSOLVED' } },
            include: { _count: { select: { members: { where: { leftAt: null } } } } },
          });
          const over = teams.filter((t) => t._count.members > max);
          if (over.length) {
            throw AppError.conflict(
              'teams_exceed_max',
              `These teams are larger than ${max}: ${over
                .slice(0, 5)
                .map((t) => `${t.teamCode} ${t.name}`)
                .join(', ')}. Resolve them first.`,
            );
          }
        }
      }
      const datesChanged =
        (rest.startsAt && new Date(rest.startsAt).getTime() !== before.startsAt.getTime()) ||
        (rest.endsAt && new Date(rest.endsAt).getTime() !== before.endsAt.getTime());
      if (datesChanged && !confirmDateChange) {
        const registered = await db.eventMembership.count({
          where: { eventId: before.id, role: 'PARTICIPANT', status: 'ACTIVE' },
        });
        if (registered > 0) {
          throw AppError.conflict(
            'confirm_date_change',
            `${registered} people have registered. Changing the dates will affect them. Confirm to continue, then post an announcement.`,
          );
        }
      }

      const result = await db.$transaction(async (tx) => {
        const updated = await tx.event.updateMany({
          where: { id: before.id, version },
          data: { ...data, version: { increment: 1 } },
        });
        if (updated.count === 0) return null;
        const after = await tx.event.findUniqueOrThrow({ where: { id: before.id } });
        const diff = changed(before, after, EVENT_AUDIT_KEYS);
        if (diff.any) {
          await writeAudit(tx, {
            eventId: before.id,
            actorId: ctx.membership.userId,
            action: 'event.updated',
            entityType: 'Event',
            entityId: before.id,
            before: diff.before,
            after: diff.after,
          });
        }
        return after;
      });
      if (!result) throw AppError.conflict('stale_version', await staleMessage(before.id));
      return result;
    },

    /** Publish checks (PRD FR-005): lists everything missing instead of failing on the first problem. */
    async publishChecks(event: Event): Promise<{ blocking: string[]; warnings: string[] }> {
      const blocking: string[] = [];
      const warnings: string[] = [];
      if (!event.name) blocking.push('Event name');
      if (!event.timeZone) blocking.push('Time zone');
      const rounds = await db.round.findMany({
        where: { eventId: event.id },
        orderBy: { order: 'asc' },
      });
      const withDeadline = rounds.filter((r) => r.submissionDeadline);
      if (withDeadline.length === 0) {
        blocking.push(`${rounds[0]?.name ?? 'Round 1'} submission deadline`);
      }
      const gb = await db.guidebookVersion.count({ where: { eventId: event.id } });
      if (gb === 0) warnings.push('The guidebook has not been published yet');
      return { blocking, warnings };
    },

    async publish(ctx: EventContext) {
      assertWritable(ctx);
      if (ctx.event.status !== 'DRAFT')
        throw AppError.conflict('already_published', 'This event is already published');
      const checks = await this.publishChecks(ctx.event);
      if (checks.blocking.length) {
        throw AppError.conflict(
          'publish_blocked',
          `Cannot publish yet. Missing: ${checks.blocking.join(', ')}`,
          {
            missing: checks.blocking,
          },
        );
      }
      const event = await db.$transaction(async (tx) => {
        const e = await tx.event.update({
          where: { id: ctx.event.id },
          data: { status: 'PUBLISHED', publishedAt: new Date(), version: { increment: 1 } },
        });
        await writeAudit(tx, {
          eventId: e.id,
          actorId: ctx.membership.userId,
          action: 'event.published',
          entityType: 'Event',
          entityId: e.id,
          before: { status: 'DRAFT' },
          after: { status: 'PUBLISHED' },
        });
        return e;
      });
      return { event, warnings: checks.warnings };
    },

    async unpublish(ctx: EventContext) {
      assertWritable(ctx);
      if (ctx.event.status !== 'PUBLISHED')
        throw AppError.conflict('not_published', 'Only a published event can be unpublished');
      const registered = await db.eventMembership.count({
        where: { eventId: ctx.event.id, role: 'PARTICIPANT', status: { not: 'REMOVED' } },
      });
      if (registered > 0) {
        throw AppError.conflict(
          'has_registrations',
          'This event has registrations, so it cannot be unpublished. Close registration instead.',
        );
      }
      return db.$transaction(async (tx) => {
        const e = await tx.event.update({
          where: { id: ctx.event.id },
          data: {
            status: 'DRAFT',
            registrationStatus: 'NOT_OPEN',
            publishedAt: null,
            version: { increment: 1 },
          },
        });
        await writeAudit(tx, {
          eventId: e.id,
          actorId: ctx.membership.userId,
          action: 'event.unpublished',
          entityType: 'Event',
          entityId: e.id,
        });
        return e;
      });
    },

    async setRegistration(
      ctx: EventContext,
      input: {
        status: 'NOT_OPEN' | 'OPEN' | 'CLOSED';
        opensAt?: string | null;
        closesAt?: string | null;
      },
    ) {
      assertWritable(ctx);
      if (input.status === 'OPEN' && ctx.event.status !== 'PUBLISHED') {
        throw AppError.conflict('not_published', 'Publish the event before opening registration');
      }
      return db.$transaction(async (tx) => {
        const e = await tx.event.update({
          where: { id: ctx.event.id },
          data: {
            registrationStatus: input.status,
            registrationOpensAt: input.opensAt ? new Date(input.opensAt) : null,
            registrationClosesAt: input.closesAt ? new Date(input.closesAt) : null,
            version: { increment: 1 },
          },
        });
        await writeAudit(tx, {
          eventId: e.id,
          actorId: ctx.membership.userId,
          action: 'registration.updated',
          entityType: 'Event',
          entityId: e.id,
          before: { registrationStatus: ctx.event.registrationStatus },
          after: {
            registrationStatus: e.registrationStatus,
            opensAt: e.registrationOpensAt,
            closesAt: e.registrationClosesAt,
          },
        });
        return e;
      });
    },

    async conclude(ctx: EventContext, confirmWithoutResults: boolean) {
      assertWritable(ctx);
      if (ctx.event.status !== 'PUBLISHED')
        throw AppError.conflict('not_published', 'Only a published event can be concluded');
      const hasResults =
        (await db.resultSnapshot.count({
          where: { eventId: ctx.event.id, publishedAt: { not: null }, unpublishedAt: null },
        })) > 0;
      if (!hasResults && !confirmWithoutResults) {
        throw AppError.conflict(
          'no_published_results',
          'No results have been published. Confirm to conclude the event without published results.',
        );
      }
      return db.$transaction(async (tx) => {
        const e = await tx.event.update({
          where: { id: ctx.event.id },
          data: {
            status: 'CONCLUDED',
            concludedAt: new Date(),
            registrationStatus: 'CLOSED',
            version: { increment: 1 },
          },
        });
        await writeAudit(tx, {
          eventId: e.id,
          actorId: ctx.membership.userId,
          action: 'event.concluded',
          entityType: 'Event',
          entityId: e.id,
        });
        return e;
      });
    },

    async archive(ctx: EventContext) {
      if (ctx.event.ownerId !== ctx.membership.userId)
        throw AppError.forbidden('Only the event owner can archive it');
      if (ctx.event.status !== 'CONCLUDED' || !ctx.event.concludedAt) {
        throw AppError.conflict('not_concluded', 'Conclude the event before archiving it');
      }
      if (Date.now() - ctx.event.concludedAt.getTime() < 7 * 864e5) {
        throw AppError.conflict(
          'too_early',
          'Archiving is available 7 days after the event is concluded',
        );
      }
      return db.$transaction(async (tx) => {
        const e = await tx.event.update({
          where: { id: ctx.event.id },
          data: { status: 'ARCHIVED', archivedAt: new Date(), version: { increment: 1 } },
        });
        await writeAudit(tx, {
          eventId: e.id,
          actorId: ctx.membership.userId,
          action: 'event.archived',
          entityType: 'Event',
          entityId: e.id,
        });
        return e;
      });
    },
    log: logger,
  };
}
export type EventService = ReturnType<typeof createEventService>;
