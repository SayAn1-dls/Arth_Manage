import { useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyEvent } from '@arthakram/shared';
import { ApiError, request } from '../../lib/api.js';
import { eventApi, type Announcement } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import { useListState } from '../../lib/useListState.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../ui/index.js';
import { cn } from '../../ui/cn.js';

type Role = 'EVERYONE' | 'PARTICIPANTS' | 'JUDGES' | 'STAFF';
const ROLE_AUDIENCE: Record<Role, string> = {
  EVERYONE: 'Everyone in the event',
  PARTICIPANTS: 'All participants',
  JUDGES: 'All judges',
  STAFF: 'All helping staff',
};
const SOURCE_LABEL: Record<string, string> = {
  broadcast: 'Targeted message',
  application: 'Application decision',
  shortlist: 'Shortlist decision',
  deadline: 'Deadline reminder',
};
const DELIVERY_LABEL: Record<string, string> = {
  QUEUED: 'queued',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped (no longer a member)',
};

interface Options {
  rounds: { id: string; name: string; shortlistEnabled: boolean }[];
  tracks: { id: string; name: string }[];
}
interface Send {
  key: string;
  subject: string;
  source: string;
  createdAt: string;
  counts: Record<string, number>;
}

/**
 * Communication (navigation audit consolidation 3): one composer for announcements and targeted messages.
 * The organiser picks the audience while composing; the channel follows from it and is stated plainly:
 * role audiences get an in-app announcement (not emailed), participant cohorts get an email that is queued
 * and also shown in their Updates. Every send is confirmed with its recipient count first.
 */
export function CommunicationPage() {
  const mine = useOutletContext<MyEvent>();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2>Communication</h2>
        <p className="mt-1">
          Post announcements and send targeted messages from one place. Participants read both on
          their Updates page.
        </p>
      </div>
      <Composer mine={mine} />
      <History mine={mine} />
    </div>
  );
}

