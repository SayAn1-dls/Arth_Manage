import { Loader2 } from 'lucide-react';
import { cn } from './cn.js';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-graphite">
      <Loader2 aria-hidden className="size-5 animate-spin" />
      <span>{label}…</span>
    </span>
  );
}

/** Placeholder block while content loads. Decorative; announce loading via Spinner or aria-busy. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-card bg-peach/50', className)} />;
}
