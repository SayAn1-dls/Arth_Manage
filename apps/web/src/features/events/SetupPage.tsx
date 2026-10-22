import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventDto, MyEvent } from '@arthakram/shared';
import { ApiError } from '../../lib/api.js';
import { eventApi, MODE_LABEL, TIME_ZONES, TYPE_LABEL, useEvent } from '../../lib/events.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DateTimeField,
  Dialog,
  FormErrorSummary,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';
import { RegistrationFieldsCard } from '../admin/FormEditors.js';

type Draft = Pick<
  EventDto,
  | 'name'
  | 'type'
  | 'mode'
  | 'startsAt'
  | 'endsAt'
  | 'timeZone'
  | 'institution'
  | 'contactEmail'
  | 'venue'
  | 'description'
  | 'eligibility'
  | 'teamMin'
  | 'teamMax'
  | 'declarations'
  | 'trackRequired'
  | 'showWinners'
  | 'showOwnRank'
  | 'showOwnScores'
>;

const fromEvent = (e: EventDto): Draft => ({
  name: e.name,
  type: e.type,
  mode: e.mode,
  startsAt: e.startsAt,
  endsAt: e.endsAt,
  timeZone: e.timeZone,
  institution: e.institution,
  contactEmail: e.contactEmail,
  venue: e.venue,
  description: e.description,
  eligibility: e.eligibility,
  teamMin: e.teamMin,
  teamMax: e.teamMax,
  declarations: e.declarations,
  trackRequired: e.trackRequired,
  showWinners: e.showWinners,
  showOwnRank: e.showOwnRank,
  showOwnScores: e.showOwnScores,
});

const FIELD_IDS: Record<string, string> = {
  name: 'su-name',
  startsAt: 'su-start',
  endsAt: 'su-end',
  institution: 'su-inst',
  contactEmail: 'su-email',
  description: 'su-desc',
  teamMin: 'su-min',
  teamMax: 'su-max',
  declarations: 'su-decl',
  eligibility: 'su-elig',
};

export function SetupPage() {
  const mine = useOutletContext<MyEvent>();
  const event = useEvent(mine.eventId);
  if (event.isPending) return <Spinner label="Loading setup" />;
  if (event.isError || !event.data)
    return <Alert tone="error" title="We couldn't load the event setup" />;
  return (
    <div className="flex flex-col gap-6">
      <h2>Setup</h2>
      <PublicationCard event={event.data} />
      <DetailsForm key={event.data.version} event={event.data} />
      <RegistrationFieldsCard eventId={event.data.id} />
      <LifecycleCard event={event.data} />
    </div>
  );
}

