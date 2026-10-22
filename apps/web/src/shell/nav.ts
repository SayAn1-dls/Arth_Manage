import type { Role } from '@arthakram/shared';

export interface NavEntry {
  to: string; // relative to /events/:eventId
  label: string;
  end?: boolean;
  /** Section heading shown above the first entry of each group on wide screens. */
  group?: string;
}

const entry = (to: string, label: string, group?: string, end = false): NavEntry => ({
  to,
  label,
  group,
  end,
});

/**
 * Role-specific navigation (PRD §5.4). Entries are added as each feature ships, so the menu never links
 * to a screen that does not exist. Hiding an entry is presentation only; the API enforces permissions.
 */
export function navFor(role: Role): NavEntry[] {
  switch (role) {
    case 'ADMIN':
      return [
        entry('', 'Overview', 'Run the event', true),
        entry('participants', 'Participants', 'Run the event'),
        entry('teams', 'Teams', 'Run the event'),
        entry('submissions', 'Submissions', 'Run the event'),
        entry('people', 'People', 'Run the event'),
        entry('rubric', 'Rubric', 'Judging and results'),
        entry('judging', 'Judging', 'Judging and results'),
        entry('results', 'Results', 'Judging and results'),
        entry('tasks', 'Staff tasks', 'Event day'),
        entry('checkin', 'Check-in', 'Event day'),
        entry('issues', 'Issues', 'Event day'),
        entry('setup', 'Setup', 'Set up'),
        entry('rounds', 'Rounds and deadlines', 'Set up'),
        entry('structure', 'Tracks and problems', 'Set up'),
        entry('guidebook', 'Guidebook', 'Set up'),
        entry('announcements', 'Announcements', 'Set up'),
        entry('integrations', 'Integrations', 'Set up'),
        entry('feedback', 'Feedback', 'After the event'),
        entry('certificates', 'Certificates', 'After the event'),
        entry('audit', 'Audit history', 'Records'),
      ];
    case 'PARTICIPANT':
      return [
        entry('', 'Overview', 'My event', true),
        entry('team', 'My team', 'My event'),
        entry('submission', 'Submission', 'My event'),
        entry('results', 'Results', 'My event'),
        entry('feedback', 'Feedback', 'My event'),
        entry('certificates', 'Certificates', 'My event'),
        entry('profile', 'My details', 'My event'),
        entry('rounds', 'Rounds and deadlines', 'Information'),
        entry('structure', 'Tracks and problems', 'Information'),
        entry('guidebook', 'Guidebook', 'Information'),
        entry('announcements', 'Announcements', 'Information'),
      ];
    case 'JUDGE':
      return [
        entry('', 'Overview', undefined, true),
        entry('judge', 'My teams'),
        entry('feedback', 'Feedback'),
        entry('certificates', 'Certificates'),
        entry('guidebook', 'Guidebook'),
        entry('announcements', 'Announcements'),
      ];
    case 'STAFF':
      return [
        entry('', 'Overview', undefined, true),
        entry('tasks', 'My tasks'),
        entry('checkin', 'Check-in'),
        entry('issues', 'Report an issue'),
        entry('certificates', 'Certificates'),
        entry('guidebook', 'Guidebook'),
        entry('announcements', 'Announcements'),
      ];
  }
}
