import express, { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  CERT_TYPES,
  DEFAULT_PLACEMENTS,
  certTemplateSchema,
  exceptionSchema,
  nameCorrectionSchema,
  releaseSchema,
  type CertType,
} from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAuth } from '../../auth/middleware.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx, requireUser, type EventContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { sendCsv, toCsv } from '../../exports/csv.js';
import { assertWritable } from '../events/service.js';
import { adminOnly } from '../judging/common.js';
import { sniffFileType } from '../../storage/validate.js';
import { createCertificateService, eligibleRecipients } from './service.js';
import type { Placement } from './render.js';

const typeSchema = z.enum(CERT_TYPES);

/** Certificate templates, generation, review, release, downloads, corrections (PRD Module I). */
export function certificatesRouter(deps: Deps) {
  const { db, storage } = deps;
  const svc = createCertificateService(deps);
  const router = Router({ mergeParams: true });
  const me = Router();

  const dto = (c: Awaited<ReturnType<typeof db.certificate.findMany>>[number]) => ({
    id: c.id,
    code: c.certificateCode,
    type: c.type,
    awardText: c.awardText,
    name: c.nameSnapshot,
    teamName: c.teamName,
    version: c.version,
    status: c.status,
    releasedAt: c.releasedAt,
    revokedReason: c.revokedReason,
    flaggedReason: c.flaggedReason,
    membershipId: c.membershipId,
  });

  // ── Templates ──
  router.get('/certificates/templates', requireAction('certificates.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    const rows = await db.certificateTemplate.findMany({ where: { eventId: ctx.event.id } });
    res.json({
      templates: CERT_TYPES.map((type) => {
        const t = rows.find((r) => r.type === type);
        return {
          type,
          hasBackground: Boolean(t?.backgroundKey),
          backgroundName: t?.backgroundName ?? null,
          fields: (t?.fields as unknown as Placement[])?.length ? t!.fields : DEFAULT_PLACEMENTS,
          awardTexts: t?.awardTexts ?? {},
          version: t?.version ?? 0,
        };
      }),
    });
  });

  router.put(
    '/certificates/templates/:type',
    requireAction('certificates.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const type = parse(typeSchema, req.params.type);
      const input = parse(certTemplateSchema, req.body);
      await db.$transaction(async (tx) => {
        await tx.certificateTemplate.upsert({
          where: { eventId_type: { eventId: ctx.event.id, type } },
          update: { fields: input.fields, awardTexts: input.awardTexts, version: { increment: 1 } },
          create: {
            eventId: ctx.event.id,
            type,
            fields: input.fields,
            awardTexts: input.awardTexts,
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'certificate_template.updated',
          entityType: 'CertificateTemplate',
          entityId: type,
          after: { fields: input.fields.length },
        });
      });
      res.json({ ok: true });
    },
  );

  // Background image: PNG or JPG up to 10 MB, checked by signature; small images get a warning, not a rejection.
  router.put(
    '/certificates/templates/:type/background',
    requireAction('certificates.manage'),
    express.raw({ type: () => true, limit: '11mb' }),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const type = parse(typeSchema, req.params.type);
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const kind = sniffFileType(bytes, 'png');
      if (bytes.length === 0 || (kind !== 'png' && kind !== 'jpg'))
        throw AppError.invalid('Upload a PNG or JPG image', {
          background: 'Only PNG or JPG images are accepted',
        });
      if (bytes.length > 10 * 1024 * 1024)
        throw AppError.invalid('The image is larger than 10 MB', {
          background: 'Keep the image under 10 MB',
        });
      const { width, height } = imageSize(bytes, kind);
      const key = `events/${ctx.event.id}/certificate-backgrounds/${randomUUID()}.${kind === 'png' ? 'png' : 'jpg'}`;
      await storage.put(key, bytes);
      await db.$transaction(async (tx) => {
        await tx.certificateTemplate.upsert({
          where: { eventId_type: { eventId: ctx.event.id, type } },
          update: {
            backgroundKey: key,
            backgroundName: String(req.get('x-filename') ?? 'background'),
            version: { increment: 1 },
          },
          create: {
            eventId: ctx.event.id,
            type,
            backgroundKey: key,
            backgroundName: String(req.get('x-filename') ?? 'background'),
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'certificate_template.background_uploaded',
          entityType: 'CertificateTemplate',
          entityId: type,
        });
      });
      res.status(201).json({
        width,
        height,
        warning:
          width < 2480 || height < 1754
            ? 'This image is smaller than the recommended 2480 × 1754 px, so print quality may suffer.'
            : null,
      });
    },
  );

  router.get(
    '/certificates/templates/:type/background',
    requireAction('certificates.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      const t = await db.certificateTemplate.findUnique({
        where: {
          eventId_type: { eventId: ctx.event.id, type: parse(typeSchema, req.params.type) },
        },
      });
      if (!t?.backgroundKey) throw AppError.notFound();
      const bytes = await storage.get(t.backgroundKey);
      res.setHeader('Content-Type', bytes[0] === 0x89 ? 'image/png' : 'image/jpeg');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(bytes);
    },
  );

  // Preview with a sample name, or with the longest real name so overflow is visible before generating (PRD FR-230).
  router.post(
    '/certificates/templates/:type/preview',
    requireAction('certificates.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      const type = parse(typeSchema, req.params.type);
      const { useLongestName } = parse(
        z.object({ useLongestName: z.boolean().default(false) }).strict(),
        req.body ?? {},
      );
      let name = 'Aarav Kumar Mehta';
      if (useLongestName) {
        const regs = await db.registration.findMany({
          where: { eventId: ctx.event.id, status: 'ACTIVE' },
          select: { certificateName: true },
        });
        name = regs.map((r) => r.certificateName).sort((a, b) => b.length - a.length)[0] ?? name;
      }
      const bytes = await svc.render(
        ctx.event,
        {
          type,
          nameSnapshot: name,
          teamName: 'Sample Team',
          awardText: type === 'WINNER' ? 'First Place' : null,
          certificateCode: 'CERT-PREVIEW',
          version: 0,
        },
        new Date(),
        { watermark: 'PREVIEW' },
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
      res.send(Buffer.from(bytes));
    },
  );

  // ── Generation (background job with visible progress) ──
  router.get(
    '/certificates/eligibility/:type',
    requireAction('certificates.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      const type = parse(typeSchema, req.params.type);
      const people = await eligibleRecipients(deps, ctx.event, type);
      const existing = await db.certificate.count({ where: { eventId: ctx.event.id, type } });
      res.json({
        eligible: people.length,
        existing,
        names: people.slice(0, 20).map((p) => p.name),
      });
    },
  );

  router.post('/certificates/generate', requireAction('certificates.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const { type } = parse(z.object({ type: typeSchema }).strict(), req.body);
    if (type === 'WINNER') {
      const rounds = await db.round.findMany({
        where: { eventId: ctx.event.id },
        orderBy: { order: 'desc' },
        take: 1,
      });
      const published = rounds[0]
        ? await db.resultSnapshot.count({
            where: { roundId: rounds[0].id, publishedAt: { not: null }, unpublishedAt: null },
          })
        : 0;
      if (!published)
        throw AppError.conflict(
          'results_not_published',
          "Winner certificates need the final round's results to be published first.",
        );
    }
    const running = await db.certificateJob.findFirst({
      where: {
        eventId: ctx.event.id,
        type,
        status: 'RUNNING',
        startedAt: { gt: new Date(Date.now() - 15 * 60_000) },
      },
    });
    if (running) return void res.status(202).json({ jobId: running.id, alreadyRunning: true });
    const job = await db.certificateJob.create({ data: { eventId: ctx.event.id, type } });
    const run = svc.runGeneration(ctx.event, type, job.id, ctx.membership.userId);
    if (req.query.wait === '1')
      await run; // used by tests and small events; the UI polls the job instead
    else void run;
    res.status(202).json({ jobId: job.id });
  });

  router.get(
    '/certificates/jobs/:jobId',
    requireAction('certificates.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      const j = await db.certificateJob.findFirst({
        where: { id: String(req.params.jobId), eventId: ctx.event.id },
      });
      if (!j) throw AppError.notFound();
      res.json({
        id: j.id,
        type: j.type,
        status: j.status,
        total: j.total,
        done: j.done,
        failed: j.failed,
        error: j.error,
      });
    },
  );

  // ── Review list ──
  router.get('/certificates', requireAction('certificates.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    const type = req.query.type ? parse(typeSchema, req.query.type) : undefined;
    const status = String(req.query.status ?? '');
    const q = String(req.query.q ?? '').trim();
    const rows = await db.certificate.findMany({
      where: {
        eventId: ctx.event.id,
        ...(type ? { type } : {}),
        ...(status ? { status: status as never } : {}),
        ...(q
          ? {
              OR: [
                { nameSnapshot: { contains: q, mode: 'insensitive' } },
                { certificateCode: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ type: 'asc' }, { nameSnapshot: 'asc' }],
      take: 2000,
    });
    const counts = await db.certificate.groupBy({
      by: ['type', 'status'],
      where: { eventId: ctx.event.id },
      _count: true,
    });
    res.json({
      certificates: rows.map(dto),
      counts: counts.map((c) => ({ type: c.type, status: c.status, n: c._count })),
    });
  });

  router.get('/certificates/export.csv', requireAction('export.csv'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    const rows = await db.certificate.findMany({
      where: { eventId: ctx.event.id },
      orderBy: [{ type: 'asc' }, { nameSnapshot: 'asc' }],
    });
    await writeAudit(db, {
      eventId: ctx.event.id,
      actorId: ctx.membership.userId,
      action: 'export.certificates',
      entityType: 'Export',
      after: { rows: rows.length },
    });
    sendCsv(
      res,
      `${ctx.event.slug}-certificates.csv`,
      toCsv(
        ['Certificate ID', 'Type', 'Award', 'Name', 'Team', 'Version', 'Status', 'Released at'],
        rows.map((c) => [
          c.certificateCode,
          c.type,
          c.awardText,
          c.nameSnapshot,
          c.teamName,
          c.version,
          c.status,
          c.releasedAt,
        ]),
      ),
    );
  });

  async function load(ctx: EventContext, id: string) {
    const c = await db.certificate.findFirst({ where: { id, eventId: ctx.event.id } });
    if (!c) throw AppError.notFound();
    return c;
  }

  // ── Release (per type or selection) needs the reviewed confirmation and no unresolved flags (PRD FR-233/234) ──
  router.post('/certificates/release', requireAction('certificates.release'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const { type, ids } = parse(releaseSchema, req.body);
    const scope = { eventId: ctx.event.id, type, ...(ids ? { id: { in: ids } } : {}) };
    const blocking = await db.certificate.count({
      where: { ...scope, status: { in: ['FLAGGED', 'NEEDS_REGENERATION'] } },
    });
    if (blocking)
      throw AppError.conflict(
        'unresolved_flags',
        `${blocking} certificate(s) are flagged or need regeneration. Resolve or acknowledge them before releasing.`,
      );
    const result = await db.$transaction(async (tx) => {
      const r = await tx.certificate.updateMany({
        where: { ...scope, status: 'GENERATED' },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'certificates.released',
        entityType: 'Certificate',
        after: { type, count: r.count, selected: ids?.length ?? null },
      });
      return r;
    });
    res.json({ released: result.count });
  });

  router.post(
    '/certificates/:id/revoke',
    requireAction('certificates.release'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const { reason } = parse(
        z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) }).strict(),
        req.body,
      );
      const c = await load(ctx, String(req.params.id));
      await db.$transaction(async (tx) => {
        await tx.certificate.update({
          where: { id: c.id },
          data: { status: 'REVOKED', revokedReason: reason },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'certificate.revoked',
          entityType: 'Certificate',
          entityId: c.id,
          reason,
        });
      });
      res.json({ ok: true });
    },
  );

  router.post(
    '/certificates/:id/unrevoke',
    requireAction('certificates.release'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const c = await load(ctx, String(req.params.id));
      if (c.status !== 'REVOKED')
        throw AppError.conflict('not_revoked', 'Only a revoked certificate can be restored');
      await db.$transaction(async (tx) => {
        await tx.certificate.update({
          where: { id: c.id },
          data: { status: c.releasedAt ? 'RELEASED' : 'GENERATED', revokedReason: null },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'certificate.restored',
          entityType: 'Certificate',
          entityId: c.id,
        });
      });
      res.json({ ok: true });
    },
  );

  router.post(
    '/certificates/:id/acknowledge',
    requireAction('certificates.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const c = await load(ctx, String(req.params.id));
      if (c.status !== 'FLAGGED')
        throw AppError.conflict('not_flagged', 'Only a flagged certificate can be acknowledged');
      await db.$transaction(async (tx) => {
        await tx.certificate.update({
          where: { id: c.id },
          data: { status: c.releasedAt ? 'RELEASED' : 'GENERATED', flaggedReason: null },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'certificate.flag_acknowledged',
          entityType: 'Certificate',
          entityId: c.id,
          reason: c.flaggedReason,
        });
      });
      res.json({ ok: true });
    },
  );

  router.post(
    '/certificates/:id/regenerate',
    requireAction('certificates.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const c = await load(ctx, String(req.params.id));
      const updated = await svc.regenerate(ctx.event, c.id);
      await writeAudit(db, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'certificate.regenerated',
        entityType: 'Certificate',
        entityId: c.id,
        after: { version: updated.version },
      });
      res.json(dto(updated));
    },
  );

  router.put('/certificates/exceptions', requireAction('certificates.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const input = parse(exceptionSchema, req.body);
    if (
      !(await db.eventMembership.findFirst({
        where: { id: input.membershipId, eventId: ctx.event.id, role: 'PARTICIPANT' },
      }))
    )
      throw AppError.notFound();
    await db.$transaction(async (tx) => {
      await tx.certificateException.upsert({
        where: {
          eventId_membershipId_type: {
            eventId: ctx.event.id,
            membershipId: input.membershipId,
            type: input.type,
          },
        },
        update: { include: input.include, reason: input.reason, createdBy: ctx.membership.userId },
        create: {
          eventId: ctx.event.id,
          membershipId: input.membershipId,
          type: input.type,
          include: input.include,
          reason: input.reason,
          createdBy: ctx.membership.userId,
        },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: input.include ? 'certificate.person_included' : 'certificate.person_excluded',
        entityType: 'EventMembership',
        entityId: input.membershipId,
        after: { type: input.type },
        reason: input.reason,
      });
    });
    res.json({ ok: true });
  });

  // ── Name corrections (PRD FR-236) ──
  router.get(
    '/certificates/corrections',
    requireAction('certificates.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      const rows = await db.nameCorrection.findMany({
        where: { certificate: { eventId: ctx.event.id } },
        include: { certificate: true },
        orderBy: { createdAt: 'desc' },
      });
      res.json({
        corrections: rows.map((r) => ({
          id: r.id,
          status: r.status,
          requestedName: r.requestedName,
          currentName: r.certificate.nameSnapshot,
          code: r.certificate.certificateCode,
          type: r.certificate.type,
          decisionNote: r.decisionNote,
          createdAt: r.createdAt,
        })),
      });
    },
  );

  router.post(
    '/certificates/corrections/:correctionId/decide',
    requireAction('certificates.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const { approve, note } = parse(
        z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }).strict(),
        req.body,
      );
      const r = await db.nameCorrection.findFirst({
        where: {
          id: String(req.params.correctionId),
          status: 'PENDING',
          certificate: { eventId: ctx.event.id },
        },
        include: { certificate: true },
      });
      if (!r) throw AppError.notFound();
      if (!approve && !(note ?? '').trim())
        throw AppError.invalid('Tell the participant why it was declined', {
          note: 'A reason is required',
        });
      if (approve) {
        await db.registration.update({
          where: { membershipId: r.certificate.membershipId },
          data: { certificateName: r.requestedName, version: { increment: 1 } },
        });
        await svc.regenerate(ctx.event, r.certificateId, r.requestedName);
      }
      await db.$transaction(async (tx) => {
        await tx.nameCorrection.update({
          where: { id: r.id },
          data: {
            status: approve ? 'APPROVED' : 'DECLINED',
            decisionNote: note ?? null,
            decidedById: ctx.membership.userId,
          },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: approve ? 'certificate.name_corrected' : 'certificate.name_correction_declined',
          entityType: 'Certificate',
          entityId: r.certificateId,
          before: { name: r.certificate.nameSnapshot },
          after: { name: r.requestedName },
          reason: note ?? null,
        });
      });
      res.json({ ok: true });
    },
  );

  router.post(
    '/certificates/:id/correction-request',
    requireAction('certificates.download'),
    async (req, res) => {
      const ctx = requireCtx(req);
      assertWritable(ctx);
      const { name } = parse(nameCorrectionSchema, req.body);
      const c = await load(ctx, String(req.params.id));
      if (c.membershipId !== ctx.membership.id || !c.releasedAt) throw AppError.notFound();
      if (await db.nameCorrection.findFirst({ where: { certificateId: c.id, status: 'PENDING' } }))
        throw AppError.conflict(
          'pending',
          'A correction request is already waiting for the organisers.',
        );
      await db.$transaction(async (tx) => {
        await tx.nameCorrection.create({ data: { certificateId: c.id, requestedName: name } });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'certificate.name_correction_requested',
          entityType: 'Certificate',
          entityId: c.id,
          after: { name },
        });
      });
      res.status(201).json({ ok: true });
    },
  );

  // ── Own certificates and downloads: released only, never anyone else's (PRD FR-235) ──
  const downloadable = (c: { status: string; releasedAt: Date | null }) =>
    Boolean(c.releasedAt) && c.status !== 'REVOKED' && c.status !== 'FLAGGED';

  router.get('/certificates/mine', requireAction('certificates.download'), async (req, res) => {
    const ctx = requireCtx(req);
    const rows = await db.certificate.findMany({
      where: { eventId: ctx.event.id, membershipId: ctx.membership.id, releasedAt: { not: null } },
      orderBy: { type: 'asc' },
    });
    res.json({
      certificates: rows.map((c) => ({
        ...dto(c),
        downloadable: downloadable(c),
        withdrawn: c.status === 'REVOKED',
        correctionPending: false,
      })),
    });
  });

  router.get('/certificates/:id/pdf', requireAction('certificates.download'), async (req, res) => {
    const ctx = requireCtx(req);
    const c = await load(ctx, String(req.params.id));
    const admin = ctx.membership.role === 'ADMIN';
    if (!admin && (c.membershipId !== ctx.membership.id || !downloadable(c)))
      throw AppError.notFound();
    const bytes = await storage.get(c.pdfKey);
    const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${slug(ctx.event.slug)}-${c.type === 'WINNER' ? 'Winner' : 'Participation'}-${slug(c.nameSnapshot)}.pdf"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(bytes);
  });

  // Across all of the signed-in user's events (PRD FR-235 "My certificates").
  me.get('/me/certificates', requireAuth, async (req, res) => {
    const user = requireUser(req);
    const memberships = await db.eventMembership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { event: true },
    });
    const rows = await db.certificate.findMany({
      where: { releasedAt: { not: null }, membershipId: { in: memberships.map((m) => m.id) } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      certificates: rows.map((c) => {
        const m = memberships.find((x) => x.id === c.membershipId)!;
        return {
          ...dto(c),
          eventId: m.event.id,
          eventName: m.event.name,
          downloadable: downloadable(c),
          withdrawn: c.status === 'REVOKED',
        };
      }),
    });
  });

  return { router, me };
}

/** Image dimensions from the PNG or JPEG header, so a too-small background can be warned about. */
function imageSize(bytes: Buffer, kind: 'png' | 'jpg'): { width: number; height: number } {
  if (kind === 'png') return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1]!;
    const len = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return { width: 0, height: 0 };
}

export type { CertType };
