import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError, request } from '../../lib/api.js';
import { MODE_LABEL, TYPE_LABEL } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import { Alert, Arc, Badge, Card, Eyebrow, Logo, Spinner } from '../../ui/index.js';

interface PublicEvent {
  event: {
    slug: string;
    name: string;
    type: keyof typeof TYPE_LABEL;
    mode: keyof typeof MODE_LABEL;
    startsAt: string;
    endsAt: string;
    timeZone: string;
    institution: string;
    venue: string | null;
    description: string | null;
    eligibility: string | null;
    status: 'PUBLISHED' | 'CONCLUDED' | 'ARCHIVED';
    registrationStatus: 'NOT_OPEN' | 'OPEN' | 'CLOSED';
    registrationOpensAt: string | null;
    registrationClosesAt: string | null;
    teamMin: number;
    teamMax: number;
    contactEmail: string;
  };
  rounds: { name: string; submissionDeadline: string | null }[];
  tracks: { name: string; description: string | null }[];
}

/** Public landing page for a published event (PRD 5.2-4): no account needed to read it. */
export function PublicEventPage() {
  const { slug = '' } = useParams();
  const q = useQuery({
    queryKey: ['public-event', slug],
    queryFn: () => request<PublicEvent>('GET', `/public/events/${slug}`),
    retry: false,
  });

  if (q.isPending)
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Loading event" />
      </div>
    );
  if (q.isError) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <main className="mx-auto max-w-form px-4 py-16">
        <Logo width={150} />
        <Alert
          className="mt-8"
          tone={missing ? 'info' : 'error'}
          title={missing ? "We couldn't find that event" : 'Something went wrong'}
        >
          {missing
            ? 'The link may be wrong, or the event is not published yet.'
            : 'Please try again in a moment.'}
        </Alert>
      </main>
    );
  }
  const { event: e, rounds, tracks } = q.data;
  const regText =
    e.registrationStatus === 'OPEN'
      ? 'Registration is open'
      : e.registrationStatus === 'CLOSED'
        ? 'Registration is closed'
        : e.registrationOpensAt
          ? `Registration opens ${formatDateTime(e.registrationOpensAt, e.timeZone)}`
          : 'Registration is not open yet';

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <Arc className="-top-44 -right-44 size-72 sm:-top-56 sm:-right-56 sm:size-[40rem]" />
      <Arc counter className="-top-36 -right-52 size-72 sm:-top-44 sm:-right-72 sm:size-[40rem]" />
      <header className="relative mx-auto flex max-w-content items-center justify-between px-4 py-6 sm:px-8">
        <Link to="/" aria-label="Arthakram home">
          <Logo width={150} />
        </Link>
      </header>
      <main className="relative mx-auto max-w-content px-4 pb-20 sm:px-8">
        <Eyebrow>
          {TYPE_LABEL[e.type]} · {MODE_LABEL[e.mode]}
        </Eyebrow>
        <h1 className="mt-3 max-w-[18ch]">{e.name}</h1>
        {e.description && <p className="mt-4 text-lg">{e.description}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Badge tone={e.registrationStatus === 'OPEN' ? 'success' : 'info'}>{regText}</Badge>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Card footerLabel="When and where">
            <p>
              <strong>{formatDateTime(e.startsAt, e.timeZone)}</strong>
            </p>
            <p>to {formatDateTime(e.endsAt, e.timeZone)}</p>
            {e.venue && <p className="mt-2">{e.venue}</p>}
            <p className="mt-2 text-sm">Hosted by {e.institution}</p>
          </Card>
          <Card footerLabel="Teams">
            <p>
              {e.teamMin === e.teamMax
                ? `Teams of ${e.teamMax}`
                : `Teams of ${e.teamMin} to ${e.teamMax}`}
            </p>
            {e.eligibility && <p className="mt-2 whitespace-pre-line">{e.eligibility}</p>}
          </Card>
          {tracks.length > 0 && (
            <Card footerLabel="Tracks">
              <ul className="flex flex-col gap-2">
                {tracks.map((t) => (
                  <li key={t.name}>
                    <strong>{t.name}</strong>
                    {t.description && <span> · {t.description}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {rounds.some((r) => r.submissionDeadline) && (
            <Card footerLabel="Deadlines">
              <ul className="flex flex-col gap-2">
                {rounds
                  .filter((r) => r.submissionDeadline)
                  .map((r) => (
                    <li key={r.name}>
                      <strong>{r.name}</strong>: {formatDateTime(r.submissionDeadline!, e.timeZone)}
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </div>
        <p className="mt-8 text-sm">
          Questions? <a href={`mailto:${e.contactEmail}`}>{e.contactEmail}</a>
        </p>
      </main>
    </div>
  );
}