function DetailsForm({ event }: { event: EventDto }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [draft, setDraft] = useState<Draft>(fromEvent(event));
  const [confirmDates, setConfirmDates] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const save = useMutation({
    mutationFn: (confirmDateChange: boolean) => {
      const original = fromEvent(event);
      const patch: Record<string, unknown> = { version: event.version };
      (Object.keys(draft) as (keyof Draft)[]).forEach((k) => {
        if (JSON.stringify(draft[k]) !== JSON.stringify(original[k])) patch[k] = draft[k];
      });
      if (confirmDateChange) patch.confirmDateChange = true;
      return eventApi.update(event.id, patch);
    },
    onSuccess: async () => {
      errors.clear();
      setSaved(true);
      setConfirmDates(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['event', event.id] }),
        qc.invalidateQueries({ queryKey: ['my-events'] }),
      ]);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'confirm_date_change')
        return setConfirmDates(e.message);
      errors.capture(e);
    },
  });

  const declarationsText = draft.declarations.join('\n');

  return (
    <Card footerLabel="Event details and rules">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          errors.clear();
          save.mutate(false);
        }}
      >
        <h3>Details</h3>
        {errors.formError && (
          <Alert tone="error" title={errors.formError}>
            {errors.code === 'stale_version' && (
              <Button
                variant="secondary"
                className="mt-2"
                onClick={() => qc.invalidateQueries({ queryKey: ['event', event.id] })}
              >
                Reload latest
              </Button>
            )}
          </Alert>
        )}
        <FormErrorSummary issues={errors.issues(FIELD_IDS)} />
        <Input
          id="su-name"
          label="Event name"
          required
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.fields.name}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Type"
            value={draft.type}
            onChange={(e) => set('type', e.target.value as Draft['type'])}
          >
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select
            label="Mode"
            value={draft.mode}
            onChange={(e) => set('mode', e.target.value as Draft['mode'])}
          >
            {Object.entries(MODE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select
            label="Time zone"
            value={draft.timeZone}
            onChange={(e) => set('timeZone', e.target.value)}
          >
            {TIME_ZONES.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <DateTimeField
            id="su-start"
            label="Starts"
            required
            value={draft.startsAt}
            timeZone={draft.timeZone}
            onChange={(v) => v && set('startsAt', v)}
            error={errors.fields.startsAt}
          />
          <DateTimeField
            id="su-end"
            label="Ends"
            required
            value={draft.endsAt}
            timeZone={draft.timeZone}
            onChange={(v) => v && set('endsAt', v)}
            error={errors.fields.endsAt}
          />
        </div>
        <Input
          id="su-inst"
          label="Organising institution"
          required
          value={draft.institution}
          onChange={(e) => set('institution', e.target.value)}
          error={errors.fields.institution}
        />
        <Input
          id="su-email"
          type="email"
          label="Contact email"
          required
          value={draft.contactEmail}
          onChange={(e) => set('contactEmail', e.target.value)}
          error={errors.fields.contactEmail}
        />
        <Input
          label="Venue"
          value={draft.venue ?? ''}
          onChange={(e) => set('venue', e.target.value || null)}
          error={errors.fields.venue}
        />
        <Textarea
          id="su-desc"
          label="Short description"
          maxLength={300}
          value={draft.description ?? ''}
          onChange={(e) => set('description', e.target.value || null)}
          error={errors.fields.description}
        />

        <h3 className="mt-4">Teams and eligibility</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="su-min"
            type="number"
            min={1}
            max={10}
            label="Minimum team size"
            value={draft.teamMin}
            onChange={(e) => set('teamMin', Number(e.target.value))}
            error={errors.fields.teamMin}
          />
          <Input
            id="su-max"
            type="number"
            min={1}
            max={10}
            label="Maximum team size"
            hint="With a maximum of 1, each registrant becomes a solo team."
            value={draft.teamMax}
            onChange={(e) => set('teamMax', Number(e.target.value))}
            error={errors.fields.teamMax}
          />
        </div>
        <Textarea
          id="su-decl"
          label="Participant declarations"
          hint="One per line, up to five. Participants must tick each one when registering."
          value={declarationsText}
          onChange={(e) =>
            set(
              'declarations',
              e.target.value
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean),
            )
          }
          error={errors.fields.declarations}
        />
        <Textarea
          id="su-elig"
          label="Eligibility notes"
          hint="Shown on the event page. Detailed rules belong in the guidebook."
          value={draft.eligibility ?? ''}
          onChange={(e) => set('eligibility', e.target.value || null)}
          error={errors.fields.eligibility}
        />
        <Checkbox
          label="Teams must choose a track"
          hint="Only applies when tracks exist."
          checked={draft.trackRequired}
          onChange={(e) => set('trackRequired', e.target.checked)}
        />

        <h3 className="mt-4">What teams see when results are published</h3>
        <Checkbox
          label="Show the winners list"
          checked={draft.showWinners}
          onChange={(e) => set('showWinners', e.target.checked)}
        />
        <Checkbox
          label="Show each team its own rank"
          checked={draft.showOwnRank}
          onChange={(e) => set('showOwnRank', e.target.checked)}
        />
        <Checkbox
          label="Show each team its own score"
          checked={draft.showOwnScores}
          onChange={(e) => set('showOwnScores', e.target.checked)}
        />

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
      </form>
      <Dialog
        open={confirmDates !== null}
        title="Change the event dates?"
        onClose={() => setConfirmDates(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmDates(null)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate(true)} loading={save.isPending}>
              Change dates
            </Button>
          </>
        }
      >
        <p>{confirmDates}</p>
      </Dialog>
    </Card>
  );
}

