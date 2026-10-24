import { Router } from 'express';
import type { Deps } from '../http/deps.js';

/** Development/test only: lets the UI tests read the emailed links. Never mounted in production. */
export function devRouter({ db }: Deps) {
  const router = Router();
  router.get('/dev/outbox', async (req, res) => {
    const to = String(req.query.to ?? '').toLowerCase();
    const messages = await db.outboxEmail.findMany({
      where: to ? { toEmail: to } : {},
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ messages });
  });
  return router;
}
