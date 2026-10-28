import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../lib/api.js';
import type { Workspace } from '../../lib/judging.js';
import { Alert, Badge, Button, Card, Textarea } from '../../ui/index.js';
export type Memo = { scratchpad: string; starred: boolean; version: number };
export type Briefing = {
  briefing: { body: string; examples: string; contact: string; version: number };
  glossary: { id: string; term: string; definition: string; trackId: string | null }[];
  tracks: { id: string; name: string }[];
};
export type Insight = {
  versionNo: number;
  checkedAt: string;
  summary: string;
  repo: null | {
    url: string;
    reachable: boolean;
    error?: string;
    language?: string | null;
    pushedAt?: string | null;
    readme?: string;
    readmeHighlights?: string[];
  };
  files: { fieldId: string; available: boolean }[];
  ai: null | { summary: string; techStack: string[]; readmeHighlights: string[] };
  aiConfigured: boolean;
  aiError: string | null;
  notice: string;
};
export type JudgeToolsHandle = { flush: () => Promise<void> };
export const JudgeNotebook = forwardRef<
  JudgeToolsHandle,
  { eventId: string; assignmentId: string }
>(function JudgeNotebook({ eventId, assignmentId }, ref) {
  const cache = useQueryClient(),
    [error, setError] = useState(''),
    [status, setStatus] = useState('Loading private notes…');
  const q = useQuery({
    queryKey: ['judge-memo', eventId, assignmentId],
    queryFn: () => request<Memo>('GET', `/events/${eventId}/assignments/${assignmentId}/memo`),
    retry: false,
  });
  const [scratch, setScratch] = useState(''),
    [starred, setStarred] = useState(false);
  const version = useRef(0),
    latest = useRef({ scratchpad: '', starred: false }),
    loaded = useRef(false),
    dirty = useRef(false),
    chain = useRef(Promise.resolve()),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (q.data && !loaded.current) {
      version.current = q.data.version;
      latest.current = { scratchpad: q.data.scratchpad, starred: q.data.starred };
      setScratch(q.data.scratchpad);
      setStarred(q.data.starred);
      loaded.current = true;
      setStatus('Private notes saved');
    }
  }, [q.data]);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const run = async () => {
      if (!dirty.current || !loaded.current) return;
      const payload = { ...latest.current };
      setStatus('Saving private notes…');
      try {
        const saved = await request<Memo>(
          'PUT',
          `/events/${eventId}/assignments/${assignmentId}/memo`,
          { ...payload, version: version.current },
        );
        version.current = saved.version;
        dirty.current = JSON.stringify(payload) !== JSON.stringify(latest.current);
        setError('');
        setStatus(dirty.current ? 'Unsaved notes' : 'Private notes saved');
        void cache.invalidateQueries({ queryKey: ['judge-teams', eventId] });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save scratchpad');
        setStatus('Not saved');
        throw e;
      }
    };
    chain.current = chain.current.catch(() => {}).then(run);
    return chain.current;
  }, [eventId, assignmentId, cache]);
  useImperativeHandle(ref, () => ({ flush }), [flush]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) void flush().catch(() => {});
    },
    [flush],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  function touch(next: { scratchpad: string; starred: boolean }) {
    latest.current = next;
    dirty.current = true;
    setStatus('Unsaved notes');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(() => {}), 700);
  }
  return (
    <Card footerLabel={status}>
      <div className="flex flex-wrap justify-between gap-3">
        <h3>My scratchpad</h3>
        <Button
          variant="secondary"
          disabled={!loaded.current}
          aria-pressed={starred}
          onClick={() => {
            setStarred(!starred);
            touch({ ...latest.current, starred: !starred });
            void flush().catch(() => {});
          }}
        >
          {starred ? '★ Starred for revisit' : '☆ Revisit later'}
        </Button>
      </div>
      <p className="mt-2 text-sm">
        Only you can read this. Separate from feedback and notes to organisers.
      </p>
      {(error || q.error) && <Alert tone="error" title={error || q.error!.message} />}
      <Textarea
        label="Private scratchpad"
        maxLength={12000}
        disabled={!loaded.current}
        value={scratch}
        onChange={(e) => {
          setScratch(e.target.value);
          touch({ ...latest.current, scratchpad: e.target.value });
        }}
        onBlur={() => void flush().catch(() => {})}
      />
      <Button
        className="mt-3"
        variant="secondary"
        disabled={!loaded.current}
        onClick={() => void flush().catch(() => {})}
      >
        Save scratchpad
      </Button>
    </Card>
  );
});

export function GlossaryText({
  text,
  eventId,
  track,
}: {
  text: string;
  eventId: string;
  track?: string | null;
}) {
  const q = useQuery({
    queryKey: ['judge-briefing', eventId],
    queryFn: () => request<Briefing>('GET', `/events/${eventId}/judge/briefing`),
    staleTime: 60000,
  });
  const terms =
    q.data?.glossary.filter(
      (g) => !g.trackId || q.data?.tracks.find((t) => t.id === g.trackId)?.name === track,
    ) ?? [];
  if (!terms.length) return <>{text}</>;
  const escaped = terms
    .map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  return (
    <>
      {text.split(regex).map((part, i) => {
        const term = terms.find((t) => t.term.toLowerCase() === part.toLowerCase());
        return term ? (
          <span key={i} className="group relative inline-block">
            <abbr
              tabIndex={0}
              title={term.definition}
              className="cursor-help underline decoration-dotted"
            >
              {part}
            </abbr>
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-0 z-20 hidden w-64 rounded-lg border border-line bg-white p-3 text-sm font-normal shadow-lg group-hover:block group-focus-within:block"
            >
              {term.definition}
            </span>
          </span>
        ) : (
          part
        );
      })}
    </>
  );
}