function PublicationCard({ event }: { event: EventDto }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const checks = useQuery({
    queryKey: ['publish-checks', event.id, event.version],
    queryFn: () => eventApi.checks(event.id),
    enabled: event.status === 'DRAFT',
  });
  const [notice, setNotice] = useState<string[]>([]);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['event', event.id] }),
      qc.invalidateQueries({ queryKey: ['my-events'] }),
    ]);
  const fail = (e: unknown) => errors.capture(e);

  const publish = useMutation({
    mutationFn: () => eventApi.publish(event.id),
    onSuccess: async (r) => {
      errors.clear();
      setNotice(r.warnings);
      await refresh();
    },
    onError: fail,
  });
  const unpublish = useMutation({
    mutationFn: () => eventApi.unpublish(event.id),
    onSuccess: async () => {
      errors.clear();
      await refresh();
    },
    onError: fail,
  });
  const registration = useMutation({
    mutationFn: (status: 'NOT_OPEN' | 'OPEN' | 'CLOSED') =>
      eventApi.setRegistration(event.id, {
        status,
        opensAt: event.registrationOpensAt,
        closesAt: event.registrationClosesAt,
      }),
    onSuccess: async () => {
      errors.clear();
      await refresh();
    },
    onError: fail,
  });
  const schedule = useMutation({
    mutationFn: (v: { opensAt: string | null; closesAt: string | null }) =>
      eventApi.setRegistration(event.id, { status: event.registrationStatus, ...v }),
    onSuccess: refresh,
    onError: fail,
  });

  const statusTone = {
    DRAFT: 'info',
    PUBLISHED: 'success',
    CONCLUDED: 'warning',
    ARCHIVED: 'info',
  } as const;
  const regTone = { NOT_OPEN: 'info', OPEN: 'success', CLOSED: 'warning' } as const;
  const regLabel = {
    NOT_OPEN: 'Registration not open',
    OPEN: 'Registration open',
    CLOSED: 'Registration closed',
  } as const;

  return (
    <Card footerLabel="Publication and registration">
      <div className="flex flex-wrap items-center gap-2">
        <h3>Publication</h3>
        <Badge tone={statusTone[event.status]}>
          {event.status === 'DRAFT'
            ? 'Draft'
            : event.status === 'PUBLISHED'
              ? 'Published'
              : event.status === 'CONCLUDED'
                ? 'Concluded'
                : 'Archived'}
        </Badge>
        <Badge tone={regTone[event.registrationStatus]}>{regLabel[event.registrationStatus]}</Badge>
      </div>
      {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      {notice.length > 0 && (
        <Alert className="mt-3" tone="warning" title="Published, with a reminder">
          {notice.join('. ')}.
        </Alert>
      )}

      {event.status === 'DRAFT' && (
        <div className="mt-4">
          <p>The event is a draft and invisible on its public link. Publishing needs:</p>
          <ul className="mt-2 flex flex-col gap-1">
            {checks.isPending && (
              <li>
                <Spinner label="Checking" />
              </li>
            )}
            {checks.data?.blocking.length === 0 && (
              <li className="font-semibold text-success-fg">Everything required is set</li>
            )}
            {checks.data?.blocking.map((m) => (
              <li key={m} className="font-semibold text-error-fg">
                Missing: {m}
              </li>
            ))}
            {checks.data?.warnings.map((m) => (
              <li key={m} className="text-warning-fg">
                Note: {m}
              </li>
            ))}
          </ul>
          <Button
            className="mt-4"
            onClick={() => publish.mutate()}
            loading={publish.isPending}
            disabled={checks.isPending || (checks.data?.blocking.length ?? 0) > 0}
          >
            Publish event
          </Button>
        </div>
      )}

      {event.status === 'PUBLISHED' && (
        <div className="mt-4 flex flex-col gap-4">
          <p>
            Public link: <a href={`/e/${event.slug}`}>/e/{event.slug}</a>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={event.registrationStatus === 'OPEN' ? 'secondary' : 'primary'}
              onClick={() => registration.mutate('OPEN')}
              disabled={event.registrationStatus === 'OPEN'}
              loading={registration.isPending}
            >
              Open registration
            </Button>
            <Button
              variant="secondary"
              onClick={() => registration.mutate('CLOSED')}
              disabled={event.registrationStatus === 'CLOSED'}
            >
              Close registration
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateTimeField
              label="Registration opens (optional)"
              value={event.registrationOpensAt}
              timeZone={event.timeZone}
              onChange={(v) =>
                schedule.mutate({ opensAt: v, closesAt: event.registrationClosesAt })
              }
            />
            <DateTimeField
              label="Registration closes (optional)"
              value={event.registrationClosesAt}
              timeZone={event.timeZone}
              onChange={(v) => schedule.mutate({ opensAt: event.registrationOpensAt, closesAt: v })}
            />
          </div>
          <div>
            <Button
              variant="ghost"
              onClick={() => unpublish.mutate()}
              loading={unpublish.isPending}
            >
              Unpublish
            </Button>
            <p className="text-sm">Only possible while nobody has registered.</p>
          </div>
        </div>
      )}
      {event.publishedAt && (
        <p className="mt-3 text-sm">
          Published {formatDateTime(event.publishedAt, event.timeZone)}
        </p>
      )}
    </Card>
  );
}

