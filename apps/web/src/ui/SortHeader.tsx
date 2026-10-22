import { ArrowDown, ArrowUp } from 'lucide-react';
import { Th } from './Table.js';

/** Sortable column header: a real button, announces the sort direction, never colour alone. */
export function SortHeader({
  label,
  field,
  sort,
  dir,
  onSort,
}: {
  label: string;
  field: string;
  sort: string;
  dir: 'asc' | 'desc';
  onSort: (field: string) => void;
}) {
  const active = sort === field;
  return (
    <Th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex min-h-8 items-center gap-1 font-bold uppercase tracking-eyebrow text-ink"
      >
        {label}
        {active &&
          (dir === 'asc' ? (
            <ArrowUp aria-hidden className="size-3.5" />
          ) : (
            <ArrowDown aria-hidden className="size-3.5" />
          ))}
      </button>
    </Th>
  );
}
