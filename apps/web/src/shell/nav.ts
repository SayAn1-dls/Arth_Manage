import type { Role } from '@arthakram/shared';
import type { CollapsibleNavGroup, CollapsibleNavItem } from '../ui/CollapsibleNav.js';

export type NavGroup = CollapsibleNavGroup;
export type NavEntry = CollapsibleNavItem;

const item = (to: string, label: string, end = false): NavEntry => ({ to, label, end });
const group = (id: string, label: string, items: NavEntry[]): NavGroup => ({ id, label, items });

/** Every destination across all groups, in menu order. */
export const navItems = (groups: NavGroup[]): NavEntry[] => groups.flatMap((g) => g.items);

/** The group holding the page at `section` (first path segment under /events/:eventId; '' is the overview). */
export function activeGroupId(groups: NavGroup[], section: string): string | null {
  return groups.find((g) => g.items.some((i) => i.to.split('/')[0] === section))?.id ?? null;
}

/**
 * Role-specific navigation (PRD §5.4). Entries are added as each feature ships, so the menu never links
 * to a screen that does not exist. Hiding an entry is presentation only; the API enforces permissions.
 */
export function navFor(role: Role): NavGroup[] {
  switch (role) {
    case 'ADMIN':
      return [
        group('run', 'Run the event', [
          item('', 'Overview', true),
          item('participants', 'Participants'),
          item('teams', 'Teams'),
          item('submissions', 'Submissions'),
          item('people', 'People'),
          item('applications', 'Application review'),
          item('helpdesk', 'Helpdesk'),
          item('exceptions', 'Exception requests'),
          item('communications', 'Targeted messages'),
          item('engagement', 'Team engagement'),
        ]),
        group('judging', 'Judging and results', [
          item('advancement', 'Round shortlists'),
          item('calibration', 'Judge calibration'),
          item('integrity', 'Project review'),
          item('briefing', 'Judge briefing & glossary'),
          item('rubric', 'Rubric'),
          item('judging', 'Judging'),
          item('results', 'Results'),
        ]),
        group('event-day', 'Event day', [
          item('tasks', 'Staff tasks'),
          item('checkin', 'Check-in'),
          item('issues', 'Issues'),
        ]),
        group('setup', 'Set up', [
          item('sandbox', 'Practice workspace'),
          item('access', 'Access and matching'),
          item('setup', 'Setup'),
          item('rounds', 'Rounds and deadlines'),
          item('structure', 'Tracks and problems'),
          item('guidebook', 'Guidebook'),
          item('announcements', 'Announcements'),
          item('integrations', 'Integrations'),
        ]),
        group('after', 'After the event', [
          item('report', 'Impact report'),
          item('feedback', 'Feedback'),
          item('certificates', 'Certificates'),
        ]),
        group('records', 'Records', [item('audit', 'Audit history')]),
      ];
    case 'PARTICIPANT':
      return [
        group('workspace', 'My workspace', [
          item('', 'Overview', true),
          item('team', 'My team'),
          item('discovery', 'Find teammates'),
          item('profile', 'My details'),
        ]),
        group('participation', 'Participation', [
          item('applications', 'Application status'),
          item('submission', 'Submission'),
          item('integrity', 'Project feedback'),
          item('exceptions', 'Request exception'),
          item('results', 'Results'),
          item('certificates', 'Certificates'),
        ]),
        group('resources', 'Information', [
          item('rounds', 'Rounds and deadlines'),
          item('structure', 'Tracks and problems'),
          item('guidebook', 'Guidebook'),
          item('announcements', 'Announcements'),
        ]),
        group('communication', 'Communication', [
          item('messages', 'Event messages'),
          item('helpdesk', 'Ask Admin'),
          item('feedback', 'Feedback'),
        ]),
      ];
    case 'JUDGE':
      return [
        group('judging', 'Judging', [
          item('', 'Overview', true),
          item('judge', 'My teams'),
          item('practice', 'Practice team'),
          item('integrity', 'Market context'),
        ]),
        group('resources', 'Resources', [
          item('briefing', 'Pinned briefing'),
          item('guidebook', 'Guidebook'),
          item('announcements', 'Announcements'),
        ]),
        group('communication', 'Communication', [
          item('helpdesk', 'Ask Admin'),
          item('feedback', 'Feedback'),
        ]),
      ];
    case 'STAFF':
      return [
        group('tasks', 'My tasks', [item('', 'Overview', true), item('tasks', 'My tasks')]),
        group('operations', 'Event operations', [
          item('checkin', 'Check-in'),
          item('issues', 'Report an issue'),
        ]),
        group('info', 'Help and information', [
          item('helpdesk', 'Helpdesk'),
          item('guidebook', 'Guidebook'),
          item('announcements', 'Announcements'),
        ]),
      ];
  }
}
