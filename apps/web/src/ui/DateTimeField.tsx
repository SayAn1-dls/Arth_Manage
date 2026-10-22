import { utcIsoToZonedLocal, zonedLocalToUtcIso } from '@arthakram/shared';
import { zoneLabel } from '../lib/format.js';
import { Input } from './Field.js';

interface Props {
  label: string;
  /** UTC ISO string or null. */
  value: string | null | undefined;
  timeZone: string;
  onChange: (iso: string | null) => void;
  error?: string;
  required?: boolean;
  hint?: string;
  id?: string;
}

/** Wall-clock input interpreted in the event's time zone, stored as a UTC instant (PRD AS-09). */
export function DateTimeField({
  label,
  value,
  timeZone,
  onChange,
  error,
  required,
  hint,
  id,
}: Props) {
  return (
    <Input
      id={id}
      type="datetime-local"
      label={label}
      required={required}
      error={error}
      hint={hint ?? `Time zone: ${zoneLabel(timeZone)} (${timeZone})`}
      value={value ? utcIsoToZonedLocal(value, timeZone) : ''}
      onChange={(e) =>
        onChange(e.target.value ? zonedLocalToUtcIso(e.target.value, timeZone) : null)
      }
    />
  );
}
