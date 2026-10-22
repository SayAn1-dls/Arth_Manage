import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button.js';

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1)
    return (
      <p className="text-sm">
        {total} {total === 1 ? 'result' : 'results'}
      </p>
    );
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm">
        {total} results, page {page} of {pages}
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          icon={<ChevronLeft aria-hidden className="size-4" />}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
