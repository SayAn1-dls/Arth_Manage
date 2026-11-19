import { describe, expect, it } from 'vitest';
import { createLogger } from '../config/logger.js';
import { loadEnv } from '../config/env.js';
import { BrevoApiEmailProvider, SmtpEmailProvider, parseSender } from './provider.js';

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

describe('BrevoApiEmailProvider', () => {
  it('posts the message to the Brevo API with the key header and a parsed sender', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const provider = new BrevoApiEmailProvider(
      'xkeysib-test',
      'Arthakram <me@example.org>',
      logger,
      async (url, init) => {
        calls.push({ url, headers: init.headers, body: init.body });
        return { ok: true, status: 201, text: async () => '{"messageId":"1"}' };
      },
    );
    await provider.send({
      to: 'a@example.test',
      subject: 'Verify',
      body: 'Confirm.',
      link: 'https://x/v?t=1',
    });
    expect(calls[0]?.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0]?.headers['api-key']).toBe('xkeysib-test');
    const body = JSON.parse(calls[0]!.body);
    expect(body).toMatchObject({
      sender: { name: 'Arthakram', email: 'me@example.org' },
      to: [{ email: 'a@example.test' }],
      subject: 'Verify',
      textContent: 'Confirm.\n\nhttps://x/v?t=1\n',
    });
    expect(body.htmlContent).toContain('<a href="https://x/v?t=1"');
    expect(provider.lastFailure()).toBeUndefined();
  });

  it("throws on an error answer and records Brevo's own reason without the key", async () => {
    const provider = new BrevoApiEmailProvider(
      'xkeysib-SECRET',
      'me@example.org',
      logger,
      async () => ({
        ok: false,
        status: 401,
        text: async () => '{"code":"unauthorized","message":"Key not found"}',
      }),
    );
    await expect(
      provider.send({ to: 'a@example.test', subject: 's', body: 'b' }),
    ).rejects.toThrow();
    expect(provider.lastFailure()).toMatchObject({
      code: 'HTTP_401',
      detail: 'unauthorized: Key not found',
    });
    expect(JSON.stringify(provider.lastFailure())).not.toContain('SECRET');
  });

  it('parses sender formats', () => {
    expect(parseSender('Arthakram <a@b.org>')).toEqual({ name: 'Arthakram', email: 'a@b.org' });
    expect(parseSender('"Club" <a@b.org>')).toEqual({ name: 'Club', email: 'a@b.org' });
    expect(parseSender('a@b.org')).toEqual({ email: 'a@b.org' });
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
    expect(
      loadEnv({ ...prod, EMAIL_PROVIDER: 'smtp', BREVO_API_KEY: 'xkeysib-1' }).BREVO_API_KEY,
    ).toBe('xkeysib-1'); // the Brevo API key alone is enough
    expect(loadEnv(base).EMAIL_PROVIDER).toBe('console'); // development stays simple
  });
});
