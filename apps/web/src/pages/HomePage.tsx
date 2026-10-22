import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

export function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });

  return (
    <main>
      <h1>Arthakram events</h1>
      <p>
        {health.isPending && 'Checking the platform…'}
        {health.isError && 'The API is not reachable.'}
        {health.data && `API ${health.data.status}, database ${health.data.database}.`}
      </p>
    </main>
  );
}
