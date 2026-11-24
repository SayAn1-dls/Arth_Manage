import type { Role } from '@arthakram/shared';
import type { CollapsibleNavGroup, CollapsibleNavItem } from '../ui/CollapsibleNav.js';

/**
 * Information priority (UX spec v1.0 §4). Critical: the event or the current workflow cannot run correctly
 * without it. Important: regular operations. Advanced: specialised, shown behind progressive disclosure.
 */
export type Priority = 'critical' | 'important' | 'advanced';

export type NavEntry = CollapsibleNavItem & {
  /** One line saying what the task is for, shown on area and division cards. */
  description?: string;
  priority?: Priority;
};
export type NavGroup = Omit<CollapsibleNavGroup, 'items'> & { items: NavEntry[] };

const item = (
  to: string,
  label: string,
  description: string,
  priority: Priority = 'important',
  section?: string,
): NavEntry => ({
  to,
  label,
  description,
  priority,
  ...(to === '' ? { end: true } : {}),
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
 * Pages reached from a list rather than a card, mapped to the destination they belong to, so breadcrumbs
 * still show where the user is (for example a participant record belongs to Teams & participants).
 */
const NAV_ALIASES: Record<string, string> = {
  participants: 'teams',
};

/** Path of a division's landing page (Core Admin) under /events/:eventId. */
export const areaPath = (groupId: string) => `area/${groupId}`;
/** Path of the page that lists every area for the caller's role. */
export const ALL_AREAS = 'areas';

/**
 * Core Admin information architecture: seven divisions (ArthManage navigation audit, UX spec v1.0 §6–7).
 * Each division has a landing page of task cards; the Dashboard is the default landing page. Tasks inside a
 * division follow the event's real order of work. Hiding an entry is presentation only; the API enforces
 * every permission independently.
 */
function adminNav(): NavGroup[] {
  return [
    group(
      'dashboard',
      'Dashboard',
      [item('', 'Dashboard', 'Event status, what needs you and what to do next.', 'critical')],
      'What is happening, what needs you and what to do next.',
      true,
    ),
    group(
      'setup',
      'Setup',
      [
        item(
          'setup',
          'Event details & publishing',
          'Name, dates, team rules, results visibility, publishing and registration.',
          'critical',
          'Event configuration',
        ),
        item(
          'rounds',
          'Rounds & deadlines',
          'Rounds, submission deadlines, grace periods and submission forms.',
          'critical',
          'Event configuration',
        ),
        item(
          'structure',
          'Tracks & problems',
          'Tracks and the problem statements teams choose from.',
          'critical',
          'Event configuration',
        ),
        item(
          'guidebook',
          'Guidebook',
          'The rules and schedule participants read, with a PDF.',
          'important',
          'Event resources',
        ),
        item(
          'integrations',
          'Integrations',
          'Optional Google Sheets and Drive sync, and CSV exports.',
          'advanced',
          'Event resources',
        ),
      ],
      'Event details, rounds, tracks, guidebook and integrations.',
    ),
    group(
      'registrations',
      'Registrations & people',
      [
        item(
          'teams',
          'Teams & participants',
          'Find any team or participant, fix records and manage membership.',
          'important',
          'Registration management',
        ),
        item(
          'applications',
          'Application review',
          'Accept, waitlist or reject team applications when screening is used.',
          'important',
          'Registration management',
        ),
        item(
          'people',
          'People',
          'Invite organisers, judges, helping staff and sponsor viewers.',
          'important',
          'Organising team',
        ),
      ],
      'Teams, participants, applications and your organising team.',
    ),
    group(
      'administration',
      'Administration',
      [
        item(
          'access',
          'Access & matching',
          'Access labels and the institutions and tracks used to match judges.',
          'advanced',
          'Access & permissions',
        ),
        item(
          'audit',
          'Audit history',
          'Who changed what and when, with filters and a CSV export.',
          'advanced',
          'Records',
        ),
      ],
      'Access levels, judge matching and the audit trail.',
    ),
    group(
      'operations',
      'Event operations',
      [
        item(
          'support',
          'Support & requests',
          'Questions and exception requests from participants, judges and staff.',
          'important',
          'Participant support',
        ),
        item(
          'communication',
          'Communication',
          'Announcements and targeted messages, with history and delivery status.',
          'important',
          'Communication',
        ),
        item(
          'checkin',
          'Check-in',
          'Find a team and mark members present on event day.',
          'important',
          'Event-day management',
        ),
        item(
          'tasks',
          'Staff tasks',
          'Create, assign and follow up helping staff tasks.',
          'important',
          'Event-day management',
        ),
        item(
          'issues',
          'Issues',
          'Problems reported by staff and judges on event day.',
          'important',
          'Event-day management',
        ),
        item(
          'engagement',
          'Team engagement',
          'Which teams look active, slipping or inactive.',
          'advanced',
          'Engagement',
        ),
      ],
      'Requests, messages, check-in, staff tasks and issues.',
    ),
    group(
      'evaluation',
      'Submissions & evaluation',
      [
        item(
          'rubric',
          'Rubric',
          'The criteria and weights judges score against, per round.',
          'critical',
          'Judge configuration',
        ),
        item(
          'briefing',
          'Judge briefing & glossary',
          'What judges read before scoring, and terms explained in context.',
          'important',
          'Judge configuration',
        ),
        item(
          'submissions',
          'Submissions',
          'Who has submitted, late work, extensions and files.',
          'critical',
          'Work management',
        ),
        item(
          'judging',
          'Judging',
          'Assign judges, open and close judging, follow evaluations.',
          'critical',
          'Evaluation & integrity',
        ),
        item(
          'calibration',
          'Judge calibration',
          'Compare judges’ scoring and the optional normalisation.',
          'advanced',
          'Evaluation & integrity',
        ),
        item(
          'integrity',
          'Project review',
          'Repository checks, integrity notes and market context.',
          'advanced',
          'Evaluation & integrity',
        ),
        item(
          'advancement',
          'Round shortlists',
          'Choose which teams advance to the next round.',
          'important',
          'Work management',
        ),
        item(
          'sandbox',
          'Practice workspace',
          'Preview the participant or judge screens with practice data.',
          'advanced',
          'Testing',
        ),
      ],
      'Rubrics, submissions, judging, calibration and shortlists.',
    ),
    group(
      'results',
      'Results & insights',
      [
        item(
          'results',
          'Results',
          'Review ranks and ties, approve and publish results.',
          'critical',
          'Results',
        ),
        item(
          'feedback',
          'Feedback & reviews',
          'Participant and judge surveys, and judges’ comments for teams.',
          'important',
          'Post-event',
        ),
        item(
          'certificates',
          'Certificates',
          'Design, generate, review and release certificates.',
          'important',
          'Post-event',
        ),
        item(
          'report',
          'Impact report',
          'An aggregate PDF for sponsors and the institution.',
          'advanced',
          'Post-event',
        ),
      ],
      'Results, feedback, judges’ comments, certificates and the impact report.',
    ),
  ];
}

/**
 * Role-specific areas (PRD §5.4). Every role lands on its own dashboard ('' route); the other destinations
 * are listed on the All areas page and in the small-screen bottom bar. Hiding an entry is presentation only;
 * the API enforces permissions.
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
            item('', 'My event', 'Your next step, team, submission and updates.', 'critical'),
            item('team', 'My team', 'Members, your invite code, track and problem.', 'critical'),
            item(
              'submission',
              'Submission',
              'Your team’s work for each round, before the deadline.',
              'critical',
            ),
            item('updates', 'Updates', 'Announcements and messages from the organisers.'),
          ],
          'Your next step, team, submission and updates.',
        ),
        group(
          'outcomes',
          'Results & certificates',
          [
            item('results', 'Results', 'How your team did, once results are published.'),
            item('certificates', 'Certificates', 'Download your certificates once released.'),
            item(
              'feedback',
              'Survey & judges’ comments',
              'Tell the organisers how it went, and read judges’ comments.',
            ),
          ],
          'Results, judges’ comments, certificates and the event survey.',
        ),
        group(
          'help',
          'Help',
          [
            item(
              'support',
              'Help & requests',
              'Ask a question, or request more time or a team change.',
            ),
            item('guidebook', 'Guidebook', 'Rules, schedule and judging criteria.'),
          ],
          'Ask the organisers, request an exception or read the rules.',
        ),
        group(
          'more',
          'More',
          [
            item('rounds', 'Rounds & deadlines', 'Every round and its official deadline.'),
            item('structure', 'Tracks & problems', 'The tracks and problem statements.'),
            item(
              'applications',
              'Application status',
              'Whether your team is accepted, when screening is used.',
            ),
            item(
              'discovery',
              'Find teammates',
              'Profiles of people looking for a team.',
              'advanced',
            ),
            item(
              'integrity',
              'Market context',
              'Notes the organisers shared about your project.',
              'advanced',
            ),
            item('profile', 'My details', 'Your registration details and certificate name.'),
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
            item('', 'Judge dashboard', 'Your rounds, progress and deadline.', 'critical'),
            item('judge', 'My teams', 'The teams assigned to you and their status.', 'critical'),
            item(
              'briefing',
              'Judge briefing',
              'How the rubric works, examples and contacts.',
              'critical',
            ),
            item(
              'practice',
              'Practice team',
              'Try scoring a made-up submission; nothing is saved.',
            ),
            item(
              'integrity',
              'Market context',
              'Organisers’ notes about the projects.',
              'advanced',
            ),
          ],
          'Your assigned teams, briefing and practice.',
        ),
        group(
          'help',
          'Help & updates',
          [
            item('updates', 'Updates', 'Announcements from the organisers.'),
            item('support', 'Ask the organisers', 'A private question to the event organisers.'),
            item('guidebook', 'Guidebook', 'The event’s rules and schedule.'),
            item('feedback', 'Judge survey', 'Tell the organisers how judging went.'),
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
            item('', 'Staff dashboard', 'Check-in, your tasks and issue reports.', 'critical'),
            item('checkin', 'Check-in', 'Find a team and mark members present.', 'critical'),
            item('tasks', 'My tasks', 'What you have been asked to do, overdue first.', 'critical'),
            item('issues', 'Report an issue', 'Tell the organisers about a problem.'),
          ],
          'Check-in, your tasks and issue reports.',
        ),
        group(
          'help',
          'Help & updates',
          [
            item('updates', 'Updates', 'Announcements from the organisers.'),
            item('support', 'Helpdesk', 'Questions from participants and judges.'),
            item('guidebook', 'Guidebook', 'The event’s rules and schedule.'),
          ],
          'Announcements, the helpdesk and the guidebook.',
        ),
      ];
  }
}

/**
 * Up to four destinations for the small-screen bottom bar, taken from the same definitions as every other
 * entry point so they can never disagree. The fifth slot is always All areas.
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
 * one role.
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
