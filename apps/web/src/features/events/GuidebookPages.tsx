import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import type { GuidebookSection, MyEvent } from '@arthakram/shared';
import { ApiError, request } from '../../lib/api.js';
import { eventApi } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Markdown,
  Spinner,
  Textarea,
} from '../../ui/index.js';

interface Draft {
  sections: GuidebookSection[];
  version: number;
  updatedAt: string;
  latestPublishedVersion: number | null;
}

const newId = () => `s${Math.random().toString(36).slice(2, 9)}`;

/** Role switch: Core Admins edit the draft; everyone else reads the latest published version. */
export function GuidebookPage() {
  const mine = useOutletContext<MyEvent>();
  return mine.role === 'ADMIN' ? <GuidebookEditor mine={mine} /> : <GuidebookReader mine={mine} />;
}

function GuidebookReader({ mine }: { mine: MyEvent }) {
  const gb = useQuery({
    queryKey: ['guidebook', mine.eventId],
    queryFn: () => eventApi.guidebook(mine.eventId),
  });
  if (gb.isPending) return <Spinner label="Loading guidebook" />;
  if (!gb.data?.published) {
    return (
      <EmptyState title="The guidebook isn't published yet">
        Rules, schedule and submission details will appear here as soon as the organisers publish
        them.
      </EmptyState>
    );
  }
  const g = gb.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Guidebook</h2>
          <p className="text-sm">Updated {formatDateTime(g.publishedAt!, mine.timeZone)}</p>
        </div>
        <a
          href={`/api/v1/events/${mine.eventId}/guidebook/pdf`}
          className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-strong bg-white px-5 py-2 font-bold text-ink no-underline hover:bg-blush"
        >
          <Download aria-hidden className="size-4" /> Download PDF
        </a>
      </div>
      {g.sections.map((s) => (
        <Card key={s.id}>
          <h3 id={s.id}>{s.title}</h3>
          {s.body.trim() ? <Markdown source={s.body} /> : <p className="mt-2">Nothing here yet.</p>}
        </Card>
      ))}
    </div>
  );
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'failed';

