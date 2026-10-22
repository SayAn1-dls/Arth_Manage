import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, Upload } from 'lucide-react';
import {
  CERT_FONTS,
  FIELD_LABEL,
  ordinal,
  type CertField,
  type CertType,
  type MyEvent,
} from '@arthakram/shared';
import { ApiError } from '../../lib/api.js';
import { engageApi, type CertTemplateDto, type CertificateDto } from '../../lib/engage.js';
import { useFormErrors } from '../auth/useFormErrors.js';
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
  Table,
  TBody,
  Td,
  THead,
  Th,
  Tr,
  Textarea,
} from '../../ui/index.js';

const TYPE_LABEL: Record<CertType, string> = {
  PARTICIPATION: 'Participation',
  WINNER: 'Winner',
};
const STATUS: Record<
  CertificateDto['status'],
  { label: string; tone: 'info' | 'success' | 'warning' | 'error' }
> = {
  GENERATED: { label: 'Generated', tone: 'info' },
  RELEASED: { label: 'Released', tone: 'success' },
  REVOKED: { label: 'Revoked', tone: 'error' },
  FLAGGED: { label: 'No longer eligible', tone: 'warning' },
  NEEDS_REGENERATION: { label: 'Name changed', tone: 'warning' },
};

/** Certificate templates, generation, review, release and name corrections (PRD Module I). */
export function CertificatesAdminPage() {
  const mine = useOutletContext<MyEvent>();
  const [type, setType] = useState<CertType>('PARTICIPATION');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>Certificates</h2>
        <a
          href={`/api/v1/events/${mine.eventId}/certificates/export.csv`}
          className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-strong bg-white px-5 font-bold text-ink no-underline hover:bg-blush"
        >
          <Download aria-hidden className="size-4" /> Export CSV
        </a>
      </div>
      <p>
        Design the certificate, generate them, check the list, then release. Nobody can download a
        certificate until you release it.
      </p>
      <div className="w-60">
        <Select
          label="Certificate type"
          value={type}
          onChange={(e) => setType(e.target.value as CertType)}
        >
          <option value="PARTICIPATION">Participation</option>
          <option value="WINNER">Winner</option>
        </Select>
      </div>
      <TemplateCard key={`t-${type}`} eventId={mine.eventId} type={type} />
      <GenerateCard key={`g-${type}`} eventId={mine.eventId} type={type} />
      <ReviewCard key={`r-${type}`} eventId={mine.eventId} type={type} />
      <CorrectionsCard eventId={mine.eventId} />
    </div>
  );
}

async function openPreview(eventId: string, type: CertType, useLongestName: boolean) {
  const res = await fetch(`/api/v1/events/${eventId}/certificates/templates/${type}/preview`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'arthakram' },
    body: JSON.stringify({ useLongestName }),
  });
  if (!res.ok) throw new Error('The preview could not be created');
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
}

function TemplateCard({ eventId, type }: { eventId: string; type: CertType }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const q = useQuery({
    queryKey: ['cert-templates', eventId],
    queryFn: () => engageApi.templates(eventId),
  });
  const t = q.data?.templates.find((x) => x.type === type);
  if (q.isPending) return <Spinner label="Loading template" />;
  if (!t) return <Alert tone="error" title="We couldn't load the template" />;
  return (
    <TemplateForm
      key={t.version}
      eventId={eventId}
      template={t}
      errors={errors}
      onSaved={() => qc.invalidateQueries({ queryKey: ['cert-templates', eventId] })}
    />
  );
}

