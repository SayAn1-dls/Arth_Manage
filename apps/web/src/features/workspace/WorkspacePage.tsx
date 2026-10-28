import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router';
import type { MyEvent, Role } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import { ROLE_LABEL } from '../../lib/format.js';
import { Alert, Button, Spinner } from '../../ui/index.js';

type Options = {
  rounds: { id: string; name: string; order: number; normalisation: boolean }[];
  tracks: { id: string; name: string }[];
  staff: {
    id: string;
    role: string;
    accessLevel: string;
    institution: string;
    trackIds: string[];
    user: { name: string };
  }[];
  teams: {
    id: string;
    teamCode: string;
    name: string;
    applicationStatus: string;
    applicationNote: string | null;
  }[];
  ownTeamId: string | null;
};
type Ticket = {
  id: string;
  subject: string;
  kind: string;
  status: string;
  authorId: string;
  authorName: string;
  authorRole: Role | null;
  assignedToId: string | null;
  teamId: string | null;
  decisionNote: string | null;
  messages: {
    id: string;
    authorId: string;
    authorName: string;
    authorRole: Role | null;
    body: string;
    createdAt: string;
  }[];
};
const roleName = (role: Role | null) => (role ? ROLE_LABEL[role] : 'Former member');
const control = 'block w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-ink';
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-line bg-white p-5">{children}</section>
  );
}
function data(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return new FormData(e.currentTarget);
}
const str = (d: FormData, key: string) => String(d.get(key) ?? '');

