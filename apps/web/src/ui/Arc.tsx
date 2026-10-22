import { cn } from './cn.js';

/**
 * Cropped arc: a large circle bled off an edge so only the curve reads. Decorative only.
 * `counter` draws the thin unfilled Graphite counter-arc instead of the Ember mass.
 * Place sparingly: hero areas, auth screens, empty states. Never behind tables or forms.
 */
export function Arc({ counter = false, className }: { counter?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute rounded-full',
        counter ? 'border border-graphite' : 'bg-brand-gradient',
        className,
      )}
    />
  );
}
