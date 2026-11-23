# UX restructuring plan

Branch `feature/arthakram-ux-overhaul`, cut from `v1_runthrough` at `7168b0f` on 23 Nov 2026.

**Sources, in order of authority:**
1. *ArthManage Admin Panel – Navigation & Feature Consolidation Audit* (PDF, local reference, not committed). It is the information architecture specification for Core Admin: seven divisions, the page-to-destination table and four consolidations.
2. *Arthakram Event Platform – Product and UI/UX Audit* (23 Nov 2026, delivered in chat). It covers cross-product quality: 10 P0 and 31 P1 findings, mobile and accessibility. IDs such as P0-04 refer to it.
3. PRD, `DECISIONS.md` and `BRAND_IMPLEMENTATION.md`. These are not changed by this work, except where a row below says so.

**Direction:** less navigation, more direction. Nobody should need to know Arthakram's internal feature structure to do their job.

---

## 1. Current information architecture (before)

Every route lives under `/events/:eventId`. `EventLayout` renders a child only when its first path segment is in the caller's `navFor(role)` list. The API enforces every permission independently.

| Role | Navigation today | Items |
|---|---|---|
| Core Admin | Run the event (10) · Judging and results (7) · Event day (3) · Set up (8) · After the event (3) · Records (1) | 32 |
| Participant | My workspace (4) · Participation (6) · Information (4) · Communication (3) | 17 |
| Judge | Judging (4) · Resources (3) · Communication (2) | 9 |
| Helping Staff | My tasks (2) · Event operations (2) · Help and information (3) | 7 |
| Sponsor viewer | Impact report only (redirected from every other page) | 1 |

### 1.1 Page inventory

**Conventions in this table:**
- `{E}` is `/api/v1/events/:eventId`.
- **Type** says what the page becomes: **page** (standalone), **tab** (view inside a consolidated page), **redirect** (old path forwards to the new one), **context** (a summary on another page that links to the real home).
- **Critical logic** marks business rules that must survive unchanged.

