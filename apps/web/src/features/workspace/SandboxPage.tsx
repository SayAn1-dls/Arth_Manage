import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { request } from '../../lib/api.js';
import { Button, Alert, Spinner } from '../../ui/index.js';
const control = 'block w-full rounded-lg border border-line-strong bg-white px-3 py-2';
type Round = {
  id: string;
  name: string;
  submissionDeadline: string | null;
  formFields: {
    id: string;
    label: string;
    type: string;
    maxMb: number;
    required: boolean;
    allowedExtensions: string[];
  }[];
  rubric: {
    criteria: { id: string; name: string; weight: number; min: number; max: number }[];
  } | null;
};
type Snapshot = {
  members: { id: string; role: string; user: { name: string } }[];
  rounds: Round[];
  member: { id: string; role: string; user: { name: string } } | null;
  assignments: { teamId: string; roundId: string; team?: { name: string; teamCode: string } }[];
};
/** All practice writes use local state; GET copies configuration without impersonating a live session. */
export function SandboxPage() {
  const { eventId = '' } = useParams();
  const [memberId, setMemberId] = useState('');
  const [roundId, setRoundId] = useState('');
  const q = useQuery({
    queryKey: ['sandbox', eventId, memberId],
    queryFn: () =>
      request<Snapshot>(
        'GET',
        `/events/${eventId}/workspace/sandbox${memberId ? `?membershipId=${encodeURIComponent(memberId)}` : ''}`,
      ),
  });
  if (q.isPending) return <Spinner label="Copying event configuration" />;
  if (q.error) return <Alert tone="error" title={q.error.message} />;
  const member = q.data.member;
  const round = q.data.rounds.find((r) => r.id === roundId) ?? q.data.rounds[0];
  return (
    <div className="space-y-5">
      <h2 className="text-3xl">View as · practice workspace</h2>
      <Alert tone="info" title="Isolated practice session">
        This copies event configuration and the selected user’s assignments into a practice screen.
        Dummy submissions and scores stay in this page’s memory. It does not log in as that person.
      </Alert>
      <label className="block">
        View as
        <select
          className={control}
          value={member?.id ?? ''}
          onChange={(e) => setMemberId(e.target.value)}
        >
          {q.data.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.user.name} · {m.role}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Round
        <select
          className={control}
          value={round?.id ?? ''}
          onChange={(e) => setRoundId(e.target.value)}
        >
          {q.data.rounds.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {member?.role === 'JUDGE' && (
        <p>
          Assigned teams:{' '}
          {q.data.assignments
            .filter((a) => a.roundId === round?.id)
            .map((a) => a.team?.name)
            .join(', ') || 'No teams assigned for this round'}
        </p>
      )}
      {round && (
        <Practice
          key={`${member?.id}:${round.id}`}
          round={round}
          role={member?.role ?? 'PARTICIPANT'}
        />
      )}
    </div>
  );
}
function Practice({ round, role }: { round: Round; role: string }) {
  const [message, setMessage] = useState('');
  const criteria = round.rubric?.criteria ?? [];
  const [weights, setWeights] = useState(criteria.map((c) => c.weight));
  const [scores, setScores] = useState(criteria.map((c) => c.min));
  const total = weights.reduce((a, b) => a + b, 0);
  return (
    <>
      <form
        className="space-y-4 rounded-xl border border-line p-5"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(
            role === 'JUDGE'
              ? 'Practice evaluation submitted. No live scores changed.'
              : 'Dummy project submitted. No live submission changed.',
          );
        }}
      >
        {role === 'JUDGE' ? (
          <>
            <h3 className="text-xl">{round.name} · copied rubric</h3>
            {criteria.map((c, i) => (
              <div key={c.id} className="grid grid-cols-3 items-center gap-3">
                <strong>{c.name}</strong>
                <label>
                  Weight %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={control}
                    value={weights[i]}
                    onChange={(e) =>
                      setWeights(weights.map((w, j) => (i === j ? Number(e.target.value) : w)))
                    }
                  />
                </label>
                <label>
                  Score ({c.min}–{c.max})
                  <input
                    type="number"
                    min={c.min}
                    max={c.max}
                    required
                    className={control}
                    value={scores[i]}
                    onChange={(e) =>
                      setScores(scores.map((s, j) => (i === j ? Number(e.target.value) : s)))
                    }
                  />
                </label>
              </div>
            ))}
            <p>Total weight: {total}%</p>
            <p>
              Weighted score:{' '}
              {criteria
                .reduce((s, c, i) => s + ((scores[i]! - c.min) / (c.max - c.min)) * weights[i]!, 0)
                .toFixed(2)}{' '}
              / 100
            </p>
            <Button type="submit" disabled={!criteria.length || total !== 100}>
              Submit practice evaluation
            </Button>
          </>
        ) : (
          <>
            <h3 className="text-xl">{round.name} · dummy submission</h3>
            <p>
              Configured deadline:{' '}
              {round.submissionDeadline
                ? new Date(round.submissionDeadline).toLocaleString()
                : 'Not set'}
            </p>
            <label>
              Project title
              <input className={control} required maxLength={200} />
            </label>
            <label>
              Summary
              <textarea className={control} required maxLength={5000} />
            </label>
            {round.formFields.map((f) => (
              <label className="block" key={f.id}>
                {f.label}
                {f.required ? ' *' : ''}
                {f.type === 'FILE' ? (
                  <>
                    <p className="text-sm">
                      Up to {f.maxMb} MB · {f.allowedExtensions.join(', ') || 'Allowed file types'}
                    </p>
                    <input
                      type="file"
                      className={control}
                      required={f.required}
                      accept={f.allowedExtensions.map((e) => '.' + e).join(',')}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (
                          file &&
                          (file.size > f.maxMb * 1024 * 1024 ||
                            (f.allowedExtensions.length &&
                              !f.allowedExtensions.includes(
                                file.name.split('.').pop()?.toLowerCase() ?? '',
                              )))
                        ) {
                          e.target.value = '';
                          setMessage('File exceeds the configured size or type limit.');
                        } else
                          setMessage(
                            file ? `${file.name} selected locally. Nothing uploaded.` : '',
                          );
                      }}
                    />
                  </>
                ) : f.type === 'LONG_TEXT' ? (
                  <textarea className={control} required={f.required} />
                ) : (
                  <input
                    className={control}
                    required={f.required}
                    type={f.type.includes('URL') ? 'url' : 'text'}
                  />
                )}
              </label>
            ))}
            <Button type="submit">Submit dummy project</Button>
          </>
        )}
      </form>
      {message && <Alert tone="info" title={message} />}
    </>
  );
}
