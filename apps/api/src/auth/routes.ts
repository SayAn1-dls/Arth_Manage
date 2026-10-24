import { Router } from 'express';
import {
  emailOnlySchema,
  loginSchema,
  registerSchema,
  resetSchema,
  tokenSchema,
  type MeResponse,
} from '@arthakram/shared';
import type { Deps } from '../http/deps.js';
import { parse } from '../http/validate.js';
import { requireAuth, SESSION_COOKIE } from './middleware.js';
import { createAuthService } from './service.js';

export function authRouter(deps: Deps) {
  const router = Router();
  const auth = createAuthService(deps);
  const { limit, env } = deps;
  const secure = env.NODE_ENV === 'production';

  router.post('/auth/register', limit('register', 10, 60 * 60 * 1000), async (req, res) => {
    await auth.register(parse(registerSchema, req.body));
    res
      .status(202)
      .json({ message: 'If that email can be registered, we have sent a link to confirm it.' });
  });

  router.post('/auth/verify-email', limit('verify', 20, 15 * 60 * 1000), async (req, res) => {
    await auth.verifyEmail(parse(tokenSchema, req.body).token);
    res.json({ message: 'Email verified. You can sign in now.' });
  });

  router.post('/auth/resend-verification', limit('resend', 5, 15 * 60 * 1000), async (req, res) => {
    await auth.resendVerification(parse(emailOnlySchema, req.body).email);
    res.status(202).json({ message: 'If that account needs verifying, we have sent a new link.' });
  });

  router.post('/auth/login', limit('login', 20, 15 * 60 * 1000), async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const { user, token, maxAgeMs } = await auth.login(email, password);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: maxAgeMs,
    });
    const me: MeResponse = { id: user.id, email: user.email, name: user.name };
    res.json(me);
  });

  router.post('/auth/logout', async (req, res) => {
    const raw = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (raw) await auth.logout(raw);
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
    res.status(204).end();
  });

  router.post('/auth/forgot-password', limit('forgot', 5, 15 * 60 * 1000), async (req, res) => {
    await auth.forgotPassword(parse(emailOnlySchema, req.body).email);
    res.status(202).json({ message: 'If that account exists, we have sent a reset link.' });
  });

  router.post('/auth/reset-password', limit('reset', 10, 15 * 60 * 1000), async (req, res) => {
    const { token, password } = parse(resetSchema, req.body);
    await auth.resetPassword(token, password);
    res.json({ message: 'Password updated. Sign in with your new password.' });
  });

  router.get('/me', requireAuth, (req, res) => {
    const u = req.user!;
    const me: MeResponse = { id: u.id, email: u.email, name: u.name };
    res.json(me);
  });

  return router;
}
