import type { Role } from '@arthakram/shared';
import type { CollapsibleNavGroup, CollapsibleNavItem } from '../ui/CollapsibleNav.js';

export type NavGroup = CollapsibleNavGroup;
export type NavEntry = CollapsibleNavItem;

const item = (to: string, label: string, section?: string, end = false): NavEntry => ({
  to,
  label,
  end,
  ...(section ? { section } : {}),
});
const group = (
  id: string,
  label: string,
  items: NavEntry[],
  description: string,
  flat = false,
): NavGroup => ({ id, label, items, description, ...(flat ? { flat: true } : {}) });

/** Every destination across all groups, in menu order. */
export const navItems = (groups: NavGroup[]): NavEntry[] => groups.flatMap((g) => g.items);

/** First path segment of a destination, e.g. 'teams' for 'teams' and '' for the dashboard. */
export const segmentOf = (to: string) => to.split(/[/?]/)[0] ?? '';

/** The group holding the page at `section` (first path segment under /events/:eventId; '' is the dashboard). */
export function activeGroupId(groups: NavGroup[], section: string): string | null {
  const target = resolveSection(groups, section);
  return groups.find((g) => g.items.some((i) => segmentOf(i.to) === target))?.id ?? null;
}

/** A section with its own menu entry is itself; otherwise the entry it belongs to (see NAV_ALIASES). */
function resolveSection(groups: NavGroup[], section: string): string {
  if (navItems(groups).some((i) => segmentOf(i.to) === section)) return section;
  return NAV_ALIASES[section] ?? section;
}

/** The menu entry for the page at `section`, following detail pages back to their list. */
export function activeItem(groups: NavGroup[], section: string): NavEntry | undefined {
  const target = resolveSection(groups, section);
  return navItems(groups).find((i) => segmentOf(i.to) === target);
}

/**
 * Pages reached from a list rather than the menu, mapped to the menu entry they belong to, so the menu
 * still shows where the user is (for example a participant record belongs to Teams & participants).
 */
const NAV_ALIASES: Record<string, string> = {
  participants: 'teams',
};

/**
 * Core Admin information architecture: seven divisions (ArthManage navigation audit, docs/UX_RESTRUCTURING_PLAN.md).
 * Sections inside a division follow the event's real order of work. Hiding an entry is presentation only; the
 * API enforces every permission independently.
 */
function adminNav(): NavGroup[] {
  return [
    group(
      'dashboard',
      'Dashboard',
      [item('', 'Dashboard', undefined, true)],
      'What is happening, what needs you and what to do next.',
      true,
    ),
    group(
      'setup',
      'Setup',
      [
        item('setup', 'Event details & publishing', 'Event configuration'),
        item('rounds', 'Rounds & deadlines', 'Event configuration'),
        item('structure', 'Tracks & problems', 'Event configuration'),
        item('guidebook', 'Guidebook', 'Event resources'),
        item('integrations', 'Integrations', 'Event resources'),
      ],
      'Event details, rounds, tracks, guidebook and integrations.',
    ),
    group(
      'registrations',
      'Registrations & people',
      [
        item('teams', 'Teams & participants', 'Registration management'),
        item('applications', 'Application review', 'Registration management'),
        item('people', 'People', 'Organising team'),
      ],
      'Teams, participants, applications and your organising team.',
    ),
    group(
      'administration',
      'Administration',
      [
        item('access', 'Access & matching', 'Access & permissions'),
        item('audit', 'Audit history', 'Records'),
      ],
      'Access levels, judge matching and the audit trail.',
    ),
    group(
      'operations',
      'Event operations',
      [
        item('support', 'Support & requests', 'Participant support'),
        item('communication', 'Communication', 'Communication'),
        item('checkin', 'Check-in', 'Event-day management'),
        item('tasks', 'Staff tasks', 'Event-day management'),
        item('issues', 'Issues', 'Event-day management'),
        item('engagement', 'Team engagement', 'Engagement'),
      ],
      'Requests, messages, check-in, staff tasks and issues.',
    ),
    group(
      'evaluation',
      'Submissions & evaluation',
      [
        item('rubric', 'Rubric', 'Judge configuration'),
        item('briefing', 'Judge briefing & glossary', 'Judge configuration'),
        item('submissions', 'Submissions', 'Work management'),
        item('judging', 'Judging', 'Evaluation & integrity'),
        item('calibration', 'Judge calibration', 'Evaluation & integrity'),
        item('integrity', 'Project review', 'Evaluation & integrity'),
        item('advancement', 'Round shortlists', 'Work management'),
        item('sandbox', 'Practice workspace', 'Testing'),
      ],
      'Rubrics, submissions, judging, calibration and shortlists.',
    ),
    group(
      'results',
      'Results & insights',
      [
        item('results', 'Results', 'Results'),
        item('feedback', 'Feedback & reviews', 'Post-event'),
        item('certificates', 'Certificates', 'Post-event'),
        item('report', 'Impact report', 'Post-event'),
      ],
      'Results, feedback, judges’ comments, certificates and the impact report.',
    ),
  ];
}

