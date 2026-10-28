# Implementation plan

> Sequencing and checklist. *What* to build: PRD. *How*: `TECHNICAL_ARCHITECTURE.md`. *Look and feel*:
> `BRAND_IMPLEMENTATION.md`. Deviations and open choices: `DECISIONS.md`.
> The checklist in §6 is updated in the same commit that completes an item. A box is ticked only when
> UI, API, persistence, validation, authorisation, error handling and tests all exist and pass.

## 1. Working agreements

* **Branch:** all work on `v1_runthrough`; never `main`; never force-push. Push after each tested milestone.
* **Commits:** small, coherent, conventional (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `style:`,
  `refactor:`). Subject ≤ 72 chars; body says *what* changed and *why*, and lists notable decisions or
  follow-ups. A milestone that grows large is split along the seams listed below (schema → service →
  routes → UI → tests). Each commit leaves the repo building and tests green.
* **Brand kit PDF:** local-only. It is git-ignored (`.gitignore`), never copied into the repo, never staged.
  Before each push: inspect outgoing commits (`git diff --stat origin/v1_runthrough..HEAD`), confirm no
  `*Brand-Kit*`, `.env*`, keys or tokens.
* **Pre-commit routine:** relevant tests → `typecheck` → `lint` → review `git diff` → stage specific files →
  commit → clean tree.
* **Visual QA protocol** (UI milestones): start the app, run the Playwright script that logs in as each
  seeded role and captures desktop (1440×900) and mobile (390×844) screenshots of the screens touched,
  open the images, compare against `BRAND_IMPLEMENTATION.md` (Paper background, fonts, Ember usage,
  contrast, no blue/purple), fix, repeat. Screenshots live in a git-ignored folder. Only claim visual QA
  for screens that were actually inspected.

## 2. Scope: what V1 is

Priorities follow PRD §13 / §18.1: the smallest coherent version that runs a real single-round event end
to end, plus staff check-in/tasks and the judge feedback form. P0 first; P1 only after P0 is stable; P2
never in V1. The data model supports multiple rounds from day one (a single-round event is one round —
no separate code path), but shortlist UI is P1.

| Included (P0) | Included later (P1, if time permits) | Not built (P2 / non-goal) |
|---|---|---|
| Auth, roles, event scoping, audit | Sheets one-way push, Drive mirror | QR check-in, payments |
| Event setup, publication, rounds, tracks, problems | Multi-round shortlist UI | Public leaderboards |
| Guidebook editor + PDF, announcements | Judge-comment release to teams | AI features |
| Registration, teams, join codes, admin corrections | Judge spread view, auto-balance | Anonymous judging, bias normalisation |
| Submissions with versions, deadlines, extensions | Google sign-in | Bidirectional Sheets sync |
| Rubrics, assignments, judge workspace, scoring | Appreciation certificates | Public certificate verification |
| Results: ties, exclusions, approve, publish | Reminder emails | Offline mode, native apps |
| Staff tasks, issues, check-in | | |
| Feedback (participant; judge form), certificates, CSV export | | |

## 3. End-to-end acceptance journey (release gate)

From the brief and PRD AT-01…AT-23. Automated as Playwright specs plus API integration tests:

1. Admin signs in → creates event → sets schedule/rules/tracks/guidebook → configures registration and a
   rubric → publishes (AT-01, AT-01N).
2. Participant registers, creates a team; a second joins by code; size and one-team rules hold (AT-02, AT-03*).
3. Team submits a project before the deadline; replacing creates version 2; late and wrong-type cases
   behave (AT-05…AT-07).
4. Admin assigns judges (AT-10); judge sees only assigned teams (AT-15), opens the real submission and
   scores via the rubric after the deadline (AT-13, AT-14).
5. System computes weighted scores; admin reviews, resolves ties, approves, publishes (AT-16).
6. Participants see results only after publication; certificates download for eligible users (AT-18, AT-22).
7. Feedback collected and reviewed (AT-17); CSV exports work; audit log shows the important actions.
8. The app stays fully usable with no Google credentials.

## 4. Phases and the commit trail

The brief's phases 0–7 are kept; PRD phasing (§14) is respected by putting integrations last. Under each
phase is the **planned commit sequence** — it shows the intended flow and is adjusted (never silently) if
reality differs; changes are noted in the checklist.

