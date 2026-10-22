import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../db/client.js';

export type AuditClient = Db | Prisma.TransactionClient;

export interface AuditEntry {
  eventId?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/**
 * Append an audit record. Pass the transaction client so the entry commits or rolls back with the change.
 * The table is append-only at the database level; there is intentionally no update or delete helper.
 */
export async function writeAudit(client: AuditClient, entry: AuditEntry): Promise<void> {
  await client.auditLog.create({
    data: {
      eventId: entry.eventId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: entry.reason ?? null,
    },
  });
}
