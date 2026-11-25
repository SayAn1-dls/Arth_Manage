import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext, useParams } from 'react-router';
import { APPLICATION_TEXT } from '../participant/Deadline.js';
import type { MyEvent } from '@arthakram/shared';
import { ApiError, request } from '../../lib/api.js';
import {
  PageHeader,
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Input,
  Select,
  Spinner,
  Table,
  TBody,
  Td,
  THead,
  Th,
  Tr,
} from '../../ui/index.js';

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
    applications: admin ? 'Application review' : 'Application status',
    advancement: 'Round shortlists',
    calibration: 'Judge calibration',
    engagement: 'Team engagement',
    discovery: 'Find teammates',
    access: 'Access & matching',
    report: 'Impact report',
    sandbox: 'Practice workspace',
    integrity: 'Project review',
  };
  const descriptions: Record<string, string> = {
    applications: admin
      ? 'Accept, waitlist or reject team applications when screening is used.'
      : 'Whether your team is accepted, when screening is used.',
    advancement: 'Choose which teams advance to the next round.',
    calibration: 'Compare judges’ scoring and the optional normalisation.',
    engagement: 'Which teams look active, slipping or inactive.',
    discovery: 'Profiles of people looking for a team.',
    access: 'Access labels and the institutions and tracks used to match judges.',
    report: 'An aggregate PDF for sponsors and the institution.',
  };
  if (me.accessLevel === 'SPONSOR_VIEWER' && section === 'report')
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Sponsor overview"
          description="This event's aggregate impact report: totals, colleges, tracks and judging averages. It never contains participants' names, contact details or individual scores."
          actions={
            <a
              href={`/api/v1${base}/report.pdf`}
              className="inline-flex min-h-11 items-center self-start rounded-pill bg-ember px-5 font-bold text-ink no-underline"
            >
              Download the impact report (PDF)
            </a>
          }
        />
        <p className="text-sm">
          The report reflects the event's data at the moment you download it.
        </p>
      </div>
    );
  if (options.isPending) return <Spinner label="Loading workspace" />;
  const queryError =
    options.error || engagement.error || calibration.error || discovery.error || application.error;
  return (
    <div className="space-y-6">
      <PageHeader title={titles[section]} description={descriptions[section]} />
      {(error || queryError) && (
        <Alert tone="error" title="Could not complete request">
          {error || queryError?.message}
        </Alert>
      )}
      {notice && <Alert tone="info" title={notice} />}
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
            {!application.data?.team ? (
              <>
                <h3 className="text-xl">You are not in a team yet</h3>
                <p>
                  Applications are made by teams.{' '}
                  <Link to={`/events/${eventId}/team`}>Create or join a team</Link> first.
                </p>
              </>
            ) : (
              (() => {
                const st = application.data.team.applicationStatus;
                const t = APPLICATION_TEXT[st];
                return (
                  <>
                    <h3 className="text-xl">Application: {t?.label ?? st}</h3>
                    <p>{t?.text}</p>
                    {application.data.team.applicationNote && (
                      <p>Note from the organisers: “{application.data.team.applicationNote}”</p>
                    )}
                  </>
                );
              })()
            )}
          </Panel>
        ))}
      {section === 'advancement' && (
        <ShortlistSection eventId={eventId} base={base} rounds={options.data?.rounds ?? []} />
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
          </Panel>
          {roundId && (
            <ScoringMethod
              key={roundId}
              eventId={eventId}
              base={base}
              roundId={roundId}
              roundName={options.data?.rounds.find((r) => r.id === roundId)?.name ?? 'this round'}
              enabled={
                calibration.data?.normalisation ??
                options.data?.rounds.find((r) => r.id === roundId)?.normalisation ??
                false
              }
              loading={calibration.isPending}
            />
          )}
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type ShortlistContext = {
  fromRound: { id: string; name: string; order: number };
  toRound: {
    id: string;
    name: string;
    order: number;
    shortlistEnabled: boolean;
    started: boolean;
  };
  results: { versionNo: number; published: boolean; rankingScope: string } | null;
  currentShortlist: number;
  recipients: number;
  teams: {
    id: string;
    teamCode: string;
    name: string;
    submitted: boolean;
    rank: number | null;
    score: string | null;
    group: string | null;
    shortlisted: boolean;
  }[];
};

/** Round shortlists (D-57): see who submitted, how they ranked and who is on the shortlist before notifying anyone. */
function ShortlistSection({
  eventId,
  base,
  rounds,
}: {
  eventId: string;
  base: string;
  rounds: Options['rounds'];
}) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const from = rounds.find((r) => r.id === fromId) ?? rounds[0];
  const later = from ? rounds.filter((r) => r.order > from.order) : [];
  const to = later.find((r) => r.id === toId) ?? later[0];
  const context = useQuery({
    queryKey: ['workspace', 'shortlist', eventId, from?.id, to?.id],
    queryFn: () =>
      request<ShortlistContext>(
        'GET',
        `${base}/shortlist/${to!.id}?fromRoundId=${encodeURIComponent(from!.id)}`,
      ),
    enabled: Boolean(from && to),
  });
  if (rounds.length < 2)
    return (
      <Panel>
        <Alert tone="info" title="Add a second round to shortlist teams">
          A shortlist moves teams from one round to a later one.{' '}
          <Link to={`/events/${eventId}/rounds`}>Set up rounds</Link>
        </Alert>
      </Panel>
    );
  return (
    <Panel>
      <p>
        Choose which teams with a submitted project advance. Only shortlisted teams can submit in
        the destination round, and every active team is emailed the decision.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="From round"
          value={from?.id ?? ''}
          onChange={(e) => {
            setFromId(e.target.value);
            setToId('');
          }}
        >
          {rounds.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select
          label="To round"
          value={to?.id ?? ''}
          onChange={(e) => setToId(e.target.value)}
          disabled={!to}
          hint="Teams can only advance to a later round, so the source round and earlier rounds cannot be chosen."
        >
          {!to && <option value="">No later round</option>}
          {rounds.map((r) => (
            <option key={r.id} value={r.id} disabled={!from || r.order <= from.order}>
              {r.name}
              {r.id === from?.id ? ' (source round)' : ''}
            </option>
          ))}
        </Select>
      </div>
      {!to && (
        <Alert tone="info" title={`${from?.name ?? 'This round'} is the last round`}>
          Choose an earlier source round. Teams can only advance to a later round.
        </Alert>
      )}
      {to && context.isPending && <Spinner label="Loading teams" />}
      {context.error && (
        <Alert tone="error" title="Could not load the teams for this shortlist">
          {context.error.message}
        </Alert>
      )}
      {to && from && context.data && (
        <ShortlistForm
          key={`${from.id}:${to.id}`}
          ctx={context.data}
          base={base}
          eventId={eventId}
        />
      )}
    </Panel>
  );
}

function ShortlistForm({
  ctx,
  base,
  eventId,
}: {
  ctx: ShortlistContext;
  base: string;
  eventId: string;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(
    () => new Set(ctx.teams.filter((t) => t.shortlisted && t.submitted).map((t) => t.id)),
  );
  const [topN, setTopN] = useState('3');
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState('');
  const save = useMutation({
    mutationFn: (teamIds: string[]) =>
      request<{ advanced: number }>('POST', `${base}/shortlist`, {
        fromRoundId: ctx.fromRound.id,
        toRoundId: ctx.toRound.id,
        teamIds,
      }),
    onSuccess: async (r) => {
      setConfirming(false);
      setNotice(
        `Shortlist saved. ${plural(r.advanced, 'team')} advance to ${ctx.toRound.name}; decision emails are queued.`,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['workspace'] }),
        qc.invalidateQueries({ queryKey: ['workspace-options', eventId] }),
      ]);
    },
  });
  const from = ctx.fromRound.name,
    to = ctx.toRound.name,
    locked = ctx.toRound.started;
  const perGroup = ctx.results?.rankingScope === 'PER_TRACK';
  const ranked = ctx.teams.some((t) => t.rank !== null);
  const n = selected.size,
    m = ctx.teams.length - n;
  const top = Math.max(1, Math.floor(Number(topN)) || 1);
  const rows = [...ctx.teams].sort(
    (a, b) =>
      Number(a.rank === null) - Number(b.rank === null) ||
      (perGroup ? (a.group ?? '').localeCompare(b.group ?? '') : 0) ||
      (a.rank ?? 0) - (b.rank ?? 0) ||
      a.teamCode.localeCompare(b.teamCode),
  );
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="space-y-4">
      {notice && <Alert tone="success" title={notice} />}
      {locked && (
        <Alert tone="warning" title={`${to} has already started`}>
          Judging has opened or teams have submitted in {to}, so its shortlist can no longer change.
        </Alert>
      )}
      <p>
        {ctx.toRound.shortlistEnabled
          ? `${to} already has a shortlist of ${plural(ctx.currentShortlist, 'team')}. Teams on it are ticked below.`
          : `${to} has no shortlist yet.`}
      </p>
      {ctx.results ? (
        <p className="text-sm">
          Ranks and scores come from approved results version {ctx.results.versionNo} for {from} (
          {ctx.results.published ? 'published' : 'not yet published'}).
        </p>
      ) : (
        <Alert tone="info" title={`No approved results for ${from} yet`}>
          Ranks appear here once the results for {from} are approved. You can still choose teams by
          hand.
        </Alert>
      )}
      {ranked && !locked && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-36">
              <Input
                label="Top positions"
                type="number"
                min={1}
                value={topN}
                onChange={(e) => setTopN(e.target.value)}
              />
            </div>
            <Button
              variant="secondary"
              onClick={() =>
                setSelected(
                  new Set(
                    ctx.teams
                      .filter((t) => t.submitted && t.rank !== null && t.rank <= top)
                      .map((t) => t.id),
                  ),
                )
              }
            >
              Select the top {top} by rank{perGroup ? ' in each track' : ''}
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
          <p className="text-sm">
            This replaces the ticks below. Teams tied at position {top} are all included.
          </p>
        </div>
      )}
      <Table caption={`Teams that can advance from ${from} to ${to}`}>
        <THead>
          <Tr>
            <Th>Advance</Th>
            <Th>Submitted in {from}</Th>
            <Th>Rank and score</Th>
            <Th>Current shortlist</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((t) => (
            <Tr key={t.id}>
              <Td>
                <Checkbox
                  label={`${t.teamCode} · ${t.name}`}
                  hint={t.submitted ? undefined : 'No submitted project, so it cannot advance'}
                  checked={selected.has(t.id)}
                  disabled={!t.submitted || locked}
                  onChange={() => toggle(t.id)}
                />
              </Td>
              <Td>
                {t.submitted ? (
                  <Badge tone="success">Submitted</Badge>
                ) : (
                  <Badge tone="warning">Not submitted</Badge>
                )}
              </Td>
              <Td>
                {t.rank !== null
                  ? `Rank ${t.rank}${perGroup && t.group ? ` in ${t.group}` : ''} · ${Number(t.score).toFixed(2)}`
                  : ctx.results
                    ? 'Not ranked'
                    : 'No approved results yet'}
              </Td>
              <Td>
                {t.shortlisted ? <Badge tone="info">On shortlist</Badge> : 'Not on shortlist'}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      {ctx.teams.length === 0 && <p>There are no active teams in this event.</p>}
      <p aria-live="polite">
        <strong>{plural(n, 'team')} selected to advance</strong> · {plural(m, 'team')} will be told
        they were not shortlisted
      </p>
      {n === 0 && (
        <p className="text-sm">
          Select at least one team. Saving with nobody selected would tell every team it was not
          shortlisted, so it is not allowed.
        </p>
      )}
      <Button
        disabled={n === 0 || locked}
        onClick={() => {
          save.reset();
          setNotice('');
          setConfirming(true);
        }}
      >
        Review and save shortlist
      </Button>
      <Dialog
        open={confirming}
        title={`Advance ${plural(n, 'team')} to ${to}?`}
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate([...selected])}>
              Save shortlist and notify {n} + {m} teams
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p>
            <strong>
              {plural(n, 'team')} {n === 1 ? 'advances' : 'advance'} to {to}; {plural(m, 'team')}{' '}
              will be told they were not shortlisted.
            </strong>
          </p>
          <p>
            Emails are queued now to {plural(ctx.recipients, 'person', 'people')} and cannot be
            recalled.
          </p>
          <p>
            {ctx.toRound.shortlistEnabled
              ? `This replaces the current shortlist of ${plural(ctx.currentShortlist, 'team')}.`
              : `${to} has no shortlist yet. After saving, only the shortlisted teams can submit in it.`}
          </p>
          <p className="text-sm">Saving exactly the same selection again does not resend emails.</p>
          {save.error && (
            <Alert tone="error" title="The shortlist was not saved">
              {save.error.message}
            </Alert>
          )}
        </div>
      </Dialog>
    </div>
  );
}

