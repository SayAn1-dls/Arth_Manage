import { describe, expect, it } from 'vitest';
import {
  activeGroupId,
  activeItem,
  bottomBarFor,
  LEGACY_REDIRECTS,
  navFor,
  navItems,
} from './nav.js';

/** Destinations as they were before navigation was grouped: grouping must never add or drop a route. */
const ROUTES = {
  ADMIN: [
    '',
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

/** Destinations merged into a consolidated page; each must redirect so old links never dead-end. */
const MERGED: Partial<Record<keyof typeof ROUTES, string[]>> = {
  ADMIN: ['participants'],
};

describe('role navigation', () => {
  it('redirects every merged destination to the page that replaced it', () => {
    for (const [role, paths] of Object.entries(MERGED) as [keyof typeof ROUTES, string[]][])
      for (const p of paths) {
        const target = LEGACY_REDIRECTS[role]?.[p];
        expect(target, `${role} ${p}`).toBeTruthy();
        expect(navItems(navFor(role)).map((i) => i.to)).toContain(target!.split('?')[0]);
      }
  });

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

  it('admin uses the seven divisions of the navigation audit, dashboard first', () => {
    expect(navFor('ADMIN').map((g) => g.label)).toEqual([
      'Dashboard',
      'Setup',
      'Registrations & people',
      'Administration',
      'Event operations',
      'Submissions & evaluation',
      'Results & insights',
    ]);
    const dashboard = navFor('ADMIN')[0]!;
    expect(dashboard.items).toEqual([expect.objectContaining({ to: '', end: true })]);
  });

  it('every admin division has a one-line description for the dashboard cards', () => {
    for (const g of navFor('ADMIN')) expect(g.description?.length).toBeGreaterThan(10);
  });

  it('orders judging work the way the event runs it', () => {
    const order = navItems(navFor('ADMIN')).map((i) => i.to);
    const at = (to: string) => order.indexOf(to);
    expect(at('rubric')).toBeLessThan(at('judging'));
    expect(at('judging')).toBeLessThan(at('calibration'));
    expect(at('judging')).toBeLessThan(at('advancement'));
    expect(at('judging')).toBeLessThan(at('results'));
  });

  it('every role lands on its own dashboard', () => {
    for (const role of ['ADMIN', 'PARTICIPANT', 'JUDGE', 'STAFF'] as const)
      expect(navItems(navFor(role))[0]).toMatchObject({ to: '', end: true });
  });

  it('bottom bar entries come from the sidebar definitions', () => {
    for (const role of ['ADMIN', 'PARTICIPANT', 'JUDGE', 'STAFF'] as const) {
      const groups = navFor(role);
      const bar = bottomBarFor(role, groups);
      expect(bar.length).toBeGreaterThanOrEqual(3);
      expect(bar.length).toBeLessThanOrEqual(4);
      for (const b of bar) expect(navItems(groups)).toContainEqual(b);
    }
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
    expect(activeGroupId(admin, '')).toBe('dashboard');
    expect(activeGroupId(admin, 'advancement')).toBe('evaluation');
    expect(activeGroupId(admin, 'checkin')).toBe('operations');
    expect(activeGroupId(admin, 'guidebook')).toBe('setup');
    expect(activeGroupId(admin, 'certificates')).toBe('results');
    expect(activeGroupId(admin, 'audit')).toBe('administration');
    expect(activeGroupId(admin, 'participants')).toBe('registrations');
    expect(activeGroupId(admin, 'unknown')).toBeNull();
    expect(activeItem(admin, 'teams')?.to).toBe('teams');
    expect(activeGroupId(navFor('JUDGE'), 'judge')).toBe('judging');
    expect(activeGroupId(navFor('STAFF'), 'issues')).toBe('operations');
  });
});
