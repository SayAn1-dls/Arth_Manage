import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, MapPin, Undo2 } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { opsApi, type CheckInCard, type Issue, type StaffTask } from '../../lib/ops.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  DateTimeField,
  Dialog,
  EmptyState,
  FormErrorSummary,
  Input,
  Select,
  Skeleton,
  Spinner,
  Textarea,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';
import { useEvent } from '../../lib/events.js';

const statusTone = {
  TODO: 'info',
  IN_PROGRESS: 'warning',
  DONE: 'success',
  BLOCKED: 'error',
} as const;
const statusLabel = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  BLOCKED: 'Blocked',
} as const;
const typeLabel = {
  CHECKIN: 'Check-in desk',
  VERIFICATION: 'Verification',
  GENERAL: 'General',
} as const;

/** Staff home: what to do next, from real task data (PRD FR-122). */
export function StaffPanel({ mine }: { mine: MyEvent }) {
  const q = useQuery({
    queryKey: ['staff-tasks', mine.eventId, ''],
    queryFn: () => opsApi.tasks(mine.eventId),
  });
  if (q.isPending) return <Skeleton className="h-24" />;
  const tasks = q.data ?? [];
  const open = tasks.filter((t) => t.status !== 'DONE');
  return (
    <Card footerLabel="Your tasks">
      {tasks.length === 0 ? (
        <p>
          No tasks assigned yet. Open <strong>Check-in</strong> to help at the desk.
        </p>
      ) : (
        <>
          <h3>
            {open.length === 0
              ? 'All your tasks are done'
              : `${open.length} task${open.length === 1 ? '' : 's'} to do`}
          </h3>
          <ul className="mt-2 flex flex-col gap-1">
            {open.slice(0, 4).map((t) => (
              <li key={t.id}>
                {t.title} <Badge tone={statusTone[t.status]}>{statusLabel[t.status]}</Badge>
                {t.overdue && <Badge tone="error">Overdue</Badge>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export function TasksPage() {
  const mine = useOutletContext<MyEvent>();
  const isAdmin = mine.role === 'ADMIN';
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<StaffTask | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['staff-tasks', mine.eventId, filter],
    queryFn: () => opsApi.tasks(mine.eventId, filter),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>{isAdmin ? 'Staff tasks' : 'My tasks'}</h2>
        {isAdmin && editing === null && (
          <Button onClick={() => setEditing('new')}>Create task</Button>
        )}
      </div>
      {editing !== null && (
        <TaskForm
          key={editing === 'new' ? 'new' : editing.id}
          mine={mine}
          task={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}
      <div className="w-60">
        <Select label="Status" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All</option>
          {(Object.keys(statusLabel) as (keyof typeof statusLabel)[]).map((s) => (
            <option key={s} value={s}>
              {statusLabel[s]}
            </option>
          ))}
        </Select>
      </div>
      {q.isPending && <Spinner label="Loading tasks" />}
      {q.data?.length === 0 && (
        <EmptyState title="No tasks assigned yet">
          {isAdmin
            ? 'Create a task and assign it to your helping staff.'
            : 'Tasks assigned to you appear here.'}
        </EmptyState>
      )}
      <ul className="flex flex-col gap-3">
        {q.data?.map((t) => (
          <li key={t.id}>
            <TaskCard t={t} mine={mine} onEdit={() => setEditing(t)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TaskCard({ t, mine, onEdit }: { t: StaffTask; mine: MyEvent; onEdit: () => void }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [blocking, setBlocking] = useState(false);
  const [note, setNote] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['staff-tasks', mine.eventId] });
  const set = useMutation({
    mutationFn: (v: { status: string; note?: string }) =>
      opsApi.taskStatus(mine.eventId, t.id, v.status, v.note),
    onSuccess: async () => {
      setBlocking(false);
      setNote('');
      errors.clear();
      await refresh();
    },
    onError: errors.capture,
  });
  const del = useMutation({
    mutationFn: () => opsApi.deleteTask(mine.eventId, t.id),
    onSuccess: refresh,
  });
  return (
    <Card
      footerLabel={`${typeLabel[t.type]}${t.statusChangedBy ? ` · last change by ${t.statusChangedBy}, ${formatDateTime(t.statusChangedAt, mine.timeZone)}` : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3>{t.title}</h3>
        <Badge tone={statusTone[t.status]}>{statusLabel[t.status]}</Badge>
        {t.overdue && <Badge tone="error">Overdue</Badge>}
      </div>
      {t.description && <p className="mt-1">{t.description}</p>}
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {t.dueAt && <span>Due {formatDateTime(t.dueAt, mine.timeZone)}</span>}
        {t.location && (
          <span>
            <MapPin aria-hidden className="mr-1 inline size-4" />
            {t.location}
          </span>
        )}
        {mine.role === 'ADMIN' && (
          <span>Assigned to {t.assignees.map((a) => a.name).join(', ')}</span>
        )}
        {t.teams.length > 0 && <span>Teams: {t.teams.map((x) => x.teamCode).join(', ')}</span>}
      </p>
      {t.note && (
        <p className="mt-2 text-sm">
          <strong>Note:</strong> {t.note}
        </p>
      )}
      {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      <div className="mt-3 flex flex-wrap gap-2">
        {t.status !== 'IN_PROGRESS' && t.status !== 'DONE' && (
          <Button variant="secondary" onClick={() => set.mutate({ status: 'IN_PROGRESS' })}>
            Start
          </Button>
        )}
        {t.status !== 'DONE' && (
          <Button onClick={() => set.mutate({ status: 'DONE' })} loading={set.isPending}>
            Mark done
          </Button>
        )}
        {t.status !== 'DONE' && t.status !== 'BLOCKED' && (
          <Button variant="ghost" onClick={() => setBlocking(true)}>
            Blocked
          </Button>
        )}
        {t.status === 'DONE' && (
          <Button variant="secondary" onClick={() => set.mutate({ status: 'TODO' })}>
            Reopen
          </Button>
        )}
        {mine.role === 'ADMIN' && (
          <>
            <Button variant="secondary" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="ghost" onClick={() => del.mutate()}>
              Delete
            </Button>
          </>
        )}
      </div>
      <Dialog
        open={blocking}
        title="What is blocking this task?"
        onClose={() => setBlocking(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setBlocking(false)}>
              Cancel
            </Button>
            <Button onClick={() => set.mutate({ status: 'BLOCKED', note })} disabled={!note.trim()}>
              Mark blocked
            </Button>
          </>
        }
      >
        <Textarea
          label="Note for the organisers"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Dialog>
    </Card>
  );
}

function TaskForm({
  mine,
  task,
  onDone,
}: {
  mine: MyEvent;
  task: StaffTask | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const ev = useEvent(mine.eventId);
  const members = useQuery({
    queryKey: ['members', mine.eventId],
    queryFn: () =>
      request<{ members: { membershipId: string; name: string; role: string }[] }>(
        'GET',
        `/events/${mine.eventId}/members`,
      ),
  });
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [type, setType] = useState<StaffTask['type']>(task?.type ?? 'GENERAL');
  const [dueAt, setDueAt] = useState<string | null>(task?.dueAt ?? null);
  const [location, setLocation] = useState(task?.location ?? '');
  const [assignees, setAssignees] = useState<string[]>(
    task?.assignees.map((a) => a.membershipId) ?? [],
  );
  const staff = members.data?.members.filter((m) => m.role === 'STAFF') ?? [];
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        description: description || null,
        type,
        dueAt,
        location: location || null,
        assigneeMembershipIds: assignees,
        teamIds: task?.teams.map((t) => t.id) ?? [],
      };
      return task
        ? opsApi.updateTask(mine.eventId, task.id, body)
        : opsApi.createTask(mine.eventId, body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['staff-tasks', mine.eventId] });
      onDone();
    },
    onError: errors.capture,
  });
  return (
    <Card footerLabel={task ? 'Edit task' : 'New task'}>
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
        <FormErrorSummary
          issues={errors.issues({ title: 'tk-title', assigneeMembershipIds: 'tk-assignees' })}
        />
        <Input
          id="tk-title"
          label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={errors.fields.title}
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as StaffTask['type'])}
          >
            {(Object.keys(typeLabel) as (keyof typeof typeLabel)[]).map((k) => (
              <option key={k} value={k}>
                {typeLabel[k]}
              </option>
            ))}
          </Select>
          {ev.data && (
            <DateTimeField
              label="Due (optional)"
              value={dueAt}
              timeZone={ev.data.timeZone}
              onChange={setDueAt}
            />
          )}
          <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <fieldset id="tk-assignees" className="rounded-card bg-blush p-3">
          <legend className="px-1 text-sm font-bold text-ink">Assign to</legend>
          {staff.length === 0 && (
            <p className="text-sm">Invite helping staff on the People page first.</p>
          )}
          <div className="flex flex-wrap gap-4">
            {staff.map((m) => (
              <label key={m.membershipId} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-5 accent-ember"
                  checked={assignees.includes(m.membershipId)}
                  onChange={(e) =>
                    setAssignees(
                      e.target.checked
                        ? [...assignees, m.membershipId]
                        : assignees.filter((x) => x !== m.membershipId),
                    )
                  }
                />
                {m.name}
              </label>
            ))}
          </div>
          {errors.fields.assigneeMembershipIds && (
            <p className="mt-1 text-sm font-semibold text-error-fg">
              {errors.fields.assigneeMembershipIds}
            </p>
          )}
        </fieldset>
        <div className="flex gap-3">
          <Button type="submit" loading={save.isPending}>
            {task ? 'Save task' : 'Create task'}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Desk check-in: phone-first search, limited team card, one tap per person (PRD FR-124..126). */
export function CheckInPage() {
  const mine = useOutletContext<MyEvent>();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const summary = useQuery({
    queryKey: ['checkin-summary', mine.eventId],
    queryFn: () => opsApi.checkinSummary(mine.eventId),
  });
  const res = useQuery({
    queryKey: ['checkin', mine.eventId, term],
    queryFn: () => opsApi.checkinSearch(mine.eventId, term),
    enabled: term.length > 0,
    placeholderData: (p) => p,
  });
  return (
    <div className="flex flex-col gap-4">
      <h2>Check-in</h2>
      {summary.data && (
        <p className="text-sm">
          {summary.data.checkedIn} of {summary.data.participants} people checked in ·{' '}
          {summary.data.teams.checkedIn} of {summary.data.teams.total} teams complete ·{' '}
          {summary.data.teams.partial} partial
        </p>
      )}
      <Card>
        <form
          role="search"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q.trim());
          }}
        >
          <div className="min-w-60 flex-1">
            <Input
              label="Find a team"
              hint="Team ID, team name or a member's name"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setTerm(e.target.value.trim());
              }}
              autoComplete="off"
            />
          </div>
        </form>
      </Card>
      {term && res.data?.length === 0 && (
        <Alert tone="info" title="No team found">
          Check the team ID or name, or report an issue.
        </Alert>
      )}
      {!term && (
        <EmptyState title="Search to start">
          Type a team ID such as T-0007, a team name or a participant's name.
        </EmptyState>
      )}
      <ul className="flex flex-col gap-4">
        {res.data?.map((c) => (
          <li key={c.teamId}>
            <TeamCard card={c} mine={mine} term={term} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TeamCard({ card, mine, term }: { card: CheckInCard; mine: MyEvent; term: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const act = useMutation({
    mutationFn: (v: { id: string; action: 'check_in' | 'undo' | 'verify'; note?: string }) =>
      opsApi.checkinAction(mine.eventId, v.id, v.action, v.note),
    onSuccess: async () => {
      setError(null);
      setVerifying(null);
      setNote('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['checkin', mine.eventId, term] }),
        qc.invalidateQueries({ queryKey: ['checkin-summary', mine.eventId] }),
      ]);
    },
    onError: (e) => setError(`Not saved. ${(e as Error).message} Try again.`),
  });
  const tone =
    card.status === 'CHECKED_IN' ? 'success' : card.status === 'PARTIAL' ? 'warning' : 'info';
  return (
    <Card footerLabel={card.track ?? 'No track'}>
      <div className="flex flex-wrap items-center gap-2">
        <h3>{card.name}</h3>
        <Badge tone="info">{card.teamCode}</Badge>
        <Badge tone={tone}>
          {card.status === 'CHECKED_IN'
            ? 'Checked in'
            : card.status === 'PARTIAL'
              ? 'Partially checked in'
              : 'Not checked in'}
        </Badge>
        {card.disqualified && <Badge tone="error">Disqualified</Badge>}
      </div>
      {error && <Alert className="mt-3" tone="error" title={error} />}
      <ul className="mt-3 divide-y divide-line">
        {card.members.map((m) => (
          <li
            key={m.membershipId}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <p className="font-bold text-ink">{m.name}</p>
              <p className="text-sm">
                {m.institution}
                {m.yearOfStudy ? ` · ${m.yearOfStudy}` : ''}
              </p>
              {m.checkedIn && (
                <p className="text-sm">
                  <Check aria-hidden className="mr-1 inline size-4 text-success-fg" />
                  Checked in by {m.checkedInBy}
                  {m.idVerified
                    ? ` · ID verified by ${m.idVerifiedBy}${m.note ? `: ${m.note}` : ''}`
                    : ''}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!m.checkedIn && (
                <Button
                  onClick={() => act.mutate({ id: m.membershipId, action: 'check_in' })}
                  loading={act.isPending && act.variables?.id === m.membershipId}
                >
                  Mark present
                </Button>
              )}
              {m.checkedIn && !m.idVerified && (
                <Button variant="secondary" onClick={() => setVerifying(m.membershipId)}>
                  Verify ID
                </Button>
              )}
              {m.checkedIn && m.canUndo && (
                <Button
                  variant="ghost"
                  icon={<Undo2 aria-hidden className="size-4" />}
                  onClick={() => act.mutate({ id: m.membershipId, action: 'undo' })}
                >
                  Undo
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm">
        Wrong name or team? <a href={`../issues`}>Report an issue</a>. Staff cannot edit names or
        team membership.
      </p>
      <Dialog
        open={verifying !== null}
        title="Mark ID as verified"
        onClose={() => setVerifying(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setVerifying(null)}>
              Cancel
            </Button>
            <Button onClick={() => act.mutate({ id: verifying!, action: 'verify', note })}>
              Mark verified
            </Button>
          </>
        }
      >
        <Input
          label="Note (optional)"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          hint="For example: college ID matched."
        />
      </Dialog>
    </Card>
  );
}

const catLabel: Record<string, string> = {
  REGISTRATION_MISMATCH: 'Registration mismatch',
  TECHNICAL: 'Technical',
  FACILITIES: 'Facilities',
  CONDUCT: 'Conduct',
  OTHER: 'Other',
};

/** Issue reporting for staff, the issue queue for admins (PRD FR-128, FR-129). */
export function IssuesPage() {
  const mine = useOutletContext<MyEvent>();
  const isAdmin = mine.role === 'ADMIN';
  const qc = useQueryClient();
  const errors = useFormErrors();
  const q = useQuery({
    queryKey: ['issues', mine.eventId],
    queryFn: () => opsApi.issues(mine.eventId),
  });
  const [category, setCategory] = useState('OTHER');
  const [description, setDescription] = useState('');
  const [teamCode, setTeamCode] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [resolving, setResolving] = useState<Issue | null>(null);
  const [note, setNote] = useState('');
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['issues', mine.eventId] }),
      qc.invalidateQueries({ queryKey: ['dashboard', mine.eventId] }),
    ]);
  const report = useMutation({
    mutationFn: async () => {
      let teamId: string | null = null;
      if (teamCode.trim()) {
        const found = await opsApi.checkinSearch(mine.eventId, teamCode.trim());
        teamId =
          found.find((t) => t.teamCode.toLowerCase() === teamCode.trim().toLowerCase())?.teamId ??
          null;
      }
      return opsApi.reportIssue(mine.eventId, {
        category,
        description,
        teamId,
        severity: urgent ? 'URGENT' : 'NORMAL',
      });
    },
    onSuccess: async () => {
      errors.clear();
      setDescription('');
      setTeamCode('');
      setUrgent(false);
      await refresh();
    },
    onError: errors.capture,
  });
  const escalate = useMutation({
    mutationFn: (id: string) => opsApi.escalate(mine.eventId, id),
    onSuccess: refresh,
    onError: errors.capture,
  });
  const status = useMutation({
    mutationFn: (v: { id: string; status: string; note?: string }) =>
      opsApi.issueStatus(mine.eventId, v.id, v.status, v.note),
    onSuccess: async () => {
      setResolving(null);
      setNote('');
      await refresh();
    },
    onError: (e) => {
      setResolving(null);
      errors.capture(e);
    },
  });
  const tone = { OPEN: 'warning', ACKNOWLEDGED: 'info', RESOLVED: 'success' } as const;

  return (
    <div className="flex flex-col gap-4">
      <h2>{isAdmin ? 'Issues' : 'Report an issue'}</h2>
      <Card footerLabel="New report">
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            errors.clear();
            report.mutate();
          }}
        >
          {errors.formError && <Alert tone="error" title={errors.formError} />}
          <FormErrorSummary issues={errors.issues({ description: 'is-desc' })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(catLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Input
              label="Team ID (optional)"
              value={teamCode}
              onChange={(e) => setTeamCode(e.target.value)}
              hint="For example T-0007"
            />
          </div>
          <Textarea
            id="is-desc"
            label="What happened?"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={errors.fields.description}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-5 accent-ember"
              checked={urgent}
              onChange={(e) => setUrgent(e.target.checked)}
            />{' '}
            This is urgent
          </label>
          <div>
            <Button type="submit" loading={report.isPending}>
              Send report
            </Button>
          </div>
        </form>
      </Card>
      {q.isPending && <Spinner label="Loading issues" />}
      {q.data?.length === 0 && (
        <EmptyState title="No issues reported">
          {isAdmin
            ? 'Reports from staff and judges appear here, urgent ones first.'
            : 'Your reports and their status appear here.'}
        </EmptyState>
      )}
      <ul className="flex flex-col gap-3">
        {q.data?.map((i) => (
          <li key={i.id}>
            <Card
              footerLabel={`${catLabel[i.category]} · ${i.reporter} · ${formatDateTime(i.createdAt, mine.timeZone)}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {i.severity === 'URGENT' && (
                  <Badge tone="error">
                    <AlertTriangle aria-hidden className="mr-1 size-3" />
                    Urgent
                  </Badge>
                )}
                <Badge tone={tone[i.status]}>
                  {i.status === 'OPEN'
                    ? 'Open'
                    : i.status === 'ACKNOWLEDGED'
                      ? 'Acknowledged'
                      : 'Resolved'}
                </Badge>
                {i.team && (
                  <Badge tone="info">
                    {i.team.teamCode} {i.team.name}
                  </Badge>
                )}
              </div>
              <p className="mt-2">{i.description}</p>
              {i.resolutionNote && (
                <p className="mt-2 text-sm">
                  <strong>Resolution:</strong> {i.resolutionNote}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {i.status === 'OPEN' && i.severity === 'NORMAL' && (
                  <Button variant="secondary" onClick={() => escalate.mutate(i.id)}>
                    Escalate
                  </Button>
                )}
                {isAdmin && i.status === 'OPEN' && (
                  <Button
                    variant="secondary"
                    onClick={() => status.mutate({ id: i.id, status: 'ACKNOWLEDGED' })}
                  >
                    Acknowledge
                  </Button>
                )}
                {isAdmin && i.status !== 'RESOLVED' && (
                  <Button onClick={() => setResolving(i)}>Resolve</Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <Dialog
        open={resolving !== null}
        title="Resolve this issue"
        onClose={() => setResolving(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => status.mutate({ id: resolving!.id, status: 'RESOLVED', note })}
              disabled={!note.trim()}
            >
              Mark resolved
            </Button>
          </>
        }
      >
        <Textarea
          label="Resolution note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          hint="Required. The reporter sees it."
        />
      </Dialog>
    </div>
  );
}
