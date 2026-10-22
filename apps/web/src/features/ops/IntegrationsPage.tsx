import { useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import type { MyEvent } from '@arthakram/shared';
import { formatDateTime } from '../../lib/format.js';
import { integrationsApi, type IntegrationsDto } from '../../lib/engage.js';
import { useFormErrors } from '../auth/useFormErrors.js';
import { Alert, Badge, Button, Card, Checkbox, Dialog, Spinner } from '../../ui/index.js';

const RESULT: Record<string, { tone: 'success' | 'warning' | 'error'; text: string }> = {
  connected: { tone: 'success', text: 'Google is connected. The first sync is queued.' },
  cancelled: { tone: 'warning', text: 'Connection cancelled – nothing was changed.' },
  failed: {
    tone: 'error',
    text: "We couldn't finish connecting to Google. Nothing was changed; try again.",
  },
};
const JOB_TONE = {
  QUEUED: 'info',
  RUNNING: 'info',
  SUCCEEDED: 'success',
  FAILED: 'error',
} as const;

/** Google Sheets push and Drive mirror: honest status, Sync now, and CSV as the always-available fallback (PRD Modules F, G). */
export function IntegrationsPage() {
  const mine = useOutletContext<MyEvent>();
  const [params] = useSearchParams();
  const q = useQuery({
    queryKey: ['integrations', mine.eventId],
    queryFn: () => integrationsApi.get(mine.eventId),
    refetchInterval: (query) =>
      query.state.data?.jobs.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING')
        ? 3000
        : false,
  });
  const result = RESULT[params.get('result') ?? ''];
  return (
    <div className="flex flex-col gap-6">
      <h2>Integrations</h2>
      <p>
        The platform is always the source of truth. Google Sheets receives a read-only copy and
        Drive receives an archive copy of submitted files. CSV export always works, whatever Google
        is doing.
      </p>
      {result && <Alert tone={result.tone} title={result.text} />}
      {q.isPending && <Spinner label="Loading integrations" />}
      {q.isError && <Alert tone="error" title="We couldn't load the integrations" />}
      {q.data && <Body mine={mine} data={q.data} />}
      <Card footerLabel="Always available">
        <h3>CSV export</h3>
        <p className="mt-2">
          Download participants and teams as CSV at any time, with or without Google.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          {['participants', 'teams'].map((n) => (
            <a
              key={n}
              href={`/api/v1/events/${mine.eventId}/exports/${n}.csv`}
              className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-strong bg-white px-5 font-bold text-ink no-underline hover:bg-blush"
            >
              <Download aria-hidden className="size-4" /> {n === 'teams' ? 'Teams' : 'Participants'}{' '}
              CSV
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Body({ mine, data }: { mine: MyEvent; data: IntegrationsDto }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const ev = mine.eventId;
  const [ack, setAck] = useState(false);
  const [drive, setDrive] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations', ev] });
  const ok = (fn: () => Promise<unknown>) => ({
    mutationFn: fn,
    onSuccess: async () => {
      errors.clear();
      setConfirmOff(false);
      await refresh();
    },
    onError: errors.capture,
  });
  const connect = useMutation({
    mutationFn: () => integrationsApi.connect(ev, drive),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: errors.capture,
  });
  const sync = useMutation(ok(() => integrationsApi.syncNow(ev)));
  const toggleDrive = useMutation(
    ok(() => integrationsApi.drive(ev, !data.connection?.driveEnabled)),
  );
  const newSheet = useMutation(ok(() => integrationsApi.newSheet(ev)));
  const disconnect = useMutation(ok(() => integrationsApi.disconnect(ev)));
  const c = data.connection;
  const tz = mine.timeZone;

  if (!c)
    return (
      <Card footerLabel="Google">
        <h3>Not connected</h3>
        {!data.configured ? (
          <Alert className="mt-3" tone="info" title="Google isn't set up on this server">
            The server needs Google credentials and an encryption key before it can connect. Until
            then, use the CSV export below. Nothing is synced.
          </Alert>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <p>
              Connecting creates a spreadsheet in your Google account named after the event. Changes
              made in managed tabs are overwritten on the next sync, so add your own tabs for notes.
              Scores, judge comments and feedback are never sent.
            </p>
            {errors.formError && <Alert tone="error" title={errors.formError} />}
            <Checkbox
              label="The sheet will contain participants' personal data. I am responsible for who it is shared with."
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <Checkbox
              label="Also copy submitted files to Google Drive"
              hint="An archive for your records. Judges and participants never get access through Drive."
              checked={drive}
              onChange={(e) => setDrive(e.target.checked)}
            />
            <div>
              <Button disabled={!ack} loading={connect.isPending} onClick={() => connect.mutate()}>
                Connect Google
              </Button>
            </div>
          </div>
        )}
      </Card>
    );

  return (
    <>
      <Card footerLabel={`Connected as ${c.googleEmail}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3>Google Sheets</h3>
          <Badge
            tone={
              c.status === 'NEEDS_REAUTH'
                ? 'error'
                : c.lastResult === 'FAILED'
                  ? 'warning'
                  : 'success'
            }
          >
            {c.status === 'NEEDS_REAUTH'
              ? 'Needs reconnecting'
              : c.lastResult === 'FAILED'
                ? 'Last sync failed'
                : 'Connected'}
          </Badge>
        </div>
        <p className="mt-2">
          Last successful sync:{' '}
          <strong className="text-ink">
            {c.lastSuccessAt ? formatDateTime(c.lastSuccessAt, tz) : 'never'}
          </strong>
          {c.lastAttemptAt && ` · last attempt ${formatDateTime(c.lastAttemptAt, tz)}`}
        </p>
        <p className="mt-1 text-sm">
          This is a read-only copy. Edits made in the managed tabs are overwritten on the next sync.
        </p>
        {c.lastError && (
          <Alert
            className="mt-3"
            tone={c.status === 'NEEDS_REAUTH' ? 'error' : 'warning'}
            title={c.lastError}
          >
            {c.lastErrorDetail && (
              <details>
                <summary className="cursor-pointer font-semibold">Details</summary>
                <p className="mt-1 break-words text-sm">{c.lastErrorDetail}</p>
              </details>
            )}
          </Alert>
        )}
        {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
        <div className="mt-4 flex flex-wrap gap-3">
          {c.spreadsheetUrl && (
            <a
              href={c.spreadsheetUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-strong bg-white px-5 font-bold text-ink no-underline hover:bg-blush"
            >
              <ExternalLink aria-hidden className="size-4" /> Open the spreadsheet
            </a>
          )}
          {c.status === 'CONNECTED' ? (
            <>
              <Button
                icon={<RefreshCw aria-hidden className="size-4" />}
                loading={sync.isPending}
                onClick={() => sync.mutate()}
              >
                Sync now
              </Button>
              <Button variant="secondary" onClick={() => newSheet.mutate()}>
                Create a new spreadsheet
              </Button>
            </>
          ) : (
            <Button loading={connect.isPending} onClick={() => connect.mutate()}>
              Reconnect Google
            </Button>
          )}
          <Button variant="secondary" onClick={() => setConfirmOff(true)}>
            Disconnect
          </Button>
        </div>
      </Card>

      <Card footerLabel="Optional archive">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3>Google Drive archive</h3>
          <Badge tone={c.driveEnabled ? 'success' : 'info'}>{c.driveEnabled ? 'On' : 'Off'}</Badge>
        </div>
        <p className="mt-2">
          Submitted files are copied into your Drive under the event, round and team. The platform
          stays the master copy, and Drive problems never affect teams or judges.
        </p>
        {c.driveEnabled && (
          <p className="mt-1 text-sm">
            Mirrored: {data.mirror.MIRRORED ?? 0} · failed: {data.mirror.FAILED ?? 0}
          </p>
        )}
        <Button
          className="mt-3"
          variant="secondary"
          disabled={c.status !== 'CONNECTED'}
          onClick={() => toggleDrive.mutate()}
        >
          {c.driveEnabled ? 'Turn off the Drive archive' : 'Turn on the Drive archive'}
        </Button>
      </Card>

      <Card footerLabel="Last 20 jobs">
        <h3>Sync history</h3>
        {data.jobs.length === 0 && <p className="mt-2">Nothing has been synced yet.</p>}
        <ul className="mt-3 flex flex-col gap-2">
          {data.jobs.map((j) => (
            <li
              key={j.id}
              className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-paper px-3 py-2"
            >
              <Badge tone={JOB_TONE[j.status]}>{j.status.toLowerCase()}</Badge>
              <span className="font-semibold text-ink">
                {j.kind === 'SHEETS' ? 'Sheets' : 'Drive'}
              </span>
              <span className="text-sm">
                {j.status === 'QUEUED'
                  ? `runs after ${formatDateTime(j.runAfter, tz)}${j.attempt ? ` (retry ${j.attempt})` : ''}`
                  : formatDateTime(j.finishedAt ?? j.createdAt, tz)}
              </span>
              {j.summary && <span className="text-sm">{j.summary}</span>}
              {j.error && <span className="text-sm">{j.error}</span>}
            </li>
          ))}
        </ul>
      </Card>

      <Dialog
        open={confirmOff}
        title="Disconnect Google"
        onClose={() => setConfirmOff(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmOff(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect
            </Button>
          </>
        }
      >
        <p>
          Syncing stops and the stored Google access is deleted. The spreadsheet and Drive files
          stay in your Google account untouched, and stop updating.
        </p>
      </Dialog>
    </>
  );
}
