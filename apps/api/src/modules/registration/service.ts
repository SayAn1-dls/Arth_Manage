import type { RegisterForEventInput } from '@arthakram/shared';
import { checkHttpUrl } from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { AppError } from '../../http/errors.js';
import { writeAudit } from '../../audit/audit.js';
import type { Event, RegistrationFieldDef, User } from '../../generated/prisma/client.js';
import { effectiveRegistration } from '../events/registrationState.js';
import { createSoloTeam } from '../teams/service.js';

type Answers = Record<string, string | number | boolean>;

/** Validates custom answers against the organiser's field definitions (PRD FR-015). Hidden fields are ignored. */
export function validateAnswers(
  defs: RegistrationFieldDef[],
  answers: Answers,
  { partial = false } = {},
): { clean: Answers; errors: Record<string, string> } {
  const clean: Answers = {};
  const errors: Record<string, string> = {};
  for (const def of defs.filter((d) => !d.hidden)) {
    const key = `answers.${def.id}`;
    const raw = answers[def.id];
    const empty =
      raw === undefined ||
      raw === '' ||
      raw === null ||
      (def.type === 'CHECKBOX' && raw === false && def.required);
    if (empty) {
      if (def.required && !partial) errors[key] = `${def.label} is required`;
      continue;
    }
    switch (def.type) {
      case 'SHORT_TEXT':
        if (typeof raw !== 'string' || raw.length > 120)
          errors[key] = 'Keep this under 120 characters';
        else clean[def.id] = raw.trim();
        break;
      case 'LONG_TEXT':
        if (typeof raw !== 'string' || raw.length > 5000)
          errors[key] = 'Keep this under 5,000 characters';
        else clean[def.id] = raw.trim();
        break;
      case 'NUMBER': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) errors[key] = 'Enter a number';
        else clean[def.id] = n;
        break;
      }
      case 'SELECT':
        if (typeof raw !== 'string' || !def.options.includes(raw))
          errors[key] = 'Choose one of the listed options';
        else clean[def.id] = raw;
        break;
      case 'URL': {
        const msg = typeof raw === 'string' ? checkHttpUrl(raw) : 'Enter a valid link';
        if (msg) errors[key] = msg;
        else clean[def.id] = String(raw).trim();
        break;
      }
      case 'CHECKBOX':
        clean[def.id] = raw === true || raw === 'true';
        break;
    }
  }
  return { clean, errors };
}

export function createRegistrationService({ db, email, env }: Deps) {
  return {
    async publicForm(event: Event) {
      const custom = await db.registrationFieldDef.findMany({
        where: { eventId: event.id, hidden: false },
        orderBy: [{ order: 'asc' }, { label: 'asc' }],
      });
      return {
        registration: effectiveRegistration(event),
        declarations: event.declarations,
        soloTeams: event.teamMax === 1,
        customFields: custom.map((f) => ({
          id: f.id,
          label: f.label,
          type: f.type,
          helpText: f.helpText,
          options: f.options,
          required: f.required,
        })),
      };
    },

    /** Registers the signed-in user as a participant (PRD FR-051). Idempotent: a second submit lands on the dashboard. */
    async register(user: User, event: Event, input: RegisterForEventInput) {
      if (event.status !== 'PUBLISHED') throw AppError.notFound();
      const state = effectiveRegistration(event);
      const existing = await db.eventMembership.findUnique({
        where: { eventId_userId: { eventId: event.id, userId: user.id } },
        include: { registration: true },
      });

      if (existing) {
        if (existing.role !== 'PARTICIPANT') {
          const roleName = {
            ADMIN: 'a core admin',
            JUDGE: 'a judge',
            STAFF: 'helping staff',
            PARTICIPANT: 'a participant',
          }[existing.role];
          throw AppError.conflict(
            'role_conflict',
            `You are already ${roleName} in this event, and a person can hold only one role per event.`,
          );
        }
        if (existing.status === 'REMOVED')
          throw AppError.forbidden(
            'You can no longer register for this event. Contact the organisers.',
          );
        if (existing.registration && existing.registration.status === 'ACTIVE') {
          return { eventId: event.id, alreadyRegistered: true };
        }
      }
      if (state !== 'OPEN') {
        throw AppError.conflict(
          'registration_closed',
          state === 'CLOSED' ? 'Registration is closed' : 'Registration is not open yet',
        );
      }

      const fieldErrors: Record<string, string> = {};
      if (
        input.declarations.length !== event.declarations.length ||
        input.declarations.some((d) => d !== true)
      ) {
        fieldErrors.declarations = 'Tick every declaration to register';
      }
      const defs = await db.registrationFieldDef.findMany({ where: { eventId: event.id } });
      const { clean, errors } = validateAnswers(defs, input.answers);
      Object.assign(fieldErrors, errors);
      if (Object.keys(fieldErrors).length)
        throw AppError.invalid('Please fix the highlighted fields', fieldErrors);

      try {
        await db.$transaction(async (tx) => {
          const membership =
            existing ??
            (await tx.eventMembership.create({
              data: { eventId: event.id, userId: user.id, role: 'PARTICIPANT' },
            }));
          const data = {
            fullName: input.fullName,
            phone: input.phone ?? null,
            institution: input.institution,
            course: input.course ?? null,
            yearOfStudy: input.yearOfStudy ?? null,
            certificateName: input.certificateName ?? input.fullName,
            answers: clean,
            declarationsAcceptedAt: new Date(),
            status: 'ACTIVE' as const,
          };
          if (existing?.registration) {
            await tx.registration.update({
              where: { id: existing.registration.id },
              data: { ...data, version: { increment: 1 } },
            });
          } else {
            await tx.registration.create({
              data: { eventId: event.id, membershipId: membership.id, ...data },
            });
          }
          if (event.teamMax === 1) await createSoloTeam(tx, event, membership.id, input.fullName);
          await writeAudit(tx, {
            eventId: event.id,
            actorId: user.id,
            action: existing ? 'registration.reactivated' : 'registration.created',
            entityType: 'Registration',
            entityId: membership.id,
          });
        });
      } catch (err) {
        // Two concurrent submits: the unique membership/registration constraints let exactly one win.
        if (typeof err === 'object' && err && 'code' in err && err.code === 'P2002')
          return { eventId: event.id, alreadyRegistered: true };
        throw err;
      }
      await email.send({
        to: user.email,
        subject: `You're registered for ${event.name}`,
        body: `Hi ${input.fullName}, your registration for ${event.name} is confirmed. Create or join a team to take part.`,
        link: `${env.APP_BASE_URL}/events/${event.id}`,
      });
      return { eventId: event.id, alreadyRegistered: false };
    },
  };
}
export type RegistrationService = ReturnType<typeof createRegistrationService>;
