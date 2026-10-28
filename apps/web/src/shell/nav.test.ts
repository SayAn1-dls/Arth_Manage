import { describe, expect, it } from 'vitest';
import { activeGroupId, navFor, navItems } from './nav.js';

/** Destinations as they were before navigation was grouped: grouping must never add or drop a route. */
const ROUTES = {
  ADMIN: [
    '',
    'participants',
    'teams',
    'submissions',
    'people',
    'applications',
    'helpdesk',
    'exceptions',
    'communications',
    'engagement',
    'advancement',
    'calibration',
    'integrity',
    'briefing',
    'rubric',
    'judging',
    'results',
    'tasks',
    'checkin',
    'issues',
    'sandbox',
    'access',
    'setup',
    'rounds',
    'structure',
    'guidebook',
    'announcements',
    'integrations',
    'report',
    'feedback',
    'certificates',
    'audit',
  ],
  PARTICIPANT: [
    '',
    'team',
    'messages',
    'applications',
    'integrity',
    'helpdesk',
    'exceptions',
    'discovery',
    'submission',
    'results',
    'feedback',
    'certificates',
    'profile',
    'rounds',
    'structure',
    'guidebook',
    'announcements',
  ],
  JUDGE: [
    '',
    'judge',
    'briefing',
    'practice',
    'helpdesk',
    'integrity',
    'feedback',
    'guidebook',
    'announcements',
  ],
  STAFF: ['', 'tasks', 'checkin', 'issues', 'helpdesk', 'guidebook', 'announcements'],
} as const;

describe('role navigation', () => {
  for (const role of ['ADMIN', 'PARTICIPANT', 'JUDGE', 'STAFF'] as const) {
    it(`${role}: keeps exactly the existing destinations, each once`, () => {
      const to = navItems(navFor(role)).map((i) => i.to);
      expect([...to].sort()).toEqual([...ROUTES[role]].sort());
      expect(new Set(to).size).toBe(to.length);
    });

    it(`${role}: has unique group ids and no empty groups`, () => {
      const groups = navFor(role);
      expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
      expect(groups.every((g) => g.items.length > 0)).toBe(true);
    });
  }

  it('admin groups match the documented sections', () => {
    expect(navFor('ADMIN').map((g) => g.label)).toEqual([
      'Run the event',
      'Judging and results',
      'Event day',
      'Set up',
      'After the event',
      'Records',
    ]);
  });

  it('does not expose admin-only destinations to other roles', () => {
    for (const role of ['PARTICIPANT', 'JUDGE', 'STAFF'] as const) {
      const to = navItems(navFor(role)).map((i) => i.to);
      for (const adminOnly of [
        'participants',
        'people',
        'calibration',
        'advancement',
        'audit',
        'rubric',
        'access',
      ])
        expect(to).not.toContain(adminOnly);
    }
    expect(navItems(navFor('PARTICIPANT')).map((i) => i.to)).not.toContain('judge');
    expect(navItems(navFor('STAFF')).map((i) => i.to)).not.toContain('judge');
  });

  it('finds the group of the active section, including nested routes', () => {
    const admin = navFor('ADMIN');
    expect(activeGroupId(admin, '')).toBe('run');
    expect(activeGroupId(admin, 'advancement')).toBe('judging');
    expect(activeGroupId(admin, 'checkin')).toBe('event-day');
    expect(activeGroupId(admin, 'guidebook')).toBe('setup');
    expect(activeGroupId(admin, 'certificates')).toBe('after');
    expect(activeGroupId(admin, 'audit')).toBe('records');
    expect(activeGroupId(admin, 'unknown')).toBeNull();
    expect(activeGroupId(navFor('JUDGE'), 'judge')).toBe('judging');
    expect(activeGroupId(navFor('STAFF'), 'issues')).toBe('operations');
  });
});