### Phase 0 — Foundation
Goal: a running, empty, branded, tested skeleton.
1. `docs: add implementation plan, architecture, decisions and brand notes` *(this session; one commit per doc)*
2. `chore: initialise npm workspace (api, web, shared) with TypeScript, ESLint, Prettier`
3. `chore: add Express API skeleton with env validation, logging and health check`
4. `chore: add Prisma and PostgreSQL setup with test database tooling` *(includes Node 26 compatibility spike, D-14)*
5. `feat(web): add Vite + React + Tailwind app with routing shell`
6. `style: add Arthakram design tokens, self-hosted fonts and base styles`
7. `feat(ui): add brand component foundation — button, input, select, card, badge, alert, table`
8. `feat(ui): add dialog, empty/loading states, form-error summary, navigation primitives`
9. `feat(ui): add logo component and favicon from extracted vector artwork` *(only if D-09 resolved)*
10. `docs: add README, .env.example and brand implementation guide`
11. `test: wire Vitest, Supertest and Playwright with visual-QA screenshot script`
Exit: `npm run dev` serves a branded page; `typecheck`, `lint`, `test`, `build` pass; visual QA of the
component gallery page (desktop + mobile) done.

### Phase 1 — Authentication and permissions (PRD FR-001, §8; AT-19)
1. `feat(db): add User, Session, AuthToken, Event, EventMembership, AuditLog schema and audit append-only trigger`
2. `feat(auth): password hashing, sessions and cookie handling`
3. `feat(auth): sign-up, email verification, sign-in/out, reset, lockout and rate limits`
4. `feat(email): add provider interface with dev outbox and console adapters`
5. `feat(authz): encode permission matrix and event-scoped can() policy`
6. `test(authz): generated matrix test harness and cross-event isolation tests`
7. `feat(web): auth screens, session provider, protected routes`
8. `feat(web): app shell with My Events, event switcher and role-specific navigation`
9. `chore(db): seed demo accounts for each role` (dev-only passwords, documented)
Exit: AT-19 passes; lockout/expired-link cases tested; visual QA of auth + shell.

### Phase 2 — Events, rounds, guidebook (FR-002–FR-008, FR-010–FR-018, FR-023–FR-028; AT-01)
1. `feat(events): create/edit events with slug rules, optimistic locking and audit`
2. `feat(events): publication checks and registration status controls`
3. `feat(rounds): rounds, deadlines, grace/late policy, submission form fields`
4. `feat(catalog): tracks and problem statements`
5. `feat(guidebook): structured section editor with draft/publish versions`
6. `feat(guidebook): PDF export`
7. `feat(announcements): audience-scoped announcements`
8. `feat(web): admin event setup flow, guidebook editor and public event landing page`
9. `test: event lifecycle and publication blocking (AT-01, AT-01N)`
Exit: admin can create and publish an event with a guidebook; participants see only published content.

### Phase 3 — Participants, teams, submissions (FR-019–FR-022, FR-050–FR-073; AT-02–AT-07, AT-04)
1. `feat(registration): registration fields, participant records, locked fields, privacy notice`
2. `feat(teams): create/join by code, size rules, one-team-per-event with row-lock join`
3. `feat(teams): leave, dissolve, leadership transfer, admin corrections`
4. `feat(people): admin participant/team lists with search, filters, and CSV export`
5. `feat(web): registration flow and participant team dashboard`
6. `feat(storage): StorageProvider with local-disk adapter, signed URLs and signature validation`
7. `feat(submissions): drafts, immutable versions, validation, deadline/late/extension logic, receipts`
8. `feat(web): submission workflow and admin submission monitoring`
9. `test: team races, deadline boundaries, upload validation (AT-03N2, AT-05N1, AT-07)`
Exit: rehearsal-style test with seeded 100 participants / 30 teams; no mis-attributed submissions.

