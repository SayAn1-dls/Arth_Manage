import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { zonedLocalToUtcIso } from '@arthakram/shared';
import { eventApi, MODE_LABEL, TIME_ZONES, TYPE_LABEL } from '../../lib/events.js';
import { Alert, Button, Card, FormErrorSummary, Input, Select, Textarea } from '../../ui/index.js';
import { useFormErrors } from '../auth/useFormErrors.js';

const ids = {
  name: 'ev-name',
  type: 'ev-type',
  mode: 'ev-mode',
  startsAt: 'ev-start',
  endsAt: 'ev-end',
  timeZone: 'ev-tz',
  institution: 'ev-inst',
  contactEmail: 'ev-email',
  venue: 'ev-venue',
  description: 'ev-desc',
};

/** PRD FR-003: required fields only; everything else is configured on the setup page. */
export function CreateEventPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const errors = useFormErrors();
  const [busy, setBusy] = useState(false);
  const [timeZone, setTimeZone] = useState('Asia/Kolkata');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    errors.clear();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const local = (k: string) => String(f.get(k) ?? '');
    try {
      const event = await eventApi.create({
        name: local('name'),
        type: local('type'),
        mode: local('mode'),
        startsAt: local('startsAt') ? zonedLocalToUtcIso(local('startsAt'), timeZone) : '',
        endsAt: local('endsAt') ? zonedLocalToUtcIso(local('endsAt'), timeZone) : '',
        timeZone,
        institution: local('institution'),
        contactEmail: local('contactEmail'),
        venue: local('venue') || null,
        description: local('description') || null,
      });
      // Drop the cached list so the new event's workspace waits for fresh data instead of flashing "not found".
      qc.removeQueries({ queryKey: ['my-events'] });
      navigate(`/events/${event.id}/setup`);
    } catch (err) {
      errors.capture(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-form px-4 py-8 sm:px-0">
      <Link to="/events" className="text-sm">
        Back to my events
      </Link>
      <h1 className="mt-3 text-[2rem] sm:text-[2.5rem]">Create an event</h1>
      <p className="mt-2">
        You become its core admin. The event stays in draft, invisible to everyone else, until you
        publish it.
      </p>
      <Card className="mt-6">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {errors.formError && <Alert tone="error" title={errors.formError} />}
          <FormErrorSummary issues={errors.issues(ids)} />
          <Input id={ids.name} name="name" label="Event name" required error={errors.fields.name} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id={ids.type}
              name="type"
              label="Type"
              required
              defaultValue="HACKATHON"
              error={errors.fields.type}
            >
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <Select
              id={ids.mode}
              name="mode"
              label="Mode"
              required
              defaultValue="IN_PERSON"
              error={errors.fields.mode}
            >
              {Object.entries(MODE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <Select
            id={ids.timeZone}
            label="Time zone"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            hint="All times you enter are read in this zone."
          >
            {TIME_ZONES.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </Select>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id={ids.startsAt}
              name="startsAt"
              type="datetime-local"
              label="Starts"
              required
              error={errors.fields.startsAt}
            />
            <Input
              id={ids.endsAt}
              name="endsAt"
              type="datetime-local"
              label="Ends"
              required
              error={errors.fields.endsAt}
            />
          </div>
          <Input
            id={ids.institution}
            name="institution"
            label="Organising institution"
            required
            defaultValue="Rishihood University"
            error={errors.fields.institution}
          />
          <Input
            id={ids.contactEmail}
            name="contactEmail"
            type="email"
            label="Contact email"
            required
            error={errors.fields.contactEmail}
          />
          <Input
            id={ids.venue}
            name="venue"
            label="Venue"
            hint="Optional"
            error={errors.fields.venue}
          />
          <Textarea
            id={ids.description}
            name="description"
            label="Short description"
            hint="Up to 300 characters. Shown on the event page."
            maxLength={300}
            error={errors.fields.description}
          />
          <Button type="submit" loading={busy}>
            Create event
          </Button>
        </form>
      </Card>
    </main>
  );
}
