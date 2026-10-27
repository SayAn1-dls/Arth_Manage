import { randomInt } from 'node:crypto';
import { awardTextFor, certificateCode, type CertType } from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { writeAudit } from '../../audit/audit.js';
import type { Event, Round } from '../../generated/prisma/client.js';
import { renderCertificate, type Placement } from './render.js';

export interface Recipient {
  membershipId: string;
  name: string;
  teamName: string | null;
  awardKey: string;
  awardText: string | null;
}

/** Winner certificates come from the final round's published results; participation from the event's rule (PRD FR-231). */
export async function eligibleRecipients(
  deps: Deps,
  event: Event,
  type: CertType,
): Promise<Recipient[]> {
  const { db } = deps;
  const exceptions = await db.certificateException.findMany({ where: { eventId: event.id, type } });
  const base = new Map<string, Recipient>();

  const memberships = await db.eventMembership.findMany({
    where: {
      eventId: event.id,
      role: 'PARTICIPANT',
      status: 'ACTIVE',
      registration: { is: { status: 'ACTIVE' } },
    },
    include: {
      registration: true,
      teamMembers: { where: { leftAt: null, team: { status: 'ACTIVE' } }, include: { team: true } },
    },
  });
  const rounds = await db.round.findMany({
    where: { eventId: event.id },
    orderBy: { order: 'asc' },
  });

  if (type === 'PARTICIPATION') {
    const first = rounds[0];
    const submitted = first
      ? new Set(
          (
            await db.submission.findMany({
              where: { roundId: first.id, lastVersionNo: { gt: 0 } },
              select: { teamId: true },
            })
          ).map((s) => s.teamId),
        )
      : new Set<string>();
    const checkedIn = new Set(
      (
        await db.checkIn.findMany({
          where: { eventId: event.id, undoneAt: null },
          select: { membershipId: true },
        })
      ).map((c) => c.membershipId),
    );
    for (const m of memberships) {
      const tm = m.teamMembers[0];
      const ok =
        event.certParticipationRule === 'CHECKED_IN'
          ? Boolean(tm) && checkedIn.has(m.id)
          : Boolean(tm) && submitted.has(tm!.teamId);
      if (ok)
        base.set(m.id, {
          membershipId: m.id,
          name: m.registration!.certificateName,
          teamName: tm?.team.name ?? null,
          awardKey: '',
          awardText: null,
        });
    }
  } else {
    const final: Round | undefined = rounds[rounds.length - 1];
    const snap = final
      ? await db.resultSnapshot.findFirst({
          where: { roundId: final.id, publishedAt: { not: null }, unpublishedAt: null },
          orderBy: { publishedAt: 'desc' },
        })
      : null;
    if (final && snap) {
      const template = await db.certificateTemplate.findUnique({
        where: { eventId_type: { eventId: event.id, type: 'WINNER' } },
      });
      const texts = (template?.awardTexts ?? {}) as Record<string, string>;
      const entries = snap.entries as unknown as { teamId: string; rank: number; group: string }[];
      for (const e of entries.filter((x) => x.rank <= final.awardPositions)) {
        const awardText = awardTextFor(e.rank, e.group, final.rankingScope === 'PER_TRACK', texts);
        for (const m of memberships.filter((x) =>
          x.teamMembers.some((t) => t.teamId === e.teamId),
        )) {
          base.set(`${m.id}|R${final.order}:${e.rank}:${e.group}`, {
            membershipId: m.id,
            name: m.registration!.certificateName,
            teamName: m.teamMembers[0]?.team.name ?? null,
            awardKey: `R${final.order}:${e.rank}:${e.group}`,
            awardText,
          });
        }
      }
    }
  }

  // Admin decisions, with reasons, override the rules (PRD FR-231).
  for (const ex of exceptions) {
    const keys = [...base.keys()].filter(
      (k) => k === ex.membershipId || k.startsWith(`${ex.membershipId}|`),
    );
    if (!ex.include) keys.forEach((k) => base.delete(k));
    else if (!keys.length && type === 'PARTICIPATION') {
      const m = memberships.find((x) => x.id === ex.membershipId);
      if (m)
        base.set(m.id, {
          membershipId: m.id,
          name: m.registration!.certificateName,
          teamName: m.teamMembers[0]?.team.name ?? null,
          awardKey: '',
          awardText: null,
        });
    }
  }
  return [...base.values()];
}