function LifecycleCard({ event }: { event: EventDto }) {
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [confirm, setConfirm] = useState(false);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['event', event.id] }),
      qc.invalidateQueries({ queryKey: ['my-events'] }),
    ]);
  const conclude = useMutation({
    mutationFn: (force: boolean) => eventApi.conclude(event.id, force),
    onSuccess: async () => {
      errors.clear();
      setConfirm(false);
      await refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'no_published_results') return setConfirm(true);
      errors.capture(e);
    },
  });
  const archive = useMutation({
    mutationFn: () => eventApi.archive(event.id),
    onSuccess: async () => {
      errors.clear();
      await refresh();
    },
    onError: (e) => errors.capture(e),
  });

  if (event.status === 'DRAFT' || event.status === 'ARCHIVED') return null;
  return (
    <Card footerLabel="Closing the event">
      <h3>Conclude and archive</h3>
      {errors.formError && <Alert className="mt-3" tone="error" title={errors.formError} />}
      {event.status === 'PUBLISHED' && (
        <>
          <p className="mt-2">
            Concluding closes registration and makes the event read-only for participants, apart
            from feedback and certificates.
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() => conclude.mutate(false)}
            loading={conclude.isPending}
          >
            Conclude event
          </Button>
        </>
      )}
      {event.status === 'CONCLUDED' && (
        <>
          <p className="mt-2">
            Archiving makes the event read-only for everyone except its owner. It is available 7
            days after concluding, to the owner only.
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() => archive.mutate()}
            loading={archive.isPending}
          >
            Archive event
          </Button>
        </>
      )}
      <Dialog
        open={confirm}
        title="Conclude without published results?"
        onClose={() => setConfirm(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => conclude.mutate(true)}
              loading={conclude.isPending}
            >
              Conclude anyway
            </Button>
          </>
        }
      >
        <p>
          No results have been published yet. Participants will not be able to see results after the
          event is concluded.
        </p>
      </Dialog>
    </Card>
  );
}