/** Scoring method per round (D-54): the state is stated, and changing it is confirmed with its caveats. */
function ScoringMethod({
  eventId,
  base,
  roundId,
  roundName,
  enabled,
  loading,
}: {
  eventId: string;
  base: string;
  roundId: string;
  roundName: string;
  enabled: boolean;
  loading: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [notice, setNotice] = useState('');
  const change = useMutation({
    mutationFn: (next: boolean) =>
      request('PUT', `${base}/normalisation/${roundId}`, { enabled: next }),
    onSuccess: async (_r, next) => {
      setOpen(false);
      setNotice(
        next
          ? `Scoring method for ${roundName} is now normalised.`
          : `Scoring method for ${roundName} is now the raw average.`,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['workspace'] }),
        qc.invalidateQueries({ queryKey: ['workspace-options', eventId] }),
        qc.invalidateQueries({ queryKey: ['results-review', eventId] }),
      ]);
    },
  });
  const blocked = change.error instanceof ApiError && change.error.code === 'approved_results';
  const results = <Link to={`/events/${eventId}/results`}>Results page</Link>;
  return (
    <Panel>
      {notice && <Alert tone="success" title={notice} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          <strong>Scoring method for {roundName}:</strong>{' '}
          {enabled
            ? 'Normalised (each judge shifted to the panel mean)'
            : 'Raw average (normalisation off)'}
        </p>
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => {
            change.reset();
            setNotice('');
            setUnderstood(false);
            setOpen(true);
          }}
        >
          {enabled ? 'Turn off normalisation' : 'Turn on normalisation'}
        </Button>
      </div>
      <p className="text-sm">
        Normalisation is off by default. Raw and adjusted scores are both shown on the {results}.
      </p>
      <Dialog
        open={open}
        title={
          enabled
            ? `Turn off normalisation for ${roundName}?`
            : `Turn on normalisation for ${roundName}?`
        }
        onClose={() => setOpen(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={change.isPending}
              disabled={!enabled && !understood}
              onClick={() => change.mutate(!enabled)}
            >
              {enabled ? 'Use the raw average' : 'Normalise scores'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {enabled ? (
            <p>
              Team scores for {roundName} go back to the plain average of judges’ scores. This can
              change rankings if the adjusted scores differed.
            </p>
          ) : (
            <>
              <p>
                Team scores for {roundName} will use adjusted judge scores instead of the plain
                average. <strong>This can change rankings and reorder winners.</strong>
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  Each judge with at least 3 submitted scores is shifted by the gap between the
                  panel mean and their own mean. Adjusted scores stay within 0–100.
                </li>
                <li>
                  Judges with fewer than 3 scores are not adjusted. Three scores is a small sample,
                  so an adjustment can be mostly noise.
                </li>
                <li>
                  Judges are not assigned at random and the panel mean mixes all tracks. A judge who
                  happened to draw strong teams looks like a generous marker, so those teams are
                  marked down (and a judge who drew weaker teams has theirs marked up).
                </li>
                <li>
                  Do not use it where prizes depend on the outcome unless the organisers have
                  decided to.
                </li>
              </ul>
              <Checkbox
                label="I understand this can change rankings"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
              />
            </>
          )}
          <p className="text-sm">
            The change cannot be made while approved results exist for {roundName}.
          </p>
          {blocked ? (
            <Alert
              tone="error"
              title="Approved results for this round must be withdrawn before the scoring method can change"
            >
              {change.error?.message}. Review them on the {results}.
            </Alert>
          ) : (
            change.error && (
              <Alert tone="error" title="The scoring method was not changed">
                {change.error.message}
              </Alert>
            )
          )}
        </div>
      </Dialog>
    </Panel>
  );
}
