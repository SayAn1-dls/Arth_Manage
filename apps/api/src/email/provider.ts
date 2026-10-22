import type { Logger } from 'pino';
import type { Db } from '../db/client.js';

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  /** Primary call-to-action link, stored separately so development tooling and tests can read it. */
  link?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development provider: records the message in OutboxEmail and logs it. Nothing leaves the machine.
 * A real SMTP provider can implement the same interface (DECISIONS D-12).
 */
export class ConsoleEmailProvider implements EmailProvider {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    await this.db.outboxEmail.create({
      data: {
        toEmail: message.to,
        subject: message.subject,
        body: message.body,
        link: message.link,
      },
    });
    this.logger.info({ to: message.to, subject: message.subject }, 'email recorded in dev outbox');
  }
}