function GuidebookEditor({ mine }: { mine: MyEvent }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['guidebook-draft', mine.eventId],
    queryFn: () => request<Draft>('GET', `/events/${mine.eventId}/guidebook/draft`),
    staleTime: Infinity,
    refetchOnMount: 'always',
  });
  const [sections, setSections] = useState<GuidebookSection[] | null>(null);
  const [version, setVersion] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>('saved');
  const [conflict, setConflict] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [published, setPublished] = useState<number | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ sections, version });
  latest.current = { sections, version };

  useEffect(() => {
    if (q.data && sections === null) {
      setSections(q.data.sections);
      setVersion(q.data.version);
      setSelected(q.data.sections[0]?.id ?? null);
      setPublished(q.data.latestPublishedVersion);
    }
  }, [q.data, sections]);

  const save = useCallback(async () => {
    const { sections: s, version: v } = latest.current;
    if (!s) return false;
    setState('saving');
    try {
      const r = await request<{ version: number }>(
        'PUT',
        `/events/${mine.eventId}/guidebook/draft`,
        { sections: s, version: v },
      );
      setVersion(r.version);
      latest.current = { sections: latest.current.sections, version: r.version };
      setState((cur) => (cur === 'dirty' ? 'dirty' : 'saved'));
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stale_version') setConflict(true);
      setState('failed');
      return false;
    }
  }, [mine.eventId]);

  // Autosave 10 seconds after the last change (PRD FR-021); failures keep the text in the tab and retry.
  const touch = (next: GuidebookSection[]) => {
    setSections(next);
    setState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 10_000);
  };
  useEffect(() => {
    if (state !== 'failed' || conflict) return;
    const retry = setTimeout(() => void save(), 5_000);
    return () => clearTimeout(retry);
  }, [state, conflict, save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state === 'dirty' || state === 'failed') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const publish = useMutation({
    mutationFn: async () => {
      if (timer.current) clearTimeout(timer.current);
      if (!(await save()))
        throw new Error('Could not save the latest edits, so nothing was published.');
      return request<{ versionNo: number }>('POST', `/events/${mine.eventId}/guidebook/publish`, {
        version: latest.current.version,
        changeNote: changeNote || undefined,
      });
    },
    onSuccess: async (r) => {
      setPublished(r.versionNo);
      setPublishOpen(false);
      setChangeNote('');
      setPublishError(null);
      await qc.invalidateQueries({ queryKey: ['guidebook', mine.eventId] });
      await qc.invalidateQueries({ queryKey: ['publish-checks', mine.eventId] });
    },
    onError: (e) => setPublishError(e.message),
  });

  if (q.isPending || sections === null) return <Spinner label="Loading guidebook" />;
  const current = sections.find((s) => s.id === selected) ?? sections[0]!;
  const update = (patch: Partial<GuidebookSection>) =>
    touch(sections.map((s) => (s.id === current.id ? { ...s, ...patch } : s)));
  const move = (dir: -1 | 1) => {
    const i = sections.findIndex((s) => s.id === current.id);
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j]!, next[i]!];
    touch(next);
  };
  const add = () => {
    const s: GuidebookSection = { id: newId(), title: 'New section', body: '', hidden: false };
    touch([...sections, s]);
    setSelected(s.id);
  };
  const remove = () => {
    if (sections.length <= 1) return;
    const next = sections.filter((s) => s.id !== current.id);
    touch(next);
    setSelected(next[0]!.id);
  };

  const stateLabel = {
    saved: 'All changes saved',
    dirty: 'Unsaved changes. Saving shortly',
    saving: 'Saving',
    failed: 'Not saved. Retrying',
  }[state];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Guidebook</h2>
          <p className="text-sm" role="status" aria-live="polite">
            {stateLabel}
            {published ? `. Latest published: version ${published}` : '. Not published yet'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/v1/events/${mine.eventId}/guidebook/pdf?draft=1`}
            className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-strong bg-white px-5 py-2 font-bold text-ink no-underline hover:bg-blush"
          >
            <Download aria-hidden className="size-4" /> Draft PDF
          </a>
          <Button onClick={() => setPublishOpen(true)} disabled={conflict}>
            Publish
          </Button>
        </div>
      </div>

      {conflict && (
        <Alert tone="error" title="This guidebook was changed somewhere else">
          Your edits were not saved. Reload to see the latest version.
          <div className="mt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setSections(null);
                setConflict(false);
                setState('saved');
                void q.refetch();
              }}
            >
              Reload latest
            </Button>
          </div>
        </Alert>
      )}
      {state === 'failed' && !conflict && (
        <Alert tone="warning" title="Not saved. Retrying">
          Your text stays in this tab until it is saved.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
        <Card className="h-fit">
          <ul className="flex flex-col gap-1" aria-label="Sections">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelected(s.id)}
                  aria-current={s.id === current.id}
                  className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-pill border-l-4 px-3 py-2 text-left text-ink ${s.id === current.id ? 'border-ember bg-blush font-bold' : 'border-transparent hover:bg-blush'}`}
                >
                  <span className="truncate">{s.title}</span>
                  {s.hidden && (
                    <EyeOff aria-label="Hidden from participants" className="size-4 shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <Button
            className="mt-3 w-full"
            variant="secondary"
            icon={<Plus aria-hidden className="size-4" />}
            onClick={add}
          >
            Add section
          </Button>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-col gap-3">
              <Input
                label="Section title"
                value={current.title}
                onChange={(e) => update({ title: e.target.value })}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  aria-label="Move section up"
                  icon={<ArrowUp aria-hidden className="size-4" />}
                  onClick={() => move(-1)}
                />
                <Button
                  variant="secondary"
                  aria-label="Move section down"
                  icon={<ArrowDown aria-hidden className="size-4" />}
                  onClick={() => move(1)}
                />
                <Button
                  variant="secondary"
                  icon={
                    current.hidden ? (
                      <Eye aria-hidden className="size-4" />
                    ) : (
                      <EyeOff aria-hidden className="size-4" />
                    )
                  }
                  onClick={() => update({ hidden: !current.hidden })}
                >
                  {current.hidden ? 'Show section' : 'Hide section'}
                </Button>
                <Button
                  variant="ghost"
                  icon={<Trash2 aria-hidden className="size-4" />}
                  onClick={remove}
                  disabled={sections.length <= 1}
                >
                  Delete section
                </Button>
              </div>
              <Textarea
                label="Content"
                rows={14}
                value={current.body}
                onChange={(e) => update({ body: e.target.value })}
                hint="Headings with ## and ###, **bold**, - lists, 1. numbered lists, [links](https://example.com) and | tables |."
              />
            </div>
          </Card>
          <Card footerLabel="Preview of this section">
            {current.hidden && <Badge tone="info">Hidden from participants</Badge>}
            <h3 className="mt-2">{current.title}</h3>
            {current.body.trim() ? (
              <Markdown source={current.body} />
            ) : (
              <p className="mt-2">This section has no content yet.</p>
            )}
          </Card>
        </div>
      </div>

      <Dialog
        open={publishOpen}
        title="Publish the guidebook?"
        onClose={() => setPublishOpen(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => publish.mutate()} loading={publish.isPending}>
              Publish version {(published ?? 0) + 1}
            </Button>
          </>
        }
      >
        <p>
          Participants, judges and staff will see this version immediately. Hidden sections stay
          private. Earlier versions remain in the history.
        </p>
        <div className="mt-3">
          <Input
            label="Change note (optional)"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
          />
        </div>
        {publishError && <Alert className="mt-3" tone="error" title={publishError} />}
      </Dialog>
    </div>
  );
}
