# UX implementation progress — Command Centre restructuring

Branch `feature/arthakram-command-centre` (from `feature/arthakram-ux-overhaul` at `1adace3`). Pushed to
`origin`. Not merged into `main`.

## Completed

| Phase | What | Commit |
|---|---|---|
| 1 Audit | `UX_IMPLEMENTATION_AUDIT.md`: problems, route → domain map, role map, redundancy, data gaps | docs commit |
| 2 Shell | Sidebar (7 domains, collapsible, remembered), header (event switcher, search ⌘K, notifications, account), context panel, bottom bar, drawer | `87dc7bc` |
| 3 Dashboard | Command Centre after the reference, real data only | `87dc7bc` |
| 4 Domains | Seven landing pages: live figures, attention here, critical/everyday/advanced task cards with derived status, shortcuts; setup checklist | `b56dbda` |
| 5 Workspaces | Shared `PageHeader` on every workspace; Tracks & problem statements rebuilt around coverage; Rounds opens the new-round form from shortcuts; Add participants panel; message composer anchor | `c2b7ef4`, `85155cb` |
| 6 Roles | Shared greeting + event-at-a-glance; participant, judge and staff homes; role sidebars and bottom bars | `87dc7bc`, `c2b7ef4` |
| 7 Context | Panel: attention for this domain on task pages, still-to-do steps, deadlines, domain shortcuts; hidden on homes | `87dc7bc` |
| 8 Responsive | 375/390/768/1024/1440 checked; overflow fixes in header and homes | `c2b7ef4` and the final commit |

## Backend changes

`GET /api/v1/events/:id/dashboard` (Core Admin only, existing `requireAction('event.edit')` +
`adminOnly`) gained `people`, `trend`, `setup`, `config`, `records`; `deadlines` now includes the event
day and returns up to six. `eventLifecycle` adds "N tracks without a problem statement". New helper
`setupChecklist()`. No schema or migration change, no new endpoint. Covered by
`apps/api/src/modules/staff/staff.test.ts`.

## Checks (final run)

| Check | Result |
|---|---|
| `npm run typecheck` (web, api) | pass |
| `npx eslint apps/web/src e2e apps/api/src/modules/ops` | pass |
| `node scripts/lint-brand.mjs` | pass |
| Web unit tests (`apps/web`, vitest) | 5 files, 62 tests pass |
| API tests (`apps/api`, vitest, full suite) | 25 files, 408 tests pass |
| Playwright e2e | **not run in this session** (needs the API started with `EMAIL_PROVIDER=console RATE_LIMIT_DISABLED=true`; see README). Helpers and the four renamed labels were updated |

## Browser verification (local dev, seeded data)

- Core Admin, 1440 px: Command Centre, all seven domain landing pages, Tracks & problem statements,
  panel open/closed, sidebar collapse; 1024 px: Command Centre (header overflow found and fixed).
- Participant (Asha), 1440 and 375 px: home, drawer (full navigation), bottom bar; 375 px overflow
  found and fixed.
- Judge (Jaya), 375 px: home with no assignments (empty state), bottom bar.
- Helping staff (Sahil), 1440 px: home; global search offers only staff workspaces; `area/configuration`
  and `setup` show "This page isn't available".
- Overflow sweep with same-origin frames at 390 and 768 px over 29 admin routes (results below).

## Known issues and remaining work

- Largest workspaces (Results, Certificates, Support, Judging, Evaluation) now share the header but are
  not yet re-sectioned internally by critical / important / advanced.
- Judge evaluation workspace was not changed (it already keeps submission, rubric and scoring together;
  see `docs/JUDGE_WORKSPACE.md`).
- No organiser-specific home: organisers are event-scoped `ADMIN` members and get the Command Centre;
  their API permissions are unchanged.
- The two Vercel projects connected to the GitHub repository still fail on every push; they must be
  deleted in the Vercel dashboard (see `docs/DEPLOYMENT.md`). Render is the deployment.
- e2e journeys need a run against a dev API started as described above.