function Composer({ mine }: { mine: MyEvent }) {
  const qc = useQueryClient();
  const options = useQuery({
    queryKey: ['workspace-options', mine.eventId],
    queryFn: () => request<Options>('GET', `/events/${mine.eventId}/workspace/options`),
  });
  const blank = {
    scope: 'everyone' as 'everyone' | 'selected',
    selected: 'PARTICIPANTS' as Role | 'cohort',
    trackId: '',
    roundId: '',
    shortlistedOnly: false,
    title: '',
    body: '',
  };
  const [f, setF] = useState(blank);
  // A fresh id per composed message makes a repeated send of the same message a no-op on the server.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [review, setReview] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const email = f.scope === 'selected' && f.selected === 'cohort';
  const audience: Role =
    f.scope === 'everyone' ? 'EVERYONE' : email ? 'PARTICIPANTS' : (f.selected as Role);
  const target = {
    ...(f.trackId ? { trackId: f.trackId } : {}),
    ...(f.roundId ? { roundId: f.roundId } : {}),
    shortlistedOnly: f.shortlistedOnly,
  };
  const preview = useMutation({
    mutationFn: () =>
      request<{ recipients: number }>(
        'POST',
        `/events/${mine.eventId}/workspace/audience-preview`,
        email ? { channel: 'email', ...target } : { channel: 'announcement', audience },
      ),
  });
  const send = useMutation({
    mutationFn: async () => {
      if (email) {
        const r = await request<{ queued: number; recipients: number; duplicate: boolean }>(
          'POST',
          `/events/${mine.eventId}/workspace/broadcast`,
          { subject: f.title.trim(), body: f.body.trim(), requestId, ...target },
        );
        return r.duplicate
          ? 'This message was already queued; nothing new was sent.'
          : `Queued as email for ${r.queued} participant${r.queued === 1 ? '' : 's'}. Delivery runs in the background; check the history below.`;
      }
      await request('POST', `/events/${mine.eventId}/announcements`, {
        audience,
        title: f.title.trim(),
        body: f.body.trim(),
      });
      return `Posted to ${ROLE_AUDIENCE[audience].toLowerCase()} on their Updates page. No email was sent.`;
    },
    onSuccess: async (text) => {
      setReview(false);
      setResult(text);
      setF(blank);
      setRequestId(crypto.randomUUID());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['announcements', mine.eventId] }),
        qc.invalidateQueries({ queryKey: ['deliveries', mine.eventId] }),
      ]);
    },
  });
  const err =
    (preview.error ?? send.error) instanceof ApiError
      ? ((preview.error ?? send.error) as ApiError)
      : null;
  const ready = f.title.trim().length > 0 && f.body.trim().length > 0;
  const titleMax = email ? 200 : 160;
  const shortlistRounds = options.data?.rounds ?? [];
  const audienceText = email
    ? [
        'Participants',
        f.trackId &&
          `in ${options.data?.tracks.find((t) => t.id === f.trackId)?.name ?? 'the track'}`,
        f.roundId &&
          (f.shortlistedOnly ||
          options.data?.rounds.find((r) => r.id === f.roundId)?.shortlistEnabled
            ? `shortlisted for ${options.data?.rounds.find((r) => r.id === f.roundId)?.name}`
            : `of ${options.data?.rounds.find((r) => r.id === f.roundId)?.name}`),
      ]
        .filter(Boolean)
        .join(' ')
    : ROLE_AUDIENCE[audience];

  return (
    <Card>
      <h3>New message</h3>
      {result && (
        <Alert tone="success" title="Done" className="mt-3">
          {result}
        </Alert>
      )}
      <form
        className="mt-3 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setResult(null);
          preview.mutate(undefined, { onSuccess: () => setReview(true) });
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold text-ink">Who should get it?</legend>
          {(['everyone', 'selected'] as const).map((scope) => (
            <label key={scope} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="scope"
                className="size-5 accent-ember"
                checked={f.scope === scope}
                onChange={() => setF({ ...f, scope })}
              />
              {scope === 'everyone' ? 'Everyone in the event' : 'A selected audience'}
            </label>
          ))}
        </fieldset>
        {f.scope === 'selected' && (
          <div className="flex flex-col gap-3 rounded-card border border-line bg-paper p-4">
            <Select
              label="Audience"
              value={f.selected}
              onChange={(e) => setF({ ...f, selected: e.target.value as Role | 'cohort' })}
            >
              <option value="PARTICIPANTS">All participants</option>
              <option value="JUDGES">All judges</option>
              <option value="STAFF">All helping staff</option>
              <option value="cohort">Participants in a track or round shortlist</option>
            </Select>
            {email && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Track"
                  value={f.trackId}
                  onChange={(e) => setF({ ...f, trackId: e.target.value })}
                >
                  <option value="">Any track</option>
                  {options.data?.tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Round"
                  value={f.roundId}
                  onChange={(e) =>
                    setF({
                      ...f,
                      roundId: e.target.value,
                      shortlistedOnly: e.target.value ? f.shortlistedOnly : false,
                    })
                  }
                >
                  <option value="">Any round</option>
                  {shortlistRounds.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
                {f.roundId && (
                  <Checkbox
                    label="Only teams shortlisted for this round"
                    checked={f.shortlistedOnly}
                    onChange={(e) => setF({ ...f, shortlistedOnly: e.target.checked })}
                  />
                )}
              </div>
            )}
          </div>
        )}
        <p className="rounded-card border border-line bg-white p-3">
          <strong>How it is delivered:</strong>{' '}
          {email
            ? 'by email to each participant (queued and sent in the background, retried up to 3 times), and shown on their Updates page.'
            : 'as an announcement on the Updates page of the people you chose. It is not emailed.'}
        </p>
        <Input
          label={email ? 'Subject' : 'Title'}
          required
          maxLength={titleMax}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          error={err?.fields.title ?? err?.fields.subject}
        />
        <Textarea
          label="Message"
          required
          maxLength={email ? 4000 : 2000}
          value={f.body}
          onChange={(e) => setF({ ...f, body: e.target.value })}
          error={err?.fields.body}
        />
        {err && Object.keys(err.fields).length === 0 && <Alert tone="error" title={err.message} />}
        <div>
          <Button type="submit" loading={preview.isPending} disabled={!ready}>
            Review and send
          </Button>
          {!ready && (
            <p className="mt-1 text-sm">Add a {email ? 'subject' : 'title'} and a message first.</p>
          )}
        </div>
      </form>
      <Dialog
        open={review}
        title={email ? 'Send this email?' : 'Post this announcement?'}
        onClose={() => setReview(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setReview(false)}>
              Keep editing
            </Button>
            <Button
              loading={send.isPending}
              disabled={preview.data?.recipients === 0}
              onClick={() => send.mutate()}
            >
              {email
                ? `Queue email for ${preview.data?.recipients ?? 0}`
                : `Post to ${preview.data?.recipients ?? 0}`}
            </Button>
          </>
        }
      >
        <dl className="grid gap-2">
          <div>
            <dt className="text-sm font-semibold">Audience</dt>
            <dd>{audienceText}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold">Recipients</dt>
            <dd>
              {preview.data?.recipients ?? 0} {email ? 'participants' : 'people'}
              {preview.data?.recipients === 0 && ' (nobody matches, so nothing can be sent)'}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold">Channel</dt>
            <dd>
              {email
                ? 'Email, queued now and sent in the background. It cannot be recalled once sent.'
                : 'In-app announcement. You can edit or delete it later; there is no email.'}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold">{email ? 'Subject' : 'Title'}</dt>
            <dd>{f.title}</dd>
          </div>
        </dl>
        {send.error && (
          <Alert
            tone="error"
            title={send.error instanceof ApiError ? send.error.message : 'Not sent'}
          />
        )}
      </Dialog>
    </Card>
  );
}

