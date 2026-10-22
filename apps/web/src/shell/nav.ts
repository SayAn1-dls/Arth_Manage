import type { Role } from '@arthakram/shared';

export interface NavEntry {
  to: string; // relative to /events/:eventId
  label: string;
  end?: boolean;
}

const overview: NavEntry = { to: '', label: 'Overview', end: true };
const guidebook: NavEntry = { to: 'guidebook', label: 'Guidebook' };
const announcements: NavEntry = { to: 'announcements', label: 'Announcements' };
const schedule: NavEntry = { to: 'rounds', label: 'Rounds and deadlines' };
const tracks: NavEntry = { to: 'structure', label: 'Tracks and problems' };

/**
 * Role-specific navigation (PRD §5.4). Entries are added as each feature ships, so the menu never links
 * to a screen that does not exist. Hiding an entry is presentation only; the API enforces permissions.
 */
export function navFor(role: Role): NavEntry[] {
  switch (role) {
    case 'ADMIN':
      return [
        overview,
        { to: 'setup', label: 'Setup' },
        schedule,
        tracks,
        guidebook,
        announcements,
      ];
    case 'PARTICIPANT':
      return [overview, schedule, tracks, guidebook, announcements];
    case 'JUDGE':
    case 'STAFF':
      return [overview, guidebook, announcements];
  }
}
