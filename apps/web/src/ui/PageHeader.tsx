import type { ReactNode } from 'react';
import { cn } from './cn.js';

/**
 * The top of every workspace: what this page is for in one line, and its primary action. One heading
 * level (h2: the event name is the page's h1), no repeated event details: the header already shows them.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** The page's primary action first; at most two or three. */
  actions?: ReactNode;
  className?: string;
  /** Optional line under the description, e.g. a filter summary or a status. */
  children?: ReactNode;
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0 flex-1 basis-80">
        <h2 className="text-3xl">{title}</h2>
        {description && <p className="mt-1 max-w-measure text-lg">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A small uppercase label that separates a page's critical, everyday and advanced sections. */
export function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="font-sans text-sm font-bold tracking-eyebrow text-graphite uppercase">
      {children}
    </h3>
  );
}