### Phase 4 — Judging (FR-090–FR-102, FR-140–FR-150; AT-10–AT-15)
1. `feat(rubrics): generic template, per-round rubric, criteria, weight validation, lock/unlock`
2. `feat(scoring): pure scoring engine in shared package with PRD worked-example fixtures`
3. `feat(judging): judge invitations and assignments (bulk, manual, conflicts, progress matrix)`
4. `feat(judging): evaluation drafts, autosave, submit and reopen with version history`
5. `feat(web): judge dashboard and team judging workspace with submission viewer and rubric form`
6. `feat(web): admin rubric builder and assignment screens`
7. `test: scoring, access isolation (AT-15), invalid scores, double submit`
Exit: worked example exact; judge cannot see unassigned teams or other judges' scores.

### Phase 5 — Results and operations (FR-149–FR-156, FR-120–FR-130, FR-046; AT-16, AT-20, AT-21)
1. `feat(results): compute rankings, completeness and missing-evaluation detection`
2. `feat(results): tie groups, exclusions with reasons, approve snapshot, invalidate, publish`
3. `feat(web): result review, approval and publication screens; participant results view`
4. `feat(staff): tasks, issue reports and check-in with restricted team card`
5. `feat(web): staff dashboard and mobile check-in`
6. `feat(audit): admin audit history viewer with filters`
7. `test: results approval/publication permissions, staff restrictions, audit coverage`
Exit: full workflow through publication tested; independent spreadsheet recalculation matches.

### Phase 6 — Feedback and certificates (Modules H, I; AT-17, AT-18, AT-22)
1. `feat(feedback): participant and judge forms, responses, confidentiality, admin review`
2. `feat(certificates): templates, eligibility, generation job, review/release/revoke`
3. `feat(certificates): PDF rendering with embedded fonts, download and correction flow`
4. `feat(web): feedback and certificate screens (admin and participant)`
5. `test: eligibility, duplicate prevention, access, long-name rendering`

### Phase 7 — Integrations and hardening (Modules F, G; AT-08, AT-09)
1. `feat(sync): persistent sync queue with idempotency and retries`
2. `feat(sheets): one-way snapshot push with honest status and Sync now` *(needs Google credentials; otherwise interface + fake-provider tests only)*
3. `feat(drive): optional archive mirror` *(same)*
4. `fix/chore: security review pass, headers/CSP, rate-limit audit, error-message audit`
5. `test(e2e): full acceptance journey`
6. `perf: load-profile test for the deadline scenario`
7. `docs: deployment, backup/restore, event-day runbook, final checklist`
Exit: PRD launch-readiness checklist (§18.8) reviewed; every unverified item listed honestly.

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Node 26 is bleeding-edge; Prisma/native deps may not support it | Phase 0 spike; fall back to Node 22 LTS with `.nvmrc` and note in DECISIONS |
| Scope of PRD far exceeds one session | Strict P0-first ordering; checklist is always accurate; repo always runnable |
| Brand drift into generic SaaS look | Tokens + Tailwind mapping only; component gallery; mandatory screenshot review |
| Authorisation gaps | Single `can()` policy; generated matrix tests; 404-on-out-of-scope |
| Scoring disputes | Pure engine, PRD fixtures, independent recalculation, immutable snapshots |
| Missing logo assets | Only the live vector inside the (local) brand PDF is available; see D-09 |
| Google credentials unavailable | Integrations last, optional, honest status; CSV fallback |
| Accidental publication of brand PDF/secrets | Ignore rules + pre-push inspection routine in §1 |

## 6. Implementation checklist

Legend: `[ ]` not started · `[~]` partial · `[x]` done and verified (tests run).

**Phase 0 — Foundation**
- [x] Branch `v1_runthrough` created; brand PDF ignored; PRD committed
- [x] Implementation plan, architecture, decisions, brand notes
- [x] Workspace, TS, lint, format
- [x] API skeleton, env validation, health check
- [x] Prisma + PostgreSQL, migrations, test DB
- [x] Web app, routing shell
- [x] Design tokens, fonts, base styles
- [x] Brand component library + gallery page (dev route `/_design`; visually inspected at 1440 and 390 px)
- [x] Logo/favicon assets (D-09 resolved)
- [x] README, `.env.example`
- [x] Test tooling + visual-QA script

