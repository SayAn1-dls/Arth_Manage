import { useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyEvent } from '@arthakram/shared';
import { request } from '../../lib/api.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  FormErrorSummary,
  Input,
  Spinner,
  Textarea,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

interface Detail {
  membershipId: string;
  email: string;
  status: string;
  membershipStatus: string;
  registration: {
    fullName: string;
    phone: string | null;
    institution: string;
    course: string | null;
    yearOfStudy: string | null;
    certificateName: string;
    answers: Record<string, string | number | boolean>;
    version: number;
    registeredAt: string;
  } | null;
  team: { id: string; teamCode: string; name: string; role: string } | null;
  fields: {
    id: string;
    label: string;
    type: string;
    options: string[];
    required: boolean;
    hidden: boolean;
  }[];
}

export function ParticipantDetailPage() {
  const mine = useOutletContext<MyEvent>();
  const { membershipId = '' } = useParams();
  const q = useQuery({
    queryKey: ['participant', mine.eventId, membershipId],
    queryFn: () => request<Detail>('GET', `/events/${mine.eventId}/participants/${membershipId}`),
  });
  if (q.isPending) return <Spinner label="Loading participant" />;
  if (q.isError || !q.data.registration)
    return <Alert tone="error" title="We couldn't find that participant" />;
  return <Editor key={q.data.registration.version} d={q.data} eventId={mine.eventId} />;
}

function Editor({ d, eventId }: { d: Detail; eventId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const errors = useFormErrors();
  const reg = d.registration!;
  const [r, setR] = useState({
    fullName: reg.fullName,
    phone: reg.phone ?? '',
    institution: reg.institution,
    course: reg.course ?? '',
    yearOfStudy: reg.yearOfStudy ?? '',
    certificateName: reg.certificateName,
    answers: reg.answers,
  });
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { version: reg.version };
      const orig: Record<string, unknown> = {
        fullName: reg.fullName,
        phone: reg.phone ?? '',
        institution: reg.institution,
        course: reg.course ?? '',
        yearOfStudy: reg.yearOfStudy ?? '',
        certificateName: reg.certificateName,
      };
      for (const [k, v] of Object.entries(r)) {
        if (k === 'answers') {
          if (JSON.stringify(v) !== JSON.stringify(reg.answers)) body.answers = v;
        } else if (v !== orig[k]) body[k] = v === '' ? null : v;
      }
      return request('PATCH', `/events/${eventId}/participants/${d.membershipId}`, body);
    },
    onSuccess: async () => {
      errors.clear();
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['participant', eventId, d.membershipId] });
    },
    onError: errors.capture,
  });
  const remove = useMutation({
    mutationFn: () =>
      request('POST', `/events/${eventId}/participants/${d.membershipId}/remove`, { reason }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['participants', eventId] });
      navigate('..');
    },
    onError: (e) => {
      setRemoving(false);
      errors.capture(e);
    },
  });
  const set = (patch: Partial<typeof r>) => {
    setSaved(false);
    setR((x) => ({ ...x, ...patch }));
  };
  const removed = d.membershipStatus === 'REMOVED';

  return (
    <div className="flex flex-col gap-4">
      <Link to=".." className="text-sm">
        Back to participants
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h2>{reg.fullName}</h2>
        <Badge tone={removed ? 'error' : 'info'}>{d.status}</Badge>
      </div>
      <p>
        {d.email} ·{' '}
        {d.team ? (
          <>
            in{' '}
            <Link to={`../../teams/${d.team.id}`}>
              {d.team.teamCode} {d.team.name}
            </Link>{' '}
            ({d.team.role.toLowerCase()})
          </>
        ) : (
          'not in a team'
        )}
      </p>
      {errors.formError && <Alert tone="error" title={errors.formError} />}
      <Card footerLabel="Registration record">
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            errors.clear();
            save.mutate();
          }}
        >
          <FormErrorSummary
            issues={errors.issues({
              fullName: 'pd-name',
              phone: 'pd-phone',
              institution: 'pd-inst',
              certificateName: 'pd-cert',
            })}
          />
          <Input
            id="pd-name"
            label="Full name"
            value={r.fullName}
            onChange={(e) => set({ fullName: e.target.value })}
            error={errors.fields.fullName}
          />
          <Input
            label="Email (login)"
            value={d.email}
            readOnly
            hint="The login email can't be changed in this version."
          />
          <Input
            id="pd-phone"
            label="Phone"
            value={r.phone}
            onChange={(e) => set({ phone: e.target.value })}
            error={errors.fields.phone}
          />
          <Input
            id="pd-inst"
            label="Institution"
            value={r.institution}
            onChange={(e) => set({ institution: e.target.value })}
            error={errors.fields.institution}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Course"
              value={r.course}
              onChange={(e) => set({ course: e.target.value })}
            />
            <Input
              label="Year of study"
              value={r.yearOfStudy}
              onChange={(e) => set({ yearOfStudy: e.target.value })}
            />
          </div>
          <Input
            id="pd-cert"
            label="Name on certificate"
            value={r.certificateName}
            onChange={(e) => set({ certificateName: e.target.value })}
            error={errors.fields.certificateName}
          />
          {d.fields.map((f) => (
            <Input
              key={f.id}
              label={`${f.label}${f.hidden ? ' (hidden from registration)' : ''}`}
              value={String(r.answers[f.id] ?? '')}
              onChange={(e) => set({ answers: { ...r.answers, [f.id]: e.target.value } })}
              error={errors.fields[`answers.${f.id}`]}
            />
          ))}
          <div className="flex items-center gap-3">
            <Button type="submit" loading={save.isPending}>
              Save correction
            </Button>
            {saved && (
              <span role="status" className="text-sm font-semibold text-success-fg">
                Saved and added to the audit history
              </span>
            )}
          </div>
        </form>
      </Card>
      {!removed && (
        <div>
          <Button variant="danger" onClick={() => setRemoving(true)}>
            Remove from event
          </Button>
        </div>
      )}
      <Dialog
        open={removing}
        title="Remove this participant?"
        onClose={() => setRemoving(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRemoving(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => remove.mutate()}
              loading={remove.isPending}
              disabled={reason.trim().length < 3}
            >
              Remove
            </Button>
          </>
        }
      >
        <p>
          They leave their team, lose access to the event from their next request, and are excluded
          from certificates. Their record stays for the audit history.
        </p>
        <div className="mt-3">
          <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Dialog>
    </div>
  );
}
