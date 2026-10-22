import type { Deps } from '../http/deps.js';
import { writeAudit } from '../audit/audit.js';
import { decryptSecret, encryptSecret, parseKey } from './crypto.js';
import { FRIENDLY, GoogleError } from './google.js';
import { banner, buildTab, TABS } from './sheets.js';
import { mirrorEvent } from './drive.js';
import type { IntegrationConnection, SyncKind } from '../generated/prisma/client.js';

/** Targets from PRD FR-173/FR-175. Overridable so tests need not wait. */
export const TIMING = {
  debounceMs: 60_000,
  maxWaitMs: 5 * 60_000,
  retryMinutes: [1, 2, 4, 8, 16],
};
export const MAX_ATTEMPTS = TIMING.retryMinutes.length;

const isUnique = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';

export function tokenKey(deps: Deps): Buffer | null {
  return parseKey(deps.env.TOKEN_ENCRYPTION_KEY);
}
export const sealToken = (deps: Deps, t: string) => encryptSecret(t, tokenKey(deps)!);

/**
 * Queues a sync for an event, coalescing into the single queued job. Normal changes run 60 s after the latest
 * change but never later than 5 minutes after the first; "Sync now" runs immediately (PRD FR-173).
 */
export async function enqueueSync(
  deps: Deps,
  eventId: string,
  kind: SyncKind,
  opts: { immediate?: boolean; now?: Date } = {},
): Promise<'queued' | 'coalesced' | 'skipped'> {
  const { db } = deps;
  const now = opts.now ?? new Date();
  const conn = await db.integrationConnection.findUnique({ where: { eventId } });
  if (!conn || conn.status !== 'CONNECTED') return 'skipped';
  if (kind === 'DRIVE_MIRROR' && !conn.driveEnabled) return 'skipped';
  const queued = await db.syncJob.findFirst({
    where: { connectionId: conn.id, kind, status: 'QUEUED' },
  });
  const wanted = (first: Date) =>
    opts.immediate
      ? now
      : new Date(Math.min(now.getTime() + TIMING.debounceMs, first.getTime() + TIMING.maxWaitMs));
  if (queued) {
    const runAfter = wanted(queued.firstQueuedAt);
    await db.syncJob.update({
      where: { id: queued.id },
      data: {
        runAfter: opts.immediate ? now : runAfter > queued.runAfter ? runAfter : queued.runAfter,
      },
    });
    return 'coalesced';
  }
  try {
    await db.syncJob.create({
      data: { eventId, connectionId: conn.id, kind, firstQueuedAt: now, runAfter: wanted(now) },
    });
    return 'queued';
  } catch (e) {
    if (isUnique(e)) return 'coalesced'; // another request queued it first
    throw e;
  }
}

/** Fire-and-forget wrapper for request hooks: a queue problem must never fail the user's request. */
export function enqueueQuietly(deps: Deps, eventId: string, kind: SyncKind) {
  enqueueSync(deps, eventId, kind).catch((err) =>
    deps.logger.warn({ err, eventId }, 'could not queue sync'),
  );
}

async function markAttempt(
  deps: Deps,
  conn: IntegrationConnection,
  data: Partial<{
    lastSuccessAt: Date;
    lastResult: string;
    lastError: string | null;
    lastErrorDetail: string | null;
    status: 'NEEDS_REAUTH';
  }>,
) {
  await deps.db.integrationConnection.update({
    where: { id: conn.id },
    data: { lastAttemptAt: new Date(), ...data },
  });
}

/** Pushes every managed tab. Success is recorded only after Google confirmed every write (PRD FR-180). */
async function runSheets(deps: Deps, conn: IntegrationConnection, dataAsOf: Date) {
  const { db, google } = { db: deps.db, google: deps.google };
  const key = tokenKey(deps);
  if (!key || !conn.refreshTokenEnc) throw new GoogleError('TOKEN_REVOKED', 'No stored token');
  const token = decryptSecret(conn.refreshTokenEnc, key);
  const event = await db.event.findUniqueOrThrow({ where: { id: conn.eventId } });
  let spreadsheetId = conn.spreadsheetId;
  let tabIds = { ...(conn.tabIds as Record<string, number>) };
  if (!spreadsheetId) {
    const made = await google.createSpreadsheet(
      token,
      `${event.name} – Participants & Teams`,
      TABS.map((t) => ({ key: t.key, title: t.title })),
    );
    spreadsheetId = made.spreadsheetId;
    tabIds = made.tabIds;
    await db.integrationConnection.update({
      where: { id: conn.id },
      data: { spreadsheetId, spreadsheetUrl: made.url, tabIds },
    });
  }
  const head = banner('Arthakram', new Date(), dataAsOf);
  let written = 0;
  for (const t of TABS) {
    const rows = await buildTab(db, conn.eventId, t.key);
    const id = await google.writeTab(
      token,
      spreadsheetId,
      { key: t.key, title: t.title, sheetId: tabIds[t.key] },
      [...head, ...rows],
      head.length,
    );
    if (tabIds[t.key] !== id) {
      tabIds[t.key] = id; // recreated after being deleted
      await db.integrationConnection.update({ where: { id: conn.id }, data: { tabIds } });
    }
    written += rows.length - 1;
  }
  return `Wrote ${TABS.length} tabs, ${written} rows`;
}