export function createCertificateService(deps: Deps) {
  const { db, storage } = deps;

  async function templateFor(eventId: string, type: CertType) {
    return db.certificateTemplate.findUnique({ where: { eventId_type: { eventId, type } } });
  }

  async function render(
    event: Event,
    cert: {
      type: CertType;
      nameSnapshot: string;
      teamName: string | null;
      awardText: string | null;
      certificateCode: string;
      version: number;
    },
    createdAt: Date,
    over?: { watermark?: string },
  ) {
    const t = await templateFor(event.id, cert.type);
    return renderCertificate(
      {
        type: cert.type,
        recipientName: cert.nameSnapshot,
        eventName: event.name,
        teamName: cert.teamName,
        awardText: cert.awardText,
        date: createdAt,
        timeZone: event.timeZone,
        code: cert.certificateCode,
        verificationUrl: `${deps.env.APP_BASE_URL}/verify-certificate/${encodeURIComponent(cert.certificateCode)}`,
        placements: (t?.fields ?? []) as unknown as Placement[],
        backgroundKey: t?.backgroundKey ?? null,
        watermark: over?.watermark,
      },
      storage,
    );
  }

  const newCode = async (): Promise<string> => {
    for (let i = 0; i < 10; i++) {
      const code = certificateCode(randomInt);
      if (!(await db.certificate.findUnique({ where: { certificateCode: code } }))) return code;
    }
    throw new Error('Could not allocate a certificate code');
  };

  /**
   * Creates one certificate per (event, person, type, award). Re-running only adds newly eligible people,
   * flags holders who are no longer eligible and marks changed names for regeneration (PRD FR-232).
   * Idempotent and safe to run twice at once: the unique key makes the second creation a no-op.
   */
  async function runGeneration(event: Event, type: CertType, jobId: string, actorId: string) {
    try {
      const people = await eligibleRecipients(deps, event, type);
      await db.certificateJob.update({ where: { id: jobId }, data: { total: people.length } });
      let done = 0;
      let failed = 0;
      for (const p of people) {
        try {
          const existing = await db.certificate.findUnique({
            where: {
              eventId_membershipId_type_awardKey: {
                eventId: event.id,
                membershipId: p.membershipId,
                type,
                awardKey: p.awardKey,
              },
            },
          });
          if (existing) {
            if (existing.status === 'FLAGGED')
              await db.certificate.update({
                where: { id: existing.id },
                data: {
                  status: existing.releasedAt ? 'RELEASED' : 'GENERATED',
                  flaggedReason: null,
                },
              });
            if (existing.nameSnapshot !== p.name && existing.status !== 'REVOKED')
              await db.certificate.update({
                where: { id: existing.id },
                data: { status: 'NEEDS_REGENERATION' },
              });
          } else {
            const code = await newCode();
            const now = new Date();
            const pdfKey = `events/${event.id}/certificates/${code}-v1.pdf`;
            const bytes = await render(
              event,
              {
                type,
                nameSnapshot: p.name,
                teamName: p.teamName,
                awardText: p.awardText,
                certificateCode: code,
                version: 1,
              },
              now,
            );
            await storage.put(pdfKey, Buffer.from(bytes));
            try {
              await db.certificate.create({
                data: {
                  certificateCode: code,
                  eventId: event.id,
                  membershipId: p.membershipId,
                  type,
                  awardKey: p.awardKey,
                  awardText: p.awardText,
                  nameSnapshot: p.name,
                  teamName: p.teamName,
                  pdfKey,
                },
              });
            } catch (err) {
              if (!(typeof err === 'object' && err && 'code' in err && err.code === 'P2002'))
                throw err; // a parallel run created it first
            }
          }
          done += 1;
        } catch (err) {
          failed += 1;
          deps.logger.error(
            { err, membershipId: p.membershipId },
            'certificate generation failed for one person',
          );
        }
        await db.certificateJob.update({ where: { id: jobId }, data: { done, failed } });
      }
      // Holders who no longer qualify are flagged for review, never silently deleted.
      const keep = new Set(people.map((p) => `${p.membershipId}|${p.awardKey}`));
      const holders = await db.certificate.findMany({
        where: {
          eventId: event.id,
          type,
          status: { in: ['GENERATED', 'RELEASED', 'NEEDS_REGENERATION'] },
        },
      });
      for (const h of holders) {
        if (!keep.has(`${h.membershipId}|${h.awardKey}`))
          await db.certificate.update({
            where: { id: h.id },
            data: { status: 'FLAGGED', flaggedReason: 'No longer eligible' },
          });
      }
      await db.certificateJob.update({
        where: { id: jobId },
        data: { status: 'DONE', finishedAt: new Date(), done, failed },
      });
      await writeAudit(db, {
        eventId: event.id,
        actorId,
        action: 'certificates.generated',
        entityType: 'CertificateJob',
        entityId: jobId,
        after: { type, total: people.length, done, failed },
      });
    } catch (err) {
      deps.logger.error({ err }, 'certificate job failed');
      await db.certificateJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          error: 'Generation stopped unexpectedly. Run it again; finished certificates are kept.',
          finishedAt: new Date(),
        },
      });
    }
  }

  /** Re-renders a certificate's PDF under the same code and an incremented version; the old file is never served again. */
  async function regenerate(event: Event, certId: string, newName?: string) {
    const c = await db.certificate.findUniqueOrThrow({ where: { id: certId } });
    const reg = await db.registration.findUnique({ where: { membershipId: c.membershipId } });
    const name = newName ?? reg?.certificateName ?? c.nameSnapshot;
    const version = c.version + 1;
    const pdfKey = `events/${event.id}/certificates/${c.certificateCode}-v${version}.pdf`;
    const bytes = await render(
      event,
      {
        type: c.type,
        nameSnapshot: name,
        teamName: c.teamName,
        awardText: c.awardText,
        certificateCode: c.certificateCode,
        version,
      },
      c.createdAt,
    );
    await storage.put(pdfKey, Buffer.from(bytes));
    return db.certificate.update({
      where: { id: c.id },
      data: {
        nameSnapshot: name,
        pdfKey,
        version,
        status: c.releasedAt ? 'RELEASED' : 'GENERATED',
      },
    });
  }

  return { runGeneration, regenerate, render, templateFor };
}
export type CertificateService = ReturnType<typeof createCertificateService>;
