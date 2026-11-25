import type { Role } from '@arthakram/shared';
import type { CollapsibleNavGroup, CollapsibleNavItem } from '../ui/CollapsibleNav.js';

/**
 * Information priority (UX spec v1.0 §4). Critical: the event or the current workflow cannot run correctly
 * without it. Important: regular operations. Advanced: specialised, shown behind progressive disclosure.
 */
export type Priority = 'critical' | 'important' | 'advanced';

export type NavEntry = CollapsibleNavItem & {
  /** One line saying what the task is for, shown on domain cards and in search. */
  description?: string;
  priority?: Priority;
  /** Shown as its own sidebar destination (non-admin roles); the rest live under More. */
  primary?: boolean;
};
export type NavGroup = Omit<CollapsibleNavGroup, 'items'> & {
  items: NavEntry[];
  /** Extra cards on the domain landing page that open a workspace owned by another domain or a page section. */
  shortcuts?: NavEntry[];
};

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
const primary = (e: NavEntry): NavEntry => ({ ...e, primary: true });
const group = (
  id: string,
  label: string,
  items: NavEntry[],
  description: string,
  flat = false,
  shortcuts?: NavEntry[],
): NavGroup => ({
  id,
  label,
  items,
  description,
  ...(flat ? { flat: true } : {}),
  ...(shortcuts ? { shortcuts } : {}),
});

/** Every destination across all groups, in menu order. */
export const navItems = (groups: NavGroup[]): NavEntry[] => groups.flatMap((g) => g.items);