function TemplateForm({
  eventId,
  template,
  errors,
  onSaved,
}: {
  eventId: string;
  template: CertTemplateDto;
  errors: ReturnType<typeof useFormErrors>;
  onSaved: () => Promise<unknown>;
}) {
  const [fields, setFields] = useState(template.fields);
  const [awards, setAwards] = useState<Record<string, string>>(template.awardTexts);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const type = template.type;
  const patch = (i: number, p: Partial<CertTemplateDto['fields'][number]>) => {
    setNotice(null);
    setFields((all) => all.map((f, j) => (j === i ? { ...f, ...p } : f)));
  };
  const save = useMutation({
    mutationFn: () =>
      engageApi.saveTemplate(eventId, type, {
        fields,
        awardTexts: Object.fromEntries(Object.entries(awards).filter(([, v]) => v.trim())),
      }),
    onSuccess: async () => {
      errors.clear();
      setNotice(
        'Template saved. Certificates already generated keep their old design until you regenerate.',
      );
      await onSaved();
    },
    onError: errors.capture,
  });
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const res = await fetch(
        `/api/v1/events/${eventId}/certificates/templates/${type}/background`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Requested-With': 'arthakram',
            'X-Filename': f.name,
          },
          body: f,
        },
      );
      const body = (await res.json().catch(() => null)) as {
        warning?: string | null;
        error?: { message?: string };
      } | null;
      if (!res.ok)
        throw new ApiError(res.status, 'upload', body?.error?.message ?? 'The upload failed');
      return body;
    },
    onSuccess: async (b) => {
      errors.clear();
      setWarning(b?.warning ?? null);
      await onSaved();
    },
    onError: errors.capture,
  });
  return (
    <Card footerLabel={`${TYPE_LABEL[type]} template`}>
      <h3>Design</h3>
      <p className="mt-2">
        Upload a background (PNG or JPG, A4 landscape, 2480 × 1754 px recommended) or use the
        Arthakram default. Then place the text. Positions are percentages of the page, measured from
        the top-left.
      </p>
      {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      {warning && <Alert className="mt-3" tone="warning" title={warning} />}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          aria-label="Certificate background image"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = '';
          }}
        />
        <Button
          variant="secondary"
          loading={upload.isPending}
          icon={<Upload aria-hidden className="size-4" />}
          onClick={() => file.current?.click()}
        >
          {template.hasBackground ? 'Replace background' : 'Upload background'}
        </Button>
        <span className="text-sm">
          {template.hasBackground
            ? `Using ${template.backgroundName ?? 'your image'}`
            : 'Using the default Arthakram design'}
        </span>
      </div>
      <div className="mt-5 flex flex-col gap-3">
        {fields.map((f, i) => (
          <fieldset key={f.field} className="rounded-card border border-line bg-paper p-3">
            <legend className="px-1 font-bold text-ink">{FIELD_LABEL[f.field as CertField]}</legend>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Input
                label="Across %"
                type="number"
                min={0}
                max={100}
                value={Math.round(f.x * 100)}
                onChange={(e) => patch(i, { x: Number(e.target.value) / 100 })}
              />
              <Input
                label="Down %"
                type="number"
                min={0}
                max={100}
                value={Math.round(f.y * 100)}
                onChange={(e) => patch(i, { y: Number(e.target.value) / 100 })}
              />
              <Input
                label="Width %"
                type="number"
                min={10}
                max={100}
                value={Math.round(f.maxWidth * 100)}
                onChange={(e) => patch(i, { maxWidth: Number(e.target.value) / 100 })}
              />
              <Input
                label="Size"
                type="number"
                min={8}
                max={120}
                value={f.size}
                onChange={(e) => patch(i, { size: Number(e.target.value) })}
              />
              <Select
                label="Font"
                value={f.font}
                onChange={(e) => patch(i, { font: e.target.value })}
              >
                {CERT_FONTS.map((x) => (
                  <option key={x} value={x}>
                    {x === 'display' ? 'Display' : x === 'sans' ? 'Regular' : 'Bold'}
                  </option>
                ))}
              </Select>
              <Select
                label="Align"
                value={f.align}
                onChange={(e) => patch(i, { align: e.target.value })}
              >
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
              </Select>
              <Input
                label="Colour"
                value={f.color}
                onChange={(e) => patch(i, { color: e.target.value })}
                error={errors.fields[`fields.${i}.color`]}
              />
            </div>
          </fieldset>
        ))}
        {errors.fields.fields && (
          <p className="text-sm font-semibold text-error-fg">{errors.fields.fields}</p>
        )}
      </div>
      {type === 'WINNER' && (
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <Input
              key={n}
              label={`Award text for ${ordinal(n)} place`}
              placeholder={`${ordinal(n)} Place`}
              maxLength={80}
              value={awards[String(n)] ?? ''}
              onChange={(e) => {
                setNotice(null);
                setAwards((a) => ({ ...a, [String(n)]: e.target.value }));
              }}
            />
          ))}
        </div>
      )}
      {notice && <Alert className="mt-4" tone="success" title={notice} />}
      <div className="mt-5 flex flex-wrap gap-3">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Save template
        </Button>
        <Button
          variant="secondary"
          loading={previewing}
          icon={<Eye aria-hidden className="size-4" />}
          onClick={async () => {
            setPreviewing(true);
            try {
              await openPreview(eventId, type, false);
            } catch (e) {
              errors.capture(e);
            } finally {
              setPreviewing(false);
            }
          }}
        >
          Preview with a sample name
        </Button>
        <Button
          variant="secondary"
          onClick={() => openPreview(eventId, type, true).catch(errors.capture)}
        >
          Preview with the longest real name
        </Button>
      </div>
      <p className="mt-2 text-sm">
        Save before previewing. The preview is watermarked and is not a real certificate.
      </p>
    </Card>
  );
}

