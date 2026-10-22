import type { ReactNode } from 'react';

/** Peach marker highlight with a thin Ember underline. Headlines only, one or two words. */
export function Marker({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded-sm border-b-2 border-ember bg-peach px-1 text-inherit">
      {children}
    </mark>
  );
}
