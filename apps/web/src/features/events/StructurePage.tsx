import { useState } from 'react';
import { useLocation, useOutletContext } from 'react-router';
import { CheckCircle2, CircleAlert, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { eventApi, type Problem, type Track } from '../../lib/events.js';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  FormErrorSummary,
  Input,
  Markdown,
  PageHeader,
  SectionLabel,
  Select,
  Spinner,
  Textarea,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';
import { cn } from '../../ui/cn.js';

/**
 * Tracks and problem statements (PRD FR-010/011). Problem statements come first: they are what teams work
 * on, and a track without one leaves its teams with nothing to choose. Core Admins see coverage per track
 * and add a problem straight into the track that lacks one; everyone else reads them grouped by track.
 */
export function StructurePage() {
  const mine = useOutletContext<MyEvent>();
  const { hash } = useLocation();
  const isAdmin = mine.role === 'ADMIN';
  const [adding, setAdding] = useState<{ trackId: string } | null>(() =>
    isAdmin && hash === '#problems' ? { trackId: '' } : null,
  );
  const [addingTrack, setAddingTrack] = useState(false);
  const tracks = useQuery({
    queryKey: ['tracks', mine.eventId],
    queryFn: () => eventApi.tracks(mine.eventId),
  });
  const problems = useQuery({
    queryKey: ['problems', mine.eventId],
    queryFn: () => eventApi.problems(mine.eventId),
  });
  if (tracks.isPending || problems.isPending) return <Spinner label="Loading tracks" />;
  const trackList = tracks.data ?? [];
  const problemList = problems.data ?? [];
  const countFor = (trackId: string) => problemList.filter((p) => p.trackId === trackId).length;
  const empty = trackList.filter((t) => countFor(t.id) === 0);
  const groups = [
    ...trackList.map((t) => ({
      key: t.id,
      title: t.name,
      items: problemList.filter((p) => p.trackId === t.id),
    })),
    {
      key: 'event',
      title: trackList.length ? 'Open to every track' : 'Problem statements',
      items: problemList.filter((p) => !p.trackId || !trackList.some((t) => t.id === p.trackId)),
    },
  ].filter((g) => g.items.length > 0);
  const openForm = (trackId = '') => {
    setAdding({ trackId });
    window.setTimeout(() => document.getElementById('pr-title')?.focus(), 50);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tracks & problem statements"
        description={
          isAdmin
            ? 'What teams work on. Every track needs at least one problem statement before teams choose.'
            : 'The tracks and the problem statements teams choose from.'
        }
        actions={
          isAdmin && (
            <>
              <Button onClick={() => openForm()} icon={<Plus aria-hidden className="size-4" />}>
                Add problem statement
              </Button>
              <Button variant="secondary" onClick={() => setAddingTrack((v) => !v)}>
                {addingTrack ? 'Close' : 'Add track'}
              </Button>
            </>
          )
        }
      />

      {isAdmin && trackList.length > 0 && (
        <section aria-labelledby="coverage-h" className="flex flex-col gap-3">
          <SectionLabel id="coverage-h">Coverage by track</SectionLabel>
          <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {trackList.map((t) => {
              const n = countFor(t.id);
              return (
                <li
                  key={t.id}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-card border bg-white px-4 py-3',
                    n === 0 ? 'border-ember' : 'border-line',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-ink">{t.name}</span>
                    <span className="flex items-center gap-1.5 text-sm">
                      {n === 0 ? (
                        <>
                          <CircleAlert aria-hidden className="size-4 stroke-ember" />
                          <span className="font-semibold text-ink">No problem statement yet</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 aria-hidden className="size-4 stroke-success-fg" />
                          {n} problem statement{n === 1 ? '' : 's'}
                        </>
                      )}
                    </span>
                  </span>
                  <Button
                    variant={n === 0 ? 'primary' : 'ghost'}
                    className="min-h-10 shrink-0 px-3 text-sm"
                    onClick={() => openForm(t.id)}
                  >
                    Add
                  </Button>
                </li>
              );
            })}
          </ul>
          {empty.length > 0 && (
            <p className="text-sm">
              {empty.length} of {trackList.length} tracks have no problem statement. Teams in those
              tracks will have nothing to choose.
            </p>
          )}
        </section>
      )}

      {isAdmin && adding && (
        <ProblemForm
          key={adding.trackId}
          eventId={mine.eventId}
          tracks={trackList}
          initialTrackId={adding.trackId}
          onClose={() => setAdding(null)}
        />
      )}
      {isAdmin && addingTrack && (
        <TrackForm eventId={mine.eventId} onClose={() => setAddingTrack(false)} />
      )}

      <section
        id="problems"
        className="flex scroll-mt-20 flex-col gap-5"
        aria-labelledby="problems-h"
      >
        <h3 id="problems-h" className="sr-only">
          Problem statements
        </h3>
        {problemList.length === 0 && (
          <EmptyState title="No problem statements yet">
            {isAdmin
              ? 'Add the briefs or cases teams will work on. They can be event-wide or belong to a track.'
              : 'Problem statements appear here once the organisers publish them.'}
          </EmptyState>
        )}
        {groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-3">
            {(trackList.length > 0 || groups.length > 1) && <SectionLabel>{g.title}</SectionLabel>}
            <ul className="flex flex-col gap-3">
              {g.items.map((p) => (
                <ProblemRow key={p.id} problem={p} eventId={mine.eventId} isAdmin={isAdmin} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="tracks-h">
        <SectionLabel id="tracks-h">Tracks</SectionLabel>
        <p>
          Tracks are optional parallel categories. With none, participants never see a track
          selector.
        </p>
        {trackList.length === 0 ? (
          <EmptyState title="No tracks">
            Add a track if your event runs parallel categories.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {trackList.map((t) => (
              <TrackRow key={t.id} track={t} eventId={mine.eventId} isAdmin={isAdmin} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function useInvalidate(eventId: string, key: 'tracks' | 'problems') {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [key, eventId] });
}

function TrackForm({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const errors = useFormErrors();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const invalidate = useInvalidate(eventId, 'tracks');
  const add = useMutation({
    mutationFn: () =>
      request('POST', `/events/${eventId}/tracks`, { name, description: description || null }),
    onSuccess: async () => {
      errors.clear();
      setName('');
      setDescription('');
      await invalidate();
      onClose();
    },
    onError: errors.capture,
  });
  return (
    <Card footerLabel="Add a track">
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          errors.clear();
          add.mutate();
        }}
      >
        {errors.formError && <Alert tone="error" title={errors.formError} />}
        <FormErrorSummary issues={errors.issues({ name: 'tr-name' })} />
        <Input
          id="tr-name"
          label="Track name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.fields.name}
        />
        <Input
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div>
          <Button type="submit" loading={add.isPending}>
            Add track
          </Button>{' '}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TrackRow({
  track,
  eventId,
  isAdmin,
}: {
  track: Track;
  eventId: string;
  isAdmin: boolean;
}) {
  const errors = useFormErrors();
  const invalidate = useInvalidate(eventId, 'tracks');
  const remove = useMutation({
    mutationFn: () => request('DELETE', `/events/${eventId}/tracks/${track.id}`),
    onSuccess: invalidate,
    onError: errors.capture,
  });
  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3>{track.name}</h3>
            {track.description && <p className="mt-1">{track.description}</p>}
          </div>
          {isAdmin && (
            <Button variant="secondary" onClick={() => remove.mutate()} loading={remove.isPending}>
              Delete
            </Button>
          )}
        </div>
        {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      </Card>
    </li>
  );
}

function ProblemForm({
  eventId,
  tracks,
  initialTrackId,
  onClose,
}: {
  eventId: string;
  tracks: Track[];
  initialTrackId: string;
  onClose: () => void;
}) {
  const errors = useFormErrors();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [trackId, setTrackId] = useState(initialTrackId);
  const invalidate = useInvalidate(eventId, 'problems');
  const add = useMutation({
    mutationFn: () =>
      request('POST', `/events/${eventId}/problems`, {
        title,
        description,
        trackId: trackId || null,
      }),
    onSuccess: async () => {
      errors.clear();
      setTitle('');
      setDescription('');
      await invalidate();
      onClose();
    },
    onError: errors.capture,
  });
  return (
    <Card footerLabel="Add a problem statement">
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          errors.clear();
          add.mutate();
        }}
      >
        {errors.formError && <Alert tone="error" title={errors.formError} />}
        <FormErrorSummary issues={errors.issues({ title: 'pr-title', description: 'pr-desc' })} />
        <Input
          id="pr-title"
          label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={errors.fields.title}
        />
        {tracks.length > 0 && (
          <Select
            label="Track"
            value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
            hint="Leave empty for an event-level problem."
          >
            <option value="">No track</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        )}
        <Textarea
          id="pr-desc"
          label="Description"
          required
          hint="Supports **bold**, lists and links."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.fields.description}
        />
        <div>
          <Button type="submit" loading={add.isPending}>
            Add problem statement
          </Button>{' '}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ProblemRow({
  problem,
  eventId,
  isAdmin,
}: {
  problem: Problem;
  eventId: string;
  isAdmin: boolean;
}) {
  const errors = useFormErrors();
  const invalidate = useInvalidate(eventId, 'problems');
  const remove = useMutation({
    mutationFn: () => request('DELETE', `/events/${eventId}/problems/${problem.id}`),
    onSuccess: invalidate,
    onError: errors.capture,
  });
  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3>{problem.title}</h3>
          {isAdmin && (
            <Button variant="secondary" onClick={() => remove.mutate()} loading={remove.isPending}>
              Delete
            </Button>
          )}
        </div>
        <Markdown source={problem.description} className="mt-1" />
        {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      </Card>
    </li>
  );
}