export function WorkspacePage({ section }: { section: string }) {
  const { eventId = '' } = useParams();
  const me = useOutletContext<MyEvent>();
  const admin = me.role === 'ADMIN';
  const manager = admin || me.role === 'STAFF';
  const base = `/events/${eventId}/workspace`;
  const cache = useQueryClient();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const options = useQuery({
    queryKey: ['workspace-options', eventId],
    queryFn: () => request<Options>('GET', `${base}/options`),
  });
  const [round, setRound] = useState('');
  const roundId = round || options.data?.rounds[0]?.id || '';
  async function act(path: string, body: unknown, method: 'POST' | 'PUT' | 'PATCH' = 'POST') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request<Record<string, unknown>>(method, base + path, body);
      await cache.invalidateQueries({ queryKey: ['workspace'] });
      await cache.invalidateQueries({ queryKey: ['workspace-options', eventId] });
      setNotice('Saved successfully.');
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  const tickets = useQuery({
    queryKey: ['workspace', 'tickets', eventId],
    queryFn: () => request<{ tickets: Ticket[] }>('GET', `${base}/tickets`),
    enabled: section === 'helpdesk' || section === 'exceptions',
    refetchInterval: 30000,
  });
  const engagement = useQuery({
    queryKey: ['workspace', 'engagement', eventId],
    queryFn: () =>
      request<{
        teams: {
          id: string;
          teamCode: string;
          name: string;
          members: number;
          status: string;
          lastSeen: string | null;
          submitted: boolean;
          guidebookOpened: boolean;
        }[];
      }>('GET', `${base}/engagement`),
    enabled: section === 'engagement',
    refetchInterval: 60000,
  });
  const calibration = useQuery({
    queryKey: ['workspace', 'calibration', eventId, roundId],
    queryFn: () =>
      request<{
        normalisation: boolean;
        judges: {
          judgeId: string;
          name: string;
          average: number;
          count: number;
          delta: number;
          outlier: boolean;
          possibleFatigue: boolean;
          averageSeconds: number;
          points: { score: number }[];
        }[];
      }>('GET', `${base}/calibration/${roundId}`),
    enabled: section === 'calibration' && !!roundId,
    refetchInterval: 30000,
  });
  const discovery = useQuery({
    queryKey: ['workspace', 'discovery', eventId],
    queryFn: () =>
      request<{
        profiles: {
          id: string;
          name: string;
          headline: string;
          skills: string;
          about: string;
          contact: string;
        }[];
        mine: {
          headline: string;
          skills: string;
          about: string;
          contact: string;
          visible: boolean;
        } | null;
      }>('GET', `${base}/discovery`),
    enabled: section === 'discovery',
  });
  const deliveries = useQuery({
    queryKey: ['workspace', 'deliveries', eventId],
    queryFn: () =>
      request<{
        deliveries: {
          id: string;
          subject: string;
          status: string;
          error: string | null;
          createdAt: string;
        }[];
      }>('GET', `${base}/deliveries`),
    enabled: section === 'communications',
    refetchInterval: 30000,
  });
  const inbox = useQuery({
    queryKey: ['workspace', 'inbox', eventId],
    queryFn: () =>
      request<{ messages: { id: string; subject: string; body: string; createdAt: string }[] }>(
        'GET',
        `${base}/inbox`,
      ),
    enabled: section === 'messages',
    refetchInterval: 30000,
  });
  const application = useQuery({
    queryKey: ['workspace', 'application', eventId],
    queryFn: () =>
      request<{ team: { applicationStatus: string; applicationNote: string | null } | null }>(
        'GET',
        `${base}/application`,
      ),
    enabled: section === 'applications' && !admin,
  });
  const titles: Record<string, string> = {
    messages: 'Event messages',
    helpdesk: 'Helpdesk',
    exceptions: 'Exception requests',
    applications: 'Application review',
    advancement: 'Round shortlists',
    calibration: 'Judge calibration',
    engagement: 'Team engagement',
    communications: 'Targeted messages',
    discovery: 'Find teammates',
    access: 'Access and judge matching',
    report: 'Event impact report',
    sandbox: 'Practice workspace',
    integrity: 'Project review',
  };
  const RoundSelect = ({ name = 'roundId' }: { name?: string }) => (
    <select name={name} className={control} required>
      {options.data?.rounds.map((r) => (
        <option value={r.id} key={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
  if (me.accessLevel === 'SPONSOR_VIEWER' && section === 'report')
    return (
      <Panel>
        <h2 className="text-3xl">Event impact report</h2>
        <p>Aggregated event outcomes for sponsors.</p>
        <a href={`/api/v1${base}/report.pdf`}>Download impact report PDF</a>
      </Panel>
    );
  if (options.isPending) return <Spinner label="Loading workspace" />;
  const queryError =
    options.error ||
    tickets.error ||
    engagement.error ||
    calibration.error ||
    discovery.error ||
    deliveries.error ||
    application.error;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-bold uppercase tracking-eyebrow text-graphite">
          Event workspace
        </p>
        <h2 className="mt-2 text-3xl">{titles[section]}</h2>
      </div>
      {(error || queryError) && (
        <Alert tone="error" title="Could not complete request">
          {error || queryError?.message}
        </Alert>
      )}
      {notice && <Alert tone="info" title={notice} />}
      {section === 'messages' && (
        <>
          {inbox.error && <Alert tone="error" title={inbox.error.message} />}{' '}
          {inbox.data?.messages.map((m) => (
            <Panel key={m.id}>
              <h3 className="text-xl">{m.subject}</h3>
              <p className="text-sm">{new Date(m.createdAt).toLocaleString()}</p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </Panel>
          ))}
          {inbox.data?.messages.length === 0 && <p>No messages yet.</p>}
        </>
      )}
      {(section === 'helpdesk' || section === 'exceptions') && (
        <>
          <Panel>
            <h3 className="text-xl">
              {section === 'helpdesk' ? 'Ask Admin' : 'Request an exception'}
            </h3>
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                const d = data(e);
                await act('/tickets', {
                  subject: str(d, 'subject'),
                  body: str(d, 'body'),
                  kind: section === 'helpdesk' ? 'QUESTION' : str(d, 'kind'),
                  ...(section === 'exceptions'
                    ? {
                        roundId: str(d, 'roundId'),
                        minutes: Number(d.get('minutes')),
                        ...(str(d, 'replacementEmail')
                          ? { replacementEmail: str(d, 'replacementEmail') }
                          : {}),
                        ...(str(d, 'departingEmail')
                          ? { departingEmail: str(d, 'departingEmail') }
                          : {}),
                      }
                    : {}),
                });
              }}
            >
              <Field label="Subject">
                <input name="subject" className={control} maxLength={200} required />
              </Field>
              <Field label="Message">
                <textarea name="body" className={control} maxLength={4000} required />
              </Field>
              {section === 'exceptions' && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Request type">
                    <select name="kind" className={control}>
                      <option value="EXTENSION">Deadline extension</option>
                      <option value="UNLOCK">Unlock submission</option>
                      <option value="TEAM_CHANGE">Teammate change</option>
                    </select>
                  </Field>
                  <Field label="Round">
                    <RoundSelect />
                  </Field>
                  <Field label="Departing participant email (teammate swaps)">
                    <input type="email" name="departingEmail" className={control} />
                  </Field>
                  <Field label="Replacement participant email (teammate swaps)">
                    <input type="email" name="replacementEmail" className={control} />
                  </Field>
                  <Field label="Minutes requested">
                    <input
                      type="number"
                      name="minutes"
                      defaultValue={10}
                      min={1}
                      max={1440}
                      className={control}
                    />
                  </Field>
                </div>
              )}
              <Button type="submit" loading={busy}>
                Send request
              </Button>
            </form>
          </Panel>
          <div className="space-y-4">
            {tickets.data?.tickets
              .filter((t) =>
                section === 'helpdesk' ? t.kind === 'QUESTION' : t.kind !== 'QUESTION',
              )
              .map((t) => (
                <Panel key={t.id}>
                  <div className="flex justify-between gap-3">
                    <h3 className="text-xl">{t.subject}</h3>
                    <span className="text-sm font-bold">{t.status.replaceAll('_', ' ')}</span>
                  </div>
                  <p className="text-sm text-graphite">
                    {t.kind} ·{' '}
                    {options.data?.teams.find((x) => x.id === t.teamId)?.teamCode ??
                      `${roleName(t.authorRole)} request`}{' '}
                    · {t.authorName}
                  </p>
                  {t.messages.map((m) => (
                    <div className="rounded-lg bg-blush p-3" key={m.id}>
                      <p className="text-xs font-bold">
                        {m.authorName} · {roleName(m.authorRole)} ·{' '}
                        {new Date(m.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                    </div>
                  ))}
                  {t.decisionNote && <p>Decision: {t.decisionNote}</p>}
                  <form
                    className="flex gap-2"
                    onSubmit={async (e) => {
                      const d = data(e);
                      await act(`/tickets/${t.id}/reply`, { body: str(d, 'body') });
                    }}
                  >
                    <input
                      name="body"
                      aria-label="Reply"
                      placeholder="Write a reply"
                      className={control}
                      required
                      maxLength={4000}
                    />
                    <Button type="submit" loading={busy}>
                      Reply
                    </Button>
                  </form>
                  {manager && (
                    <div className="flex flex-wrap gap-3">
                      <select
                        aria-label="Assigned staff"
                        className={control}
                        value={t.assignedToId ?? ''}
                        onChange={(e) =>
                          void act(
                            `/tickets/${t.id}`,
                            { assignedToId: e.target.value || null },
                            'PATCH',
                          )
                        }
                      >
                        <option value="">Unassigned</option>
                        {options.data?.staff
                          .filter((s) => s.role !== 'JUDGE')
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.user.name}
                            </option>
                          ))}
                      </select>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void act(
                            `/tickets/${t.id}`,
                            { status: t.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED' },
                            'PATCH',
                          )
                        }
                      >
                        {t.status === 'RESOLVED' ? 'Reopen' : 'Resolve'}
                      </Button>
                    </div>
                  )}
                  {admin && t.kind !== 'QUESTION' && ['OPEN', 'IN_PROGRESS'].includes(t.status) && (
                    <form
                      className="space-y-3"
                      onSubmit={async (e) => {
                        const d = data(e);
                        await act(`/tickets/${t.id}/decision`, {
                          approve: str(d, 'decision') === 'approve',
                          note: str(d, 'note'),
                        });
                      }}
                    >
                      <Field label="Decision note">
                        <input name="note" className={control} required />
                      </Field>
                      <select name="decision" className={control}>
                        <option value="approve">Approve requested exception</option>
                        <option value="deny">Deny request</option>
                      </select>
                      <Button type="submit" loading={busy}>
                        Record decision
                      </Button>
                      {t.kind === 'TEAM_CHANGE' && (
                        <p className="text-sm">
                          Approval replaces the departing participant with the registered
                          replacement, preserving their team role.
                        </p>
                      )}
                    </form>
                  )}
                </Panel>
              ))}
            {tickets.data?.tickets.length === 0 && <p>No requests yet.</p>}
          </div>
        </>
      )}
      {section === 'applications' &&
        (admin ? (
          <Panel>
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                const d = data(e);
                await act('/applications', {
                  teamIds: d.getAll('teamIds'),
                  status: str(d, 'status'),
                  note: str(d, 'note'),
                });
              }}
            >
              <p>
                Select teams to accept, waitlist, or reject. Every decision is recorded and queued
                for email delivery.
              </p>
              {options.data?.teams.map((t) => (
                <label key={t.id} className="flex items-center gap-3 border-b border-line py-3">
                  <input type="checkbox" name="teamIds" value={t.id} />
                  <span className="flex-1">
                    {t.teamCode} · {t.name}
                  </span>
                  <span className="text-sm">{t.applicationStatus}</span>
                </label>
              ))}
              <select name="status" className={control}>
                <option value="ACCEPTED">Accept</option>
                <option value="WAITLISTED">Waitlist</option>
                <option value="REJECTED">Reject</option>
              </select>
              <Field label="Message to teams">
                <textarea name="note" className={control} maxLength={1000} />
              </Field>
              <Button type="submit" loading={busy}>
                Apply decision
              </Button>
            </form>
          </Panel>
        ) : (
          <Panel>
            <h3 className="text-xl">
              {application.data?.team?.applicationStatus ?? 'Create or join a team first'}
            </h3>
            <p>{application.data?.team?.applicationNote}</p>
          </Panel>
        ))}
      {section === 'advancement' && (
        <Panel>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              const d = data(e);
              await act('/shortlist', {
                fromRoundId: str(d, 'fromRoundId'),
                toRoundId: str(d, 'toRoundId'),
                teamIds: d.getAll('teamIds'),
              });
            }}
          >
            <p>
              Choose teams with a submitted project to advance. Only shortlisted teams can submit in
              the destination round. All teams receive a decision message.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From round">
                <RoundSelect name="fromRoundId" />
              </Field>
              <Field label="To round">
                <RoundSelect name="toRoundId" />
              </Field>
            </div>
            {options.data?.teams.map((t) => (
              <label className="flex gap-3 py-2" key={t.id}>
                <input type="checkbox" name="teamIds" value={t.id} />
                {t.teamCode} · {t.name}
              </label>
            ))}
            <Button type="submit" loading={busy}>
              Save shortlist and notify teams
            </Button>
          </form>
        </Panel>
      )}
      {section === 'calibration' && (
        <>
          <Field label="Round">
            <select className={control} value={roundId} onChange={(e) => setRound(e.target.value)}>
              {options.data?.rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Panel>
            <p>
              Scores are compared on the 0–100 scale. Alerts need at least three evaluations.
              Duration measures elapsed time since the first saved draft, including breaks; it is a
              review signal.
            </p>
            <p>
              Normalisation shifts each judge’s scores toward the panel mean, clamps to 0–100, and
              leaves judges with fewer than three scores unchanged. Review raw and adjusted results
              before approval.
            </p>
            <Button
              variant="secondary"
              loading={busy}
              onClick={() =>
                void act(
                  `/normalisation/${roundId}`,
                  { enabled: !calibration.data?.normalisation },
                  'PUT',
                )
              }
            >
              {calibration.data?.normalisation ? 'Disable' : 'Enable'} score normalisation
            </Button>
          </Panel>
          {calibration.data?.judges.map((j) => (
            <Panel key={j.judgeId}>
              <div className="flex justify-between">
                <h3 className="text-xl">{j.name}</h3>
                <strong>{j.average.toFixed(1)} / 100</strong>
              </div>
              <p>
                {j.count} evaluations · panel difference {j.delta.toFixed(1)} points · average
                elapsed {(j.averageSeconds / 60).toFixed(1)} min
              </p>
              <div
                className="relative h-12 rounded-lg bg-blush"
                aria-label="Evaluation score distribution"
              >
                {j.points.map((p, i) => (
                  <span
                    key={i}
                    className="absolute top-4 size-3 rounded-full bg-ember"
                    style={{ left: `${Math.min(p.score, 98)}%` }}
                    title={`Score ${p.score}`}
                  />
                ))}
              </div>
              {j.outlier && (
                <Alert tone="info" title="Scoring outlier — review rubric interpretation" />
              )}
              {j.possibleFatigue && (
                <Alert
                  tone="info"
                  title="Evaluation time dropped — check whether support is needed"
                />
              )}
            </Panel>
          ))}
          {calibration.data?.judges.length === 0 && <p>No submitted evaluations yet.</p>}
        </>
      )}
      {section === 'engagement' && (
        <>
          <Panel>
            <p>
              Activity estimates use event visits, guidebook opens, and draft saves. Active: within
              24 hours. Slipping: 24–72 hours. Inactive: over 72 hours. Unknown: no signals yet. Use
              these estimates alongside confirmed attendance when planning catering.
            </p>
            <div className="flex flex-wrap gap-6">
              {['ACTIVE', 'SLIPPING', 'INACTIVE', 'UNKNOWN'].map((s) => (
                <div key={s}>
                  <strong className="block text-3xl">
                    {engagement.data?.teams.filter((t) => t.status === s).length ?? 0}
                  </strong>
                  {s}
                </div>
              ))}
            </div>
          </Panel>
          {engagement.data?.teams.map((t) => (
            <Panel key={t.id}>
              <div className="flex justify-between">
                <h3>
                  {t.teamCode} · {t.name}
                </h3>
                <strong>{t.status}</strong>
              </div>
              <p>
                {t.members} members · {t.submitted ? 'Project submitted' : 'No submission'} ·{' '}
                {t.guidebookOpened ? 'Guidebook opened' : 'No guidebook signal'}
              </p>
              <p className="text-sm">
                Last activity: {t.lastSeen ? new Date(t.lastSeen).toLocaleString() : 'Unknown'}
              </p>
              <a href={`/events/${eventId}/tasks`}>Assign a mentor / staff task</a>
            </Panel>
          ))}
        </>
      )}
      {section === 'communications' && (
        <>
          <Panel>
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                const d = data(e);
                await act('/broadcast', {
                  subject: str(d, 'subject'),
                  body: str(d, 'body'),
                  ...(str(d, 'trackId') ? { trackId: str(d, 'trackId') } : {}),
                  ...(str(d, 'roundId') ? { roundId: str(d, 'roundId') } : {}),
                  shortlistedOnly: d.has('shortlistedOnly'),
                });
              }}
            >
              <p>
                Messages use the configured email provider. Development messages stay in the local
                outbox. One-hour submission reminders are queued automatically.
              </p>
              <Field label="Subject">
                <input name="subject" className={control} required maxLength={200} />
              </Field>
              <Field label="Message">
                <textarea name="body" className={control} required maxLength={4000} />
              </Field>
              <Field label="Track">
                <select name="trackId" className={control}>
                  <option value="">All tracks</option>
                  {options.data?.tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Round">
                <select name="roundId" className={control}>
                  <option value="">No round filter</option>
                  {options.data?.rounds.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex gap-2">
                <input name="shortlistedOnly" type="checkbox" />
                Only teams shortlisted for the selected round
              </label>
              <Button type="submit" loading={busy}>
                Queue messages
              </Button>
            </form>
          </Panel>
          <Panel>
            <h3 className="text-xl">Delivery history</h3>
            {deliveries.data?.deliveries.map((d) => (
              <div key={d.id} className="border-b border-line py-3">
                <strong>{d.subject}</strong>
                <p>
                  {d.status} · {new Date(d.createdAt).toLocaleString()}
                </p>
                {d.error && <p>{d.error}</p>}
              </div>
            ))}
          </Panel>
        </>
      )}
      {section === 'discovery' && (
        <>
          {me.role === 'PARTICIPANT' && (
            <Panel>
              <h3 className="text-xl">Your teammate profile</h3>
              <p>
                Contact details you publish here are visible to other event members. Share only what
                you want them to use.
              </p>
              <form
                key={discovery.data?.mine?.headline ?? 'new'}
                className="space-y-4"
                onSubmit={async (e) => {
                  const d = data(e);
                  await act(
                    '/discovery',
                    {
                      headline: str(d, 'headline'),
                      skills: str(d, 'skills'),
                      about: str(d, 'about'),
                      contact: str(d, 'contact'),
                      visible: d.has('visible'),
                    },
                    'PUT',
                  );
                }}
              >
                {(['headline', 'skills', 'about', 'contact'] as const).map((key) => (
                  <Field label={key[0]!.toUpperCase() + key.slice(1)} key={key}>
                    <input
                      name={key}
                      className={control}
                      defaultValue={discovery.data?.mine?.[key] ?? ''}
                      required
                      maxLength={
                        key === 'headline'
                          ? 150
                          : key === 'skills'
                            ? 500
                            : key === 'about'
                              ? 1000
                              : 200
                      }
                    />
                  </Field>
                ))}
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    name="visible"
                    defaultChecked={discovery.data?.mine?.visible ?? false}
                  />
                  Publish my profile to this event
                </label>
                <Button type="submit" loading={busy}>
                  Save profile
                </Button>
              </form>
            </Panel>
          )}
          {discovery.data?.profiles.map((p) => (
            <Panel key={p.id}>
              <h3 className="text-xl">{p.name}</h3>
              <strong>{p.headline}</strong>
              <p>{p.skills}</p>
              <p>{p.about}</p>
              <p>Contact: {p.contact}</p>
            </Panel>
          ))}
        </>
      )}
      {section === 'access' && (
        <>
          <Panel>
            <p>
              Only the event owner can change access. Co-admins use admin permissions; staff leads
              use staff permissions. Sponsor viewers can access only the impact report. Judge
              college affiliations and track preferences are used by automatic assignment.
            </p>
          </Panel>
          {options.data?.staff.map((s) => (
            <Panel key={s.id}>
              <h3 className="text-xl">
                {s.user.name} · {s.role}
              </h3>
              <form
                className="space-y-4"
                onSubmit={async (e) => {
                  const d = data(e);
                  await act(
                    `/access/${s.id}`,
                    {
                      accessLevel: str(d, 'accessLevel'),
                      institution: str(d, 'institution'),
                      trackIds: d.getAll('trackIds'),
                    },
                    'PUT',
                  );
                }}
              >
                <Field label="Access level">
                  <select name="accessLevel" defaultValue={s.accessLevel} className={control}>
                    <option value="STANDARD">Standard role</option>
                    {s.role === 'ADMIN' && (
                      <>
                        <option value="CO_ADMIN">Co-admin</option>
                        <option value="SPONSOR_VIEWER">Sponsor viewer</option>
                      </>
                    )}
                    {s.role === 'STAFF' && <option value="STAFF_LEAD">Staff lead</option>}
                  </select>
                </Field>
                <Field label="College / institution">
                  <input name="institution" defaultValue={s.institution} className={control} />
                </Field>
                {s.role === 'JUDGE' && (
                  <fieldset>
                    <legend>Preferred tracks (none means all)</legend>
                    {options.data?.tracks.map((t) => (
                      <label className="flex gap-2 py-1" key={t.id}>
                        <input
                          type="checkbox"
                          name="trackIds"
                          value={t.id}
                          defaultChecked={s.trackIds.includes(t.id)}
                        />
                        {t.name}
                      </label>
                    ))}
                  </fieldset>
                )}
                <Button type="submit" loading={busy}>
                  Save access and matching
                </Button>
              </form>
            </Panel>
          ))}
        </>
      )}
      {section === 'report' && (
        <Panel>
          <h3 className="text-xl">A report ready to share</h3>
          <p>
            Includes participant and team totals, college representation, track participation,
            submissions, check-ins, and feedback counts.
          </p>
          <a
            className="inline-block rounded-pill bg-ember px-5 py-3 font-bold text-ink"
            href={`/api/v1${base}/report.pdf`}
          >
            Download impact report PDF
          </a>
        </Panel>
      )}
    </div>
  );
}