| Route | Component | Roles | Main actions | Main API calls | Proposed destination (admin) | Type | Duplicates | Critical logic |
|---|---|---|---|---|---|---|---|---|
| *(index)* | `EventOverviewPage` | all | Admin: dashboard cards / draft checklist. Others: role panels | `{E}`, `{E}/rounds`, `{E}/announcements`, `{E}/guidebook`, `{E}/publish-checks`, `{E}/dashboard` | **Dashboard** | page | Latest announcements duplicated Announcements; draft checklist duplicated publish checks | Dashboard counts must match the lists they link to |
| `setup` | `SetupPage` | Admin | Details, publish/unpublish, registration open/close and schedule, conclude, archive, registration questions | `PATCH {E}`, `/publish`, `/unpublish`, `/registration`, `/conclude`, `/archive`, `/registration-fields` | Setup › Event configuration › **Event details & publishing** | page (sectioned, P1-27) | – | Publish checks; conclude/archive rules (D-30); field deletion rules |
| `rounds` | `RoundsPage` | Admin, Participant | Add, edit, delete round; submission form editor | `{E}/rounds`, `/rounds/:id/form` | Setup › Event configuration › Rounds & deadlines | page | – | Deadline-change reason; delete-in-use (D-35) |
| `structure` | `StructurePage` | Admin, Participant | Add or delete tracks and problems | `{E}/tracks`, `{E}/problems` | Setup › Event configuration › Tracks & problems | page | – | Delete-in-use (D-35) |
| `guidebook` | `GuidebookPage` | all | Editor with autosave and publish; reader | `/guidebook/draft`, `/guidebook/publish`, `/guidebook` | Setup › Event resources › Guidebook | page | – | Optimistic lock; published versions |
| `integrations` | `IntegrationsPage` | Admin | Google connect, sync, drive, CSV | `{E}/integrations/*` | Setup › Event resources › Integrations | page | – | Consent checkbox; honest status (PRD-D4) |
| `teams` | `TeamsPage` | Admin | Search, filters, CSV | `GET {E}/teams` | Registrations & people › **Teams & participants** (Teams view) | page | Same people as Participants | – |
| `participants` | `ParticipantsPage` | Admin | Search, filters, CSV | `GET {E}/participants` | Teams & participants (Participants view) | redirect → `teams?view=participants` | Same people as Teams | – |
| `teams/:teamId` | `TeamDetailPage` | Admin | Rename, track/problem, add/remove member, leader, disqualify/reinstate, history | `{E}/teams/:id/*` | Team detail inside Teams & participants | page | – | Disqualify reason; team size rules |
| `participants/:id` | `ParticipantDetailPage` | Admin | Correct record, remove (reason) | `{E}/participants/:id` | Participant detail inside Teams & participants | page | – | Removal is final (D-33) |
| `applications` | `WorkspacePage#applications` | Admin, Participant | Accept/waitlist/reject teams with a message | `/workspace/applications` | Registrations & people › Application review | page | – | Turning screening on gates submission |
| `people` | `PeoplePage` | Admin | Invite (role), revoke, remove | `{E}/members`, `{E}/invitations` | Registrations & people › Organising team › People | page | Overlaps Access (same people) | Invitation tokens; one role per event |
| `access` | `WorkspacePage#access` | Admin (owner) | Access level, institution, judge tracks | `PUT /workspace/access/:id` | Administration › Access & matching | page | Overlaps People | Owner-only (API); sponsor 404s |
| `audit` | `AuditPage` | Admin | Filters, CSV | `{E}/audit` | Administration › Records › Audit history | page | – | Append-only |
| `helpdesk` | `WorkspacePage#helpdesk` | all | Ask, reply; manager assign/resolve | `/workspace/tickets*` | Event operations › **Support & requests** (General) | redirect → `support?tab=general` | Same ticket list as Exceptions | Authors see only own tickets |
| `exceptions` | `WorkspacePage#exceptions` | Admin, Participant | Request; admin decide | `/workspace/tickets*`, `/decision` | Support & requests (Exception requests) | redirect → `support?tab=exceptions` | Same ticket list as Helpdesk | Decision is one-time; team swap and extension rules |
| `announcements` | `AnnouncementsPage` | all | Admin post, edit, delete by role audience; others read | `{E}/announcements` | Event operations › **Communication** (Announcements history) | redirect → `communication?history=announcements` (admin) / `updates` (others) | Second composer next to Targeted messages | Audience visibility per role |
| `communications` | `WorkspacePage#communications` | Admin | Email to participants by track or shortlist; delivery history | `/workspace/broadcast`, `/workspace/deliveries` | Communication (Targeted history) | redirect → `communication?history=targeted` | Second composer | Idempotent delivery keys; worker retries |
| `messages` | `WorkspacePage#messages` | Participant | Read personal messages | `/workspace/inbox` | Participant **Updates** | redirect → `updates` | Second inbox beside Announcements | Own rows only |
| `checkin` | `CheckInPage` | Admin, Staff | Search, mark present, verify ID, undo | `{E}/checkin/*` | Event operations › Event-day management › Check-in | page | – | Audit of every check-in |
| `tasks` | `TasksPage` | Admin, Staff | Create, edit, status | `{E}/staff/tasks*` | Event-day management › Staff tasks | page | – | Staff see own tasks only |
| `issues` | `IssuesPage` | Admin, Staff | Report, escalate, acknowledge, resolve | `{E}/issues*` | Event-day management › Issues | page | Third queue next to Helpdesk and Exceptions; kept separate (staff and operational, not participant requests) | – |
| `engagement` | `WorkspacePage#engagement` | Admin | Read team activity | `/workspace/engagement` | Event operations › Engagement › Team engagement | page | – | Unknown is not inactive |
| `rubric` | `RubricPage` | Admin | Template, criteria, activate, unlock | `/rounds/:r/rubric*` | Submissions & evaluation › Judge configuration › Rubric | page | – | Weights must total 100; unlock reopens evaluations |
| `briefing` | `JudgeBriefingPage` | Admin, Judge | Briefing and glossary | `/judge/briefing`, `/judge/glossary` | Judge configuration › Judge briefing & glossary | page | – | Optimistic lock |
| `submissions` | `SubmissionsMonitorPage` (+ detail) | Admin | Monitor; extension, size override | `/rounds/:r/submissions*` | Submissions & evaluation › Work management › Submissions | page | – | Extension rules (D-36) |
| `judging` | `JudgingPage` | Admin | Open/close, assign, auto-balance, exclude, reopen | `/rounds/:r/judging*`, `/assignments*` | Evaluation & integrity › Judging | page | – | Result invalidation (D-41) |
| `calibration` | `WorkspacePage#calibration` | Admin | Calibration view, normalisation toggle | `/workspace/calibration/:r`, `/normalisation/:r` | Evaluation & integrity › Judge calibration | page | – | D-54 restriction (P0-05) |
| `integrity` | `ProjectReviewPage` | Admin, Participant, Judge | Admin review; others read market context | `/workspace/reviews*` | Evaluation & integrity › Project review | page | – | Integrity notes admin-only |
| `advancement` | `WorkspacePage#advancement` | Admin | Shortlist and notify | `/workspace/shortlist` | Work management › Round shortlists | page | – | Shortlist gates later-round submission (P0-04) |
| `sandbox` | `SandboxPage` | Admin | Preview as participant/judge | `/workspace/sandbox` | Testing › Practice workspace | page | Confused with the judges' Practice team (P1-17) | Never persists |
| `results` | `ResultsPage` | Admin, Participant | Review, ties, approve, publish | `/rounds/:r/results/*`, `{E}/results` | Results & insights › Results | page | – | Snapshots; fingerprint invalidation (D-41) |
| `feedback` | `FeedbackAdminPage` / `FeedbackPage` | all but Staff | Admin: forms, results, judges' comments release. Others: survey | `/feedback/*`, `/rounds/:r/comments*` | Results & insights › Post-event › **Feedback & reviews** | page with tabs | Comments moderation mixed into the survey page | Confidential forms; comment release needs published results |
| `certificates` | `CertificatesAdminPage` / `MyCertificatesPage` | Admin, Participant | Templates, generate, review, release | `/certificates/*` | Post-event › Certificates | page | – | Release gate (D-45) |
| `report` | `WorkspacePage#report` | Admin, Sponsor | Impact PDF | `/workspace/report.pdf` | Post-event › Impact report | page | – | Sponsor sees only this |
| `team`, `profile`, `submission`, `discovery` | participant pages | Participant | Team, details, submission, discovery | as before | Participant workspace | page | – | Submission lock and deadlines |
| `judge/*`, `practice` | judge pages | Judge | Queue, evaluation, compare, practice | as before | Judge workspace | page | – | Judge sees assigned teams only |

