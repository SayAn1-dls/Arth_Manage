import type { Deps } from '../http/deps.js';

const DAY = 24 * 60 * 60 * 1000;

/** Removes sessions and one-time tokens that can never be used again, so these tables do not grow forever. */
export async function purgeExpired({ db }: Pick<Deps, 'db'>, now = new Date()) {
  const [sessions, tokens, attempts] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.authToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(now.getTime() - 7 * DAY) } },
          { usedAt: { lt: new Date(now.getTime() - 7 * DAY) } },
        ],
      },
    }),
    db.joinAttempt.deleteMany({ where: { at: { lt: new Date(now.getTime() - 30 * DAY) } } }),
  ]);
  return { sessions: sessions.count, tokens: tokens.count, attempts: attempts.count };
}

export function startMaintenance(deps: Deps, everyMs = 6 * 60 * 60 * 1000): () => void {
  const run = () =>
    purgeExpired(deps).catch((err) => deps.logger.warn({ err }, 'maintenance purge failed'));
  void run();
  const t = setInterval(run, everyMs);
  t.unref();
  return () => clearInterval(t);
}
