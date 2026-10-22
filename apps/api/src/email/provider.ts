import nodemailer from 'nodemailer';
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

export interface MailTransport {
  sendMail(m: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

/**
 * Production provider: sends through any SMTP service (SMTP_URL, for example smtps://user:pass@host:465).
 * Failures are thrown so callers see them; the message body is plain text and carries the link.
 */
export class SmtpEmailProvider implements EmailProvider {
  constructor(
    private readonly from: string,
    private readonly transport: MailTransport,
    private readonly logger: Logger,
  ) {}

  static fromUrl(url: string, from: string, logger: Logger) {
    return new SmtpEmailProvider(from, nodemailer.createTransport(url), logger);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.body,
    });
    this.logger.info({ subject: message.subject }, 'email sent');
  }
}
