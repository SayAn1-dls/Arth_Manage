import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.js';
import { Eyebrow } from './Eyebrow.js';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Label shown in the Blush footer strip (the kit's "soft card"). */
  footerLabel?: ReactNode;
}

/** White panel on Paper, ~8px radius, optional Blush footer strip. */
export function Card({ footerLabel, className, children, ...rest }: CardProps) {
  return (
    <div className={cn('overflow-hidden rounded-card bg-white shadow-card', className)} {...rest}>
      <div className="p-5 sm:p-6">{children}</div>
      {footerLabel && (
        <div className="border-t border-line bg-blush px-5 py-2.5 sm:px-6">
          <Eyebrow>{footerLabel}</Eyebrow>
        </div>
      )}
    </div>
  );
}
