import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../lib/api.js';
import { participantApi, type PublicForm } from '../../lib/participant.js';
import { AuthLayout } from '../../shell/AuthLayout.js';
import { useSession } from '../../shell/session.js';
import {
  Alert,
  Button,
  Checkbox,
  FormErrorSummary,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

/** Registration replaces the Google Form (PRD FR-051). Requires sign-in; the landing page sends people here. */
export function RegisterForEventPage() {
  const { slug = '' } = useParams();
  const { user, loading } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const errors = useFormErrors();
  const form = useQuery({
    queryKey: ['reg-form', slug],
    queryFn: () => participantApi.publicForm(slug),
    retry: false,
  });
  const event = useQuery({
    queryKey: ['public-event', slug],
    queryFn: () => request<{ event: { name: string } }>('GET', `/public/events/${slug}`),
  });
  const me = useQuery({
    queryKey: ['public-me', slug],
    queryFn: () => participantApi.publicMe(slug),
    enabled: Boolean(user),
  });
  const [busy, setBusy] = useState(false);
  const [ticks, setTicks] = useState<boolean[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});

  if (loading)
    return (
      <AuthLayout title="Register">
        <Spinner label="Loading" />
      </AuthLayout>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: `/e/${slug}/register` }} />;
  if (form.isPending || me.isPending || event.isPending)
    return (
      <AuthLayout title="Register">
        <Spinner label="Loading the form" />
      </AuthLayout>
    );
  if (form.isError)
    return (
      <AuthLayout title="Register">
        <Alert tone="error" title="We couldn't find that event" />
      </AuthLayout>
    );
  if (me.data?.registered) return <Navigate to={`/events/${me.data.eventId}/team`} replace />;
  const f: PublicForm = form.data;
  const fullName = user.name;
  const ids = {
    fullName: 'rg-name',
    institution: 'rg-inst',
    phone: 'rg-phone',
    declarations: 'rg-decl',
  };

  if (me.data?.role && me.data.role !== 'PARTICIPANT') {
    return (
      <AuthLayout title="You already have a role here">
        <Alert tone="info" title="A person can hold only one role per event.">
          You are part of this event as {me.data.role.toLowerCase()}.{' '}
          <Link to={`/events/${me.data.eventId}`}>Open the event</Link>.
        </Alert>
      </AuthLayout>
    );
  }
  if (f.registration !== 'OPEN') {
    return (
      <AuthLayout title="Registration">
        <Alert
          tone="warning"
          title={
            f.registration === 'CLOSED' ? 'Registration is closed' : 'Registration is not open yet'
          }
        >
          <Link to={`/e/${slug}`}>Back to the event page</Link>
        </Alert>
      </AuthLayout>
    );
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    errors.clear();
    setBusy(true);
    const d = new FormData(e.currentTarget);
    const v = (k: string) => String(d.get(k) ?? '').trim();
    try {
      const result = await participantApi.register(slug, {
        fullName: v('fullName'),
        phone: v('phone') || null,
        institution: v('institution'),
        course: v('course') || null,
        yearOfStudy: v('yearOfStudy') || null,
        certificateName: v('certificateName') || undefined,
        answers: Object.fromEntries(
          f.customFields
            .map((c) => [c.id, answers[c.id] ?? (c.type === 'CHECKBOX' ? false : '')])
            .filter(([, val]) => val !== ''),
        ),
        declarations: f.declarations.map((_, i) => ticks[i] ?? false),
      });
      qc.removeQueries({ queryKey: ['my-events'] });
      navigate(`/events/${result.eventId}/team`);
    } catch (err) {
      errors.capture(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={`Register for ${event.data?.event.name ?? 'the event'}`}
      intro={
        f.soloTeams
          ? 'This event is for individual participants.'
          : 'After you register you can create a team or join one with a code.'
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {errors.formError && <Alert tone="error" title={errors.formError} />}
        <FormErrorSummary
          issues={errors.issues({
            fullName: ids.fullName,
            institution: ids.institution,
            phone: ids.phone,
            declarations: ids.declarations,
            ...Object.fromEntries(f.customFields.map((c) => [`answers.${c.id}`, `cf-${c.id}`])),
          })}
        />
        <Input
          id={ids.fullName}
          name="fullName"
          label="Full name"
          required
          defaultValue={fullName}
          error={errors.fields.fullName}
        />
        <Input
          label="Email"
          value={user.email}
          readOnly
          hint="Your sign-in email. It cannot be changed here."
        />
        <Input
          id={ids.phone}
          name="phone"
          type="tel"
          label="Phone"
          hint="Optional. 7 to 15 digits, with an optional leading +."
          error={errors.fields.phone}
        />
        <Input
          id={ids.institution}
          name="institution"
          label="Institution"
          required
          error={errors.fields.institution}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input name="course" label="Course or programme" />
          <Input name="yearOfStudy" label="Year of study" />
        </div>
        <Input
          name="certificateName"
          label="Name on certificate"
          hint="Leave empty to use your full name."
          error={errors.fields.certificateName}
        />
        {f.customFields.map((c) => {
          const id = `cf-${c.id}`;
          const err = errors.fields[`answers.${c.id}`];
          const common = {
            id,
            label: c.label,
            hint: c.helpText ?? undefined,
            required: c.required,
            error: err,
          };
          if (c.type === 'LONG_TEXT')
            return (
              <Textarea
                key={c.id}
                {...common}
                onChange={(e) => setAnswers((a) => ({ ...a, [c.id]: e.target.value }))}
              />
            );
          if (c.type === 'SELECT')
            return (
              <Select
                key={c.id}
                {...common}
                defaultValue=""
                onChange={(e) => setAnswers((a) => ({ ...a, [c.id]: e.target.value }))}
              >
                <option value="">Choose one</option>
                {c.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            );
          if (c.type === 'CHECKBOX')
            return (
              <Checkbox
                key={c.id}
                id={id}
                label={c.label}
                hint={c.helpText ?? undefined}
                onChange={(e) => setAnswers((a) => ({ ...a, [c.id]: e.target.checked }))}
              />
            );
          return (
            <Input
              key={c.id}
              {...common}
              type={c.type === 'NUMBER' ? 'number' : c.type === 'URL' ? 'url' : 'text'}
              onChange={(e) => setAnswers((a) => ({ ...a, [c.id]: e.target.value }))}
            />
          );
        })}
        {f.declarations.length > 0 && (
          <fieldset id={ids.declarations} className="flex flex-col gap-3 rounded-card bg-blush p-4">
            <legend className="px-1 text-sm font-bold text-ink">Please confirm</legend>
            {f.declarations.map((text, i) => (
              <Checkbox
                key={i}
                label={text}
                checked={ticks[i] ?? false}
                onChange={(e) =>
                  setTicks((t) => {
                    const n = [...t];
                    n[i] = e.target.checked;
                    return n;
                  })
                }
              />
            ))}
            {errors.fields.declarations && (
              <p className="text-sm font-semibold text-error-fg">{errors.fields.declarations}</p>
            )}
          </fieldset>
        )}
        <p className="text-sm">
          We collect these details to run the event. Organisers can see your email and phone;
          teammates see your email; judges see only your name and institution.
        </p>
        <Button type="submit" loading={busy}>
          Register
        </Button>
      </form>
    </AuthLayout>
  );
}
