// Screens added per phase for scripts/visual-qa.mjs. `{event}` is the demo event id; `as` is a seeded account key.
export const screens = [
  // Phase 2: events, rounds, guidebook
  { name: 'public-event', path: '/e/hacksonipat-2026' },
  { name: 'create-event', path: '/events/new', as: 'admin' },
  { name: 'setup-admin', path: '/events/{event}/setup', as: 'admin' },
  { name: 'rounds-admin', path: '/events/{event}/rounds', as: 'admin' },
  { name: 'structure-admin', path: '/events/{event}/structure', as: 'admin' },
  { name: 'guidebook-admin', path: '/events/{event}/guidebook', as: 'admin' },
  { name: 'guidebook-participant', path: '/events/{event}/guidebook', as: 'asha' },
  { name: 'announcements-admin', path: '/events/{event}/announcements', as: 'admin' },
  { name: 'announcements-judge', path: '/events/{event}/announcements', as: 'judge1' },
];