function GenerateCard({ eventId, type }: { eventId: string; type: CertType }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [jobId, setJobId] = useState<string | null>(null);
  const el = useQuery({
    queryKey: ['cert-eligibility', eventId, type],
    queryFn: () => engageApi.eligibility(eventId, type),
  });
  const job = useQuery({
    queryKey: ['cert-job', eventId, jobId],
    queryFn: () => engageApi.job(eventId, jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 1000 : false),
  });
  const finished = job.data && job.data.status !== 'RUNNING';
  useEffect(() => {
    if (finished) {
      void qc.invalidateQueries({ queryKey: ['cert-list', eventId] });
      void qc.invalidateQueries({ queryKey: ['cert-eligibility', eventId, type] });
    }
  }, [finished, qc, eventId, type]);
  const generate = useMutation({
    mutationFn: () => engageApi.generate(eventId, type),
    onSuccess: (r) => {
      errors.clear();
      setJobId(r.jobId);
    },
    onError: errors.capture,
  });
  const running = job.data?.status === 'RUNNING';
  return (
    <Card footerLabel="Generate">
      <h3>Generate {TYPE_LABEL[type].toLowerCase()} certificates</h3>
      {el.data && (
        <p className="mt-2">
          <strong>{el.data.eligible}</strong> {el.data.eligible === 1 ? 'person is' : 'people are'}{' '}
          eligible and <strong>{el.data.existing}</strong> certificate
          {el.data.existing === 1 ? ' has' : 's have'} been generated. Running this again only adds
          people who are missing, and never creates duplicates.
        </p>
      )}
      {type === 'PARTICIPATION' && (
        <p className="mt-1 text-sm">
          Who counts as a participant is set under Setup (submitted in the first round, or checked
          in).
        </p>
      )}
      {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      {job.data && (
        <div className="mt-3" role="status" aria-live="polite">
          <progress
            className="h-3 w-full accent-ember"
            value={job.data.done + job.data.failed}
            max={Math.max(job.data.total, 1)}
          />
          <p className="mt-1 text-sm">
            {running && `Generating ${job.data.done} of ${job.data.total}…`}
            {job.data.status === 'DONE' &&
              `Done: ${job.data.done} generated${job.data.failed ? `, ${job.data.failed} failed` : ''}.`}
            {job.data.status === 'FAILED' &&
              `It stopped early: ${job.data.error ?? 'unknown error'}.`}
          </p>
        </div>
      )}
      <Button
        className="mt-4"
        onClick={() => generate.mutate()}
        loading={generate.isPending || running}
      >
        Generate certificates
      </Button>
    </Card>
  );
}

type Dialogs = { kind: 'revoke'; cert: CertificateDto } | { kind: 'release' } | null;

function ReviewCard({ eventId, type }: { eventId: string; type: CertType }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const qs = new URLSearchParams({ type, status, q: search }).toString();
  const list = useQuery({
    queryKey: ['cert-list', eventId, qs],
    queryFn: () => engageApi.certificates(eventId, qs),
    placeholderData: (p) => p,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['cert-list', eventId] });
  const close = () => {
    setDialog(null);
    setReason('');
    setReviewed(false);
  };
  const run = <A,>(fn: (a: A) => Promise<unknown>, msg?: string) => ({
    mutationFn: fn,
    onSuccess: async () => {
      errors.clear();
      setNotice(msg ?? null);
      close();
      await refresh();
    },
    onError: (e: unknown) => {
      close();
      errors.capture(e);
    },
  });
  const revoke = useMutation(
    run((id: string) => engageApi.revoke(eventId, id, reason), 'Certificate revoked.'),
  );
  const unrevoke = useMutation(
    run((id: string) => engageApi.unrevoke(eventId, id), 'Certificate restored.'),
  );
  const ack = useMutation(
    run((id: string) => engageApi.acknowledge(eventId, id), 'Flag acknowledged.'),
  );
  const regen = useMutation(
    run(
      (id: string) => engageApi.regenerate(eventId, id),
      'Certificate regenerated with the current name.',
    ),
  );
  const release = useMutation({
    mutationFn: () => engageApi.release(eventId, type),
    onSuccess: async (r) => {
      errors.clear();
      setNotice(
        `Released ${r.released} certificate${r.released === 1 ? '' : 's'}. People can now download them.`,
      );
      close();
      await refresh();
    },
    onError: (e) => {
      close();
      errors.capture(e);
    },
  });
  const rows = list.data?.certificates ?? [];
  const pending = rows.filter((r) => r.status === 'GENERATED').length;
  const blocking = rows.filter(
    (r) => r.status === 'FLAGGED' || r.status === 'NEEDS_REGENERATION',
  ).length;
  return (
    <Card footerLabel="Review and release">
      <h3>Review and release</h3>
      <p className="mt-2">
        {rows.length} certificate{rows.length === 1 ? '' : 's'} · {pending} waiting for release
        {blocking > 0 && ` · ${blocking} need your attention before release`}
      </p>
      {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      {notice && <Alert className="mt-3" tone="success" title={notice} />}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Input
          label="Search name or ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {Object.entries(STATUS).map(([v, s]) => (
            <option key={v} value={v}>
              {s.label}
            </option>
          ))}
        </Select>
        <div className="flex items-end">
          <Button
            disabled={pending === 0 && blocking === 0}
            onClick={() => setDialog({ kind: 'release' })}
          >
            Release to recipients
          </Button>
        </div>
      </div>
      {list.isPending && <Spinner label="Loading certificates" />}
      {list.data && rows.length === 0 && (
        <div className="mt-4">
          <EmptyState title="No certificates yet">
            Generate them above, then review the list here.
          </EmptyState>
        </div>
      )}
      {rows.length > 0 && (
        <div className="mt-4">
          <Table caption={`${TYPE_LABEL[type]} certificates`}>
            <THead>
              <tr>
                <Th>Name</Th>
                <Th>ID</Th>
                <Th>Award</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-semibold text-ink">
                    {c.name}
                    {c.teamName && <span className="block text-xs font-normal">{c.teamName}</span>}
                  </Td>
                  <Td>
                    {c.code} <span className="text-xs">v{c.version}</span>
                  </Td>
                  <Td>{c.awardText ?? '–'}</Td>
                  <Td>
                    <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                    {(c.flaggedReason || c.revokedReason) && (
                      <span className="mt-1 block text-xs">
                        {c.flaggedReason ?? c.revokedReason}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <a
                        className="inline-flex min-h-11 items-center rounded-pill border border-line-strong bg-white px-4 font-bold text-ink no-underline hover:bg-blush"
                        href={`/api/v1/events/${eventId}/certificates/${c.id}/pdf`}
                        aria-label={`Download certificate for ${c.name}`}
                      >
                        PDF
                      </a>
                      {c.status === 'NEEDS_REGENERATION' && (
                        <Button variant="secondary" onClick={() => regen.mutate(c.id)}>
                          Regenerate
                        </Button>
                      )}
                      {c.status === 'FLAGGED' && (
                        <Button variant="secondary" onClick={() => ack.mutate(c.id)}>
                          Keep anyway
                        </Button>
                      )}
                      {c.status === 'REVOKED' ? (
                        <Button variant="secondary" onClick={() => unrevoke.mutate(c.id)}>
                          Restore
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => setDialog({ kind: 'revoke', cert: c })}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      <Dialog
        open={dialog?.kind === 'revoke'}
        title="Revoke this certificate"
        onClose={close}
        actions={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={revoke.isPending}
              onClick={() => dialog?.kind === 'revoke' && revoke.mutate(dialog.cert.id)}
            >
              Revoke certificate
            </Button>
          </>
        }
      >
        <p>
          {dialog?.kind === 'revoke' ? dialog.cert.name : ''} will no longer be able to download it.
          You can restore it later.
        </p>
        <Textarea
          className="mt-3"
          label="Reason (recorded in the audit history)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={errors.fields.reason}
        />
      </Dialog>
      <Dialog
        open={dialog?.kind === 'release'}
        title={`Release ${TYPE_LABEL[type].toLowerCase()} certificates`}
        onClose={close}
        actions={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={!reviewed}
              loading={release.isPending}
              onClick={() => release.mutate()}
            >
              Release now
            </Button>
          </>
        }
      >
        <p>
          Everyone with a generated {TYPE_LABEL[type].toLowerCase()} certificate will be able to
          download it straight away. Names and awards cannot be changed silently afterwards, only
          through a recorded correction.
        </p>
        <Checkbox
          className="mt-3"
          label="I have reviewed the list and the preview"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />
      </Dialog>
    </Card>
  );
}

function CorrectionsCard({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const q = useQuery({
    queryKey: ['cert-corrections', eventId],
    queryFn: () => engageApi.corrections(eventId),
  });
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) =>
      engageApi.decide(eventId, v.id, v.approve, v.approve ? undefined : note),
    onSuccess: async () => {
      errors.clear();
      setDeclining(null);
      setNote('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['cert-corrections', eventId] }),
        qc.invalidateQueries({ queryKey: ['cert-list', eventId] }),
      ]);
    },
    onError: errors.capture,
  });
  const rows = q.data?.corrections ?? [];
  if (!rows.length) return null;
  return (
    <Card footerLabel="Name corrections">
      <h3>Name correction requests</h3>
      <p className="mt-2">
        Approving keeps the same certificate ID and issues a new version with the corrected name.
      </p>
      {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      <ul className="mt-4 flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-card border border-line bg-paper p-3">
            <p className="font-semibold text-ink">
              {r.currentName} → {r.requestedName}{' '}
              <span className="text-sm font-normal">({r.code})</span>
            </p>
            {r.status === 'PENDING' ? (
              declining === r.id ? (
                <div className="mt-2 flex flex-col gap-2">
                  <Input
                    label="Why is it declined?"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    error={errors.fields.note}
                  />
                  <div className="flex gap-2">
                    <Button onClick={() => decide.mutate({ id: r.id, approve: false })}>
                      Decline request
                    </Button>
                    <Button variant="secondary" onClick={() => setDeclining(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <Button
                    onClick={() => decide.mutate({ id: r.id, approve: true })}
                    loading={decide.isPending}
                  >
                    Approve and regenerate
                  </Button>
                  <Button variant="secondary" onClick={() => setDeclining(r.id)}>
                    Decline
                  </Button>
                </div>
              )
            ) : (
              <p className="mt-1 text-sm">
                <Badge tone={r.status === 'APPROVED' ? 'success' : 'warning'}>
                  {r.status.toLowerCase()}
                </Badge>{' '}
                {r.decisionNote}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
