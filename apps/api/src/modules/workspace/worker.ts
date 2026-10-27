import type { Deps } from '../../http/deps.js';
export function startWorkspaceWorker(deps: Deps) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = new Date();
      const rounds = await deps.db.round.findMany({
        where: {
          submissionDeadline: { gt: now, lte: new Date(+now + 3600000) },
          event: { status: 'PUBLISHED' },
        },
        include: { event: true },
      });
      for (const r of rounds) {
        const entries = r.shortlistEnabled
          ? await deps.db.roundEntry.findMany({ where: { roundId: r.id } })
          : [];
        const members = await deps.db.teamMember.findMany({
          where: {
            eventId: r.eventId,
            leftAt: null,
            team: {
              status: 'ACTIVE',
              ...(r.shortlistEnabled ? { id: { in: entries.map((e) => e.teamId) } } : {}),
            },
            membership: { status: 'ACTIVE' },
          },
        });
        await deps.db.messageDelivery.createMany({
          data: members.map((m) => ({
            eventId: r.eventId,
            membershipId: m.membershipId,
            key: `deadline:${r.id}:${r.submissionDeadline!.toISOString()}`,
            subject: `${r.event.name}: submission due soon`,
            body: `${r.name} closes at ${r.submissionDeadline!.toISOString()}. Check your event dashboard for your team's deadline.`,
          })),
          skipDuplicates: true,
        });
      }
      await deps.db.messageDelivery.updateMany({
        where: { status: 'SENDING', sentAt: { lt: new Date(Date.now() - 600000) } },
        data: { status: 'QUEUED' },
      });
      const queue = await deps.db.messageDelivery.findMany({
        where: { status: 'QUEUED', attempts: { lt: 3 } },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const item of queue) {
        const claimed = await deps.db.messageDelivery.updateMany({
          where: { id: item.id, status: 'QUEUED' },
          data: { status: 'SENDING', sentAt: new Date(), attempts: { increment: 1 } },
        });
        if (!claimed.count) continue;
        const member = await deps.db.eventMembership.findFirst({
          where: { id: item.membershipId, eventId: item.eventId, status: 'ACTIVE' },
          include: { user: true },
        });
        if (!member) {
          await deps.db.messageDelivery.update({
            where: { id: item.id },
            data: { status: 'SKIPPED', error: 'Membership no longer active' },
          });
          continue;
        }
        try {
          await deps.email.send({
            to: member.user.email,
            subject: item.subject,
            body: item.body,
            link: `${deps.env.APP_BASE_URL}/events/${item.eventId}`,
          });
          await deps.db.messageDelivery.update({
            where: { id: item.id },
            data: { status: 'SENT', sentAt: new Date(), error: null },
          });
        } catch {
          await deps.db.messageDelivery.update({
            where: { id: item.id },
            data: {
              status: item.attempts >= 2 ? 'FAILED' : 'QUEUED',
              error: 'Delivery failed; check email configuration',
            },
          });
        }
      }
    } catch (err) {
      deps.logger.error({ err }, 'workspace worker failed');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void run(), 30000);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
