import type { Role } from '@arthakram/shared';

export interface NavEntry {
  to: string; // relative to /events/:eventId
  label: string;
  end?: boolean;
}

/**
 * Role-specific navigation (PRD §5.4). Entries are added as each feature ships, so the menu never links
 * to a screen that does not exist. Hiding an entry is presentation only; the API enforces permissions.
 */
export function navFor(role: Role): NavEntry[] {
  const common: NavEntry[] = [{ to: '', label: 'Overview', end: true }];
  switch (role) {
    case 'ADMIN':
    case 'JUDGE':
    case 'STAFF':
    case 'PARTICIPANT':
      return common;
  }
}