function History({ mine }: { mine: MyEvent }) {
  const list = useListState({ sort: 'date' });
  const view =
    (['announcements', 'targeted'] as const).find((v) => v === list.get('history')) ?? 'all';
  const failedOnly = list.get('delivery') === 'FAILED';
  const announcements = useQuery({
    queryKey: ['announcements', mine.eventId],
    queryFn: () => eventApi.announcements(mine.eventId),
  });
  const sends = useQuery({
    queryKey: ['deliveries', mine.eventId],
    queryFn: () =>
      request<{ sends: Send[] }>('GET', `/events/${mine.eventId}/workspace/deliveries/summary`),
    refetchInterval: 30000,
  });
  const rows = useMemo(() => {
    const a = (announcements.data ?? []).map((x) => ({
      kind: 'announcement' as const,
      at: x.createdAt,
      a: x,
    }));
    const t = (sends.data?.sends ?? [])
      .filter((x) => !failedOnly || (x.counts.FAILED ?? 0) > 0)
      .map((x) => ({ kind: 'targeted' as const, at: x.createdAt, s: x }));
    return [
      ...(view !== 'targeted' && !failedOnly ? a : []),
      ...(view !== 'announcements' ? t : []),
    ].sort((x, y) => y.at.localeCompare(x.at));
  }, [announcements.data, sends.data, view, failedOnly]);

  return (
    <section aria-labelledby="history-h" className="flex flex-col gap-3">
      <h3 id="history-h">History</h3>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Show" className="flex flex-wrap gap-2">
          {(
            [
              ['all', 'All'],
              ['announcements', 'Announcements'],
              ['targeted', 'Targeted'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={view === k}
              onClick={() => list.set({ history: k === 'all' ? null : k })}
              className={cn(
                'min-h-11 rounded-pill border px-5 font-bold text-ink',
                view === k ? 'border-ink bg-blush' : 'border-line-strong bg-white hover:bg-blush',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {view !== 'announcements' && (
          <Checkbox
            label="Only sends with failed deliveries"
            checked={failedOnly}
            onChange={(e) => list.set({ delivery: e.target.checked ? 'FAILED' : null })}
          />
        )}
      </div>
      {(announcements.isPending || sends.isPending) && <Spinner label="Loading history" />}
      {(announcements.isError || sends.isError) && (
        <Alert tone="error" title="We couldn't load the message history" />
      )}
      {!announcements.isPending && !sends.isPending && rows.length === 0 && (
        <EmptyState title={failedOnly ? 'No failed deliveries' : 'Nothing sent yet'}>
          {failedOnly
            ? 'Every queued email has been delivered or is still on its way.'
            : 'Messages you post or send appear here.'}
        </EmptyState>
      )}
      <ul className="flex flex-col gap-3">
        {rows.map((r) =>
          r.kind === 'announcement' ? (
            <li key={`a-${r.a.id}`}>
              <AnnouncementRow mine={mine} a={r.a} />
            </li>
          ) : (
            <li key={`t-${r.s.key}`}>
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">{SOURCE_LABEL[r.s.source] ?? 'Message'}</Badge>
                  <span className="text-sm">
                    Email · {formatDateTime(r.s.createdAt, mine.timeZone)}
                  </span>
                </div>
                <h4 className="mt-2 font-display text-lg font-bold">{r.s.subject}</h4>
                <p className="mt-1">
                  {Object.entries(r.s.counts)
                    .map(([k, n]) => `${n} ${DELIVERY_LABEL[k] ?? k.toLowerCase()}`)
                    .join(' · ')}
                </p>
                {(r.s.counts.FAILED ?? 0) > 0 && (
                  <p className="mt-1 text-sm">
                    Failed emails were tried 3 times. Recipients can still read the message on their
                    Updates page.
                  </p>
                )}
              </Card>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function AnnouncementRow({ mine, a }: { mine: MyEvent; a: Announcement }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState({ title: a.title, body: a.body, audience: a.audience });
  const refresh = () => qc.invalidateQueries({ queryKey: ['announcements', mine.eventId] });
  const save = useMutation({
    mutationFn: () => request('PATCH', `/events/${mine.eventId}/announcements/${a.id}`, draft),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => request('DELETE', `/events/${mine.eventId}/announcements/${a.id}`),
    onSuccess: refresh,
  });
  const err = save.error instanceof ApiError ? save.error : null;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">Announcement</Badge>
        <span className="text-sm">
          {ROLE_AUDIENCE[a.audience as Role] ?? a.audience} · in-app ·{' '}
          {formatDateTime(a.createdAt, mine.timeZone)}
          {a.edited && ' · edited'}
        </span>
      </div>
      {editing ? (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Select
            label="Audience"
            value={draft.audience}
            onChange={(e) => setDraft({ ...draft, audience: e.target.value as Role })}
          >
            {Object.entries(ROLE_AUDIENCE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Input
            label="Title"
            maxLength={160}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            error={err?.fields.title}
          />
          <Textarea
            label="Message"
            maxLength={2000}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            error={err?.fields.body}
          />
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending}>
              Save changes
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <h4 className="mt-2 font-display text-lg font-bold">{a.title}</h4>
          <p className="mt-1 whitespace-pre-line">{a.body}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
        </>
      )}
      <Dialog
        open={confirmDelete}
        title="Delete this announcement?"
        onClose={() => setConfirmDelete(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete announcement
            </Button>
          </>
        }
      >
        <p>
          “{a.title}” disappears from everyone's Updates page. This cannot be undone; the deletion
          is kept in the audit history.
        </p>
        {remove.error && <Alert tone="error" title="Not deleted. Try again." />}
      </Dialog>
    </Card>
  );
}

/**
 * Updates: one place where participants, judges and staff read announcements for their role and messages
 * sent to them personally (targeted messages, application and shortlist decisions, deadline reminders).
 */
export function UpdatesPage() {
  const mine = useOutletContext<MyEvent>();
  const announcements = useQuery({
    queryKey: ['announcements', mine.eventId],
    queryFn: () => eventApi.announcements(mine.eventId),
  });
  const inbox = useQuery({
    queryKey: ['inbox', mine.eventId],
    queryFn: () =>
      request<{ messages: { id: string; subject: string; body: string; createdAt: string }[] }>(
        'GET',
        `/events/${mine.eventId}/workspace/inbox`,
      ),
    refetchInterval: 30000,
  });
  const items = [
    ...(announcements.data ?? []).map((a) => ({
      id: `a-${a.id}`,
      label: 'Announcement',
      title: a.title,
      body: a.body,
      at: a.createdAt,
    })),
    ...(inbox.data?.messages ?? []).map((m) => ({
      id: `m-${m.id}`,
      label: 'Message to you',
      title: m.subject,
      body: m.body,
      at: m.createdAt,
    })),
  ].sort((x, y) => y.at.localeCompare(x.at));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2>Updates</h2>
        <p className="mt-1">
          Announcements from the organisers and messages sent to you, newest first.{' '}
          <Link to={`/events/${mine.eventId}/support`}>Ask the organisers</Link> if something is
          unclear.
        </p>
      </div>
      {(announcements.isPending || inbox.isPending) && <Spinner label="Loading updates" />}
      {(announcements.isError || inbox.isError) && (
        <Alert tone="error" title="We couldn't load every update">
          Some updates may be missing. Refresh the page to try again.
        </Alert>
      )}
      {!announcements.isPending && !inbox.isPending && items.length === 0 && (
        <EmptyState title="No updates yet">
          Announcements and messages from the organisers will appear here.
        </EmptyState>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((i) => (
          <li key={i.id}>
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={i.label === 'Announcement' ? 'info' : 'brand'}>{i.label}</Badge>
                <span className="text-sm">{formatDateTime(i.at, mine.timeZone)}</span>
              </div>
              <h3 className="mt-2 text-lg">{i.title}</h3>
              <p className="mt-1 whitespace-pre-line">{i.body}</p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