/** Runs one claimed job and records the truthful outcome, scheduling retries per FR-175. */
async function execute(deps: Deps, jobId: string) {
  const { db } = deps;
  const job = await db.syncJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { connection: true },
  });
  const conn = job.connection;
  const dataAsOf = job.startedAt ?? new Date();
  try {
    if (conn.status !== 'CONNECTED')
      throw new GoogleError('TOKEN_REVOKED', 'Connection is not active');
    const summary =
      job.kind === 'SHEETS' ? await runSheets(deps, conn, dataAsOf) : await mirrorEvent(deps, conn);
    await db.syncJob.update({
      where: { id: job.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        summary,
        error: null,
        errorDetail: null,
      },
    });
    if (job.kind === 'SHEETS')
      await markAttempt(deps, conn, {
        lastSuccessAt: new Date(),
        lastResult: 'SUCCEEDED',
        lastError: null,
        lastErrorDetail: null,
      });
  } catch (err) {
    const g = err instanceof GoogleError ? err : new GoogleError('OTHER', String(err));
    if (!(err instanceof GoogleError)) deps.logger.error({ err, jobId }, 'sync job crashed');
    const message = FRIENDLY[g.kind];
    const final = g.kind === 'TOKEN_REVOKED' || job.attempt + 1 >= MAX_ATTEMPTS;
    if (final) {
      await db.syncJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          attempt: job.attempt + 1,
          error: message,
          errorDetail: g.detail,
        },
      });
    } else {
      // Back to the queue unless a newer job already took the single queued slot, which supersedes this one.
      const delay = TIMING.retryMinutes[job.attempt]! * 60_000;
      try {
        await db.syncJob.update({
          where: { id: job.id },
          data: {
            status: 'QUEUED',
            attempt: job.attempt + 1,
            runAfter: new Date(Date.now() + delay),
            error: message,
            errorDetail: g.detail,
            startedAt: null,
          },
        });
      } catch (e) {
        if (!isUnique(e)) throw e;
        await db.syncJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            error: `${message} (superseded)`,
            errorDetail: g.detail,
          },
        });
      }
    }
    await markAttempt(deps, conn, {
      lastResult: 'FAILED',
      lastError: message,
      lastErrorDetail: g.detail,
      ...(g.kind === 'TOKEN_REVOKED' ? { status: 'NEEDS_REAUTH' as const } : {}),
    });
    if (g.kind === 'TOKEN_REVOKED')
      await writeAudit(db, {
        eventId: conn.eventId,
        actorId: null,
        action: 'integration.needs_reauth',
        entityType: 'IntegrationConnection',
        entityId: conn.id,
      });
  }
}

/** Claims and runs every job that is due. Safe to call from several processes: the claim is a conditional update. */
export async function runDueJobs(deps: Deps, now = new Date()): Promise<number> {
  const { db } = deps;
  const due = await db.syncJob.findMany({
    where: { status: 'QUEUED', runAfter: { lte: now } },
    orderBy: { runAfter: 'asc' },
    take: 20,
  });
  let ran = 0;
  for (const j of due) {
    let claimed;
    try {
      claimed = await db.syncJob.updateMany({
        where: { id: j.id, status: 'QUEUED' },
        data: { status: 'RUNNING', startedAt: now },
      });
    } catch (e) {
      if (isUnique(e)) continue; // one is already running for this connection
      throw e;
    }
    if (!claimed.count) continue;
    await execute(deps, j.id);
    ran += 1;
  }
  return ran;
}

/** Jobs left RUNNING by a crashed process return to the queue on start-up (restart safety). */
export async function recoverStuckJobs(deps: Deps, olderThanMs = 10 * 60_000) {
  await deps.db.syncJob.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - olderThanMs) } },
    data: { status: 'QUEUED', runAfter: new Date(), startedAt: null },
  });
}

export function startSyncWorker(deps: Deps, intervalMs = 5000): () => void {
  let busy = false;
  void recoverStuckJobs(deps).catch(() => undefined);
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    runDueJobs(deps)
      .catch((err) => deps.logger.error({ err }, 'sync worker tick failed'))
      .finally(() => {
        busy = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