/** First path segment of a destination, e.g. 'teams' for 'teams' and '' for the dashboard. */
export const segmentOf = (to: string) => to.split(/[/?#]/)[0] ?? '';

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

/** Path of a domain's landing page (Core Admin) under /events/:eventId. The Command Centre is the dashboard. */
export const areaPath = (groupId: string) => (groupId === 'command' ? '' : `area/${groupId}`);
/** Path of the page that lists every destination for the caller's role. */
export const ALL_AREAS = 'areas';

/**
 * Core Admin information architecture: seven domains (approved UX decision, Nov 2026). Each domain has a
 * landing page of task cards; the Command Centre is the dashboard. Every route belongs to exactly one
 * domain (its breadcrumb and sidebar highlight); a domain may also show `shortcuts` into another domain's
 * workspace when the task is commonly started from there. Hiding an entry is presentation only; the API
 * enforces every permission independently.
 */
function adminNav(): NavGroup[] {
  return [
    group(
      'command',
      'Command Centre',
      [item('', 'Command Centre', 'Event status, what needs you and what to do next.', 'critical')],
      'What is happening across the event and what needs you now.',
      true,
    ),
    group(
      'configuration',
      'Event Configuration',
      [
        item(
          'setup',
          'Event details & publishing',
          'Name, dates, venue, team rules, registration window and publishing.',
          'critical',
        ),
        item(
          'rounds',
          'Rounds & deadlines',
          'Rounds, submission deadlines, grace periods and submission forms.',
          'critical',
        ),
        item(
          'structure',
          'Tracks & problem statements',
          'Tracks and the problem statements teams choose from.',
          'critical',
        ),
        item('guidebook', 'Guidebook', 'The rules and schedule participants read, with a PDF.'),
        item(
          'integrations',
          'Integrations & exports',
          'Optional Google Sheets and Drive sync, and CSV exports.',
          'advanced',
        ),
        item(
          'sandbox',
          'Practice workspace',
          'Preview the participant or judge screens with practice data.',
          'advanced',
        ),
      ],
      'Everything the event needs before it can run: details, rounds, problems and rules.',
      false,
      [
        item(
          'setup#publishing',
          'Registration settings',
          'When registration opens and closes, and whether it is open now.',
        ),
        item(
          'setup#registration-questions',
          'Registration questions',
          'Extra questions participants answer when they register.',
        ),
        item(
          'setup#teams-eligibility',
          'Team size & eligibility',
          'Minimum and maximum team size, declarations and who can take part.',
        ),
      ],
    ),
    group(
      'people',
      'People & Teams',
      [
        item(
          'teams',
          'Teams & participants',
          'Find any team or participant, fix records and manage membership.',
          'critical',
        ),
        item(
          'applications',
          'Application review',
          'Accept, waitlist or reject team applications when screening is used.',
        ),
        item(
          'people',
          'Organising team, judges & staff',
          'Invite co-admins, judges, helping staff and sponsor viewers.',
        ),
        item(
          'access',
          'Access & matching',
          'Access labels and the institutions and tracks used to match judges.',
          'advanced',
        ),
      ],
      'Registrations, teams, applications and the people running the event.',
      false,
      [
        item(
          'teams?view=participants',
          'Participant search',
          'Search every registered participant by name, email or institution.',
        ),
        item(
          'teams?add=1',
          'Add participants',
          'Share the registration link; participants register themselves.',
        ),
      ],
    ),
    group(
      'judging',
      'Judging & Evaluation',
      [
        item(
          'rubric',
          'Rubrics',
          'The criteria and weights judges score against, per round.',
          'critical',
        ),
        item(
          'submissions',
          'Submissions',
          'Who has submitted, late work, extensions and files.',
          'critical',
        ),
        item(
          'judging',
          'Judge assignments & progress',
          'Assign judges, open and close judging, follow every evaluation.',
          'critical',
        ),
        item(
          'briefing',
          'Judge briefing & glossary',
          'What judges read before scoring, and terms explained in context.',
        ),
        item('advancement', 'Round shortlists', 'Choose which teams advance to the next round.'),
        item(
          'calibration',
          'Judge calibration',
          'Compare judges’ scoring and the optional normalisation.',
          'advanced',
        ),
        item(
          'integrity',
          'Project review',
          'Repository checks, integrity notes and market context.',
          'advanced',
        ),
      ],
      'Rubrics, submissions, judge assignments, evaluations and shortlists.',
      false,
      [item('results', 'Results', 'Review ranks and ties, then approve and publish results.')],
    ),
    group(
      'operations',
      'Live Operations',
      [
        item('checkin', 'Check-in', 'Find a team and mark members present.', 'critical'),
        item(
          'support',
          'Helpdesk & exception requests',
          'Questions and exception requests from participants, judges and staff.',
          'critical',
        ),
        item('issues', 'Issues', 'Problems reported by staff and judges on event day.'),
        item('tasks', 'Staff tasks', 'Create, assign and follow up helping staff tasks.'),
        item(
          'engagement',
          'Team engagement',
          'Which teams look active, slipping or inactive.',
          'advanced',
        ),
      ],
      'Event day: check-in, requests, issues and staff tasks.',
      false,
      [item('rounds', 'Event schedule', 'Every round and deadline, in the event’s time zone.')],
    ),
    group(
      'communication',
      'Communication',
      [
        item(
          'communication',
          'Messages & announcements',
          'Write once, choose the audience, and see delivery for every message.',
          'critical',
        ),
      ],
      'Announcements and targeted messages to participants, judges and staff.',
      false,
      [
        item(
          'communication?history=announcements',
          'Announcements',
          'Everyone-in-the-event updates and their history.',
        ),
        item(
          'communication?history=targeted',
          'Targeted messages',
          'Messages to chosen teams, participants, judges or staff.',
        ),
        item(
          'communication?history=targeted&delivery=FAILED',
          'Email delivery problems',
          'Messages that could not be delivered by email.',
        ),
        item(
          'support?tab=general',
          'Questions & responses',
          'Questions from participants and judges, and your answers.',
        ),
      ],
    ),
    group(
      'records',
      'Reports & Records',
      [
        item(
          'results',
          'Results',
          'Review ranks and ties, approve and publish results.',
          'critical',
        ),
        item(
          'feedback',
          'Feedback & reviews',
          'Participant and judge surveys, and judges’ comments for teams.',
        ),
        item('certificates', 'Certificates', 'Design, generate, review and release certificates.'),
        item('report', 'Impact report', 'An aggregate PDF for sponsors and the institution.'),
        item(
          'audit',
          'Audit history',
          'Who changed what and when, with filters and a CSV export.',
          'advanced',
        ),
      ],
      'Results, feedback, certificates, reports and the audit trail.',
      false,
      [item('integrations', 'Exports', 'CSV exports of teams, participants and scores.')],
    ),
  ];
}

/**
 * Role-specific navigation (PRD §5.4). Every role lands on its own dashboard ('' route). Entries marked
 * `primary` are sidebar destinations; the rest are under More (the All areas page and the mobile drawer).
 * Hiding an entry is presentation only; the API enforces permissions.
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
            primary(
              item('', 'My event', 'Your next step, team, submission and updates.', 'critical'),
            ),
            primary(
              item('team', 'My team', 'Members, your invite code, track and problem.', 'critical'),
            ),
            primary(
              item(
                'submission',
                'Submissions',
                'Your team’s work for each round, before the deadline.',
                'critical',
              ),
            ),
            primary(item('rounds', 'Schedule', 'Every round and its official deadline.')),
            primary(
              item('updates', 'Announcements', 'Announcements and messages from the organisers.'),
            ),
          ],
          'Your next step, team, submission and updates.',
        ),
        group(
          'outcomes',
          'Results & certificates',
          [
            item('results', 'Results', 'How your team did, once results are published.'),
            primary(
              item(
                'feedback',
                'Feedback',
                'Tell the organisers how it went, and read judges’ comments.',
              ),
            ),
            primary(
              item('certificates', 'Certificates', 'Download your certificates once released.'),
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
            primary(item('', 'My dashboard', 'Your rounds, progress and deadline.', 'critical')),
            primary(
              item(
                'judge',
                'Assigned teams',
                'The teams assigned to you and their status.',
                'critical',
              ),
            ),
            primary(
              item(
                'briefing',
                'Rubric & briefing',
                'How the rubric works, examples and contacts.',
                'critical',
              ),
            ),
            primary(
              item(
                'practice',
                'Practice team',
                'Try scoring a made-up submission; nothing is saved.',
              ),
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
            primary(item('updates', 'Announcements', 'Announcements from the organisers.')),
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
            primary(
              item('', 'My dashboard', 'Check-in, your tasks and issue reports.', 'critical'),
            ),
            primary(
              item(
                'tasks',
                'My tasks',
                'What you have been asked to do, overdue first.',
                'critical',
              ),
            ),
            primary(
              item('checkin', 'Check-in', 'Find a team and mark members present.', 'critical'),
            ),
            primary(item('issues', 'Issues', 'Report a problem and follow what you reported.')),
          ],
          'Check-in, your tasks and issue reports.',
        ),
        group(
          'help',
          'Help & updates',
          [
            primary(item('updates', 'Announcements', 'Announcements from the organisers.')),
            primary(item('guidebook', 'Schedule & rules', 'The event’s rules and schedule.')),
            item('support', 'Helpdesk', 'Questions from participants and judges.'),
          ],
          'Announcements, the helpdesk and the guidebook.',
        ),
      ];
  }
}

/** A sidebar destination: an admin domain or a role's primary page. */
export interface SidebarEntry {
  id: string;
  label: string;
  /** Path under /events/:eventId ('' is the role's dashboard). */
  to: string;
  /** Whether this entry is the current location. */
  match: (section: string, groupId: string | null) => boolean;
}

/** Sidebar destinations for a role: the seven domains for Core Admins, primary pages for everyone else. */
export function sidebarFor(role: Role): SidebarEntry[] {
  const groups = navFor(role);
  if (role === 'ADMIN')
    return groups.map((g) => ({
      id: g.id,
      label: g.label,
      to: areaPath(g.id),
      match: (_section, groupId) => groupId === g.id,
    }));
  return navItems(groups)
    .filter((i) => i.primary)
    .map((i) => ({
      id: i.to || 'home',
      label: i.label,
      to: i.to,
      match: (section) => resolveSection(groups, section) === segmentOf(i.to),
    }));
}

/**
 * Four destinations for the small-screen bottom bar, taken from the same definitions as every other entry
 * point so they can never disagree. The fifth slot is always More (the full navigation drawer).
 */
const BOTTOM_BAR: Record<Role, string[]> = {
  ADMIN: ['command', 'people', 'judging', 'operations'],
  PARTICIPANT: ['home', 'team', 'submission', 'updates'],
  JUDGE: ['home', 'judge', 'briefing', 'updates'],
  STAFF: ['home', 'tasks', 'checkin', 'issues'],
};

export function bottomBarFor(role: Role): SidebarEntry[] {
  const all = sidebarFor(role);
  return BOTTOM_BAR[role]
    .map((id) => all.find((i) => i.id === id))
    .filter((i): i is SidebarEntry => Boolean(i));
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

/** Old domain landing-page ids (UX v1.0) mapped to the current ones, so bookmarked area pages still open. */
export const LEGACY_AREAS: Record<string, string> = {
  dashboard: 'command',
  setup: 'configuration',
  registrations: 'people',
  administration: 'records',
  evaluation: 'judging',
  results: 'records',
};