/**
 * Role-specific navigation (PRD §5.4). Every role lands on its own dashboard ('' route); other destinations are
 * grouped by the job the person is doing. Hiding an entry is presentation only; the API enforces permissions.
 */
export function navFor(role: Role): NavGroup[] {
  switch (role) {
    case 'ADMIN':
      return adminNav();
    case 'PARTICIPANT':
      return [
        group(
          'workspace',
          'My event',
          [
            item('', 'My event', undefined, true),
            item('team', 'My team'),
            item('submission', 'Submission'),
            item('updates', 'Updates'),
          ],
          'Your next step, team, submission and updates.',
        ),
        group(
          'outcomes',
          'Results & certificates',
          [
            item('results', 'Results'),
            item('certificates', 'Certificates'),
            item('feedback', 'Survey & judges’ comments'),
          ],
          'Results, judges’ comments, certificates and the event survey.',
        ),
        group(
          'help',
          'Help',
          [item('support', 'Help & requests'), item('guidebook', 'Guidebook')],
          'Ask the organisers, request an exception or read the rules.',
        ),
        group(
          'more',
          'More',
          [
            item('rounds', 'Rounds & deadlines'),
            item('structure', 'Tracks & problems'),
            item('applications', 'Application status'),
            item('discovery', 'Find teammates'),
            item('integrity', 'Market context'),
            item('profile', 'My details'),
          ],
          'Event details, your profile and other tools.',
        ),
      ];
    case 'JUDGE':
      return [
        group(
          'judging',
          'Judging',
          [
            item('', 'Judge dashboard', undefined, true),
            item('judge', 'My teams'),
            item('briefing', 'Judge briefing'),
            item('practice', 'Practice team'),
            item('integrity', 'Market context'),
          ],
          'Your assigned teams, briefing and practice.',
        ),
        group(
          'help',
          'Help & updates',
          [
            item('updates', 'Updates'),
            item('support', 'Ask the organisers'),
            item('guidebook', 'Guidebook'),
            item('feedback', 'Judge survey'),
          ],
          'Announcements, questions to organisers and the guidebook.',
        ),
      ];
    case 'STAFF':
      return [
        group(
          'operations',
          'Event day',
          [
            item('', 'Staff dashboard', undefined, true),
            item('checkin', 'Check-in'),
            item('tasks', 'My tasks'),
            item('issues', 'Report an issue'),
          ],
          'Check-in, your tasks and issue reports.',
        ),
        group(
          'help',
          'Help & updates',
          [item('updates', 'Updates'), item('support', 'Helpdesk'), item('guidebook', 'Guidebook')],
          'Announcements, the helpdesk and the guidebook.',
        ),
      ];
  }
}

/**
 * Up to five destinations for the small-screen bottom bar, taken from the same definitions as the sidebar so
 * the two can never disagree. The last slot is always the full menu.
 */
const BOTTOM_BAR: Record<Role, string[]> = {
  ADMIN: ['', 'support', 'teams', 'judging'],
  PARTICIPANT: ['', 'team', 'submission', 'updates'],
  JUDGE: ['', 'judge', 'briefing', 'updates'],
  STAFF: ['', 'checkin', 'tasks', 'issues'],
};

export function bottomBarFor(role: Role, groups: NavGroup[]): NavEntry[] {
  const all = navItems(groups);
  return BOTTOM_BAR[role]
    .map((to) => all.find((i) => i.to === to))
    .filter((i): i is NavEntry => Boolean(i));
}

/**
 * Old destinations that now live inside a consolidated page. EventLayout redirects them (keeping the query
 * string) so bookmarks and habits never hit a dead end. Keyed by role because some paths are only merged for
 * one role (participants keep their own pages).
 */
export const LEGACY_REDIRECTS: Partial<Record<Role, Record<string, string>>> = {
  ADMIN: {
    participants: 'teams?view=participants',
    helpdesk: 'support?tab=general',
    exceptions: 'support?tab=exceptions',
    announcements: 'communication?history=announcements',
    communications: 'communication?history=targeted',
  },
  PARTICIPANT: {
    helpdesk: 'support',
    exceptions: 'support?type=exception',
    announcements: 'updates',
    messages: 'updates',
  },
  JUDGE: { helpdesk: 'support', announcements: 'updates' },
  STAFF: { helpdesk: 'support', announcements: 'updates' },
};
