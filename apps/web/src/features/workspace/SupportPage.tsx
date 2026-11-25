import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyEvent } from '@arthakram/shared';
import { ApiError, request } from '../../lib/api.js';
import { formatDateTime, ROLE_LABEL } from '../../lib/format.js';
import { useListState } from '../../lib/useListState.js';
import {
  PageHeader,
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../ui/index.js';
import { cn } from '../../ui/cn.js';

/** Request kinds and statuses exactly as the workflow stores them (no invented states). */
export const KIND_LABEL: Record<string, string> = {
  QUESTION: 'General question',
  EXTENSION: 'Deadline extension',
  UNLOCK: 'Submission unlock',
  TEAM_CHANGE: 'Team change',
};
export const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  APPROVED: 'Approved',
  DENIED: 'Denied',
};
const STATUS_TONE: Record<string, 'info' | 'warning' | 'success' | 'error'> = {
  OPEN: 'warning',
  IN_PROGRESS: 'info',
  RESOLVED: 'success',
  APPROVED: 'success',
  DENIED: 'error',
};
const ACTIVITY_LABEL: Record<string, string> = {
  'helpdesk.created': 'Request received',
  'helpdesk.updated': 'Status or assignment changed',
  'exception.decided': 'Decision recorded',
};
const isOpen = (s: string) => s === 'OPEN' || s === 'IN_PROGRESS';

interface Message {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorRole: string | null;
}
export interface Ticket {
  id: string;
  subject: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  authorName: string;
  authorRole: string | null;
  teamCode: string | null;
  teamName: string | null;
  roundId: string | null;
  roundName: string | null;
  minutes: number;
  departingEmail: string | null;
  replacementEmail: string | null;
  decisionNote: string | null;
  assignedToId: string | null;
  assigneeName: string | null;
  currentCutoff: string | null;
  proposedCutoff: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  activity?: { action: string; at: string; actor: string }[];
  messages: Message[];
}
interface TicketList {
  tickets: Ticket[];
  assignees: { id: string; name: string; role: string }[];
}

const roleName = (r: string | null) =>
  r ? ((ROLE_LABEL as Record<string, string>)[r] ?? r) : 'Former member';

function useTickets(eventId: string) {
  return useQuery({
    queryKey: ['support', eventId],
    queryFn: () => request<TicketList>('GET', `/events/${eventId}/workspace/tickets`),
    refetchInterval: 30000,
  });
}

/**
 * Support & requests (navigation audit consolidation 2). Organisers and helping staff get one inbox for
 * general questions and exception requests, with the type visible on every row. Participants and judges get
 * "Help & requests": one form that asks what they need first, and their own requests.
 */
export function SupportPage() {
  const mine = useOutletContext<MyEvent>();
  return mine.role === 'ADMIN' || mine.role === 'STAFF' ? (
    <SupportInbox mine={mine} />
  ) : (
    <MyRequests mine={mine} />
  );
}

// ── Organiser inbox ──────────────────────────────────────────────────────────────────────────────

