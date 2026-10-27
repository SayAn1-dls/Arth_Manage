import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { Alert, Button, Spinner } from '../../ui/index.js';
const control = 'block w-full rounded-lg border border-line-strong bg-white px-3 py-2';
type Review = {
  id: string;
  teamId: string;
  integrityNote?: string;
  marketNote: string;
  status?: string;
  repoUrl?: string;
  releaseToTeam?: boolean;
  sources:
    | {
        kind?: string;
        matchedLines?: number;
        matches?: { line: number; text: string; referenceLine: number; referenceText: string }[];
      }
    | unknown;
};
export function ProjectReviewPage() {
  const { eventId = '', roundId: routeRound, teamId: routeTeam } = useParams();
  const role = useOutletContext<MyEvent>().role;
  const admin = role === 'ADMIN';
  const cache = useQueryClient();
  const [round, setRound] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/events/${eventId}/workspace`;
  const options = useQuery({
    queryKey: ['workspace-options', eventId],
    queryFn: () =>
      request<{
        rounds: { id: string; name: string }[];
        teams: { id: string; name: string; teamCode: string }[];
      }>('GET', base + '/options'),
  });
  const rid = routeRound || round || options.data?.rounds[0]?.id || '';
  const reviews = useQuery({
    queryKey: ['project-reviews', eventId, rid],
    queryFn: () => request<{ reviews: Review[] }>('GET', `${base}/reviews/${rid}`),
    enabled: !!rid,
  });
  async function save(e: FormEvent<HTMLFormElement>, teamId: string, scan: boolean | 'compare') {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await request(
        scan ? 'POST' : 'PUT',
        `${base}/reviews/${rid}/${teamId}${scan === 'compare' ? '/compare' : scan ? '/scan' : ''}`,
        scan === 'compare'
          ? { repoUrl: d.get('repoUrl'), referenceUrl: d.get('referenceUrl'), path: d.get('path') }
          : scan
            ? { repoUrl: d.get('repoUrl') }
            : {
                integrityNote: d.get('integrityNote'),
                marketNote: d.get('marketNote'),
                status: d.get('status'),
                releaseToTeam: d.has('releaseToTeam'),
              },
      );
      await cache.invalidateQueries({ queryKey: ['project-reviews', eventId, rid] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  if (options.isPending) return <Spinner label="Loading project reviews" />;
  const entries = admin
    ? options.data?.teams
    : reviews.data?.reviews
        .filter((v) => !routeTeam || v.teamId === routeTeam)
        .map((v) => ({ id: v.teamId, name: 'Market context', teamCode: '' }));
  return (
    <div className="space-y-5">
      <h2 className="text-3xl">Project integrity and market context</h2>
      <p>
        Concept overlap is context for differentiation, execution, and user experience. Integrity
        flags require human investigation before any action.
      </p>
      {admin && (
        <Alert tone="info" title="Public repository checks available">
          This checks GitHub creation and pre-event commit history. Full code similarity and AI
          prior-art discovery need a configured provider; no originality certification is implied.
        </Alert>
      )}
      {(error || reviews.error || options.error) && (
        <Alert tone="error" title="Review unavailable">
          {error || reviews.error?.message || options.error?.message}
        </Alert>
      )}
      {!routeRound && (
        <select
          aria-label="Review round"
          className={control}
          value={rid}
          onChange={(e) => setRound(e.target.value)}
        >
          {options.data?.rounds.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      {entries?.map((t) => {
        const v = reviews.data?.reviews.find((v) => v.teamId === t.id);
        return (
          <section key={t.id} className="space-y-4 rounded-xl border border-line p-5">
            <h3 className="text-xl">
              {t.teamCode} {t.name}
            </h3>
            {admin && (
              <>
                <form onSubmit={(e) => void save(e, t.id, true)} className="flex gap-2">
                  <input
                    type="url"
                    name="repoUrl"
                    aria-label="GitHub repository URL"
                    placeholder="https://github.com/owner/repository"
                    className={control}
                    defaultValue={v?.repoUrl ?? ''}
                    required
                  />
                  <Button type="submit" loading={busy}>
                    Check history
                  </Button>
                </form>
                <form className="space-y-3" onSubmit={(e) => void save(e, t.id, 'compare')}>
                  <h4 className="font-bold">Compare a source file against a reference</h4>
                  <input
                    name="repoUrl"
                    aria-label="Submitted repository"
                    placeholder="Submitted GitHub repository URL"
                    className={control}
                    required
                    defaultValue={v?.repoUrl ?? ''}
                  />
                  <input
                    name="referenceUrl"
                    aria-label="Reference repository"
                    placeholder="Reference GitHub repository URL"
                    className={control}
                    required
                  />
                  <input
                    name="path"
                    aria-label="Source file path"
                    placeholder="src/example.ts — same path in both repositories"
                    className={control}
                    required
                  />
                  <Button type="submit" variant="secondary" loading={busy}>
                    Compare source file
                  </Button>
                </form>
                {Array.isArray(v?.sources) &&
                  v.sources.map(
                    (
                      source: {
                        kind?: string;
                        matchedLines?: number;
                        matches?: {
                          line: number;
                          text: string;
                          referenceLine: number;
                          referenceText: string;
                        }[];
                      },
                      i: number,
                    ) =>
                      source.kind === 'CODE_COMPARISON' ? (
                        <div key={i} className="overflow-x-auto">
                          <p>
                            {source.matchedLines} substantial lines match. Inspect permitted reuse
                            before acting.
                          </p>
                          <table className="w-full text-sm">
                            <thead>
                              <tr>
                                <th>Submission</th>
                                <th>Reference</th>
                              </tr>
                            </thead>
                            <tbody>
                              {source.matches?.map((m, j) => (
                                <tr key={j}>
                                  <td className="border border-line bg-blush p-2">
                                    <code>
                                      {m.line}: {m.text}
                                    </code>
                                  </td>
                                  <td className="border border-line bg-blush p-2">
                                    <code>
                                      {m.referenceLine}: {m.referenceText}
                                    </code>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null,
                  )}
                {v?.status && <strong>{v.status}</strong>}
                <p className="whitespace-pre-wrap">{v?.integrityNote}</p>
                {v?.repoUrl && (
                  <a href={v.repoUrl} target="_blank" rel="noreferrer">
                    Inspect repository and history
                  </a>
                )}
                <form
                  className="space-y-3"
                  onSubmit={(e) => void save(e, t.id, false)}
                  key={v?.id ?? 'new'}
                >
                  <label className="block">
                    Integrity review
                    <textarea
                      name="integrityNote"
                      className={control}
                      maxLength={4000}
                      defaultValue={v?.integrityNote ?? ''}
                    />
                  </label>
                  <label className="block">
                    Market context for judges
                    <textarea
                      name="marketNote"
                      className={control}
                      maxLength={4000}
                      defaultValue={v?.marketNote ?? ''}
                    />
                  </label>
                  <select name="status" className={control} defaultValue={v?.status ?? 'PENDING'}>
                    <option>PENDING</option>
                    <option>FLAGGED</option>
                    <option>CLEARED</option>
                    <option>REVIEWED</option>
                  </select>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      name="releaseToTeam"
                      defaultChecked={v?.releaseToTeam ?? false}
                    />
                    Release market context to the team
                  </label>
                  <Button type="submit" loading={busy}>
                    Save review
                  </Button>
                </form>
              </>
            )}
            {!admin && (
              <p className="whitespace-pre-wrap">
                {v?.marketNote || 'No market context has been released.'}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
