import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, LogOut, UserMinus } from 'lucide-react';
import type { MyEvent, TeamDto } from '@arthakram/shared';
import { eventApi, useEvent } from '../../lib/events.js';
import { participantApi } from '../../lib/participant.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  FormErrorSummary,
  Input,
  Select,
  Spinner,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

/** Team home for participants: create or join, then manage the team while registration is open (PRD FR-052..057). */
export function TeamPage() {
  const mine = useOutletContext<MyEvent>();
  const q = useQuery({
    queryKey: ['my-team', mine.eventId],
    queryFn: () => participantApi.myTeam(mine.eventId),
  });
  const event = useEvent(mine.eventId);
  if (q.isPending || event.isPending) return <Spinner label="Loading your team" />;
  const open = event.data?.registrationStatus === 'OPEN';
  return (
    <div className="flex flex-col gap-6">
      <h2>My team</h2>
      {q.data ? (
        <TeamDetails team={q.data} eventId={mine.eventId} open={open} />
      ) : (
        <NoTeam eventId={mine.eventId} open={open} max={event.data?.teamMax ?? 4} />
      )}
    </div>
  );
}

function useRefresh(eventId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['my-team', eventId] }),
      qc.invalidateQueries({ queryKey: ['tracks', eventId] }),
    ]);
}

function NoTeam({ eventId, open, max }: { eventId: string; open: boolean; max: number }) {
  const refresh = useRefresh(eventId);
  const createErr = useFormErrors();
  const joinErr = useFormErrors();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof participantApi.previewJoin>
  > | null>(null);

  const create = useMutation({
    mutationFn: () => participantApi.createTeam(eventId, name),
    onSuccess: refresh,
    onError: createErr.capture,
  });
  const look = useMutation({
    mutationFn: () => participantApi.previewJoin(eventId, code),
    onSuccess: setPreview,
    onError: joinErr.capture,
  });
  const join = useMutation({
    mutationFn: () => participantApi.join(eventId, code),
    onSuccess: refresh,
    onError: joinErr.capture,
  });

  if (!open) {
    return (
      <Alert tone="warning" title="Registration is closed">
        You are not in a team. Contact the organisers to be placed in one.
      </Alert>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card footerLabel="Start a team">
        <h3>Create a team</h3>
        <p className="mt-1 text-sm">
          You become the leader and get a code to share with up to {max - 1} teammates.
        </p>
        <form
          className="mt-4 flex flex-col gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            createErr.clear();
            create.mutate();
          }}
        >
          {createErr.formError && <Alert tone="error" title={createErr.formError} />}
          <FormErrorSummary issues={createErr.issues({ name: 'tm-name' })} />
          <Input
            id="tm-name"
            label="Team name"
            required
            hint="3 to 40 characters, unique in this event."
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={createErr.fields.name}
          />
          <div>
            <Button type="submit" loading={create.isPending}>
              Create team
            </Button>
          </div>
        </form>
      </Card>
      <Card footerLabel="Join with a code">
        <h3>Join a team</h3>
        <p className="mt-1 text-sm">Ask your team leader for the 8-character code.</p>
        <form
          className="mt-4 flex flex-col gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            joinErr.clear();
            setPreview(null);
            look.mutate();
          }}
        >
          {joinErr.formError && <Alert tone="error" title={joinErr.formError} />}
          <Input
            id="tm-code"
            label="Join code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            autoCapitalize="characters"
            error={joinErr.fields.code}
          />
          <div>
            <Button type="submit" variant="secondary" loading={look.isPending}>
              Find team
            </Button>
          </div>
        </form>
        <Dialog
          open={preview !== null}
          title={preview?.full ? `${preview.name} is full` : `Join ${preview?.name ?? ''}?`}
          onClose={() => setPreview(null)}
          actions={
            preview?.full ? (
              <Button onClick={() => setPreview(null)}>Close</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setPreview(null)}>
                  Cancel
                </Button>
                <Button onClick={() => join.mutate()} loading={join.isPending}>
                  Join team
                </Button>
              </>
            )
          }
        >
          {preview && (
            <p>
              Led by <strong>{preview.leaderName}</strong>. Current size {preview.size} of{' '}
              {preview.max}.{preview.full && ' Ask the leader, or create your own team.'}
            </p>
          )}
          {joinErr.formError && <Alert className="mt-3" tone="error" title={joinErr.formError} />}
        </Dialog>
      </Card>
    </div>
  );
}

