import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../../http/deps.js';
import { requireCtx } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { adminOnly, judgeOnly, loadRound } from './common.js';
import { assertWritable } from '../events/service.js';
import { writeAudit } from '../../audit/audit.js';
import { createBrandDocument, PDF_COLORS, safeText, wrapText } from '../../pdf/brand.js';
import { repositoryReading, aiReading } from './insights.js';

export function judgeToolsRouter({ db, storage, env, limit }: Deps) {
  const r = Router({ mergeParams: true });
  const ownerAssignment = async (c: ReturnType<typeof requireCtx>, id: string) => {
    judgeOnly(c);
    const a = await db.judgeAssignment.findFirst({
      where: {
        id,
        eventId: c.event.id,
        judgeMembershipId: c.membership.id,
        status: { not: 'UNASSIGNED' },
      },
      include: { round: true },
    });
    if (!a) throw AppError.notFound();
    return a;
  };
  r.get('/assignments/:id/memo', async (req, res) => {
    const c = requireCtx(req),
      a = await ownerAssignment(c, String(req.params.id));
    const m = await db.judgeMemo.findUnique({ where: { assignmentId: a.id } });
    res.json(m ?? { scratchpad: '', starred: false, version: 0 });
  });
  r.put('/assignments/:id/memo', async (req, res) => {
    const c = requireCtx(req);
    assertWritable(c);
    const a = await ownerAssignment(c, String(req.params.id));
    const input = parse(
      z
        .object({
          scratchpad: z.string().max(12000).optional(),
          starred: z.boolean().optional(),
          version: z.number().int().min(0),
        })
        .strict(),
      req.body,
    );
    const { version, ...patch } = input;
    const m = await db.$transaction(async (tx) => {
      await tx.judgeMemo.createMany({
        data: [{ assignmentId: a.id, version: 0 }],
        skipDuplicates: true,
      });
      const changed = await tx.judgeMemo.updateMany({
        where: { assignmentId: a.id, version },
        data: { ...patch, version: { increment: 1 } },
      });
      if (!changed.count)
        throw AppError.conflict(
          'stale_memo',
          'Your scratchpad changed in another tab. Reload before saving.',
        );
      return tx.judgeMemo.findUniqueOrThrow({ where: { assignmentId: a.id } });
    });
    res.json(m);
  });
  r.get('/judge/briefing', async (req, res) => {
    const c = requireCtx(req);
    if (!['ADMIN', 'JUDGE'].includes(c.membership.role)) throw AppError.notFound();
    const [briefing, glossary, tracks] = await Promise.all([
      db.judgeBriefing.findUnique({ where: { eventId: c.event.id } }),
      db.trackGlossary.findMany({ where: { eventId: c.event.id }, orderBy: { term: 'asc' } }),
      db.track.findMany({ where: { eventId: c.event.id }, select: { id: true, name: true } }),
    ]);
    res.json({
      briefing: briefing ?? {
        body: 'Read each criterion and its weight before scoring. Judge execution against the rubric, and assess submissions independently. Declare any conflict before evaluating.',
        examples:
          'Practice example: score each criterion using its stated range. A score is not complete until every required criterion and feedback field is filled.',
        contact: c.event.contactEmail,
        version: 0,
      },
      glossary,
      tracks,
    });
  });
  r.put('/judge/briefing', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    assertWritable(c);
    const input = parse(
      z
        .object({
          body: z.string().max(20000),
          examples: z.string().max(12000),
          contact: z.string().max(1000),
          version: z.number().int().min(0),
        })
        .strict(),
      req.body,
    );
    await db.$transaction(async (tx) => {
      await tx.judgeBriefing.createMany({
        data: [{ eventId: c.event.id, version: 0 }],
        skipDuplicates: true,
      });
      const changed = await tx.judgeBriefing.updateMany({
        where: { eventId: c.event.id, version: input.version },
        data: {
          body: input.body,
          examples: input.examples,
          contact: input.contact,
          version: { increment: 1 },
        },
      });
      if (!changed.count)
        throw AppError.conflict('stale_briefing', 'Briefing changed. Reload before editing.');
      await writeAudit(tx, {
        eventId: c.event.id,
        actorId: c.membership.userId,
        action: 'judge.briefing_updated',
        entityType: 'JudgeBriefing',
        entityId: c.event.id,
      });
    });
    res.json({ ok: true });
  });
  r.put('/judge/glossary', async (req, res) => {
    const c = requireCtx(req);
    adminOnly(c);
    assertWritable(c);
    const { terms } = parse(
      z
        .object({
          terms: z
            .array(
              z.object({
                term: z.string().trim().min(1).max(80),
                definition: z.string().trim().min(1).max(1500),
                trackId: z.string().nullable(),
              }),
            )
            .max(100),
        })
        .strict(),
      req.body,
    );
    if (new Set(terms.map((t) => t.term.toLowerCase())).size !== terms.length)
      throw AppError.invalid('Use each glossary term once');
    const tracks = await db.track.findMany({ where: { eventId: c.event.id } });
    if (terms.some((t) => t.trackId && !tracks.some((x) => x.id === t.trackId)))
      throw AppError.invalid('Choose tracks belonging to this event');
    await db.$transaction(async (tx) => {
      await tx.trackGlossary.deleteMany({ where: { eventId: c.event.id } });
      await tx.trackGlossary.createMany({
        data: terms.map((t) => ({ ...t, eventId: c.event.id })),
      });
      await writeAudit(tx, {
        eventId: c.event.id,
        actorId: c.membership.userId,
        action: 'judge.glossary_updated',
        entityType: 'TrackGlossary',
      });
    });
    res.json({ ok: true });
  });
  r.get('/judge/practice', async (req, res) => {
    const c = requireCtx(req);
    judgeOnly(c);
    const rubric = await db.rubric.findFirst({
      where: { round: { eventId: c.event.id }, state: { not: 'DRAFT' } },
      include: { criteria: { orderBy: { order: 'asc' } } },
    });
    res.json({
      title: 'Practice team · RiverWatch',
      summary:
        'A fictional team uses water-level sensors and a public dashboard to report flood risks. The prototype uses TypeScript and a simulated sensor feed. Demo data only.',
      readme:
        'Setup: install dependencies and run the development server. The sensor stream is simulated. Limitations: no field deployment, no measured accuracy claims.',
      criteria: rubric?.criteria.map((x) => ({
        id: x.id,
        name: x.name,
        description: x.description,
        weight: x.weight,
        min: x.min,
        max: x.max,
      })) ?? [
        {
          id: 'execution',
          name: 'Execution',
          description: 'Assess the demonstrated implementation.',
          weight: 50,
          min: 0,
          max: 10,
        },
        {
          id: 'impact',
          name: 'Impact',
          description: 'Assess the evidence for the stated problem.',
          weight: 50,
          min: 0,
          max: 10,
        },
      ],
    });
  });
  r.get('/judge/export.pdf', async (req, res) => {
    const c = requireCtx(req);
    judgeOnly(c);
    const assignments = await db.judgeAssignment.findMany({
      where: {
        eventId: c.event.id,
        judgeMembershipId: c.membership.id,
        evaluation: { isNot: null },
      },
      include: {
        evaluation: { include: { scores: { include: { criterion: true } } } },
        round: true,
      },
      orderBy: [{ roundId: 'asc' }, { createdAt: 'asc' }],
    });
    const teams = await db.team.findMany({
      where: { eventId: c.event.id, id: { in: assignments.map((a) => a.teamId) } },
      select: { id: true, name: true, teamCode: true },
    });
    const { doc, fonts } = await createBrandDocument();
    let page = doc.addPage();
    let y = 780;
    const line = (s: string, size = 11) => {
      for (const v of wrapText(safeText(fonts.text, s), fonts.text, size, 495)) {
        if (y < 55) {
          page = doc.addPage();
          y = 780;
        }
        page.drawText(v, { x: 45, y, size, font: fonts.text, color: PDF_COLORS.ink });
        y -= size + 5;
      }
      y -= 5;
    };
    line(c.event.name, 20);
    line(`Personal evaluation record for ${req.user!.name}`, 14);
    line(
      `Generated ${new Date().toISOString()}. Includes drafts and submitted evaluations. No other judge's evaluations are included.`,
    );
    for (const a of assignments) {
      const e = a.evaluation!,
        t = teams.find((t) => t.id === a.teamId);
      line(`${t?.teamCode ?? ''} ${t?.name ?? 'Former team'} — ${a.round.name}`, 15);
      line(
        `Status: ${e.status} | Assignment: ${a.status} | Score: ${e.weightedScore ?? 'Incomplete'}`,
      );
      for (const s of e.scores) line(`${s.criterion.name}: ${s.score} (${s.criterion.weight}%)`);
      line(`Feedback for team: ${e.teamComment ?? ''}`);
      line(`Note to organisers: ${e.privateNote ?? ''}`);
      line(`Submitted: ${e.submittedAt?.toISOString() ?? 'Not submitted'}`);
    }
    if (!assignments.length) line('No evaluations saved yet.');
    res
      .type('application/pdf')
      .set('Content-Disposition', 'attachment; filename="my-evaluations.pdf"')
      .send(Buffer.from(await doc.save()));
  });
  r.get(
    '/rounds/:roundId/judge/teams/:teamId/insight',
    limit('judge-insight', 15, 60000),
    async (req, res) => {
      const c = requireCtx(req);
      judgeOnly(c);
      const round = await loadRound(db, c, String(req.params.roundId));
      const a = await db.judgeAssignment.findFirst({
        where: {
          eventId: c.event.id,
          roundId: round.id,
          teamId: String(req.params.teamId),
          judgeMembershipId: c.membership.id,
          status: 'ACTIVE',
        },
      });
      if (!a || round.judgingStatus === 'NOT_OPEN') throw AppError.notFound();
      const sub = await db.submission.findUnique({
        where: { roundId_teamId: { roundId: round.id, teamId: a.teamId } },
        include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 }, files: true },
      });
      const v = sub?.versions[0];
      if (!sub || !v) throw AppError.notFound('No submitted version');
      const cached = await db.submissionInsight.findUnique({ where: { versionId: v.id } });
      if (cached && Date.now() - +cached.updatedAt < 900000) return void res.json(cached.payload);
      const fields = await db.submissionFormField.findMany({ where: { roundId: round.id } }),
        values = v.values as Record<string, string>;
      const repoField = fields.find((f) => f.type === 'REPO_URL' && values[f.id]);
      const repo = repoField
        ? await repositoryReading(values[repoField.id]!).catch((e) => ({
            url: values[repoField.id]!,
            reachable: false,
            error: e instanceof Error ? e.message : 'Unavailable',
          }))
        : null;
      const files = await Promise.all(
        fields
          .filter((f) => f.type === 'FILE' && values[f.id])
          .map(async (f) => {
            const file = sub.files.find((x) => x.id === values[f.id] && x.fieldId === f.id);
            if (!file) return { fieldId: f.id, available: false };
            try {
              const bytes = await storage.get(file.storageKey);
              return { fieldId: f.id, available: bytes.length === file.sizeBytes };
            } catch {
              return { fieldId: f.id, available: false };
            }
          }),
      );
      const readme = repo && 'readme' in repo ? repo.readme : '';
      let ai = null,
        aiError: string | null = null;
      try {
        ai = await aiReading(env, {
          title: v.title,
          summary: v.summary,
          readme,
          language: repo && 'language' in repo ? repo.language : null,
        });
      } catch {
        aiError = 'AI summary unavailable; use the source material.';
      }
      const payload = {
        versionNo: v.versionNo,
        checkedAt: new Date().toISOString(),
        summary: v.summary,
        repo,
        files,
        ai,
        aiError,
        aiConfigured: Boolean(
          env.JUDGE_AI_ENABLED && env.OPENAI_API_KEY && env.JUDGE_SUMMARY_MODEL,
        ),
        notice:
          'Convenience reading aid only. Verify the source material. No suggested score or ranking.',
      };
      await db.submissionInsight.upsert({
        where: { versionId: v.id },
        create: { versionId: v.id, payload },
        update: { payload },
      });
      res.json(payload);
    },
  );
  return r;
}
