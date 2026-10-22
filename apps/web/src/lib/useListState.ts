import { useSearchParams } from 'react-router';

/** Filters, sort and page live in the URL so they survive a reload and the back button (PRD FR-020). */
export function useListState(defaults: { sort: string; dir?: 'asc' | 'desc' }) {
  const [params, setParams] = useSearchParams();
  const get = (k: string, d = '') => params.get(k) ?? d;
  const set = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page'); // any filter change returns to page 1
    setParams(next, { replace: true });
  };
  const sort = get('sort', defaults.sort);
  const dir = (get('dir', defaults.dir ?? 'asc') === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc';
  return {
    get,
    set,
    sort,
    dir,
    page: Math.max(1, Number(get('page', '1')) || 1),
    toggleSort: (field: string) =>
      set({ sort: field, dir: sort === field && dir === 'asc' ? 'desc' : 'asc' }),
    queryString: () => params.toString(),
  };
}
