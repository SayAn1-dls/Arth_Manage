import { useParams, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { request } from '../../lib/api.js';
import { Alert, Spinner } from '../../ui/index.js';
export function VerifyCertificatePage() {
  const { code = '' } = useParams();
  const q = useQuery({
    queryKey: ['verify-certificate', code],
    queryFn: () =>
      request<{
        name: string;
        event: string;
        code: string;
        type: string;
        award: string | null;
        status: string;
        releasedAt: string;
      }>('GET', `/public/certificates/${encodeURIComponent(code)}`),
    retry: false,
  });
  return (
    <main className="mx-auto max-w-xl space-y-5 px-5 py-16">
      <Link to="/">Arthakram</Link>
      <h1 className="text-3xl">Certificate verification</h1>
      {q.isPending ? (
        <Spinner label="Checking certificate" />
      ) : q.error ? (
        <Alert tone="error" title="Certificate not found or not released" />
      ) : (
        <section className="space-y-3 rounded-xl border border-line p-6">
          <Alert
            tone={q.data.status === 'RELEASED' ? 'info' : 'error'}
            title={q.data.status === 'RELEASED' ? 'Verified certificate' : 'Certificate revoked'}
          />
          <h2 className="text-2xl">{q.data.name}</h2>
          <p>{q.data.event}</p>
          <p>{q.data.award || q.data.type}</p>
          <p>ID: {q.data.code}</p>
          {q.data.releasedAt && <p>Released {new Date(q.data.releasedAt).toLocaleDateString()}</p>}
        </section>
      )}
    </main>
  );
}