export function ReadingAid({
  data,
  eventId,
  roundId,
  onHealth,
  videoLengths,
}: {
  data: Workspace;
  videoLengths: Record<string, number>;
  eventId: string;
  roundId: string;
  onHealth: (value: Insight) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const q = useQuery({
    queryKey: ['judge-insight', eventId, roundId, data.team.id, data.submission?.versionNo],
    queryFn: () =>
      request<Insight>(
        'GET',
        `/events/${eventId}/rounds/${roundId}/judge/teams/${data.team.id}/insight`,
      ),
    enabled,
    retry: false,
    staleTime: 900000,
  });
  useEffect(() => {
    if (q.data) onHealth(q.data);
  }, [q.data, onHealth]);
  return (
    <Card footerLabel="Reading convenience · never a suggested score">
      <h3>Submission at a glance</h3>
      <p className="mt-2 text-sm">
        Optional repository metadata and AI-assisted summary. Verify claims against the submission.
        Scoring stays entirely yours.
      </p>
      <Button
        className="mt-3"
        variant="secondary"
        loading={q.isFetching}
        onClick={() => {
          if (enabled) void q.refetch();
          else setEnabled(true);
        }}
      >
        Load reading card and link checks
      </Button>
      {q.error && <Alert className="mt-3" tone="warning" title={q.error.message} />}
      {q.data && (
        <div className="mt-4 space-y-3">
          <Badge tone="info">
            Version {q.data.versionNo} · checked {new Date(q.data.checkedAt).toLocaleTimeString()}
          </Badge>
          <p>
            <strong>{q.data.ai ? 'AI-assisted summary' : 'Submitted project summary'}:</strong>{' '}
            {q.data.ai?.summary ?? q.data.summary}
          </p>
          <p>
            <strong>Tech stack:</strong>{' '}
            {q.data.ai?.techStack.join(', ') ||
              q.data.repo?.language ||
              'Not stated / not detected'}
          </p>
          <p>
            <strong>Video length:</strong>{' '}
            {Object.values(videoLengths).length
              ? Object.values(videoLengths)
                  .map(
                    (n) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`,
                  )
                  .join(', ')
              : 'Not verified; provider-hosted videos must be opened on their site.'}
          </p>
          <p>
            <strong>Repo activity:</strong>{' '}
            {q.data.repo?.pushedAt
              ? `Latest push ${new Date(q.data.repo.pushedAt).toLocaleString()}`
              : (q.data.repo?.error ?? 'Not available')}
          </p>
          <div>
            <strong>README highlights:</strong>
            <ul className="list-disc pl-5">
              {(q.data.ai?.readmeHighlights ?? q.data.repo?.readmeHighlights ?? []).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            {!q.data.ai?.readmeHighlights.length && !q.data.repo?.readmeHighlights?.length && (
              <p>No readable README highlights found.</p>
            )}
          </div>
          {!q.data.ai && (
            <p className="text-sm">
              {q.data.aiError ??
                (q.data.aiConfigured
                  ? 'AI returned no summary.'
                  : 'AI is not configured. This card uses source text and repository metadata.')}
            </p>
          )}
          <p className="text-xs">{q.data.notice}</p>
        </div>
      )}
    </Card>
  );
}
export function VideoHealth({
  url,
  onDuration,
}: {
  url: string;
  onDuration?: (seconds: number) => void;
}) {
  const [state, setState] = useState<'unchecked' | 'metadata' | 'playable' | 'failed'>('unchecked'),
    [seconds, setSeconds] = useState<number | null>(null);
  const direct = /\.(mp4|webm|ogg|mov)(?:[?#]|$)/i.test(url);
  if (!direct) return <Badge tone="info">Video playback unverified · open provider link</Badge>;
  return (
    <div className="mt-2">
      <video
        className="max-h-56 w-full rounded-lg"
        controls
        preload="metadata"
        src={url}
        onLoadedMetadata={(e) => {
          const n = e.currentTarget.duration;
          if (Number.isFinite(n)) {
            setSeconds(n);
            onDuration?.(n);
          }
          setState('metadata');
        }}
        onCanPlay={() => setState('playable')}
        onError={() => setState('failed')}
      />
      <Badge tone={state === 'playable' ? 'success' : state === 'failed' ? 'warning' : 'info'}>
        {state === 'playable' || state === 'metadata'
          ? `${state === 'playable' ? 'Video playable' : 'Video metadata loaded'}${seconds !== null ? ` · ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : ''}`
          : state === 'failed'
            ? 'Video could not load'
            : 'Checking video metadata…'}
      </Badge>
    </div>
  );
}
export function JudgeLinks({ eventId }: { eventId: string }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      <Link to={`/events/${eventId}/briefing`}>Pinned judge briefing</Link>
      <Link to={`/events/${eventId}/helpdesk`}>Ask Admin</Link>
      <Link to={`/events/${eventId}/practice`}>Practice team</Link>
      <a href={`/api/v1/events/${eventId}/judge/export.pdf`}>Export my evaluations (PDF)</a>
    </div>
  );
}
export function SimplePanel({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-line bg-white p-5">{children}</section>
  );
}
