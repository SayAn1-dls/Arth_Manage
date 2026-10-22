import { describe, expect, it } from 'vitest';
import { utcIsoToZonedLocal, zonedLocalToUtcIso } from './time.js';

describe('time zones', () => {
  it('interprets wall-clock time in the event zone (IST is UTC+5:30)', () => {
    expect(zonedLocalToUtcIso('2027-02-15T18:00', 'Asia/Kolkata')).toBe('2027-02-15T12:30:00.000Z');
    expect(utcIsoToZonedLocal('2027-02-15T12:30:00.000Z', 'Asia/Kolkata')).toBe('2027-02-15T18:00');
  });
  it('handles zones with daylight saving', () => {
    expect(zonedLocalToUtcIso('2027-07-01T09:00', 'America/New_York')).toBe(
      '2027-07-01T13:00:00.000Z',
    );
    expect(zonedLocalToUtcIso('2027-01-01T09:00', 'America/New_York')).toBe(
      '2027-01-01T14:00:00.000Z',
    );
  });
  it('round-trips', () => {
    const iso = zonedLocalToUtcIso('2027-03-10T23:59', 'Asia/Kolkata');
    expect(utcIsoToZonedLocal(iso, 'Asia/Kolkata')).toBe('2027-03-10T23:59');
  });
});
