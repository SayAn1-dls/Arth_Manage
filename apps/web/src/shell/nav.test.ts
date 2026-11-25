import { describe, expect, it } from 'vitest';
import {
  activeGroupId,
  activeItem,
  bottomBarFor,
  LEGACY_REDIRECTS,
  navFor,
  navItems,
  segmentOf,
  sidebarFor,
} from './nav.js';

/** Every destination each role must be able to reach from the menu (merged pages are in MERGED). */
const ROUTES = {
  ADMIN: [
    '',
    'teams',
    'submissions',
    'people',
    'applications',
    'support',
    'communication',
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
    'integrations',
    'report',
    'feedback',
    'certificates',
    'audit',
  ],
  PARTICIPANT: [
    '',
    'team',
    'applications',
    'integrity',
    'support',
    'discovery',
    'submission',
    'results',
    'feedback',
    'certificates',
    'profile',
    'rounds',
    'structure',
    'guidebook',
    'updates',
  ],
  JUDGE: [
    '',
    'judge',
    'briefing',
    'practice',
    'support',
    'integrity',
    'feedback',
    'guidebook',
    'updates',
  ],
  STAFF: ['', 'tasks', 'checkin', 'issues', 'support', 'guidebook', 'updates'],
} as const;

/** Destinations merged into a consolidated page; each must redirect so old links never dead-end. */
const MERGED: Partial<Record<keyof typeof ROUTES, string[]>> = {
  ADMIN: ['participants', 'helpdesk', 'exceptions', 'announcements', 'communications'],
  PARTICIPANT: ['helpdesk', 'exceptions', 'announcements', 'messages'],
  JUDGE: ['helpdesk', 'announcements'],
  STAFF: ['helpdesk', 'announcements'],
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

  it('admin uses the seven approved domains, Command Centre first', () => {
    expect(navFor('ADMIN').map((g) => g.label)).toEqual([
      'Command Centre',
      'Event Configuration',
      'People & Teams',
      'Judging & Evaluation',
      'Live Operations',
      'Communication',
      'Reports & Records',
    ]);
    const command = navFor('ADMIN')[0]!;
    expect(command.items).toEqual([expect.objectContaining({ to: '', end: true })]);
  });

  it('every admin domain has a one-line description for its landing page', () => {
    for (const g of navFor('ADMIN')) expect(g.description?.length).toBeGreaterThan(10);
  });

  it('domain shortcuts only point at destinations the admin can already reach', () => {
    const reachable = navItems(navFor('ADMIN')).map((i) => i.to);
    for (const g of navFor('ADMIN'))
      for (const sc of g.shortcuts ?? []) expect(reachable, sc.label).toContain(segmentOf(sc.to));
  });

  it('keeps problem statements with the critical configuration tasks', () => {
    const config = navFor('ADMIN').find((g) => g.id === 'configuration')!;
    expect(config.items.find((i) => i.to === 'structure')?.priority).toBe('critical');
  });

  it('orders judging work the way the event runs it', () => {
    const order = navItems(navFor('ADMIN')).map((i) => i.to);
    const at = (to: string) => order.indexOf(to);
    expect(at('rubric')).toBeLessThan(at('judging'));
    expect(at('judging')).toBeLessThan(at('calibration'));
    expect(at('judging')).toBeLessThan(at('advancement'));
    expect(at('judging')).toBeLessThan(at('results'));
  });

  it('the sidebar is never a tree: admins get seven domains, other roles at most eight pages', () => {
    expect(sidebarFor('ADMIN')).toHaveLength(7);
    for (const role of ['PARTICIPANT', 'JUDGE', 'STAFF'] as const) {
      const entries = sidebarFor(role);
      expect(entries.length).toBeGreaterThanOrEqual(4);
      expect(entries.length).toBeLessThanOrEqual(8);
    }
  });

  it('every role lands on its own dashboard', () => {
    for (const role of ['ADMIN', 'PARTICIPANT', 'JUDGE', 'STAFF'] as const)
      expect(navItems(navFor(role))[0]).toMatchObject({ to: '', end: true });
  });

  it('bottom bar entries come from the sidebar definitions', () => {
    for (const role of ['ADMIN', 'PARTICIPANT', 'JUDGE', 'STAFF'] as const) {
      const bar = bottomBarFor(role);
      expect(bar).toHaveLength(4);
      const ids = sidebarFor(role).map((e) => e.id);
      for (const b of bar) expect(ids).toContain(b.id);
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
    expect(activeGroupId(admin, '')).toBe('command');
    expect(activeGroupId(admin, 'advancement')).toBe('judging');
    expect(activeGroupId(admin, 'checkin')).toBe('operations');
    expect(activeGroupId(admin, 'guidebook')).toBe('configuration');
    expect(activeGroupId(admin, 'certificates')).toBe('records');
    expect(activeGroupId(admin, 'audit')).toBe('records');
    expect(activeGroupId(admin, 'participants')).toBe('people');
    expect(activeGroupId(admin, 'communication')).toBe('communication');
    expect(activeGroupId(admin, 'unknown')).toBeNull();
    expect(activeItem(admin, 'teams')?.to).toBe('teams');
    expect(activeGroupId(navFor('JUDGE'), 'judge')).toBe('judging');
    expect(activeGroupId(navFor('STAFF'), 'issues')).toBe('operations');
  });
});
