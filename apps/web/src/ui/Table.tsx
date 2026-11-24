import { useLayoutEffect, useRef } from 'react';
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from './cn.js';

/**
 * White card on Paper. Below 640 px each row becomes a stacked card with every value labelled by its
 * column heading (brand §8, audit P1-31), so phones never need sideways scrolling. Wider screens keep the
 * table, with a scrollable region as a fallback.
 */
export function Table({
  className,
  children,
  caption,
  ...rest
}: HTMLAttributes<HTMLTableElement> & { caption?: string }) {
  const ref = useRef<HTMLTableElement>(null);
  // Label each cell with its column heading for the stacked layout (read from the rendered headings, so
  // every table gets it without changing its markup). Runs after each render because rows change.
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
    table.querySelectorAll('tbody tr').forEach((tr) =>
      [...tr.children].forEach((td, i) => {
        if (heads[i]) td.setAttribute('data-label', heads[i]!);
      }),
    );
  });
  return (
    <div
      className="relative overflow-x-auto rounded-card bg-white shadow-card"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table
        ref={ref}
        className={cn('ak-stack w-full border-collapse text-left text-sm', className)}
        {...rest}
      >
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
