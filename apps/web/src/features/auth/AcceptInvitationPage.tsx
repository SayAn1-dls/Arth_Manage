import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { request } from '../../lib/api.js';
import { AuthLayout } from '../../shell/AuthLayout.js';
import { useSession } from '../../shell/session.js';
import { Alert, Spinner } from '../../ui/index.js';

/** Accepting needs a signed-in account whose email matches the invitation. */
export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, loading } = useSession();
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
      })
      .catch((e: Error) => setResult({ ok: false, message: e.message }));
  }, [user, token, qc]);

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
          <Link to={`/events/${result.eventId}`}>Open the event</Link>
        </Alert>
      )}
      {result && !result.ok && (
        <Alert tone="error" title={result.message}>
          Ask the organiser to send a new invitation if you need one.
        </Alert>
      )}
    </AuthLayout>
  );
}
