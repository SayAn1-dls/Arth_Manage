# UX implementation audit — Command Centre restructuring (Nov 2026)

Branch: `feature/arthakram-command-centre`, cut from `feature/arthakram-ux-overhaul` at `1adace3`.
Earlier history: `docs/UX_RESTRUCTURING_PLAN.md` (consolidations and the v1.0 layout).

## 1. Sources used

| Source | Where | Status |
|---|---|---|
| PRD | `docs/PRD-Hackathon-and-Case-Competition-Platform.pdf` | In repo |
| Primary UX audit ("ArthManage Admin Panel — Navigation & Feature Consolidation Audit") | Owner's local copy | Read; **not committed** |
| Secondary UX document ("ArthManage: Navigation & Information Architecture") | Owner's local copy | Read; **not committed** |
| Core Admin dashboard reference ("Arthakram Event Command Centre", screenshot) | Owner's local copy | Read; **not committed** |
| Brand Kit v2.0 | Owner's local copy; rules summarised in `docs/BRAND_IMPLEMENTATION.md` | Read; **not committed** |
| Technical architecture, implementation plan, decisions, release readiness | `docs/` | In repo |

## 2. Problems found in the v1.0 layout

1. **No persistent navigation.** v1.0 removed the sidebar; every move between areas went through
   breadcrumbs or the All areas page. Users lost their sense of place.
2. **Generic dashboard.** The admin dashboard led with six division cards and a stage strip; the
   reference puts the event, its numbers, the registration trend, quick actions and attention first.
3. **No real metrics.** There was no judge count, no registration history and no setup percentage in
   the API, so a reference-style dashboard could not be built honestly.
4. **Division pages were link lists.** Every card looked the same and carried little state.
5. **Problem statements were buried** under "Setup" with nothing telling an organiser that a track had
   none; the backend had no check for it.
6. **Quick actions had no landing point.** "Add deadline", "Send announcement" and "Add participant"
   had no anchor or panel to open.
7. **Inconsistent page tops.** Each workspace had its own heading pattern; most had no statement of
   purpose and no primary action placement.
8. **Role homes looked unrelated** to each other and to the admin dashboard.
9. **Mobile:** a bottom bar existed but no full navigation drawer.
10. **Dead code:** an expandable-tree navigation component (and tests) remained although nothing used it.
11. **Bug:** while the event list loaded, the context panel requested `/events//rounds` and similar.

## 3. Route → domain map (Core Admin)

Every route belongs to exactly one domain (breadcrumb and sidebar highlight). Domains also show
*shortcut cards* into a workspace owned elsewhere when that task is commonly started from there.

| Domain | Owned routes | Shortcut cards |
|---|---|---|
| Command Centre | `''` (dashboard) | — |
| Event Configuration | `setup`, `rounds`, `structure`, `guidebook`, `integrations`*, `sandbox`* | `setup#publishing`, `setup#registration-questions`, `setup#teams-eligibility` |
| People & Teams | `teams` (+ `teams/:id`, `participants/:id`), `applications`, `people`, `access`* | `teams?view=participants`, `teams?add=1` |
| Judging & Evaluation | `rubric`, `submissions` (+ detail), `judging`, `briefing`, `advancement`, `calibration`*, `integrity`* | `results` |
| Live Operations | `checkin`, `support`, `issues`, `tasks`, `engagement`* | `rounds` (event schedule) |
| Communication | `communication` | announcements, targeted, failed deliveries, `support?tab=general` |
| Reports & Records | `results`, `feedback`, `certificates`, `report`, `audit`* | `integrations` (exports) |

`*` advanced: folded behind "Advanced tools" on the landing page. Integrations is also the sidebar's
secondary "Integrations & settings" destination (no eighth domain).

## 4. Role → navigation

| Role | Sidebar | Bottom bar (+ More) |
|---|---|---|
| Core Admin / organiser (`ADMIN`) | 7 domains + Integrations & settings | Command Centre, People & Teams, Judging, Live ops |
| Participant | My event, My team, Submissions, Schedule, Announcements, Feedback, Certificates + More | Home, Team, Submissions, Updates |
| Judge | My dashboard, Assigned teams, Rubric & briefing, Practice team, Announcements + More | Home, Teams, Rubric, Updates |
| Helping staff | My dashboard, My tasks, Check-in, Issues, Announcements, Schedule & rules + More | Home, Tasks, Check-in, Issues |
| Sponsor viewer (`ADMIN` + `SPONSOR_VIEWER`) | none: impact report only (unchanged) | none |

There is no separate "organiser" role in the data model: event organisers are `ADMIN` members of an
event, with `CO_ADMIN`/`SPONSOR_VIEWER` access labels. Their access is event-scoped by the API
(`eventContext` + permission matrix), not global, so the navigation above never widens anything.

## 5. Redundancy removed or consolidated

| Before | After |
|---|---|
| Six division cards on the dashboard and on All areas | Sidebar domains; the dashboard follows the reference |
| Stage strip + Next steps on the dashboard | Stage shown in Event at a glance; setup steps on Event Configuration (checklist); attention items on the dashboard |
| Deadlines on domain pages and in the panel | Panel only (and dashboard) |
| Separate headings/paragraph patterns per page | One `PageHeader` |
| Expandable tree nav component (unused) | Removed |
| Track footer on every grouped problem card | Removed (the group heading says it) |

Earlier consolidations (Teams + Participants, Helpdesk + Exceptions, Announcements + Targeted,
Feedback + Team comments) are unchanged; their redirects still work.

## 6. Backend data gaps closed

`GET /events/:id/dashboard` (admin-only, unchanged authorisation) gained: `people` (judges, invites,
staff, admins), `trend` (daily registrations and teams in the event time zone), `setup` (stage-
independent checklist and percentage), `config` and `records` summaries, the event day in
`deadlines`, and an attention item for tracks without problem statements. No schema change.
