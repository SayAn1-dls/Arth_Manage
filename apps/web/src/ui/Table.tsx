import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from './cn.js';

/** White card on Paper with a scrollable region so wide admin tables never break the page on mobile. */
export function Table({
  className,
  children,
  caption,
  ...rest
}: HTMLAttributes<HTMLTableElement> & { caption?: string }) {
  return (
    <div
      className="overflow-x-auto rounded-card bg-white shadow-card"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className={cn('w-full border-collapse text-left text-sm', className)} {...rest}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export const THead = (p: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className="border-b border-line-strong bg-blush" {...p} />
);
export const TBody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
export const Tr = ({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('border-b border-line last:border-0 hover:bg-paper', className)} {...rest} />
);
export const Th = ({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    scope="col"
    className={cn(
      'whitespace-nowrap px-4 py-3 text-xs font-bold uppercase tracking-eyebrow text-ink',
      className,
    )}
    {...rest}
  />
);
export const Td = ({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('px-4 py-3 align-middle text-graphite', className)} {...rest} />
);