function TeamDetails({ team, eventId, open }: { team: TeamDto; eventId: string; open: boolean }) {
  const refresh = useRefresh(eventId);
  const errors = useFormErrors();
  const tracks = useQuery({
    queryKey: ['tracks', eventId],
    queryFn: () => eventApi.tracks(eventId),
  });
  const problems = useQuery({
    queryKey: ['problems', eventId],
    queryFn: () => eventApi.problems(eventId),
  });
  const isLeader = team.members.find((m) => m.isYou)?.role === 'LEADER';
  const [name, setName] = useState(team.name);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const act = <T,>(fn: () => Promise<T>) => ({
    mutationFn: fn,
    onSuccess: () => {
      errors.clear();
      return refresh();
    },
    onError: errors.capture,
  });
  const rename = useMutation(
    act(() => participantApi.updateTeam(eventId, { version: team.version, name })),
  );
  const regenerate = useMutation(act(() => participantApi.regenerateCode(eventId)));
  const leave = useMutation({
    mutationFn: () => participantApi.leave(eventId),
    onSuccess: () => {
      setConfirmLeave(false);
      return refresh();
    },
    onError: (e) => {
      setConfirmLeave(false);
      errors.capture(e);
    },
  });

  const pick = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      participantApi.updateTeam(eventId, { version: team.version, ...body }),
    onSuccess: () => {
      errors.clear();
      return refresh();
    },
    onError: errors.capture,
  });
  const remove = useMutation({
    mutationFn: (id: string) => participantApi.removeMember(eventId, id),
    onSuccess: refresh,
    onError: errors.capture,
  });
  const transfer = useMutation({
    mutationFn: (id: string) => participantApi.transfer(eventId, id),
    onSuccess: refresh,
    onError: errors.capture,
  });

  const copy = async () => {
    if (!team.joinCode) return;
    await navigator.clipboard.writeText(team.joinCode).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const trackProblems = (problems.data ?? []).filter(
    (p) => !p.trackId || p.trackId === team.trackId,
  );

  return (
    <div className="flex flex-col gap-4">
      {errors.formError && <Alert tone="error" title={errors.formError} />}
      {team.status === 'DISQUALIFIED' && (
        <Alert tone="error" title="This team is disqualified">
          {team.disqualifiedReason}
        </Alert>
      )}
      <Card footerLabel={`Team ID ${team.teamCode}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3>{team.name}</h3>
          {team.complete ? (
            <Badge tone="success">Complete</Badge>
          ) : (
            <Badge tone="warning">Incomplete: needs {team.min - team.size} more</Badge>
          )}
          <Badge tone="info">
            {team.size} of {team.max}
          </Badge>
        </div>
        {isLeader && open && (
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              errors.clear();
              rename.mutate();
            }}
          >
            <div className="min-w-60 flex-1">
              <Input
                label="Team name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={errors.fields.name}
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              loading={rename.isPending}
              disabled={name === team.name}
            >
              Rename
            </Button>
          </form>
        )}
        {team.joinCode && (
          <div className="mt-4 rounded-card bg-blush p-4">
            <p className="text-xs font-bold uppercase tracking-eyebrow text-ink">Join code</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <code className="rounded-pill bg-white px-3 py-1.5 font-mono text-xl font-bold tracking-widest text-ink">
                {team.joinCode}
              </code>
              <Button
                variant="secondary"
                icon={
                  copied ? (
                    <Check aria-hidden className="size-4" />
                  ) : (
                    <Copy aria-hidden className="size-4" />
                  )
                }
                onClick={copy}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
              {isLeader && (
                <Button
                  variant="ghost"
                  icon={<KeyRound aria-hidden className="size-4" />}
                  onClick={() => regenerate.mutate()}
                  loading={regenerate.isPending}
                >
                  New code
                </Button>
              )}
            </div>
            <p className="mt-2 text-sm">
              Share it with your teammates. Making a new code stops the old one working.
            </p>
          </div>
        )}
        {!open && (
          <Alert className="mt-4" tone="info" title="Registration is closed">
            Contact the organisers to change your team.
          </Alert>
        )}
      </Card>

      <Card footerLabel="Members">
        <ul className="divide-y divide-line">
          {team.members.map((m) => (
            <li
              key={m.membershipId}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div>
                <p className="font-bold text-ink">
                  {m.name} {m.role === 'LEADER' && <Badge>Leader</Badge>}
                </p>
                <p className="text-sm">
                  {m.institution}
                  {m.email ? ` · ${m.email}` : ''}
                </p>
              </div>
              {isLeader && open && !m.isYou && (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => transfer.mutate(m.membershipId)}>
                    Make leader
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<UserMinus aria-hidden className="size-4" />}
                    onClick={() => remove.mutate(m.membershipId)}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {open && (
          <Button
            className="mt-4"
            variant="secondary"
            icon={<LogOut aria-hidden className="size-4" />}
            onClick={() => setConfirmLeave(true)}
          >
            Leave team
          </Button>
        )}
      </Card>

      {(tracks.data?.length ?? 0) > 0 || (problems.data?.length ?? 0) > 0 ? (
        <Card footerLabel="Track and problem statement">
          <div className="grid gap-4 sm:grid-cols-2">
            {(tracks.data?.length ?? 0) > 0 && (
              <Select
                label="Track"
                value={team.trackId ?? ''}
                disabled={!isLeader}
                onChange={(e) => pick.mutate({ trackId: e.target.value || null, problemId: null })}
              >
                <option value="">Not chosen yet</option>
                {tracks.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
            {(problems.data?.length ?? 0) > 0 && (
              <Select
                label="Problem statement"
                value={team.problemId ?? ''}
                disabled={!isLeader}
                onChange={(e) => pick.mutate({ problemId: e.target.value || null })}
              >
                <option value="">Not chosen yet</option>
                {trackProblems.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <p className="mt-3 text-sm">
            {isLeader
              ? 'You can change these until the first submission deadline.'
              : 'Only the team leader can choose.'}
          </p>
        </Card>
      ) : null}

      <Dialog
        open={confirmLeave}
        title="Leave this team?"
        onClose={() => setConfirmLeave(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmLeave(false)}>
              Stay
            </Button>
            <Button variant="danger" onClick={() => leave.mutate()} loading={leave.isPending}>
              Leave team
            </Button>
          </>
        }
      >
        <p>
          Submissions stay with the team and you lose access to them. If you are the last member,
          the team is dissolved.
        </p>
      </Dialog>
    </div>
  );
}
