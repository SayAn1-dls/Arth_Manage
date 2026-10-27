import type { Db } from '../../db/client.js';

export function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function calibration(rows: { judgeId: string; score: number; seconds: number; at: Date }[]) {
  const panelMean = mean(rows.map((r) => r.score));
  return [...new Set(rows.map((r) => r.judgeId))].map((judgeId) => {
    const mine = rows.filter((r) => r.judgeId === judgeId).sort((a, b) => +a.at - +b.at);
    const average = mean(mine.map((r) => r.score));
    const delta = average - panelMean;
    const first = mean(mine.slice(0, 3).map((r) => r.seconds));
    const last = mean(mine.slice(-3).map((r) => r.seconds));
    return {
      judgeId,
      average,
      count: mine.length,
      delta,
      outlier: mine.length >= 3 && Math.abs(delta) >= 15,
      possibleFatigue: mine.length >= 6 && first > 0 && last < first * 0.4,
      averageSeconds: mean(mine.map((r) => r.seconds)),
      points: mine,
    };
  });
}

export async function engagement(db: Db, eventId: string) {
  const [teams, pulses, submissions] = await Promise.all([
    db.team.findMany({
      where: { eventId, status: 'ACTIVE' },
      include: { members: { where: { leftAt: null } }, track: true },
    }),
    db.activityPulse.findMany({ where: { eventId } }),
    db.submission.findMany({
      where: { eventId },
      select: { teamId: true, draftUpdatedAt: true, lastVersionNo: true },
    }),
  ]);
  const now = Date.now();
  return teams.map((t) => {
    const activity = pulses.filter((p) => t.members.some((m) => m.membershipId === p.membershipId));
    const drafts = submissions.filter((s) => s.teamId === t.id);
    const times = [...activity.map((p) => +p.lastSeenAt), ...drafts.map((s) => +s.draftUpdatedAt)];
    const lastSeen = times.length ? Math.max(...times) : null;
    const hours = lastSeen === null ? null : (now - lastSeen) / 3600000;
    return {
      id: t.id,
      teamCode: t.teamCode,
      name: t.name,
      track: t.track?.name ?? '',
      members: t.members.length,
      lastSeen: lastSeen ? new Date(lastSeen) : null,
      guidebookOpened: activity.some((p) => p.guidebookAt),
      submitted: drafts.some((s) => s.lastVersionNo > 0),
      status:
        hours === null ? 'UNKNOWN' : hours <= 24 ? 'ACTIVE' : hours <= 72 ? 'SLIPPING' : 'INACTIVE',
    };
  });
}
