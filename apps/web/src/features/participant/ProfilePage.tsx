import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyEvent } from '@arthakram/shared';
import { participantApi, type MyRegistration } from '../../lib/participant.js';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  FormErrorSummary,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

/** The participant's own registration details (PRD FR-056): all editable while open, phone and certificate name after. */
export function ProfilePage() {
  const mine = useOutletContext<MyEvent>();
  const q = useQuery({
    queryKey: ['my-registration', mine.eventId],
    queryFn: () => participantApi.myRegistration(mine.eventId),
  });
  if (q.isPending) return <Spinner label="Loading your details" />;
  if (q.isError) return <Alert tone="error" title="We couldn't load your registration" />;
  return <ProfileForm key={q.data.registration.version} data={q.data} eventId={mine.eventId} />;
}

function ProfileForm({ data, eventId }: { data: MyRegistration; eventId: string }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [r, setR] = useState(data.registration);
  const [saved, setSaved] = useState(false);
  const mode = data.editable;
  const can = (k: string) =>
    mode === 'all' ||
    (mode === 'phone_and_certificate_name' && (k === 'phone' || k === 'certificateName'));
  const set = (patch: Partial<typeof r>) => {
    setSaved(false);
    setR((x) => ({ ...x, ...patch }));
  };
  const save = useMutation({
    mutationFn: () => {
      const original = data.registration;
      const body: Record<string, unknown> = { version: original.version };
      for (const k of [
        'fullName',
        'phone',
        'institution',
        'course',
        'yearOfStudy',
        'certificateName',
      ] as const) {
        if (r[k] !== original[k] && can(k)) body[k] = r[k] === '' ? null : r[k];
      }
      if (can('answers') && JSON.stringify(r.answers) !== JSON.stringify(original.answers))
        body.answers = r.answers;
      return participantApi.updateRegistration(eventId, body);
    },
    onSuccess: async () => {
      errors.clear();
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['my-registration', eventId] });
    },
    onError: errors.capture,
  });

  return (
    <div className="flex flex-col gap-4">
      <h2>My details</h2>
      {mode === 'phone_and_certificate_name' && (
        <Alert tone="info" title="Registration is closed">
          You can still update your phone number and the name on your certificate. Contact the
          organisers to correct anything else.
        </Alert>
      )}
      {mode === 'none' && (
        <Alert tone="info" title="Your certificate has been issued">
          Contact the organisers to correct your details.
        </Alert>
      )}
      <Card footerLabel="Registration details">
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            errors.clear();
            save.mutate();
          }}
        >
          {errors.formError && (
            <Alert tone="error" title={errors.formError}>
              {errors.code === 'stale_version' && (
                <Button
                  variant="secondary"
                  className="mt-2"
                  onClick={() => qc.invalidateQueries({ queryKey: ['my-registration', eventId] })}
                >
                  Reload latest
                </Button>
              )}
            </Alert>
          )}
          <FormErrorSummary
            issues={errors.issues({
              fullName: 'pf-name',
              phone: 'pf-phone',
              institution: 'pf-inst',
              certificateName: 'pf-cert',
            })}
          />
          <Input
            id="pf-name"
            label="Full name"
            required
            disabled={!can('fullName')}
            value={r.fullName}
            onChange={(e) => set({ fullName: e.target.value })}
            error={errors.fields.fullName}
          />
          <Input
            id="pf-phone"
            type="tel"
            label="Phone"
            disabled={!can('phone')}
            value={r.phone ?? ''}
            onChange={(e) => set({ phone: e.target.value })}
            error={errors.fields.phone}
          />
          <Input
            id="pf-inst"
            label="Institution"
            required
            disabled={!can('institution')}
            value={r.institution}
            onChange={(e) => set({ institution: e.target.value })}
            error={errors.fields.institution}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Course or programme"
              disabled={!can('course')}
              value={r.course ?? ''}
              onChange={(e) => set({ course: e.target.value })}
            />
            <Input
              label="Year of study"
              disabled={!can('yearOfStudy')}
              value={r.yearOfStudy ?? ''}
              onChange={(e) => set({ yearOfStudy: e.target.value })}
            />
          </div>
          <Input
            id="pf-cert"
            label="Name on certificate"
            hint="Check the spelling. This is printed exactly as written."
            disabled={!can('certificateName')}
            value={r.certificateName}
            onChange={(e) => set({ certificateName: e.target.value })}
            error={errors.fields.certificateName}
          />
          {data.fields.map((f) => {
            const v = r.answers[f.id];
            const setAnswer = (val: string | number | boolean) =>
              set({ answers: { ...r.answers, [f.id]: val } });
            const base = {
              label: f.label,
              hint: f.helpText ?? undefined,
              required: f.required,
              disabled: !can('answers'),
              error: errors.fields[`answers.${f.id}`],
            };
            if (f.type === 'CHECKBOX')
              return (
                <Checkbox
                  key={f.id}
                  label={f.label}
                  disabled={!can('answers')}
                  checked={v === true}
                  onChange={(e) => setAnswer(e.target.checked)}
                />
              );
            if (f.type === 'SELECT')
              return (
                <Select
                  key={f.id}
                  {...base}
                  value={String(v ?? '')}
                  onChange={(e) => setAnswer(e.target.value)}
                >
                  <option value="">Choose one</option>
                  {f.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </Select>
              );
            if (f.type === 'LONG_TEXT')
              return (
                <Textarea
                  key={f.id}
                  {...base}
                  value={String(v ?? '')}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              );
            return (
              <Input
                key={f.id}
                {...base}
                type={f.type === 'NUMBER' ? 'number' : f.type === 'URL' ? 'url' : 'text'}
                value={String(v ?? '')}
                onChange={(e) => setAnswer(e.target.value)}
              />
            );
          })}
          {mode !== 'none' && (
            <div className="flex items-center gap-3">
              <Button type="submit" loading={save.isPending}>
                Save changes
              </Button>
              {saved && (
                <span role="status" className="text-sm font-semibold text-success-fg">
                  Saved
                </span>
              )}
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}
