import { describe, expect, it } from 'vitest';
import { createLogger } from '../config/logger.js';
import { loadEnv } from '../config/env.js';
import { SmtpEmailProvider } from './provider.js';

const logger = createLogger(
  loadEnv({ DATABASE_URL: 'postgresql://x/y', SESSION_SECRET: 'a'.repeat(32) }),
);
const base = { DATABASE_URL: 'postgresql://x/y', SESSION_SECRET: 'a'.repeat(32) };

describe('SmtpEmailProvider', () => {
  it('sends HTML email with embedded link (plus plain text fallback) and surfaces transport failures', async () => {
    const sent: Array<{ from: string; to: string; subject: string; text: string; html?: string }> =
      [];
    const ok = new SmtpEmailProvider(
      'Arthakram <hello@example.org>',
      { sendMail: async (m) => void sent.push(m) },
      logger,
    );
    await ok.send({
      to: 'a@example.test',
      subject: 'Verify',
      body: 'Confirm your email address.',
      link: 'https://x/verify?token=1',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: 'Arthakram <hello@example.org>',
      to: 'a@example.test',
      subject: 'Verify',
      text: 'Confirm your email address.\n\nhttps://x/verify?token=1\n',
    });
    const html = sent[0]?.html;
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Confirm your email address.');
    expect(html).toContain('<a href="https://x/verify?token=1"');

    const down = new SmtpEmailProvider(
      'x',
      { sendMail: async () => Promise.reject(new Error('ECONNREFUSED')) },
      logger,
    );
    await expect(down.send({ to: 'a@example.test', subject: 's', body: 'b' })).rejects.toThrow(
      'ECONNREFUSED',
    );
  });

  it('remembers the last failure as a code and server reply, never the message text, and clears it on success', async () => {
    let fail = true;
    const provider = new SmtpEmailProvider(
      'x',
      {
        sendMail: async () => {
          if (!fail) return;
          throw Object.assign(new Error('Invalid login for smtp://user:SECRET@host'), {
            code: 'EAUTH',
            responseCode: 535,
            response: '535 5.7.8 Authentication failed',
          });
        },
      },
      logger,
    );
    expect(provider.lastFailure()).toBeUndefined();
    await expect(
      provider.send({ to: 'a@example.test', subject: 's', body: 'b' }),
    ).rejects.toThrow();
    const failure = provider.lastFailure();
    expect(failure).toMatchObject({ code: 'EAUTH', detail: '535 5.7.8 Authentication failed' });
    expect(JSON.stringify(failure)).not.toContain('SECRET');
    fail = false;
    await provider.send({ to: 'a@example.test', subject: 's', body: 'b' });
    expect(provider.lastFailure()).toBeUndefined();
  });
});

describe('production configuration guards', () => {
  it('refuses to start in production with console email, an http base URL, or smtp without SMTP_URL', () => {
    const prod = { ...base, NODE_ENV: 'production', APP_BASE_URL: 'https://events.example.org' };
    expect(() => loadEnv({ ...prod })).toThrow(/EMAIL_PROVIDER/);
    expect(() => loadEnv({ ...prod, EMAIL_PROVIDER: 'smtp' })).toThrow(/SMTP_URL/);
    expect(() =>
      loadEnv({ ...prod, EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://h', APP_BASE_URL: 'http://x' }),
    ).toThrow(/https/);
    expect(loadEnv({ ...prod, EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://h' }).EMAIL_PROVIDER).toBe(
      'smtp',
    );
    expect(loadEnv(base).EMAIL_PROVIDER).toBe('console'); // development stays simple
  });
});
