import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { request } from '../../lib/api.js';
import { AuthLayout } from '../../shell/AuthLayout.js';
import { useSession } from '../../shell/session.js';
import { Alert, Spinner } from '../../ui/index.js';

/** Accepting needs a signed-in account whose email matches the invitation. */
export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, loading, signOut } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [result, setResult] = useState<
    { ok: true; eventId: string; eventName: string } | { ok: false; message: string } | null
  >(null);
  const started = useRef(false);

  useEffect(() => {
    if (!user || started.current) return;
    started.current = true;
    request<{ eventId: string; eventName: string }>('POST', '/invitations/accept', { token })
      .then((r) => {
        qc.removeQueries({ queryKey: ['my-events'] });
        setResult({ ok: true, ...r });
        // Go straight into the event; the success message stays for a moment for screen readers.
        window.setTimeout(() => navigate(`/events/${r.eventId}`, { replace: true }), 1500);
      })
      .catch((e: Error) => setResult({ ok: false, message: e.message }));
  }, [user, token, qc, navigate]);

  if (loading)
    return (
      <AuthLayout title="Invitation">
        <Spinner label="Loading" />
      </AuthLayout>
    );
  if (!user)
    return <Navigate to="/login" replace state={{ from: `/invitations/accept?token=${token}` }} />;
  return (
    <AuthLayout title="Invitation">
      {!result && <Spinner label="Accepting your invitation" />}
      {result?.ok && (
        <Alert tone="success" title={`You have joined ${result.eventName}`}>
          Your role and menu are set by the invitation.{' '}
          <Link to={`/events/${result.eventId}`}>Open the event</Link>
        </Alert>
      )}
      {result && !result.ok && (
        <Alert tone="error" title={result.message}>
          <p>
            You are signed in as <strong>{user.email}</strong>. If the invitation was sent to
            another address, sign out and sign in (or create an account) with that address; you will
            come straight back here.
          </p>
          <button
            type="button"
            className="mt-2 font-bold underline"
            onClick={async () => {
              await signOut();
              navigate(`/login?next=${encodeURIComponent(`/invitations/accept?token=${token}`)}`);
            }}
          >
            Sign out and switch account
          </button>
          <p className="mt-2">Otherwise, ask the organiser to send a new invitation.</p>
        </Alert>
      )}
    </AuthLayout>
  );
}