Public and auth routes (`/`, `/e/:slug`, `/e/:slug/register`, `/login`, `/register`, `/verify-email`, `/invitations/accept`, `/forgot-password`, `/reset-password`, `/verify-certificate/:code`) are unchanged in structure. Their return-path fixes are P0-01.

---

## 2. Proposed information architecture (after)

### 2.1 Core Admin: seven divisions

The sidebar shows the seven divisions. Only the division that holds the current page is expanded (progressive disclosure, remembered per role and event). Inside a division, small section headings group the pages. Group keys are stable ids (`dashboard`, `setup`, `registrations`, `administration`, `operations`, `evaluation`, `results`), never visible text.

| # | Division (id) | Section | Pages (path) |
|---|---|---|---|
| 1 | **Dashboard** (`dashboard`) | – | Dashboard (index): stage, needs attention, next steps, division cards. **Default landing page** |
| 2 | **Setup** (`setup`) | Event configuration | Event details & publishing (`setup`) · Rounds & deadlines (`rounds`) · Tracks & problems (`structure`) |
| | | Event resources | Guidebook (`guidebook`) · Integrations (`integrations`) |
| 3 | **Registrations & people** (`registrations`) | Registration management | Teams & participants (`teams`) · Application review (`applications`) |
| | | Organising team | People (`people`) |
| 4 | **Administration** (`administration`) | Access & permissions | Access & matching (`access`) |
| | | Records | Audit history (`audit`) |
| 5 | **Event operations** (`operations`) | Participant support | Support & requests (`support`) |
| | | Communication | Communication (`communication`) |
| | | Event-day management | Check-in (`checkin`) · Staff tasks (`tasks`) · Issues (`issues`) |
| | | Engagement | Team engagement (`engagement`) |
| 6 | **Submissions & evaluation** (`evaluation`) | in event order | Rubric → Judge briefing & glossary → Submissions → Judging → Judge calibration → Project review → Round shortlists → Practice workspace (Testing) |
| 7 | **Results & insights** (`results`) | Results | Results (`results`) |
| | | Post-event | Feedback & reviews (`feedback`) · Certificates (`certificates`) · Impact report (`report`) |

