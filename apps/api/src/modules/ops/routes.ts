import { Router } from 'express';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx } from '../../http/context.js';
import { writeAudit } from '../../audit/audit.js';
import { sendCsv, toCsv } from '../../exports/csv.js';
import { adminOnly, judgedVersions } from '../judging/common.js';
import { checkinSummary } from '../staff/routes.js';
import { submissionStatus } from '../submissions/logic.js';
import { hasDraftContent, roundTiming } from '../submissions/service.js';
import { effectiveRegistration } from '../events/registrationState.js';

/** Operational dashboard and audit history for Core Admins (PRD FR-043, FR-046). */
export function opsRouter(deps: Deps) {
  const { db } = deps;
  const router = Router({ mergeParams: true });

  router.get('/dashboard', requireAction('event.edit'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    const e = ctx.event;
    const now = new Date();
    // Each card loads independently: one failing never blanks the others (PRD FR-043).
    const card = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
      try {
        return await fn();
      } catch (err) {
        deps.logger.error({ err }, 'dashboard card failed');
        return { error: 'This card could not load. Refresh to try again.' };
      }
    };
    const [participants, teams, submissions, judging, checkin, issues, tasks, deadlines] =
      await Promise.all([
        card(async () => {
          const [registered, inTeam, withdrawn] = await Promise.all([
            db.eventMembership.count({
              where: {
                eventId: e.id,
                role: 'PARTICIPANT',
                status: 'ACTIVE',
                registration: { is: { status: 'ACTIVE' } },
              },
            }),
            db.teamMember.count({
              where: { eventId: e.id, leftAt: null, team: { status: { not: 'DISSOLVED' } } },
            }),
            db.registration.count({ where: { eventId: e.id, status: 'WITHDRAWN' } }),
          ]);
          return {
            registered,
            inTeam,
            noTeam: Math.max(registered - inTeam, 0),
            withdrawn,
            registration: effectiveRegistration(e),
          };
        }),
        card(async () => {
          const list = await db.team.findMany({
            where: { eventId: e.id, status: { not: 'DISSOLVED' } },
            include: { members: { where: { leftAt: null } } },
          });
          return {
            total: list.length,
            complete: list.filter((t) => t.members.length >= e.teamMin).length,
            incomplete: list.filter((t) => t.members.length < e.teamMin).length,
            disqualified: list.filter((t) => t.status === 'DISQUALIFIED').length,
          };
        }),
        card(async () => {
          const rounds = await db.round.findMany({
            where: { eventId: e.id },
            orderBy: { order: 'asc' },
          });
          const teamsList = await db.team.findMany({
            where: { eventId: e.id, status: 'ACTIVE' },
            select: { id: true },
          });
          return Promise.all(
            rounds.map(async (r) => {
              const subs = await db.submission.findMany({
                where: { roundId: r.id },
                include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
              });
              const counts: Record<string, number> = {};
              for (const t of teamsList) {
                const s = subs.find((x) => x.teamId === t.id);
                const st = submissionStatus(
                  roundTiming(r),
                  s?.extensionDeadline ?? null,
                  s
                    ? {
                        hasDraftContent: hasDraftContent(s),
                        lastVersionNo: s.lastVersionNo,
                        lastVersionLateMinutes: s.versions[0]?.lateMinutes ?? 0,
                      }
                    : null,
                  now,
                );
                counts[st] = (counts[st] ?? 0) + 1;
              }
              return { roundId: r.id, name: r.name, counts };
            }),
          );
        }),
        card(async () => {
          const rounds = await db.round.findMany({
            where: { eventId: e.id },
            orderBy: { order: 'asc' },
          });
          return Promise.all(
            rounds.map(async (r) => {
              const [assigned, submitted, judged] = await Promise.all([
                db.judgeAssignment.count({ where: { roundId: r.id, status: 'ACTIVE' } }),
                db.evaluation.count({
                  where: { status: 'SUBMITTED', assignment: { roundId: r.id, status: 'ACTIVE' } },
                }),
                judgedVersions(db, r.id),
              ]);
              return {
                roundId: r.id,
                name: r.name,
                status: r.judgingStatus,
                assigned,
                submitted,
                teamsWithWork: judged.size,
              };
            }),
          );
        }),
        card(() => checkinSummary(deps, e.id)),
        card(async () => {
          const open = await db.issueReport.findMany({
            where: { eventId: e.id, status: { not: 'RESOLVED' } },
            orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
            take: 10,
          });
          return {
            open: open.length,
            urgent: open
              .filter((i) => i.severity === 'URGENT')
              .map((i) => ({
                id: i.id,
                category: i.category,
                description: i.description.slice(0, 120),
              })),
          };
        }),
        card(async () => ({
          blocked: await db.staffTask.count({ where: { eventId: e.id, status: 'BLOCKED' } }),
          open: await db.staffTask.count({
            where: { eventId: e.id, status: { in: ['TODO', 'IN_PROGRESS'] } },
          }),
          unassigned: await db.staffTask.count({
            where: { eventId: e.id, assignees: { none: {} } },
          }),
        })),
        card(async () => {
          const rounds = await db.round.findMany({ where: { eventId: e.id } });
          const items = [
            ...(e.registrationClosesAt
              ? [{ label: 'Registration closes', at: e.registrationClosesAt }]
              : []),
            ...rounds.flatMap((r) => [
              ...(r.submissionDeadline
                ? [{ label: `${r.name} submissions close`, at: r.submissionDeadline }]
                : []),
              ...(r.judgingDeadline
                ? [{ label: `${r.name} judging deadline`, at: r.judgingDeadline }]
                : []),
            ]),
          ];
          return items
            .filter((i) => i.at > now)
            .sort((a, b) => a.at.getTime() - b.at.getTime())
            .slice(0, 3);
        }),
      ]);
    res.json({
      generatedAt: now,
      participants,
      teams,
      submissions,
      judging,
      checkin,
      issues,
      tasks,
      deadlines,
      integrations: await card(async () => {
        const c = await db.integrationConnection.findUnique({ where: { eventId: e.id } });
        const on = c && c.status !== 'DISCONNECTED';
        const failing = Boolean(on && c.lastResult === 'FAILED');
        return {
          configured: deps.google.configured,
          status: !on
            ? 'NOT_CONNECTED'
            : c.status === 'NEEDS_REAUTH'
              ? 'NEEDS_REAUTH'
              : failing
                ? 'FAILING'
                : 'CONNECTED',
          driveEnabled: Boolean(on && c.driveEnabled),
          lastSuccessAt: on ? c.lastSuccessAt : null,
          lastError: on ? c.lastError : null,
          spreadsheetUrl: on ? c.spreadsheetUrl : null,
        };
      }),
    });
  });

  // ── Audit history (PRD FR-046): read-only, filterable, exportable ──
  async function auditRows(eventId: string, q: Record<string, unknown>, take: number, skip = 0) {
    const where = {
      eventId,
      ...(q.entityType ? { entityType: String(q.entityType) } : {}),
      ...(q.action ? { action: { contains: String(q.action), mode: 'insensitive' as const } } : {}),
      ...(q.actorId ? { actorId: String(q.actorId) } : {}),
      ...(q.from || q.to
        ? {
            at: {
              ...(q.from ? { gte: new Date(String(q.from)) } : {}),
              ...(q.to ? { lte: new Date(String(q.to)) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.auditLog.findMany({ where, orderBy: { at: 'desc' }, take, skip }),
      db.auditLog.count({ where }),
    ]);
    const actors = await db.user.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))] } },
    });
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        at: r.at,
        actor:
          actors.find((a) => a.id === r.actorId)?.name ?? (r.actorId ? 'Former user' : 'System'),
        actorId: r.actorId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
        reason: r.reason,
      })),
    };
  }

  router.get('/audit', requireAction('audit.view'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 50) || 50));
    const { rows, total } = await auditRows(
      ctx.event.id,
      req.query,
      pageSize,
      (page - 1) * pageSize,
    );
    const types = await db.auditLog.findMany({
      where: { eventId: ctx.event.id },
      distinct: ['entityType'],
      select: { entityType: true },
    });
    res.json({ total, page, pageSize, rows, entityTypes: types.map((t) => t.entityType).sort() });
  });

  router.get('/audit.csv', requireAction('audit.view'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    const { rows } = await auditRows(ctx.event.id, req.query, 10_000);
    await writeAudit(db, {
      eventId: ctx.event.id,
      actorId: ctx.membership.userId,
      action: 'export.audit',
      entityType: 'Export',
      after: { rows: rows.length },
    });
    sendCsv(
      res,
      `${ctx.event.slug}-audit.csv`,
      toCsv(
        ['Time', 'Actor', 'Action', 'Entity type', 'Entity id', 'Reason', 'Before', 'After'],
        rows.map((r) => [
          r.at,
          r.actor,
          r.action,
          r.entityType,
          r.entityId,
          r.reason,
          r.before ? JSON.stringify(r.before) : '',
          r.after ? JSON.stringify(r.after) : '',
        ]),
      ),
    );
  });

  return router;
}
