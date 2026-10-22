import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { Arc, Badge, Eyebrow, Logo, Marker } from '../ui/index.js';
import { useSession } from '../shell/session.js';

export function HomePage() {
  const { user } = useSession();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <Arc className="-top-44 -right-44 size-72 sm:-top-56 sm:-right-56 sm:size-[44rem]" />
      <Arc counter className="-top-36 -right-52 size-72 sm:-top-44 sm:-right-72 sm:size-[44rem]" />

      <header className="relative mx-auto flex max-w-content items-center justify-between px-4 py-6 sm:px-8">
        <Logo width={150} />
      </header>

      <main className="relative mx-auto max-w-content px-4 pt-10 pb-20 sm:px-8 sm:pt-20">
        <Eyebrow className="text-graphite">Product &amp; Consulting Club</Eyebrow>
        <h1 className="mt-3 max-w-[16ch]">
          Run every hackathon and case competition from <Marker>one place</Marker>
        </h1>
        <p className="mt-5 text-lg">
          Registration, teams, submissions, judging, results and certificates for Arthakram events,
          with one source of truth.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to={user ? '/events' : '/login'}
            className="inline-flex min-h-11 items-center rounded-pill border border-ember bg-ember px-5 py-2 font-bold text-ink no-underline hover:brightness-95"
          >
            {user ? 'Open my events' : 'Sign in'}
          </Link>
          {!user && (
            <Link
              to="/register"
              className="inline-flex min-h-11 items-center rounded-pill border border-line-strong bg-white px-5 py-2 font-bold text-ink no-underline hover:bg-blush"
            >
              Create an account
            </Link>
          )}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3" aria-live="polite">
          <Badge tone="brand">Foundation build</Badge>
          {health.isPending && <Badge tone="info">Checking platform</Badge>}
          {health.isError && <Badge tone="error">API unreachable</Badge>}
          {health.data?.database === 'up' && (
            <span className="inline-flex items-center gap-2 text-ink">
              <CheckCircle2 aria-hidden className="size-5" /> API and database are up
            </span>
          )}
          {health.data?.database === 'down' && (
            <span className="inline-flex items-center gap-2 text-ink">
              <TriangleAlert aria-hidden className="size-5" /> API is up, database is down
            </span>
          )}
        </div>
      </main>
    </div>
  );
}
