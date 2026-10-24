import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import type { Deps } from '../../http/deps.js';
import { requireAction } from '../../authz/can.js';
import { requireCtx, requireUser } from '../../http/context.js';
import { requireAuth } from '../../auth/middleware.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { writeAudit } from '../../audit/audit.js';
import { adminOnly } from '../judging/common.js';
import { assertWritable } from '../events/service.js';
import { enqueueQuietly, enqueueSync, sealToken, tokenKey } from '../../integrations/queue.js';
import { FRIENDLY, GoogleError } from '../../integrations/google.js';

const STATE_TTL_MS = 10 * 60_000;

function signState(secret: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, x: Date.now() + STATE_TTL_MS, n: randomBytes(8).toString('hex') }),
  ).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
function readState(secret: string, state: string): { e: string; u: string; d: boolean } | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
    e: string;
    u: string;
    d: boolean;
    x: number;
  };
  return p.x > Date.now() ? p : null;
}

/** Event changes that should refresh the connected sheet (PRD FR-173). Feedback, scores and certificates never sync. */
const SHEET_PATH =
  /^\/events\/([^/]+)\/(registration\/me|participants|teams|members|my-team|tracks|problems|publish|checkin\/members|rounds\/[^/]+\/submission)(\/|$)/;
const SUBMIT_PATH = /^\/events\/([^/]+)\/rounds\/[^/]+\/submission\/submit$/;
const PUBLIC_REGISTER = /^\/public\/events\/([^/]+)\/register$/;

/** After a successful change, queue (never run) a sync. A queue problem never fails the user's request. */
export function syncHooks(deps: Deps) {
  return Router().use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const path = req.path; // read now: Express rewrites the URL as the request leaves each router
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      const reg = PUBLIC_REGISTER.exec(path);
      if (reg) {
        void deps.db.event
          .findUnique({ where: { slug: reg[1]! }, select: { id: true } })
          .then((e) => e && enqueueQuietly(deps, e.id, 'SHEETS'))
          .catch(() => undefined);
        return;
      }
      const m = SHEET_PATH.exec(path);
      if (m) enqueueQuietly(deps, m[1]!, 'SHEETS');
      const s = SUBMIT_PATH.exec(path);
      if (s) enqueueQuietly(deps, s[1]!, 'DRIVE_MIRROR');
    });
    next();
  });
}

