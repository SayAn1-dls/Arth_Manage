import { AppError } from '../http/errors.js';
import type { Deps } from '../http/deps.js';
import { writeAudit } from '../audit/audit.js';
import { DUMMY_HASH_PROMISE, hashPassword, newToken, sha256, verifyPassword } from './crypto.js';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000; // PRD FR-001: reset link valid 30 minutes
const LOCK_AFTER = 5; // 5 failures in 15 minutes lock sign-in for 15 minutes (PRD FR-001)
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000; // OQ-14 defaults
const OTHER_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export const GENERIC_CREDENTIALS_ERROR = 'Email or password is incorrect';

export function createAuthService({ db, email, env }: Deps) {
  async function issueToken(userId: string, type: 'VERIFY_EMAIL' | 'RESET_PASSWORD') {
    const raw = newToken();
    await db.authToken.create({
      data: {
        userId,
        type,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + (type === 'VERIFY_EMAIL' ? VERIFY_TTL_MS : RESET_TTL_MS)),
      },
    });
    return raw;
  }

  async function sendVerification(user: { id: string; email: string; name: string }) {
    const token = await issueToken(user.id, 'VERIFY_EMAIL');
    const link = `${env.APP_BASE_URL}/verify-email?token=${token}`;
    await email.send({
      to: user.email,
      subject: 'Verify your email for Arthakram events',
      body: `Hi ${user.name}, confirm your email address to finish creating your account. This link works once and expires in 24 hours.`,
      link,
    });
  }

  return {
    /** Always answers the same way so account existence is not revealed. */
    async register(input: { name: string; email: string; password: string }) {
      const existing = await db.user.findUnique({ where: { email: input.email } });
      if (existing) {
        await email.send({
          to: existing.email,
          subject: 'You already have an Arthakram events account',
          body: 'Someone tried to create an account with this email. If it was you, sign in or reset your password.',
          link: `${env.APP_BASE_URL}/login`,
        });
        return;
      }
      const user = await db.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: await hashPassword(input.password),
        },
      });
      await writeAudit(db, {
        actorId: user.id,
        action: 'user.registered',
        entityType: 'User',
        entityId: user.id,
      });
      await sendVerification(user);
    },

    async verifyEmail(rawToken: string) {
      const token = await db.authToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
      if (!token || token.type !== 'VERIFY_EMAIL' || token.usedAt || token.expiresAt < new Date()) {
        throw new AppError(400, 'link_expired', 'This link has expired or was already used');
      }
      await db.$transaction([
        db.authToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
        db.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } }),
      ]);
    },

    async resendVerification(emailAddr: string) {
      const user = await db.user.findUnique({ where: { email: emailAddr } });
      if (user && !user.emailVerifiedAt) await sendVerification(user);
    },

    async login(emailAddr: string, password: string) {
      const user = await db.user.findUnique({ where: { email: emailAddr } });
      if (!user) {
        await verifyPassword(password, await DUMMY_HASH_PROMISE); // equalise timing
        throw new AppError(401, 'invalid_credentials', GENERIC_CREDENTIALS_ERROR);
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new AppError(
          429,
          'account_locked',
          'Too many failed sign-in attempts. Try again in 15 minutes or reset your password.',
        );
      }
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) {
        const now = new Date();
        // A stale count from an earlier window is reset first; the increment itself is atomic in the database
        // so parallel guesses cannot all read the same count and slip past the lock.
        await db.user.updateMany({
          where: {
            id: user.id,
            lastFailedLoginAt: { lt: new Date(now.getTime() - LOCK_WINDOW_MS) },
          },
          data: { failedLoginCount: 0 },
        });
        const updated = await db.user.update({
          where: { id: user.id },
          data: { failedLoginCount: { increment: 1 }, lastFailedLoginAt: now },
        });
        if (updated.failedLoginCount >= LOCK_AFTER)
          await db.user.update({
            where: { id: user.id },
            data: { lockedUntil: new Date(now.getTime() + LOCK_WINDOW_MS) },
          });
        throw new AppError(401, 'invalid_credentials', GENERIC_CREDENTIALS_ERROR);
      }
      if (!user.emailVerifiedAt) {
        throw new AppError(
          403,
          'email_not_verified',
          'Verify your email to sign in. We can send the link again.',
        );
      }
      await db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null },
      });

      const isAdmin =
        (await db.eventMembership.count({
          where: { userId: user.id, role: 'ADMIN', status: 'ACTIVE' },
        })) > 0;
      const ttl = isAdmin ? ADMIN_SESSION_MS : OTHER_SESSION_MS;
      const raw = newToken();
      await db.session.create({
        data: { userId: user.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttl) },
      });
      return { user, token: raw, maxAgeMs: ttl };
    },

    async resolveSession(rawToken: string) {
      const session = await db.session.findUnique({
        where: { tokenHash: sha256(rawToken) },
        include: { user: true },
      });
      if (!session || session.expiresAt < new Date()) return null;
      return session;
    },

    async logout(rawToken: string) {
      await db.session.deleteMany({ where: { tokenHash: sha256(rawToken) } });
    },

    async forgotPassword(emailAddr: string) {
      const user = await db.user.findUnique({ where: { email: emailAddr } });
      if (!user) return; // same response either way
      const token = await issueToken(user.id, 'RESET_PASSWORD');
      await email.send({
        to: user.email,
        subject: 'Reset your Arthakram events password',
        body: 'Use this link to choose a new password. It works once and expires in 30 minutes.',
        link: `${env.APP_BASE_URL}/reset-password?token=${token}`,
      });
    },

    async resetPassword(rawToken: string, password: string) {
      const token = await db.authToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
      if (
        !token ||
        token.type !== 'RESET_PASSWORD' ||
        token.usedAt ||
        token.expiresAt < new Date()
      ) {
        throw new AppError(400, 'link_expired', 'This link has expired or was already used');
      }
      const passwordHash = await hashPassword(password);
      await db.$transaction([
        db.authToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
        db.user.update({
          where: { id: token.userId },
          // A reset also proves control of the mailbox and clears any lockout.
          data: {
            passwordHash,
            failedLoginCount: 0,
            lockedUntil: null,
            emailVerifiedAt: new Date(),
          },
        }),
        db.session.deleteMany({ where: { userId: token.userId } }), // sign out everywhere
      ]);
      await writeAudit(db, {
        actorId: token.userId,
        action: 'user.password_reset',
        entityType: 'User',
        entityId: token.userId,
      });
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
