import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

function remaining(ms: number): string {
  if (ms <= 0) return 'Closed';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return `${d} d ${h} h left`;
  if (h > 0) return `${h} h ${min} min left`;
  return `${Math.max(min, 1)} min left`;
}

/** Live time remaining until an instant. Display only: the server decides whether a deadline has passed. */
export function Countdown({ until, className }: { until: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className={className} title={new Date(until).toISOString()}>
      <Clock aria-hidden className="mr-1 inline size-4 align-text-bottom" />
      {remaining(new Date(until).getTime() - now)}
    </span>
  );
}
