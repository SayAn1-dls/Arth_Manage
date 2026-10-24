import type { ReactNode } from 'react';
import { Arc } from './Arc.js';

/** Empty states may carry one brand device (a cropped arc); content stays plain and actionable. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-card bg-white p-8 text-center shadow-card sm:p-12">
      <Arc className="-right-24 -bottom-24 size-40 sm:-right-24 sm:-bottom-24 sm:size-64" />
      <div className="relative mx-auto flex max-w-md flex-col items-center gap-3">
        <h3>{title}</h3>
        {children && <p className="text-graphite">{children}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