**Phase 1 — Auth and permissions**
- [x] Schema: users, sessions, tokens, events, memberships, audit
- [x] Sign-up/verify/sign-in/out/reset/lockout
- [x] Email provider (dev outbox)
- [x] Permission matrix + event-context/`requireAction` middleware + 404 scoping
- [x] Matrix test harness
- [x] Auth UI, protected routes, shell, role navigation
- [x] Seed accounts

**Phase 2 — Events and guidebook**
- [x] Event create/edit/publish/registration status
- [x] Rounds and deadlines (submission form fields land with submissions in Phase 3)
- [x] Tracks and problem statements
- [x] Guidebook editor, versions, PDF
- [x] Announcements
- [x] Admin setup UI, public landing page

**Phase 3 — Teams and submissions**
- [x] Registration + participant records
- [x] Teams: create/join/leave/dissolve/transfer
- [x] Admin lists, search, correction, CSV export
- [x] Participant dashboard
- [x] Storage provider + upload validation
- [x] Submission versions, deadlines, extensions, receipts
- [x] Admin submission monitoring

**Phase 4 — Judging**
- [x] Rubrics (generic + custom) with weight validation
- [x] Scoring engine + fixtures
- [x] Judge assignments + progress
- [x] Evaluations (draft/submit/reopen)
- [x] Judge dashboard + workspace
- [x] Access-isolation tests

**Phase 5 — Results and operations**
- [x] Rankings, completeness, ties, exclusions
- [x] Approve / invalidate / publish
- [x] Participant results view
- [x] Staff tasks, issues, check-in
- [x] Audit viewer

**Phase 6 — Feedback and certificates**
- [x] Feedback forms + review (one response per person, confidential option, judge comment release/hide)
- [x] Certificate templates, generation, release, download, revoke, name corrections
- Deferred (P1/P2): judge/staff appreciation certificates, public verification page, email reminders

**Phase 7 — Integrations and hardening**
- [x] Sync queue; Sheets push; Drive mirror (fake-provider tested; real Google REST client unverified, needs credentials)
- [x] Security pass; CSP; rate limits (route probe test, 413 handling, production config guards, SMTP provider)
- [x] Full E2E acceptance journey (cross-role boundaries spec plus the seven workflow specs)
- [x] Load test at PRD profile (`npm run test:load -w @arthakram/api`)
- [x] Deployment + runbook docs (`docs/DEPLOYMENT.md`, `docs/RUNBOOK.md`)

**Release readiness (controlled pilot)** — see `docs/RELEASE_READINESS.md`
- [x] Production-readiness audit with regression tests (16 defects fixed)
- [x] Empty-database workflow journey; staging rehearsal over HTTPS with SMTP
- [x] Backup and restore rehearsed
- [x] Visual QA of every role and key states (partial list of inspected screens in the report)
- [ ] Google Sheets/Drive verified against real Google (needs credentials; manual steps documented)
- [ ] Real host, certificate, mail provider rehearsal (needs hosting decision)

**Post-audit follow-up (28 Oct 2026)** — see `docs/PRODUCT_AUDIT_2026-10-28.md` and `docs/CHANGELOG.md`
- [x] A1 certificate same-event constraints restored; migration test has a fixed must-exist list
- [x] A3 shortlist notices sent once, to active teams only
- [x] A4 API typecheck clean; repo-wide Prettier clean
- [x] A5 `body-parser` advisory cleared (`npm audit` 0)
- [x] A6 e2e environment documented in the README
- [x] A9 public certificate endpoint rate limited
- [x] A12 documentation aligned (README, DECISIONS D-54 to D-58, RELEASE_READINESS section 11, DEPLOYMENT, FEATURES_V2, JUDGE_WORKSPACE, TECHNICAL_ARCHITECTURE)
- [ ] A2 decide on score normalisation (per-track panel mean, larger minimum sample, or removal) before it is used for prizes
- [ ] A7 foreign keys on the PR #3 tables, after a data check
- [ ] A8 backoff for the email and reminder worker
- [ ] A11 optional `GITHUB_TOKEN` for project review and reading cards
- [ ] Working agreement: one concern per PR from now on (A10); at most 3 files per commit on this branch

## 7. Reporting at the end of each session

Features implemented · features tested · test results (actual output) · visual QA performed (which
screens, which widths) · commits created · push status (verified with `git ls-remote`) · incomplete work ·
external configuration required · commands to run the app.