**Departures from the PDF, and why:**
- **"Setup" page label.** It becomes "Event details & publishing", so the page is not named the same as its division. The PDF allows labels to follow product naming.
- **Submissions & evaluation order.** The pages are ordered by when the work happens: configure judges, receive submissions, judge, calibrate, review, then shortlist. The PDF sections are kept as sub-headings.
- **Dashboard and Results & insights.** The PDF's hand-drawn map placed Results & Insights under Dashboard. The PDF's own final table makes it a separate division, and that table is what is followed here.

### 2.2 Other roles

Each role lands on its own dashboard at the index route.

| Role | Default | Groups |
|---|---|---|
| Participant | **My event** (next step, application state, team, submission with the official deadline, updates, results and certificates when available) | My event (My event, My team, Submission, Updates) · Results & certificates · Help (Help & requests, Guidebook) · More (Rounds, Tracks, Application status, Find teammates, Market context, My details) |
| Judge | **Judge dashboard** (progress, deadline, next team, briefing) | Judging (Dashboard, My teams, Judge briefing, Practice team, Market context) · Help & updates |
| Helping Staff | **Staff dashboard** (check-in first, my tasks, report an issue) | Event day (Dashboard, Check-in, My tasks, Report an issue) · Help & updates |
| Sponsor viewer | **Impact report** (only page they are authorised to see) | – |

**Mobile.** Below the `lg` breakpoint, a fixed bottom bar shows 4 role-specific destinations plus **More**, which opens the same sidebar. Both come from the same `navFor()` definitions (`bottomBarFor`), so they can never disagree.

---

## 3. Old to new route mapping and redirects

Old list paths keep working. `EventLayout` replaces them in history and carries the query string over (for example `participants?q=ravi` becomes `teams?view=participants&q=ravi`). Detail paths (`participants/:id`, `teams/:id`) are unchanged.

| Old path | Role | New destination |
|---|---|---|
| `participants` | Admin | `teams?view=participants` |
| `helpdesk` | Admin | `support?tab=general` |
| `exceptions` | Admin | `support?tab=exceptions` |
| `announcements` | Admin | `communication?history=announcements` |
| `communications` | Admin | `communication?history=targeted` |
| `helpdesk` | Participant, Judge, Staff | `support` |
| `exceptions` | Participant | `support?type=exception` |
| `announcements` | Participant, Judge, Staff | `updates` |
| `messages` | Participant | `updates` |

---

## 4. Feature consolidations

### 4.1 Teams + Participants → Teams & participants (`teams`)

