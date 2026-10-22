import { useState } from 'react';
import { useOutletContext } from 'react-router';
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
  Select,
  Spinner,
  Textarea,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

/** Tracks and problem statements (PRD FR-010/011). Everyone in the event can read them; Core Admins edit. */
export function StructurePage() {
  const mine = useOutletContext<MyEvent>();
  const isAdmin = mine.role === 'ADMIN';
  const tracks = useQuery({
    queryKey: ['tracks', mine.eventId],
    queryFn: () => eventApi.tracks(mine.eventId),
  });
  const problems = useQuery({
    queryKey: ['problems', mine.eventId],
    queryFn: () => eventApi.problems(mine.eventId),
  });
  if (tracks.isPending || problems.isPending) return <Spinner label="Loading tracks" />;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" aria-labelledby="tracks-h">
        <h2 id="tracks-h">Tracks</h2>
        <p>
          Tracks are optional parallel categories. With none, participants never see a track
          selector.
        </p>
        {isAdmin && <TrackForm eventId={mine.eventId} />}
        {tracks.data?.length === 0 && (
          <EmptyState title="No tracks">
            Add a track if your event runs parallel categories.
          </EmptyState>
        )}
        <ul className="flex flex-col gap-3">
          {tracks.data?.map((t) => (
            <TrackRow key={t.id} track={t} eventId={mine.eventId} isAdmin={isAdmin} />
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-4" aria-labelledby="problems-h">
        <h2 id="problems-h">Problem statements</h2>
        {isAdmin && <ProblemForm eventId={mine.eventId} tracks={tracks.data ?? []} />}
        {problems.data?.length === 0 && (
          <EmptyState title="No problem statements">
            Briefs and cases appear here once added.
          </EmptyState>
        )}
        <ul className="flex flex-col gap-3">
          {problems.data?.map((p) => (
            <ProblemRow
              key={p.id}
              problem={p}
              tracks={tracks.data ?? []}
              eventId={mine.eventId}
              isAdmin={isAdmin}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function useInvalidate(eventId: string, key: 'tracks' | 'problems') {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [key, eventId] });
}

function TrackForm({ eventId }: { eventId: string }) {
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

function ProblemForm({ eventId, tracks }: { eventId: string; tracks: Track[] }) {
  const errors = useFormErrors();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [trackId, setTrackId] = useState('');
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
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ProblemRow({
  problem,
  tracks,
  eventId,
  isAdmin,
}: {
  problem: Problem;
  tracks: Track[];
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
  const track = tracks.find((t) => t.id === problem.trackId);
  return (
    <li>
      <Card footerLabel={track ? `Track: ${track.name}` : 'Event-level'}>
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