/** Google Sheets push and Drive mirror: connection, status, "Sync now" (PRD Modules F and G). */
export function integrationsRouter(deps: Deps) {
  const { db, google, env } = deps;
  const router = Router({ mergeParams: true });
  const top = Router();
  const configured = () => google.configured && tokenKey(deps) !== null;

  const callbackUrl = (eventId: string, result: string) =>
    `${env.APP_BASE_URL}/events/${eventId}/integrations?result=${result}`;

  router.get('/integrations', requireAction('integrations.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    const conn = await db.integrationConnection.findUnique({ where: { eventId: ctx.event.id } });
    const jobs = await db.syncJob.findMany({
      where: { eventId: ctx.event.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const mirrors = await db.driveMirror.groupBy({
      by: ['status'],
      where: { eventId: ctx.event.id },
      _count: true,
    });
    res.json({
      configured: configured(),
      connection:
        conn && conn.status !== 'DISCONNECTED'
          ? {
              status: conn.status,
              googleEmail: conn.googleEmail,
              spreadsheetUrl: conn.spreadsheetUrl,
              driveEnabled: conn.driveEnabled,
              lastSuccessAt: conn.lastSuccessAt,
              lastAttemptAt: conn.lastAttemptAt,
              lastResult: conn.lastResult,
              lastError: conn.lastError,
              lastErrorDetail: conn.lastErrorDetail,
            }
          : null,
      jobs: jobs.map((j) => ({
        id: j.id,
        kind: j.kind,
        status: j.status,
        attempt: j.attempt,
        runAfter: j.runAfter,
        finishedAt: j.finishedAt,
        summary: j.summary,
        error: j.error,
        errorDetail: j.errorDetail,
        createdAt: j.createdAt,
      })),
      mirror: Object.fromEntries(mirrors.map((m) => [m.status, m._count])),
    });
  });

  router.post('/integrations/connect', requireAction('integrations.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    if (!configured())
      throw new AppError(
        503,
        'not_configured',
        'Google is not set up on this server. An administrator must provide the Google credentials and a token encryption key first.',
      );
    const { acknowledged, enableDrive } = parse(
      z.object({ acknowledged: z.boolean(), enableDrive: z.boolean().default(false) }).strict(),
      req.body,
    );
    if (!acknowledged)
      throw AppError.invalid('Please confirm who is responsible for the sheet', {
        acknowledged: "Tick the box to confirm you'll control who the sheet is shared with",
      });
    const state = signState(env.SESSION_SECRET, {
      e: ctx.event.id,
      u: ctx.membership.userId,
      d: enableDrive,
    });
    res.json({ url: google.authUrl(state, enableDrive) });
  });

  router.post('/integrations/sync-now', requireAction('integrations.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const conn = await db.integrationConnection.findUnique({ where: { eventId: ctx.event.id } });
    if (!conn || conn.status === 'DISCONNECTED')
      throw AppError.conflict('not_connected', 'Connect Google first.');
    if (conn.status === 'NEEDS_REAUTH')
      throw AppError.conflict('needs_reauth', FRIENDLY.TOKEN_REVOKED);
    await enqueueSync(deps, ctx.event.id, 'SHEETS', { immediate: true });
    if (conn.driveEnabled)
      await enqueueSync(deps, ctx.event.id, 'DRIVE_MIRROR', { immediate: true });
    res.status(202).json({ queued: true });
  });

  router.put('/integrations/drive', requireAction('integrations.manage'), async (req, res) => {
    const ctx = requireCtx(req);
    adminOnly(ctx);
    assertWritable(ctx);
    const { enabled } = parse(z.object({ enabled: z.boolean() }).strict(), req.body);
    const conn = await db.integrationConnection.findUnique({ where: { eventId: ctx.event.id } });
    if (!conn || conn.status !== 'CONNECTED')
      throw AppError.conflict('not_connected', 'Connect Google first.');
    await db.integrationConnection.update({
      where: { id: conn.id },
      data: { driveEnabled: enabled },
    });
    await writeAudit(db, {
      eventId: ctx.event.id,
      actorId: ctx.membership.userId,
      action: enabled ? 'integration.drive_enabled' : 'integration.drive_disabled',
      entityType: 'IntegrationConnection',
      entityId: conn.id,
    });
    if (enabled) await enqueueSync(deps, ctx.event.id, 'DRIVE_MIRROR', { immediate: true });
    else
      await db.syncJob.deleteMany({
        where: { connectionId: conn.id, kind: 'DRIVE_MIRROR', status: 'QUEUED' },
      });
    res.json({ driveEnabled: enabled });
  });

  // Forget the spreadsheet so the next sync creates a fresh one (PRD FR-177 "Create a new one").
  router.post(
    '/integrations/new-spreadsheet',
    requireAction('integrations.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const conn = await db.integrationConnection.findUnique({ where: { eventId: ctx.event.id } });
      if (!conn || conn.status !== 'CONNECTED')
        throw AppError.conflict('not_connected', 'Connect Google first.');
      await db.integrationConnection.update({
        where: { id: conn.id },
        data: {
          spreadsheetId: null,
          spreadsheetUrl: null,
          tabIds: {},
          lastError: null,
          lastErrorDetail: null,
        },
      });
      await enqueueSync(deps, ctx.event.id, 'SHEETS', { immediate: true });
      res.status(202).json({ queued: true });
    },
  );

  // Stops all jobs and deletes the stored token. The spreadsheet in Google is left untouched (PRD FR-178).
  router.post(
    '/integrations/disconnect',
    requireAction('integrations.manage'),
    async (req, res) => {
      const ctx = requireCtx(req);
      adminOnly(ctx);
      assertWritable(ctx);
      const conn = await db.integrationConnection.findUnique({ where: { eventId: ctx.event.id } });
      if (!conn || conn.status === 'DISCONNECTED') throw AppError.notFound();
      await db.$transaction(async (tx) => {
        await tx.syncJob.deleteMany({ where: { connectionId: conn.id, status: 'QUEUED' } });
        await tx.integrationConnection.update({
          where: { id: conn.id },
          data: { status: 'DISCONNECTED', refreshTokenEnc: null, driveEnabled: false },
        });
        await writeAudit(tx, {
          eventId: ctx.event.id,
          actorId: ctx.membership.userId,
          action: 'integration.disconnected',
          entityType: 'IntegrationConnection',
          entityId: conn.id,
        });
      });
      res.json({ ok: true });
    },
  );

  // OAuth return. Signed, expiring state ties the response to the admin who started it (CSRF defence for OAuth).
  top.get('/integrations/google/callback', requireAuth, async (req: Request, res) => {
    const user = requireUser(req);
    const state = readState(env.SESSION_SECRET, String(req.query.state ?? ''));
    if (!state || state.u !== user.id) return void res.redirect(`${env.APP_BASE_URL}/events`);
    const admin = await db.eventMembership.findFirst({
      where: { eventId: state.e, userId: user.id, role: 'ADMIN', status: 'ACTIVE' },
    });
    if (!admin) return void res.redirect(`${env.APP_BASE_URL}/events`);
    if (req.query.error || !req.query.code)
      return void res.redirect(callbackUrl(state.e, 'cancelled'));
    try {
      const { refreshToken, email } = await google.exchangeCode(String(req.query.code));
      const existing = await db.integrationConnection.findUnique({ where: { eventId: state.e } });
      const data = {
        status: 'CONNECTED' as const,
        googleEmail: email,
        connectedById: user.id,
        refreshTokenEnc: sealToken(deps, refreshToken),
        driveEnabled: state.d,
        acknowledgedAt: new Date(),
        lastError: null,
        lastErrorDetail: null,
      };
      const conn = existing
        ? await db.integrationConnection.update({ where: { id: existing.id }, data })
        : await db.integrationConnection.create({ data: { eventId: state.e, ...data } });
      await writeAudit(db, {
        eventId: state.e,
        actorId: user.id,
        action: 'integration.connected',
        entityType: 'IntegrationConnection',
        entityId: conn.id,
        after: { googleEmail: email, driveEnabled: state.d },
      });
      await enqueueSync(deps, state.e, 'SHEETS', { immediate: true });
      if (state.d) await enqueueSync(deps, state.e, 'DRIVE_MIRROR', { immediate: true });
      res.redirect(callbackUrl(state.e, 'connected'));
    } catch (err) {
      deps.logger.warn(
        { err: err instanceof GoogleError ? err.detail : String(err) },
        'google connect failed',
      );
      res.redirect(callbackUrl(state.e, 'failed'));
    }
  });

  return { router, top };
}