function SupportInbox({ mine }: { mine: MyEvent }) {
  const list = useListState({ sort: 'updated' });
  const q = useTickets(mine.eventId);
  const tab = (['general', 'exceptions'] as const).find((t) => t === list.get('tab')) ?? 'all';
  const status = list.get('status', 'open');
  const selected = list.get('ticket');

  if (q.isPending) return <Spinner label="Loading requests" />;
  if (q.isError || !q.data)
    return (
      <Alert tone="error" title="We couldn't load requests">
        <Button variant="secondary" className="mt-2" onClick={() => void q.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  const all = q.data.tickets;
  const ticket = selected ? all.find((t) => t.id === selected) : undefined;
  if (ticket)
    return (
      <TicketDetail
        mine={mine}
        ticket={ticket}
        assignees={q.data.assignees}
        onBack={() => list.set({ ticket: null })}
      />
    );

  const inTab = all.filter((t) =>
    tab === 'general' ? t.kind === 'QUESTION' : tab === 'exceptions' ? t.kind !== 'QUESTION' : true,
  );
  const category = list.get('category');
  const round = list.get('round');
  const assignee = list.get('assignee');
  const from = list.get('from');
  const to = list.get('to');
  const shown = inTab.filter(
    (t) =>
      (status === 'all' || (status === 'open' ? isOpen(t.status) : t.status === status)) &&
      (!category || t.kind === category) &&
      (!round || t.roundId === round) &&
      (!assignee || (assignee === 'none' ? !t.assignedToId : t.assignedToId === assignee)) &&
      (!from || t.createdAt.slice(0, 10) >= from) &&
      (!to || t.createdAt.slice(0, 10) <= to),
  );
  const openCount = (pred: (t: Ticket) => boolean) =>
    all.filter((t) => pred(t) && isOpen(t.status)).length;
  const tabs = [
    { key: 'all', label: 'All requests', count: openCount(() => true) },
    { key: 'general', label: 'General', count: openCount((t) => t.kind === 'QUESTION') },
    {
      key: 'exceptions',
      label: 'Exception requests',
      count: openCount((t) => t.kind !== 'QUESTION'),
    },
  ];
  const rounds = [
    ...new Map(
      all.flatMap((t) => (t.roundId ? [[t.roundId, t.roundName ?? 'Round'] as const] : [])),
    ),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={mine.role === 'STAFF' ? 'Helpdesk' : 'Helpdesk & exception requests'}
        description={
          <>
            Questions and exception requests from participants, judges and staff, in one inbox.
            {mine.role === 'STAFF' && ' Only Core Admins can approve or deny exception requests.'}
          </>
        }
      />
      <div role="tablist" aria-label="Request type" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() =>
              list.set({ tab: t.key === 'all' ? null : t.key, category: null, round: null })
            }
            className={cn(
              'min-h-11 rounded-pill border px-5 font-bold text-ink',
              tab === t.key ? 'border-ink bg-blush' : 'border-line-strong bg-white hover:bg-blush',
            )}
          >
            {t.label} <span className="font-medium">({t.count} open)</span>
          </button>
        ))}
      </div>
      <Card>
        <form
          aria-label="Filter requests"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(e) => e.preventDefault()}
        >
          <Select
            label="Status"
            value={status}
            onChange={(e) =>
              list.set({ status: e.target.value === 'open' ? null : e.target.value })
            }
          >
            <option value="open">Needs action</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
            <option value="all">Any status</option>
          </Select>
          {tab !== 'general' && (
            <Select
              label="Category"
              value={category}
              onChange={(e) => list.set({ category: e.target.value })}
            >
              <option value="">Any category</option>
              {tab === 'all' && <option value="QUESTION">{KIND_LABEL.QUESTION}</option>}
              <option value="EXTENSION">{KIND_LABEL.EXTENSION}</option>
              <option value="UNLOCK">{KIND_LABEL.UNLOCK}</option>
              <option value="TEAM_CHANGE">{KIND_LABEL.TEAM_CHANGE}</option>
            </Select>
          )}
          {rounds.length > 0 && tab !== 'general' && (
            <Select
              label="Round"
              value={round}
              onChange={(e) => list.set({ round: e.target.value })}
            >
              <option value="">Any round</option>
              {rounds.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          )}
          <Select
            label="Assigned to"
            value={assignee}
            onChange={(e) => list.set({ assignee: e.target.value })}
          >
            <option value="">Anyone</option>
            <option value="none">Nobody yet</option>
            {q.data.assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({roleName(a.role)})
              </option>
            ))}
          </Select>
          <Input
            label="Received from"
            type="date"
            value={from}
            onChange={(e) => list.set({ from: e.target.value })}
          />
          <Input
            label="Received to"
            type="date"
            value={to}
            onChange={(e) => list.set({ to: e.target.value })}
          />
        </form>
      </Card>
      {shown.length === 0 ? (
        <EmptyState
          title={inTab.length === 0 ? 'No requests yet' : 'No requests match these filters'}
        >
          {inTab.length === 0
            ? 'Requests from participants, judges and staff appear here.'
            : 'Change the status or other filters to see more.'}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Requests">
          {shown.map((t) => (
            <li key={t.id}>
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={t.kind === 'QUESTION' ? 'info' : 'brand'}>
                    {KIND_LABEL[t.kind] ?? t.kind}
                  </Badge>
                  <Badge tone={STATUS_TONE[t.status] ?? 'info'}>
                    {STATUS_LABEL[t.status] ?? t.status}
                  </Badge>
                </div>
                <h3 className="mt-2 text-lg">
                  <button
                    type="button"
                    className="text-left underline"
                    onClick={() => list.set({ ticket: t.id })}
                  >
                    {t.subject}
                  </button>
                </h3>
                <p className="mt-1 text-sm">
                  From {t.authorName} ({roleName(t.authorRole)})
                  {t.teamCode && ` · ${t.teamCode} ${t.teamName ?? ''}`}
                  {t.roundName && ` · ${t.roundName}`} · received{' '}
                  {formatDateTime(t.createdAt, mine.timeZone)} ·{' '}
                  {t.assigneeName ? `assigned to ${t.assigneeName}` : 'not assigned'} ·{' '}
                  {t.messages.length} message{t.messages.length === 1 ? '' : 's'}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TicketDetail({
  mine,
  ticket: t,
  assignees,
  onBack,
}: {
  mine: MyEvent;
  ticket: Ticket;
  assignees: TicketList['assignees'];
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<null | 'approve' | 'deny'>(null);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const at = (iso: string | null | undefined) => (iso ? formatDateTime(iso, mine.timeZone) : '—');
  const refresh = () => qc.invalidateQueries({ queryKey: ['support', mine.eventId] });
  const base = `/events/${mine.eventId}/workspace/tickets/${t.id}`;
  const patch = useMutation({
    mutationFn: (body: { status?: string; assignedToId?: string | null }) =>
      request('PATCH', base, body),
    onSuccess: async (_d, body) => {
      await refresh();
      setNotice({
        tone: 'success',
        text:
          'assignedToId' in body
            ? 'Assignment saved.'
            : `Marked as ${(STATUS_LABEL[body.status ?? ''] ?? '').toLowerCase()}.`,
      });
    },
    onError: (e) =>
      setNotice({ tone: 'error', text: e instanceof ApiError ? e.message : 'Not saved.' }),
  });
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      request('POST', `${base}/decision`, { approve, note: note.trim() }),
    onSuccess: async (_d, approve) => {
      setDecision(null);
      setNote('');
      await refresh();
      setNotice({ tone: 'success', text: approve ? 'Request approved.' : 'Request denied.' });
    },
  });
  const decided = t.status === 'APPROVED' || t.status === 'DENIED';
  const exception = t.kind !== 'QUESTION';
  const team = t.teamCode ? `${t.teamCode} ${t.teamName ?? ''}`.trim() : 'the team';

  const consequence = () => {
    if (decision === 'deny')
      return 'The request is closed as denied and cannot be reopened. The participant sees your note; nothing else changes.';
    if (t.kind === 'TEAM_CHANGE')
      return `${t.departingEmail ?? 'The departing participant'} leaves ${team} and ${t.replacementEmail ?? 'the replacement'} joins with the same team role. The replacement must be registered and not already in a team. This cannot be undone from here.`;
    return `${team} will be able to submit for ${t.roundName ?? 'this round'} until ${at(t.proposedCutoff)} (${t.minutes} minutes added to ${t.currentCutoff ? `its current cutoff, ${at(t.currentCutoff)}` : 'now'}, or to now if that has passed). The decision is final; a later change needs a new request.`;
  };

  return (
    <div className="flex flex-col gap-4">
      <button type="button" className="self-start text-sm underline" onClick={onBack}>
        Back to all requests
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={exception ? 'brand' : 'info'}>{KIND_LABEL[t.kind] ?? t.kind}</Badge>
        <Badge tone={STATUS_TONE[t.status] ?? 'info'}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
      </div>
      <h2>{t.subject}</h2>
      {notice && <Alert tone={notice.tone} title={notice.text} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <h3>Request</h3>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Fact label="From">
                {t.authorName} ({roleName(t.authorRole)})
              </Fact>
              <Fact label="Team">{t.teamCode ? team : 'No team'}</Fact>
              <Fact label="Received">{at(t.createdAt)}</Fact>
              <Fact label="Last updated">{at(t.updatedAt)}</Fact>
              {exception && t.kind !== 'TEAM_CHANGE' && (
                <>
                  <Fact label="Round">{t.roundName ?? '—'}</Fact>
                  <Fact label="Time requested">{t.minutes} minutes</Fact>
                  <Fact label="Team's cutoff now">{at(t.currentCutoff)}</Fact>
                  {!decided && <Fact label="Cutoff if approved now">{at(t.proposedCutoff)}</Fact>}
                </>
              )}
              {t.kind === 'TEAM_CHANGE' && (
                <>
                  <Fact label="Leaving the team">{t.departingEmail ?? '—'}</Fact>
                  <Fact label="Joining the team">{t.replacementEmail ?? '—'}</Fact>
                </>
              )}
              {decided && (
                <Fact label="Decision">
                  {STATUS_LABEL[t.status]}
                  {t.decidedBy && ` by ${t.decidedBy}`}
                  {t.decidedAt && `, ${at(t.decidedAt)}`}
                  {t.decisionNote && <span className="block">“{t.decisionNote}”</span>}
                </Fact>
              )}
            </dl>
          </Card>
          <Thread mine={mine} ticket={t} />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <h3>Handle</h3>
            <Select
              label="Assigned to"
              value={t.assignedToId ?? ''}
              disabled={patch.isPending}
              onChange={(e) => patch.mutate({ assignedToId: e.target.value || null })}
            >
              <option value="">Nobody</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({roleName(a.role)})
                </option>
              ))}
            </Select>
            <div className="mt-2 flex flex-wrap gap-2">
              {t.status === 'OPEN' && (
                <Button variant="secondary" onClick={() => patch.mutate({ status: 'IN_PROGRESS' })}>
                  Mark in progress
                </Button>
              )}
              {!exception && isOpen(t.status) && (
                <Button variant="secondary" onClick={() => patch.mutate({ status: 'RESOLVED' })}>
                  Mark resolved
                </Button>
              )}
              {t.status === 'RESOLVED' && (
                <Button variant="secondary" onClick={() => patch.mutate({ status: 'OPEN' })}>
                  Reopen
                </Button>
              )}
            </div>
            {exception && isOpen(t.status) && mine.role === 'ADMIN' && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="font-bold">Decide this request</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button onClick={() => setDecision('approve')}>Approve…</Button>
                  <Button variant="secondary" onClick={() => setDecision('deny')}>
                    Deny…
                  </Button>
                </div>
              </div>
            )}
            {exception && isOpen(t.status) && mine.role !== 'ADMIN' && (
              <p className="mt-3 text-sm">A Core Admin needs to approve or deny this request.</p>
            )}
          </Card>
          {t.activity && t.activity.length > 0 && (
            <Card>
              <h3>Activity</h3>
              <ol className="mt-2 flex flex-col gap-2 text-sm">
                {t.activity.map((a, i) => (
                  <li key={i}>
                    <strong>{ACTIVITY_LABEL[a.action] ?? a.action}</strong>
                    <span className="block">
                      {a.actor}, {at(a.at)}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      </div>
      <Dialog
        open={decision !== null}
        title={decision === 'approve' ? `Approve: ${KIND_LABEL[t.kind]}?` : 'Deny this request?'}
        onClose={() => {
          setDecision(null);
          decide.reset();
        }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button
              variant={decision === 'deny' ? 'danger' : 'primary'}
              loading={decide.isPending}
              disabled={note.trim().length < 3}
              onClick={() => decide.mutate(decision === 'approve')}
            >
              {decision === 'approve' ? 'Approve request' : 'Deny request'}
            </Button>
          </>
        }
      >
        <p>{consequence()}</p>
        <Textarea
          label="Note to the participant (required)"
          hint="At least 3 characters. Saved with the decision and shown to the person who asked."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={decide.error instanceof ApiError ? decide.error.message : undefined}
        />
      </Dialog>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-semibold">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Thread({ mine, ticket: t }: { mine: MyEvent; ticket: Ticket }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);
  const reply = useMutation({
    mutationFn: () =>
      request('POST', `/events/${mine.eventId}/workspace/tickets/${t.id}/reply`, {
        body: body.trim(),
      }),
    onSuccess: async () => {
      setBody('');
      setSent(true);
      await qc.invalidateQueries({ queryKey: ['support', mine.eventId] });
    },
  });
  const closed = t.status === 'RESOLVED' || t.status === 'APPROVED' || t.status === 'DENIED';
  return (
    <Card>
      <h3>Conversation</h3>
      <ol className="mt-3 flex flex-col gap-3">
        {t.messages.map((m) => (
          <li key={m.id} className="rounded-card border border-line bg-paper p-3">
            <p className="text-sm font-semibold">
              {m.authorName} ({roleName(m.authorRole)}) ·{' '}
              {formatDateTime(m.createdAt, mine.timeZone)}
            </p>
            <p className="mt-1 whitespace-pre-line">{m.body}</p>
          </li>
        ))}
      </ol>
      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) reply.mutate();
        }}
      >
        <Textarea
          label={closed ? 'Add a note (this request is closed)' : 'Reply'}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setSent(false);
          }}
          error={reply.error instanceof ApiError ? reply.error.message : undefined}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" loading={reply.isPending} disabled={!body.trim()}>
            Send reply
          </Button>
          {sent && <span role="status">Reply sent.</span>}
        </div>
      </form>
    </Card>
  );
}

// ── Participant, judge: Help & requests ─────────────────────────────────────────────────────────

function MyRequests({ mine }: { mine: MyEvent }) {
  const q = useTickets(mine.eventId);
  const list = useListState({ sort: 'updated' });
  const participant = mine.role === 'PARTICIPANT';
  const options = useQuery({
    queryKey: ['workspace-options', mine.eventId],
    queryFn: () =>
      request<{ rounds: { id: string; name: string }[]; ownTeamId: string | null }>(
        'GET',
        `/events/${mine.eventId}/workspace/options`,
      ),
  });
  const qc = useQueryClient();
  const [kind, setKind] = useState(
    participant && list.get('type') === 'exception' ? 'EXTENSION' : 'QUESTION',
  );
  const [form, setForm] = useState({
    subject: '',
    body: '',
    roundId: '',
    minutes: '15',
    departingEmail: '',
    replacementEmail: '',
  });
  const [done, setDone] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      request('POST', `/events/${mine.eventId}/workspace/tickets`, {
        subject: form.subject.trim(),
        body: form.body.trim(),
        kind,
        ...(kind === 'EXTENSION' || kind === 'UNLOCK'
          ? { roundId: form.roundId, minutes: Number(form.minutes) }
          : {}),
        ...(kind === 'TEAM_CHANGE'
          ? { departingEmail: form.departingEmail, replacementEmail: form.replacementEmail }
          : {}),
      }),
    onSuccess: async () => {
      setForm({ ...form, subject: '', body: '', departingEmail: '', replacementEmail: '' });
      setDone(
        kind === 'QUESTION'
          ? 'Your question was sent to the organisers. Replies appear below.'
          : 'Your request was sent. An organiser will approve or deny it; the outcome appears below.',
      );
      await qc.invalidateQueries({ queryKey: ['support', mine.eventId] });
    },
  });
  const hasTeam = Boolean(options.data?.ownTeamId);
  const err = create.error instanceof ApiError ? create.error : null;
  const rounds = options.data?.rounds ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={participant ? 'Help & requests' : 'Ask the organisers'}
        description={
          participant
            ? 'Ask a question, or request more time, a submission unlock or a teammate change.'
            : 'Questions go privately to the event organisers.'
        }
      />
      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setDone(null);
            create.mutate();
          }}
        >
          {participant && (
            <Select
              label="What do you need?"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setDone(null);
              }}
            >
              <option value="QUESTION">Ask a question</option>
              <option value="EXTENSION">More time to submit (deadline extension)</option>
              <option value="UNLOCK">Unlock our submission to change it</option>
              <option value="TEAM_CHANGE">Replace a teammate</option>
            </Select>
          )}
          {kind !== 'QUESTION' && !hasTeam && (
            <Alert tone="warning" title="You need to be in a team to make this request">
              <Link to={`/events/${mine.eventId}/team`}>Go to My team</Link>
            </Alert>
          )}
          {(kind === 'EXTENSION' || kind === 'UNLOCK') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Round"
                required
                value={form.roundId}
                onChange={(e) => setForm({ ...form, roundId: e.target.value })}
              >
                <option value="">Choose a round</option>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Minutes needed"
                hint="Between 1 and 1440. Organisers decide; the request does not change your deadline by itself."
                type="number"
                min={1}
                max={1440}
                required
                value={form.minutes}
                onChange={(e) => setForm({ ...form, minutes: e.target.value })}
              />
            </div>
          )}
          {kind === 'TEAM_CHANGE' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Email of the teammate leaving"
                type="email"
                required
                value={form.departingEmail}
                onChange={(e) => setForm({ ...form, departingEmail: e.target.value })}
                error={err?.fields.departingEmail}
              />
              <Input
                label="Email of the person joining"
                hint="They must already be registered for this event and not in a team."
                type="email"
                required
                value={form.replacementEmail}
                onChange={(e) => setForm({ ...form, replacementEmail: e.target.value })}
                error={err?.fields.replacementEmail}
              />
            </div>
          )}
          <Input
            label="Subject"
            required
            maxLength={200}
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            error={err?.fields.subject}
          />
          <Textarea
            label={kind === 'QUESTION' ? 'Your question' : 'Why you need this'}
            required
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            error={err?.fields.body}
          />
          {err && Object.keys(err.fields).length === 0 && (
            <Alert tone="error" title={err.message} />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              loading={create.isPending}
              disabled={kind !== 'QUESTION' && !hasTeam}
            >
              {kind === 'QUESTION' ? 'Send question' : 'Send request'}
            </Button>
            {done && <span role="status">{done}</span>}
          </div>
        </form>
      </Card>

      <section aria-labelledby="mine-h" className="flex flex-col gap-3">
        <h3 id="mine-h">Your requests</h3>
        {q.isPending && <Spinner label="Loading your requests" />}
        {q.isError && <Alert tone="error" title="We couldn't load your requests" />}
        {q.data && q.data.tickets.length === 0 && <p>You haven't sent anything yet.</p>}
        {q.data?.tickets.map((t) => (
          <div key={t.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={t.kind === 'QUESTION' ? 'info' : 'brand'}>
                {KIND_LABEL[t.kind] ?? t.kind}
              </Badge>
              <Badge tone={STATUS_TONE[t.status] ?? 'info'}>
                {STATUS_LABEL[t.status] ?? t.status}
              </Badge>
              <strong>{t.subject}</strong>
            </div>
            {(t.status === 'APPROVED' || t.status === 'DENIED') && (
              <Alert
                tone={t.status === 'APPROVED' ? 'success' : 'warning'}
                title={t.status === 'APPROVED' ? 'Approved' : 'Not approved'}
              >
                {t.decisionNote}
                {t.status === 'APPROVED' && t.kind !== 'TEAM_CHANGE' && (
                  <span className="block">
                    Check your new cutoff on the{' '}
                    <Link to={`/events/${mine.eventId}/submission`}>Submission</Link> page.
                  </span>
                )}
              </Alert>
            )}
            <Thread mine={mine} ticket={t} />
          </div>
        ))}
      </section>
    </div>
  );
}
