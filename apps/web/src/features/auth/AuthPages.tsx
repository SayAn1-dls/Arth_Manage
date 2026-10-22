import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { PASSWORD_MIN } from '@arthakram/shared';
import { api } from '../../lib/api.js';
import { AuthLayout } from '../../shell/AuthLayout.js';
import { Alert, Button, FormErrorSummary, Input, Spinner } from '../../ui/index.js';
import { useFormErrors } from './useFormErrors.js';

const linkCls = 'font-bold text-ink underline underline-offset-4';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [resent, setResent] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/events';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    errors.clear();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const me = await api.login({
        email: String(form.get('email')),
        password: String(form.get('password')),
      });
      qc.setQueryData(['me'], me);
      navigate(from, { replace: true });
    } catch (err) {
      errors.capture(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Sign in" intro="Use your Arthakram events account.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {errors.formError && (
          <Alert tone="error" title={errors.formError}>
            {errors.code === 'email_not_verified' && (
              <Button
                variant="secondary"
                className="mt-2"
                onClick={async () => {
                  await api.resendVerification(email);
                  setResent(true);
                }}
              >
                Send the verification link again
              </Button>
            )}
          </Alert>
        )}
        {resent && <Alert tone="success" title="Check your inbox for a new link." />}
        <FormErrorSummary
          issues={errors.issues({ email: 'login-email', password: 'login-password' })}
        />
        <Input
          id="login-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          error={errors.fields.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          id="login-password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
          error={errors.fields.password}
        />
        <Button type="submit" loading={busy}>
          Sign in
        </Button>
        <p className="text-sm">
          <Link to="/forgot-password" className={linkCls}>
            Forgot your password?
          </Link>
        </p>
        <p className="text-sm">
          New here?{' '}
          <Link to="/register" className={linkCls}>
            Create an account
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const errors = useFormErrors();
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    errors.clear();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const input = {
      name: String(form.get('name')),
      email: String(form.get('email')),
      password: String(form.get('password')),
    };
    try {
      await api.register(input);
      setSentTo(input.email);
    } catch (err) {
      errors.capture(err);
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your email">
        <Alert tone="success" title={`We sent a confirmation link to ${sentTo}`}>
          Open it to finish creating your account. The link works once and expires in 24 hours.
        </Alert>
        <p className="mt-4 text-sm">
          <Link to="/login" className={linkCls}>
            Back to sign in
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" intro="One account for every event you join.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {errors.formError && <Alert tone="error" title={errors.formError} />}
        <FormErrorSummary
          issues={errors.issues({ name: 'reg-name', email: 'reg-email', password: 'reg-password' })}
        />
        <Input
          id="reg-name"
          name="name"
          label="Full name"
          autoComplete="name"
          required
          error={errors.fields.name}
        />
        <Input
          id="reg-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          error={errors.fields.email}
        />
        <Input
          id="reg-password"
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN} characters.`}
          required
          error={errors.fields.password}
        />
        <Button type="submit" loading={busy}>
          Create account
        </Button>
        <p className="text-sm">
          Already registered?{' '}
          <Link to="/login" className={linkCls}>
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'ok' | 'failed'>('working');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; the link is single-use
    started.current = true;
    api
      .verifyEmail(token)
      .then((r) => {
        setMessage(r.message);
        setState('ok');
      })
      .catch((e: Error) => {
        setMessage(e.message);
        setState('failed');
      });
  }, [token]);

  return (
    <AuthLayout title="Verify your email">
      {state === 'working' && <Spinner label="Verifying" />}
      {state === 'ok' && (
        <>
          <Alert tone="success" title={message} />
          <p className="mt-4">
            <Link to="/login" className={linkCls}>
              Continue to sign in
            </Link>
          </p>
        </>
      )}
      {state === 'failed' && (
        <>
          <Alert tone="error" title={message} />
          <p className="mt-4 text-sm">
            Sign in and we will offer to send a fresh link.{' '}
            <Link to="/login" className={linkCls}>
              Sign in
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const errors = useFormErrors();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    errors.clear();
    setBusy(true);
    try {
      await api.forgotPassword(String(new FormData(e.currentTarget).get('email')));
      setDone(true);
    } catch (err) {
      errors.capture(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      intro="We will email you a link that works once for 30 minutes."
    >
      {done ? (
        <Alert tone="success" title="If that account exists, a reset link is on its way." />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {errors.formError && <Alert tone="error" title={errors.formError} />}
          <Input
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            required
            error={errors.fields.email}
          />
          <Button type="submit" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-4 text-sm">
        <Link to="/login" className={linkCls}>
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const errors = useFormErrors();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    errors.clear();
    setBusy(true);
    try {
      await api.resetPassword({
        token: params.get('token') ?? '',
        password: String(new FormData(e.currentTarget).get('password')),
      });
      setDone(true);
    } catch (err) {
      errors.capture(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Choose a new password">
      {done ? (
        <>
          <Alert tone="success" title="Password updated" />
          <p className="mt-4">
            <Link to="/login" className={linkCls}>
              Sign in
            </Link>
          </p>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {errors.formError && (
            <Alert tone="error" title={errors.formError}>
              <Link to="/forgot-password" className={linkCls}>
                Request a new link
              </Link>
            </Alert>
          )}
          <Input
            name="password"
            type="password"
            label="New password"
            autoComplete="new-password"
            hint={`At least ${PASSWORD_MIN} characters.`}
            required
            error={errors.fields.password}
          />
          <Button type="submit" loading={busy}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
