/**
 * Permission matrix, PRD §8.1. This is data, not logic: the server's `can()` reads it, the UI may read it
 * to decide what to show, and the generated test harness iterates it so every cell is covered.
 *
 * NONE      no access (out-of-scope records answer "not found")
 * OWN       only the user's own record, own team or own submission
 * ASSIGNED  only records assigned to the user
 * READ      read-only access to published/event-level information
 * FULL      all records of the event
 */
export const ROLES = ['ADMIN', 'JUDGE', 'STAFF', 'PARTICIPANT'] as const;
export type Role = (typeof ROLES)[number];

export const SCOPES = ['NONE', 'OWN', 'ASSIGNED', 'READ', 'FULL'] as const;
export type Scope = (typeof SCOPES)[number];

type Row = Record<Role, Scope>;
const row = (ADMIN: Scope, JUDGE: Scope, STAFF: Scope, PARTICIPANT: Scope): Row => ({
  ADMIN,
  JUDGE,
  STAFF,
  PARTICIPANT,
});

export const PERMISSIONS = {
  'event.view': row('FULL', 'READ', 'READ', 'READ'),
  'event.edit': row('FULL', 'NONE', 'NONE', 'NONE'),
  'participants.manage': row('FULL', 'NONE', 'READ', 'OWN'),
  'team.edit': row('FULL', 'NONE', 'NONE', 'OWN'),
  'team.view': row('FULL', 'ASSIGNED', 'READ', 'OWN'),
  'checkin.record': row('FULL', 'NONE', 'FULL', 'NONE'),
  'submission.view': row('FULL', 'ASSIGNED', 'NONE', 'OWN'),
  'submission.upload': row('NONE', 'NONE', 'NONE', 'OWN'),
  'submission.edit': row('NONE', 'NONE', 'NONE', 'OWN'),
  'submission.unlock': row('FULL', 'NONE', 'NONE', 'NONE'),
  'rubric.view': row('FULL', 'ASSIGNED', 'NONE', 'NONE'),
  'rubric.edit': row('FULL', 'NONE', 'NONE', 'NONE'),
  'judges.assign': row('FULL', 'NONE', 'NONE', 'NONE'),
  'score.enter': row('NONE', 'ASSIGNED', 'NONE', 'NONE'),
  'score.editSubmitted': row('NONE', 'OWN', 'NONE', 'NONE'),
  'score.view': row('FULL', 'OWN', 'NONE', 'NONE'),
  'judgeComments.view': row('FULL', 'OWN', 'NONE', 'OWN'),
  'results.viewAggregate': row('FULL', 'NONE', 'NONE', 'OWN'),
  'results.approve': row('FULL', 'NONE', 'NONE', 'NONE'),
  'results.publish': row('FULL', 'NONE', 'NONE', 'NONE'),
  'feedbackForms.manage': row('FULL', 'NONE', 'NONE', 'NONE'),
  'feedback.viewResponses': row('FULL', 'NONE', 'NONE', 'NONE'),
  'feedback.submit': row('NONE', 'OWN', 'NONE', 'OWN'),
  'certificates.manage': row('FULL', 'NONE', 'NONE', 'NONE'),
  'certificates.release': row('FULL', 'NONE', 'NONE', 'NONE'),
  'certificates.download': row('FULL', 'OWN', 'OWN', 'OWN'),
  'export.csv': row('FULL', 'NONE', 'NONE', 'NONE'),
  'integrations.manage': row('FULL', 'NONE', 'NONE', 'NONE'),
  'audit.view': row('FULL', 'NONE', 'NONE', 'NONE'),
  'staffTasks.manage': row('FULL', 'NONE', 'ASSIGNED', 'NONE'),
  'issues.report': row('FULL', 'NONE', 'OWN', 'NONE'),
  'announcements.post': row('FULL', 'NONE', 'NONE', 'NONE'),
  'announcements.view': row('FULL', 'READ', 'READ', 'READ'),
  'members.manage': row('FULL', 'NONE', 'NONE', 'NONE'),
} as const satisfies Record<string, Row>;

export type Action = keyof typeof PERMISSIONS;
export const ACTIONS = Object.keys(PERMISSIONS) as Action[];

export function scopeFor(role: Role, action: Action): Scope {
  return PERMISSIONS[action][role];
}

/** True when the role has any access at all to the action (before OWN/ASSIGNED checks on the record). */
export function roleMayAttempt(role: Role, action: Action): boolean {
  return scopeFor(role, action) !== 'NONE';
}
