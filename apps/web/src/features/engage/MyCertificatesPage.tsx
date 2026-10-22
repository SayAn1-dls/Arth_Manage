import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { engageApi } from '../../lib/engage.js';
import { useFormErrors } from '../auth/useFormErrors.js';
import { Alert, Badge, Button, Card, EmptyState, Input, Spinner } from '../../ui/index.js';

/** The signed-in person's own released certificates for this event (PRD FR-235). */
export function MyCertificatesPage() {
  const mine = useOutletContext<MyEvent>();
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [fixing, setFixing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['my-certificates', mine.eventId],
    queryFn: () => engageApi.myCertificates(mine.eventId),
  });
  const ask = useMutation({
    mutationFn: (id: string) => engageApi.requestCorrection(mine.eventId, id, name),
    onSuccess: async () => {
      errors.clear();
      setFixing(null);
      setName('');
      setNotice('Thanks. The organisers will review your correction and tell you the outcome.');
      await qc.invalidateQueries({ queryKey: ['my-certificates', mine.eventId] });
    },
    onError: errors.capture,
  });
  return (
    <div className="flex flex-col gap-6">
      <h2>Certificates</h2>
      {q.isPending && <Spinner label="Loading certificates" />}
      {q.isError && <Alert tone="error" title="We couldn't load your certificates" />}
      {notice && <Alert tone="success" title={notice} />}
      {q.data?.certificates.length === 0 && (
        <EmptyState title="No certificates yet">
          When the organisers release certificates, yours will appear here to download.
        </EmptyState>
      )}
      {q.data?.certificates.map((c) => (
        <Card key={c.id} footerLabel={`Certificate ID ${c.code}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3>
              {c.type === 'WINNER' ? (c.awardText ?? 'Winner') : 'Certificate of participation'}
            </h3>
            {c.withdrawn && <Badge tone="error">Withdrawn</Badge>}
          </div>
          <p className="mt-2">
            Issued to <strong className="text-ink">{c.name}</strong>
            {c.teamName ? ` · ${c.teamName}` : ''}
          </p>
          {c.withdrawn && (
            <Alert className="mt-3" tone="warning" title="This certificate has been withdrawn">
              Contact the organisers if you think this is a mistake.
            </Alert>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            {c.downloadable && (
              <a
                href={`/api/v1/events/${mine.eventId}/certificates/${c.id}/pdf`}
                className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-ember bg-ember px-5 font-bold text-ink no-underline hover:brightness-95"
              >
                <Download aria-hidden className="size-4" /> Download PDF
              </a>
            )}
            {c.downloadable && (
              <Button variant="secondary" onClick={() => setFixing(fixing === c.id ? null : c.id)}>
                My name is wrong
              </Button>
            )}
          </div>
          {fixing === c.id && (
            <form
              className="mt-4 flex flex-col gap-3 border-t border-line pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                errors.clear();
                ask.mutate(c.id);
              }}
            >
              <Input
                label="Name exactly as it should appear"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={errors.fields.name}
                hint="Latin letters only. The organisers approve every change."
              />
              {errors.formError && <Alert tone="error" title={errors.formError} />}
              <div>
                <Button type="submit" loading={ask.isPending}>
                  Send correction request
                </Button>
              </div>
            </form>
          )}
        </Card>
      ))}
    </div>
  );
}