- **One page, two views.** A `Teams | Participants` switch is kept in the URL as `view=`; Teams is the default (PDF open point 3). Search, filters, sort and page also live in the URL, so links and Back keep their state.
- **Search** matches team name, team ID, member name, email and phone in both views. The teams search is extended server-side to include each member's account name and institution. This is an additive change.
- **Team rows** show name and ID, status, track and problem, submission status, member names (from the list API, an additive `members` field) and completeness.
- **Participants view** keeps every participant-level action: open record, correct, remove. Unassigned participants (`team=none`) are a filter and a count.
- **Team detail** is the existing page, extended with submissions per round and dates, linked from the team row.

### 4.2 Helpdesk + Exception requests → Support & requests (`support`)

- **Tabs:** All requests · General · Exception requests.
- **Filters:** status (`OPEN`, `IN_PROGRESS`, `RESOLVED`, `APPROVED`, `DENIED`: only the statuses the workflow really uses), category (`EXTENSION` deadline extension · `UNLOCK` submission unlock · `TEAM_CHANGE` team change; the PDF's "Other special request" does not exist in the data model, so it is not offered), round (exceptions only), assignee (including "Nobody"), date received.
- **Row:** type badge in words, subject, team, author and role, status, assignee, received date.
- **Detail:** full request context (kind, round, minutes requested and resulting deadline, departing and replacement emails), thread, assignment, decision with handler and timestamps. Decisions use explicit **Approve** and **Deny** buttons with consequence dialogs (P0-09).
- **Admins see the inbox only.** Participants, judges and staff see "Help & requests": their own requests and one form that asks for the request type first.

### 4.3 Announcements + Targeted messages → Communication (`communication`)

One composer. **Audience:** Everyone, or a selected audience. Only audiences the data model supports are offered:

| Audience | Channel (unchanged semantics) | Recipient count |
|---|---|---|
| Everyone · Participants · Judges · Staff | In-app announcement on the Updates page. **Not emailed.** | Active members of those roles |
| Participants in a track and/or shortlisted for a round | Email, queued through the outbox, plus the participant's in-app Updates | Exact recipients, from a dry run of the broadcast query |

- **Before sending:** audience, recipient count, channel and what delivery means, shown in a confirmation dialog.
- **Sending:** a per-compose request id makes the targeted send idempotent. The existing unique `(eventId, membershipId, key)` index absorbs a double submit.
- **After sending:** the composer clears; the result says "Posted" for an announcement and "Queued for N recipients" for email, never "delivered".
- **History:** All · Announcements · Targeted. Targeted rows are grouped per send, with queued, sent, failed and skipped counts. Failed deliveries are filterable.
- **Participants** read both kinds in one **Updates** page.

### 4.4 Feedback + Team comments → Feedback & reviews (`feedback`)

Tabs, following the real direction of each record:

| Tab | What it is (source → audience) | Visibility rules kept |
|---|---|---|
| Participant feedback | Participant survey: participants → organisers | Confidential forms never expose names |
| Judge feedback | Judge survey: judges → organisers | As configured on the form |
| Team feedback / comments | **Comments judges wrote about a team**: judge → team, moderated by organisers | Reach the team only after the round's results are published **and** organisers release them, labelled Judge 1, Judge 2. Hidden comments never reach the team. Judges' private notes to organisers are **never** shown here or to teams |

This settles PDF open point 2: "Team feedback" means judges' comments about teams. No team-written feedback exists. No records are merged; each tab reads its own existing endpoint.

---

## 5. Duplicate-data inventory and the single home for each

| Information | Single home (manage) | Elsewhere (context only) | Removed duplicate |
|---|---|---|---|
| Team membership | Teams & participants | Dashboard counts; participant My team | Separate Participants page |
| Support requests | Support & requests | Dashboard "needs attention" counts | Separate Helpdesk and Exceptions lists; admin-facing participant forms |
| Messages | Communication | Participant Updates; dashboard failed-delivery count | Second composer; second participant inbox |
| Feedback and comments | Feedback & reviews | Participant Results shows released judges' comments | Comments buried under the survey page for participants |
| Submissions | Submissions | Dashboard per-round counts; team detail | – |
| Judging | Judging | Dashboard progress; Results summaries (no controls) | – |
| Certificates | Certificates | Dashboard flagged count | – |
| Announcements on overview | Communication / Updates | – | "Latest announcements" block removed from the admin dashboard |
| Event dates | Event details & publishing | One identity line on the dashboard | Dates card on the admin dashboard |

---

## 6. Permission considerations

- Navigation hides items for presentation only. Every endpoint keeps its `requireAction` and `adminOnly` checks. No permission is loosened.
- **New endpoints** are admin-only:
  - audience preview;
  - grouped delivery history.
- **Extended endpoints** are additive fields only:
  - dashboard lifecycle;
  - team list members;
  - ticket list filters.
- **Sponsor viewer** remains `ADMIN` with `accessLevel=SPONSOR_VIEWER`, and the API keeps returning 404 for everything except the report.
- **P0-10:** the invitation carries the access level, so a sponsor never holds full admin access between invite and downgrade. Only the event owner may invite co-admins and sponsor viewers, matching the owner-only rule on Access. This needs one additive column on `Invitation` (section 8).
- **Judges' private notes** (`privateNote`) are never added to any participant-visible response.

## 7. Migration and redirect strategy

- Route renames are handled in the web layout (section 3), without server redirects; API paths are unchanged.
- Bookmarks keep working, and the query string is carried over.
- Sidebar preferences are stored under the new group ids. Stale ids from the old menu are ignored by `parseNavChoices`, so nothing breaks.

## 8. Database changes

**One additive migration**, only for P0-10: `Invitation.accessLevel TEXT NOT NULL DEFAULT 'STANDARD'`.
- Existing rows get `STANDARD`, the current behaviour.
- **Rollback:** dropping the column restores the old schema, with no data loss beyond pending sponsor invitations, which would then accept as standard admins. So revoke those first.
- It is tested on a fresh database (migration test) and on the seeded development database.

No other schema changes are needed.

## 9. Implementation phases (one or more commits each)

| Phase | Scope |
|---|---|
| 0 | This plan |
| 1 | Seven-division navigation, lifecycle-aware admin dashboard, bottom bar, event switcher |
| 2 | Teams & participants |
| 3 | Support & requests |
| 4 | Communication and participant Updates |
| 5 | Feedback & reviews |
| 6 | Participant, judge, staff and sponsor dashboards |
| 7 | P0 fixes (P0-01 to P0-10), selected P1s (P1-14 to P1-21, P1-27, P1-28, P1-31), duplicate removal |
| 8 | Full regression: unit, API, e2e, lint, brand lint, typecheck, build, and visual QA at 360/390/768/1440 px for every role and lifecycle state |

## 10. Testing strategy

- **Unit (web):**
  - navigation definitions: every old destination is still reachable, seven divisions in order, bottom bar derived from the sidebar;
  - redirect table;
  - lifecycle rendering.
- **API:**
  - lifecycle stage per state (draft, registration, judging, results, wrap-up), attention counts against seeded data;
  - audience preview counts equal the queued recipients;
  - idempotent broadcast;
  - ticket filters;
  - team search by member name;
  - sponsor invitation acceptance yields `SPONSOR_VIEWER` and a 404 on participant data;
  - owner-only invite of sponsor and co-admin.
- **E2E:** existing specs updated for new labels and paths; redirects of old bookmarks.
- **Visual QA:** `npm run qa:visual` plus manual screenshots of each division, role dashboard and lifecycle state, inspected by eye.

## 11. Open product decisions (defaults used, not invented answers)

| # | Question | Default used | Why |
|---|---|---|---|
| OD-1 | PDF "teach change": does it mean team change? | Team change (`TEAM_CHANGE`) | It is the only matching kind in the data model |
| OD-2 | "Team feedback": written by teams, or about teams? | About teams (judges' comments) | Only that data exists (section 4.4) |
| OD-3 | Teams & participants: default view, or remember the last one? | Teams by default; the view is kept in the URL | Spec says the default is Teams |
| OD-4 | Targeted audiences: individuals, teams, judges, organisers? | Roles (in-app) and participant cohorts by track or shortlist (email) | Only these are supported by the data model and permissions; individual targeting would be new scope |
| OD-5 | Normalisation (D-54) | Kept, behind a consequence dialog with the D-54 caveat and a visible "Scoring method" line on Results | Removing it is a product decision |
| OD-6 | "Other special request" exception category | Not offered | Not in the data model; adding it would change the exception workflow |
| OD-7 | Recent activity on the dashboard | Not shown | The audit log is the record; a feed would mostly repeat "Needs attention" |

---

## 12. Implementation status (end of this branch)

### P0 findings: all addressed

| ID | Status | Where |
|---|---|---|
| P0-01 Return path through sign-up and invitations | Fixed | `1d75e1e` |
| P0-02 One official deadline | Fixed (dashboard, submission page, submission list, public page) | `4cfc7bf`, `972e453` |
| P0-03 Eligibility explained before typing | Fixed (API reports `blockedReason`; page read-only) | `4cfc7bf`, `972e453` |
| P0-04 Safe round shortlists | Fixed | `f4bb40d` |
| P0-05 Explicit normalisation with the D-54 caveat | Fixed (restriction kept, not removed) | `f4bb40d` |
| P0-06 Publish preview and confirmation | Fixed | `f4bb40d` |
| P0-07 No lost work on navigation | Fixed (guidebook, submission, evaluation) | `972e453` |
| P0-08 Declaration typing | Fixed | `1d75e1e` |
| P0-09 Exception decisions with full context | Fixed | `86efc9d` |
| P0-10 Sponsor and access-label invitations | Fixed (additive migration) | `b44d6ec` |

### P1 findings

**Addressed:**
- P1-08 comment release dialog
- P1-11 application status in words
- P1-12 composer confirmation and no duplicate sends
- P1-13 lifecycle dashboard
- P1-14 seven divisions in work order
- P1-15 one Communication page and one Updates inbox
- P1-16 one support inbox
- P1-18 judge progress
- P1-19 judge list badges
- P1-20 judging deadline warning
- P1-23 late submissions
- P1-27 sectioned setup page
- P1-28 check-in issue link
- P1-29 invitation recovery
- P1-30 public page way in
- P1-31 stacked mobile tables and bottom bar

**Partly addressed:**
- P1-02: only Rank again and Clear tie are confirmed.
- P1-03: Discard changes and announcement delete ask first; other deletes do not yet.
- P1-24: "team number" wording on the dashboard.

**Scheduled, not done here, with the reason:**

| ID | Reason |
|---|---|
| P1-01 | Confirmations for publish, unpublish, conclude and archive: the Setup page was restructured first; the dialogs are a contained follow-up |
| P1-04 | Confirmations for people and team member changes |
| P1-05 | Needs a new "withdraw approval" API, which changes result lifecycle semantics. Product decision first |
| P1-06 | Flagging certificates when results change. Touches certificate validity rules; needs a product decision |
| P1-07 | Rubric activation with unsaved edits |
| P1-09 | Certificate release counts |
| P1-10 | Application review table |
| P1-17 | Practice workspace naming. The audit's label is kept for now |
| P1-21 | Evaluation layout below 1280 px |
| P1-22 | Market context headings. Needs the team name in the reviews API |
| P1-25 | Judges' comments under Results. Comments stay on the participant survey page; the nav label says so |
| P1-26 | Problem-statement release time. A new feature with a schema change |

### Verification

API, web unit, e2e, lint, brand lint, typecheck and production build are run before the final commit. Visual QA was done in the browser at 1024 and 375 px for every admin division, the participant, judge and staff dashboards, Support & requests, Communication, Feedback & reviews and the stacked tables. The final report gives the exact figures.
