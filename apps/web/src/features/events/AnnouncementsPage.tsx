import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AUDIENCES, type MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { eventApi, type Announcement } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FormErrorSummary,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

const AUDIENCE_LABEL: Record<(typeof AUDIENCES)[number], string> = {
  EVERYONE: 'Everyone',
  PARTICIPANTS: 'Participants',
  JUDGES: 'Judges',
  STAFF: 'Helping staff',
};

export function AnnouncementsPage() {
  const mine = useOutletContext<MyEvent>();
  const isAdmin = mine.role === 'ADMIN';
  const q = useQuery({
    queryKey: ['announcements', mine.eventId],
    queryFn: () => eventApi.announcements(mine.eventId),
  });
  const [editing, setEditing] = useState<Announcement | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <h2>Announcements</h2>
      {isAdmin && (
        <AnnouncementForm
          key={editing?.id ?? 'new'}
          eventId={mine.eventId}
          existing={editing}
          onDone={() => setEditing(null)}
        />
      )}
      {q.isPending && <Spinner label="Loading announcements" />}
      {q.data?.length === 0 && (
        <EmptyState title="No announcements yet">
          Updates from the organisers will show up here.
        </EmptyState>
      )}
      <ul className="flex flex-col gap-4">
        {q.data?.map((a) => (
          <li key={a.id}>
            <AnnouncementCard a={a} mine={mine} isAdmin={isAdmin} onEdit={() => setEditing(a)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnnouncementCard({
  a,
  mine,
  isAdmin,
  onEdit,
}: {
  a: Announcement;
  mine: MyEvent;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => request('DELETE', `/events/${mine.eventId}/announcements/${a.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements', mine.eventId] }),
  });
  return (
    <Card footerLabel={formatDateTime(a.createdAt, mine.timeZone) + (a.edited ? ' · edited' : '')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3>{a.title}</h3>
        {isAdmin && <Badge tone="info">To {AUDIENCE_LABEL[a.audience]}</Badge>}
      </div>
      <p className="mt-2 whitespace-pre-line">{a.body}</p>
      {isAdmin && (
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
            Delete
          </Button>
        </div>
      )}
    </Card>
  );
}

function AnnouncementForm({
  eventId,
  existing,
  onDone,
}: {
  eventId: string;
  existing: Announcement | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [audience, setAudience] = useState<Announcement['audience']>(
    existing?.audience ?? 'EVERYONE',
  );
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const save = useMutation({
    mutationFn: () =>
      existing
        ? request('PATCH', `/events/${eventId}/announcements/${existing.id}`, {
            audience,
            title,
            body,
          })
        : request('POST', `/events/${eventId}/announcements`, { audience, title, body }),
    onSuccess: async () => {
      errors.clear();
      setTitle('');
      setBody('');
      await qc.invalidateQueries({ queryKey: ['announcements', eventId] });
      onDone();
    },
    onError: errors.capture,
  });
  return (
    <Card footerLabel={existing ? 'Edit announcement' : 'Post an announcement'}>
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          errors.clear();
          save.mutate();
        }}
      >
        {errors.formError && <Alert tone="error" title={errors.formError} />}
        <FormErrorSummary issues={errors.issues({ title: 'an-title', body: 'an-body' })} />
        <Select
          label="Audience"
          value={audience}
          onChange={(e) => setAudience(e.target.value as Announcement['audience'])}
        >
          {AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {AUDIENCE_LABEL[a]}
            </option>
          ))}
        </Select>
        <Input
          id="an-title"
          label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={errors.fields.title}
        />
        <Textarea
          id="an-body"
          label="Message"
          required
          hint="Up to 2,000 characters."
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={errors.fields.body}
        />
        <div className="flex gap-3">
          <Button type="submit" loading={save.isPending}>
            {existing ? 'Save changes' : 'Post announcement'}
          </Button>
          {existing && (
            <Button variant="secondary" onClick={onDone}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
