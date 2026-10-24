import { Router } from 'express';
import {
  guidebookDraftSchema,
  guidebookPublishSchema,
  type GuidebookSection,
} from '@arthakram/shared';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { assertWritable } from './service.js';
import { renderGuidebookPdf } from './pdf.js';

/** Guidebook editor and published versions (PRD A.4). Drafts are admin-only; everyone else sees the latest published version. */
export function guidebookRouter({ db, logger }: Deps) {
  const router = Router({ mergeParams: true });

  router.get('/guidebook/draft', requireAction('event.edit'), async (req, res) => {
    const gb = await db.guidebook.findUnique({ where: { eventId: requireCtx(req).event.id } });
    if (!gb) throw AppError.notFound();
    const latest = await db.guidebookVersion.findFirst({
      where: { eventId: gb.eventId },
      orderBy: { versionNo: 'desc' },
    });
    res.json({
      sections: gb.sections as unknown as GuidebookSection[],
      version: gb.version,
      updatedAt: gb.updatedAt,
      latestPublishedVersion: latest?.versionNo ?? null,
    });
  });

  // Autosave target. Optimistic lock so two admins never silently overwrite each other (PRD 6.0-3).
  router.put('/guidebook/draft', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const input = parse(guidebookDraftSchema, req.body);
    const result = await db.guidebook.updateMany({
      where: { eventId: ctx.event.id, version: input.version },
      data: {
        sections: input.sections,
        version: { increment: 1 },
        updatedById: ctx.membership.userId,
      },
    });
    if (result.count === 0) {
      throw AppError.conflict(
        'stale_version',
        'The guidebook was changed by someone else. Reload to see the latest version.',
      );
    }
    const gb = await db.guidebook.findUniqueOrThrow({ where: { eventId: ctx.event.id } });
    res.json({ version: gb.version, updatedAt: gb.updatedAt });
  });

  router.post('/guidebook/publish', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    assertWritable(ctx);
    const input = parse(guidebookPublishSchema, req.body);
    const out = await db.$transaction(async (tx) => {
      const gb = await tx.guidebook.findUnique({ where: { eventId: ctx.event.id } });
      if (!gb) throw AppError.notFound();
      if (gb.version !== input.version) {
        throw AppError.conflict(
          'stale_version',
          'The guidebook changed since you loaded it. Reload before publishing.',
        );
      }
      const sections = (gb.sections as unknown as GuidebookSection[]).filter((s) => !s.hidden);
      if (sections.length === 0)
        throw AppError.invalid('Show at least one section before publishing');
      const last = await tx.guidebookVersion.findFirst({
        where: { eventId: ctx.event.id },
        orderBy: { versionNo: 'desc' },
      });
      const versionNo = (last?.versionNo ?? 0) + 1;
      const v = await tx.guidebookVersion.create({
        data: {
          eventId: ctx.event.id,
          versionNo,
          sections,
          changeNote: input.changeNote ?? null,
          publishedById: ctx.membership.userId,
        },
      });
      await writeAudit(tx, {
        eventId: ctx.event.id,
        actorId: ctx.membership.userId,
        action: 'guidebook.published',
        entityType: 'Guidebook',
        entityId: v.id,
        after: { versionNo },
        reason: input.changeNote ?? null,
      });
      return v;
    });
    res.status(201).json({ versionNo: out.versionNo, publishedAt: out.publishedAt });
  });

  router.get('/guidebook/versions', requireAction('event.edit'), async (req, res) => {
    const versions = await db.guidebookVersion.findMany({
      where: { eventId: requireCtx(req).event.id },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true, changeNote: true, publishedAt: true },
    });
    res.json({ versions });
  });

  // Latest published version for every role in the event (judges and staff read it too).
  router.get('/guidebook', requireAction('event.view'), async (req, res) => {
    const v = await db.guidebookVersion.findFirst({
      where: { eventId: requireCtx(req).event.id },
      orderBy: { versionNo: 'desc' },
    });
    if (!v)
      return void res.json({ published: false, sections: [], versionNo: null, publishedAt: null });
    res.json({
      published: true,
      sections: v.sections as unknown as GuidebookSection[],
      versionNo: v.versionNo,
      publishedAt: v.publishedAt,
    });
  });

  router.get('/guidebook/pdf', requireAction('event.view'), async (req, res) => {
    const ctx = requireCtx(req);
    const wantDraft = req.query.draft === '1';
    if (wantDraft && ctx.membership.role !== 'ADMIN') throw AppError.notFound(); // drafts are admin-only
    try {
      let sections: GuidebookSection[];
      let versionLabel: string;
      let dateLabel: Date;
      if (wantDraft) {
        const gb = await db.guidebook.findUnique({ where: { eventId: ctx.event.id } });
        if (!gb) throw AppError.notFound();
        sections = (gb.sections as unknown as GuidebookSection[]).filter((s) => !s.hidden);
        versionLabel = 'Draft';
        dateLabel = gb.updatedAt;
      } else {
        const v = await db.guidebookVersion.findFirst({
          where: { eventId: ctx.event.id },
          orderBy: { versionNo: 'desc' },
        });
        if (!v)
          throw AppError.conflict('not_published', 'The guidebook has not been published yet');
        sections = v.sections as unknown as GuidebookSection[];
        versionLabel = `Version ${v.versionNo}`;
        dateLabel = v.publishedAt;
      }
      const bytes = await renderGuidebookPdf({
        eventName: ctx.event.name,
        timeZone: ctx.event.timeZone,
        versionLabel,
        date: dateLabel,
        sections,
        watermark: wantDraft ? 'DRAFT' : undefined,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${ctx.event.slug}-guidebook${wantDraft ? '-draft' : ''}.pdf"`,
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(Buffer.from(bytes));
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error({ err }, 'guidebook pdf failed');
      throw new AppError(
        503,
        'pdf_unavailable',
        'The PDF is temporarily unavailable. The web version is still available.',
      );
    }
  });

  return router;
}
