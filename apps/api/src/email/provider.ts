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
  sendMail(m: { from: string; to: string; subject: string; text: string; html?: string }): Promise<unknown>;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtmlEmail(message: EmailMessage): string {
  const safeSubject = escapeHtml(message.subject);
  const safeBody = escapeHtml(message.body).replace(/\n/g, '<br />');
  const safeLink = message.link ? escapeHtml(message.link) : undefined;

  const ctaSection = safeLink
    ? `<div style="margin: 28px 0;">
         <a href="${safeLink}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #111827; color: #ffffff; font-weight: 600; font-size: 15px; text-decoration: none; padding: 12px 24px; border-radius: 6px;">
           Continue to Arthakram
         </a>
       </div>
       <p style="color: #6b7280; font-size: 13px; line-height: 1.5; margin-top: 24px;">
         Or copy and paste this <a href="${safeLink}" style="color: #2563eb; text-decoration: underline;">login link</a> into your browser.
       </p>`
    : '';

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeSubject}</title>
  </head>
  <body style="margin: 0; padding: 24px; background-color: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827;">
    <div style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 32px;">
      <h2 style="margin-top: 0; margin-bottom: 16px; font-size: 20px; font-weight: 600; color: #111827;">
        ${safeSubject}
      </h2>
      <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151;">
        ${safeBody}
      </p>
      ${ctaSection}
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 28px 0 16px 0;" />
      <p style="margin: 0; font-size: 12px; color: #9ca3af;">
        Arthakram Events &bull; If you did not request this email, you can safely ignore it.
      </p>
    </div>
  </body>
</html>`;
}

/**
 * Production provider: sends through any SMTP service (SMTP_URL, for example smtps://user:pass@host:465).
 * Failures are thrown so callers see them; the message is sent as HTML with an embedded link (and plain text fallback).
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
      // Plain text fallback + HTML body with embedded link
      text: message.link ? `${message.body}\n\n${message.link}\n` : message.body,
      html: buildHtmlEmail(message),
    });
    this.logger.info({ subject: message.subject }, 'email sent');
  }
}
