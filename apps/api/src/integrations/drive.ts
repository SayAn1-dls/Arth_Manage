import type { Deps } from '../http/deps.js';
import { decryptSecret, parseKey } from './crypto.js';
import { GoogleError } from './google.js';
import type { IntegrationConnection } from '../generated/prisma/client.js';

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'untitled';

/**
 * Copies submitted versions' files into the connected account's Drive (PRD Module G). Platform storage stays
 * canonical; nothing is shared with judges or participants. Each object is keyed so a retry never duplicates it.
 */
export async function mirrorEvent(deps: Deps, conn: IntegrationConnection): Promise<string> {
  const { db, google, storage } = deps;
  const key = parseKey(deps.env.TOKEN_ENCRYPTION_KEY);
  if (!key || !conn.refreshTokenEnc) throw new GoogleError('TOKEN_REVOKED', 'No stored token');
  const token = decryptSecret(conn.refreshTokenEnc, key);
  const event = await db.event.findUniqueOrThrow({ where: { id: conn.eventId } });
  const folders = { ...(conn.driveFolders as Record<string, string>) };
  const saveFolders = () =>
    db.integrationConnection.update({ where: { id: conn.id }, data: { driveFolders: folders } });
  async function folder(k: string, name: string, parent?: string) {
    if (!folders[k]) {
      folders[k] = await google.createFolder(token, name, parent);
      await saveFolders();
    }
    return folders[k]!;
  }

  const versions = await db.submissionVersion.findMany({
    where: { eventId: conn.eventId },
    include: { submission: { include: { team: true, round: true } } },
    orderBy: { submittedAt: 'asc' },
  });
  const fields = await db.submissionFormField.findMany({
    where: { round: { eventId: conn.eventId } },
  });
  const done = new Map(
    (await db.driveMirror.findMany({ where: { eventId: conn.eventId, status: 'MIRRORED' } })).map(
      (m) => [m.key, m],
    ),
  );
  let mirrored = 0;
  let failed = 0;
  const record = (
    k: string,
    data: { status: 'MIRRORED' | 'FAILED'; driveFileId?: string; error?: string },
  ) =>
    db.driveMirror.upsert({
      where: { eventId_key: { eventId: conn.eventId, key: k } },
      update: data,
      create: { eventId: conn.eventId, key: k, ...data },
    });

  for (const v of versions) {
    const values = v.values as Record<string, string>;
    const mine = fields.filter((f) => f.roundId === v.submission.roundId);
    const wanted: {
      key: string;
      name: string;
      load: () => Promise<{ bytes: Buffer; type: string }>;
    }[] = [];
    for (const f of mine.filter((x) => x.type === 'FILE')) {
      const fileId = values[f.id];
      if (!fileId) continue;
      const file = await db.submissionFile.findFirst({
        where: { id: fileId, eventId: conn.eventId },
      });
      if (!file) continue;
      wanted.push({
        key: `file:${file.id}`,
        name: `v${v.versionNo} ${safe(f.label)} ${safe(file.originalName)}`,
        load: async () => ({ bytes: await storage.get(file.storageKey), type: file.contentType }),
      });
    }
    const links = mine
      .filter((f) => ['REPO_URL', 'VIDEO_URL', 'LIVE_URL', 'OTHER_URL'].includes(f.type))
      .map((f) => `${f.label}: ${values[f.id] ?? ''}`);
    if (links.length)
      wanted.push({
        key: `links:${v.id}`,
        name: `v${v.versionNo} links.txt`,
        load: async () => ({ bytes: Buffer.from(links.join('\n') + '\n'), type: 'text/plain' }),
      });

    for (const w of wanted) {
      if (done.has(w.key)) continue; // already mirrored: skipped, never duplicated
      try {
        const root = await folder('root', `${event.name} (${event.slug})`);
        const round = await folder(
          `round:${v.submission.roundId}`,
          `Round ${v.submission.round.order} – ${safe(v.submission.round.name)}`,
          root,
        );
        const team = await folder(
          `team:${v.submission.roundId}:${v.submission.teamId}`,
          `${v.submission.team.teamCode} – ${safe(v.submission.team.name)}`,
          round,
        );
        const { bytes, type } = await w.load();
        const id = await google.uploadFile(token, team, w.name, bytes, type);
        await record(w.key, { status: 'MIRRORED', driveFileId: id });
        mirrored += 1;
      } catch (err) {
        if (err instanceof GoogleError && err.kind === 'TOKEN_REVOKED') throw err;
        failed += 1;
        await record(w.key, {
          status: 'FAILED',
          error: err instanceof Error ? err.message.slice(0, 300) : 'failed',
        });
      }
    }
  }
  if (failed)
    throw new GoogleError(
      'OTHER',
      `${failed} file(s) could not be mirrored; ${mirrored} succeeded`,
    );
  return `Mirrored ${mirrored} new file${mirrored === 1 ? '' : 's'}`;
}
