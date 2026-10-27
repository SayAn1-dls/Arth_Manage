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
        entry('applications', 'Application review', 'Run the event'),
        entry('helpdesk', 'Helpdesk', 'Run the event'),
        entry('exceptions', 'Exception requests', 'Run the event'),
        entry('communications', 'Targeted messages', 'Run the event'),
        entry('engagement', 'Team engagement', 'Run the event'),
        entry('advancement', 'Round shortlists', 'Judging and results'),
        entry('calibration', 'Judge calibration', 'Judging and results'),
        entry('integrity', 'Project review', 'Judging and results'),
        entry('briefing', 'Judge briefing & glossary', 'Judging and results'),
        entry('rubric', 'Rubric', 'Judging and results'),
        entry('judging', 'Judging', 'Judging and results'),
        entry('results', 'Results', 'Judging and results'),
        entry('tasks', 'Staff tasks', 'Event day'),
        entry('checkin', 'Check-in', 'Event day'),
        entry('issues', 'Issues', 'Event day'),
        entry('sandbox', 'Practice workspace', 'Set up'),
        entry('access', 'Access and matching', 'Set up'),
        entry('setup', 'Setup', 'Set up'),
        entry('rounds', 'Rounds and deadlines', 'Set up'),
        entry('structure', 'Tracks and problems', 'Set up'),
        entry('guidebook', 'Guidebook', 'Set up'),
        entry('announcements', 'Announcements', 'Set up'),
        entry('integrations', 'Integrations', 'Set up'),
        entry('report', 'Impact report', 'After the event'),
        entry('feedback', 'Feedback', 'After the event'),
        entry('certificates', 'Certificates', 'After the event'),
        entry('audit', 'Audit history', 'Records'),
      ];
    case 'PARTICIPANT':
      return [
        entry('', 'Overview', 'My event', true),
        entry('team', 'My team', 'My event'),
        entry('messages', 'Event messages', 'My event'),
        entry('applications', 'Application status', 'My event'),
        entry('integrity', 'Project feedback', 'My event'),
        entry('helpdesk', 'Ask Admin', 'My event'),
        entry('exceptions', 'Request exception', 'My event'),
        entry('discovery', 'Find teammates', 'My event'),
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
        entry('briefing', 'Pinned briefing'),
        entry('practice', 'Practice team'),
        entry('helpdesk', 'Ask Admin'),
        entry('integrity', 'Market context'),
        entry('feedback', 'Feedback'),
        entry('guidebook', 'Guidebook'),
        entry('announcements', 'Announcements'),
      ];
    case 'STAFF':
      return [
        entry('', 'Overview', undefined, true),
        entry('tasks', 'My tasks'),
        entry('checkin', 'Check-in'),
        entry('issues', 'Report an issue'),
        entry('helpdesk', 'Helpdesk'),
        entry('guidebook', 'Guidebook'),
        entry('announcements', 'Announcements'),
      ];
  }
}
