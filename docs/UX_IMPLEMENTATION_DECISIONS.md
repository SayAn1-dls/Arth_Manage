# UX implementation decisions — Command Centre restructuring (Nov 2026)

Approved product decisions (owner's brief) are final; this file records how they were applied, the
reasons for smaller choices, and where the build deviates from the dashboard reference.

## Applied decisions

| # | Decision | How it is built |
|---|---|---|
| 1 | Persistent, compact, expandable sidebar | `shell/Sidebar.tsx`: icon + label, collapses to icons with tooltips, remembered in `localStorage` (`ak.sidebar.v1`), arrow-key navigation, active domain marked with an Ember bar and `aria-current` |
| 2 | Domain opens a landing page, never a tree | `area/:domain` (`features/events/AreasPage.tsx`); the sidebar has no nested items |
| 3 | Contextual right panel | `shell/ContextPanel.tsx`: attention for this domain (task pages only), still-to-do steps, deadlines, contextual shortcuts; hidden on homes; toggle remembered (`ak.panel.v1`); fold-out below `xl` |
| 4 | Dashboard follows the reference | `features/ops/CommandCentre.tsx` |
| 5 | Bottom bar and full drawer on mobile | `shell/MobileNav.tsx` |
| 6 | Frontend plus necessary backend | Only the dashboard endpoint and lifecycle grew; no schema change |
| 7 | Simplify, keep capabilities | Nothing user-facing was removed; see the audit, section 5 |

## Smaller decisions

- **D-UX-1 Every route has one home domain.** Breadcrumbs and the sidebar highlight come from it.
  Cross-domain tasks (Results under Judging, Exports under Records) are shortcut cards, never duplicate
  routes.
- **D-UX-2 Status labels are derived, never typed in.** `taskState()` reads the dashboard payload only;
  a shortcut into a page section never inherits the whole page's status. Unknown means no label.
- **D-UX-3 Trends only from stored history.** Metric cards show "↑ N this week" from `createdAt`, not
  invented percentage growth; judges show pending invitations instead when there are any.
- **D-UX-4 The registration chart is a running total of registrations received** (including later
  withdrawals), bucketed by day in the event's time zone. The card shows *active* registrations; the
  chart caption says so.
- **D-UX-5 Setup completion counts required steps only.** Optional steps (custom questions, staff)
  never lower the percentage.
- **D-UX-6 "Add participant" shares the registration link.** Accounts are personal (own email
  verification and declarations), and the API has no organiser-creates-participant flow; adding one
  would change the consent model. The quick action opens an "Add participants" panel with the link,
  its state and a copy button.
- **D-UX-7 Global search is permission-aware by construction.** Workspaces come from the caller's own
  navigation; only Core Admins query teams, participants and judges, through the same list endpoints
  the pages use (the API enforces access again).
- **D-UX-8 Notifications reuse loaded data.** Admins: attention items. Others: latest announcements,
  with a per-device "seen" marker. No new endpoint.
- **D-UX-9 Ember is never a text colour.** Icons use `stroke-ember` (decorative), links and labels are
  Ink/Graphite. This keeps the brand lint rule and the kit's contrast table.
- **D-UX-10 Grids respond to the workspace, not the window** (container queries), so opening the side
  panel never squeezes cards.

## Deviations from the reference screenshot

| Reference | Build | Why |
|---|---|---|
| Orange text links ("View Event", "View All") | Ink text with an Ember arrow | Ember on Paper/White is 2.69–2.93:1 and fails WCAG; the kit forbids it |
| Percentage trends (↑ 8%) | "↑ N this week" or nothing | No stored baseline for a percentage; fabricating one is not allowed |
| Campus illustration top-right | Omitted | No licensed asset in the kit; not invented |
| Large decorative feather in the sidebar | Omitted | The kit forbids recolouring or fading the logo artwork |
| Integrations & Settings as an eighth sidebar item | Secondary item at the sidebar foot | Brief: no eighth primary domain |
| Single attention line | Top item plus the next three, expandable | Real events have several items; each still links to its workspace |
| Event activity feed | Not added | It would duplicate the audit history and the attention list |
