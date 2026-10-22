/** Deadlines and dates are always shown in the event's time zone with the zone label (PRD 6.0-6). */
export function formatDateTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${date}, ${time} ${zoneLabel(timeZone, d)}`;
}

export function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

export function zoneLabel(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' }).formatToParts(
    at,
  );
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  return timeZone === 'Asia/Kolkata' ? 'IST' : name;
}

export const ROLE_LABEL = {
  ADMIN: 'Core admin',
  JUDGE: 'Judge',
  STAFF: 'Helping staff',
  PARTICIPANT: 'Participant',
} as const;
