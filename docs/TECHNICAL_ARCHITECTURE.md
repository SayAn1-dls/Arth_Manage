# Technical architecture

> Source of truth for *how* the platform is built. Product behaviour comes from the PRD
> (`docs/PRD-Hackathon-and-Case-Competition-Platform.pdf`, referenced below as **PRD §x / FR-xxx / AT-xx**);
> visual identity comes from `docs/BRAND_IMPLEMENTATION.md`; sequencing comes from
> `docs/IMPLEMENTATION_PLAN.md`; choices and deviations are logged in `docs/DECISIONS.md`.
> If code and this document disagree, fix one of them in the same commit.

## 1. Scope in one paragraph

A web platform that lets one organising team run a hackathon or case competition from event setup
to certificates, with four role-specific interfaces (Core Admin, Participant, Judge, Helping Staff)
inside one application. The platform database is the single source of truth. Google Sheets (one-way
push) and Google Drive (optional archive mirror) are late, optional integrations; CSV export is the
guaranteed fallback. V1 is sized for the PRD load profile: ≤ 1,000 participants, 250 teams, 50 judges,
30 staff per event, < 10 concurrent events (PRD AS-01/02).

## 2. Technology stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language, shared types and validation between client and server |
| Monorepo | npm workspaces | Simplest option that lets `web`, `api` and `shared` share code; no extra tooling |
| Frontend | React 19, Vite 8, React Router 8, Tailwind CSS, `lucide-react` | Requested stack; Tailwind is mapped onto CSS-variable brand tokens |
| Server state | TanStack Query | Caching, optimistic-lock error handling, retry for idempotent writes |
| Forms | Plain forms; server-side Zod validation mapped to field errors by `useFormErrors` | React Hook Form was not adopted (DECISIONS D-21); the server is the validator of record (PRD 6.0-4) |
| Backend | Node.js, Express, TypeScript | Requested stack; thin routes over services |
| Validation | Zod (in `packages/shared`) | Single schema source for request bodies, responses and forms |
| Database | PostgreSQL 16 | Required constraints (partial unique indexes, row locks, triggers) |
| ORM | Prisma (migrations, client); raw SQL where a constraint needs it | Requested stack; raw migrations for partial indexes and the append-only audit trigger |
| Passwords | `scrypt` from `node:crypto` (salted, tuned cost) | Slow salted hash (NFR-S2) with no native build step; revisit argon2id if packaging allows |
| Sessions | Server-side `Session` table + opaque token in an HTTP-only, `SameSite=Lax`, `Secure` (prod) cookie | Sign-out invalidates server-side (NFR-S3); 12 h admin / 7 d others (OQ-14) |
| PDF | `pdf-lib` + `@pdf-lib/fontkit` | Guidebook PDF and certificates; embeds Instrument Sans / Bricolage Grotesque |
| Email | `EmailProvider` interface; dev adapter writes to an `OutboxEmail` table and the console; SMTP adapter for real use | No paid service needed locally (OQ-08) |
| File storage | `StorageProvider` interface; `LocalDiskStorage` (private directory, signed short-lived URLs) | Honest local storage now; object storage adapter later. Never claimed as cloud storage |
| Logging | `pino`, JSON logs, request id, secrets redacted | |
| Tests | Vitest (unit + API integration with Supertest), Playwright (E2E + visual QA screenshots) | Chromium for Playwright is already installed locally |
| Quality | ESLint, Prettier, `tsc --noEmit`, Husky-free (run via npm scripts) | |

Local prerequisites (verified on this machine on 28 Oct 2026): Node 26.9, npm 11, PostgreSQL 16 or 18 (the
Postgres.app 18 server was used for the 28 Oct audit run), Playwright Chromium. Node 26 is very new: Phase 0 includes a spike confirming Prisma and every
dependency installs and runs on it, with a documented fallback to Node 22 LTS (DECISIONS D-14).

## 3. Repository layout

```
.
├── apps/
│   ├── api/                      Express API + Prisma
│   │   ├── prisma/               schema.prisma, migrations/, seed.ts
│   │   └── src/
│   │       ├── config/           env parsing (Zod), constants
│   │       ├── http/             app.ts, middleware (session, event-context, rate-limit, error, idempotency)
│   │       ├── modules/          one folder per domain module (see §5)
│   │       │   └── <module>/     routes.ts · service.ts · repo.ts · policy.ts · *.test.ts
│   │       ├── auth/             password hashing, sessions, verification/reset tokens
│   │       ├── authz/            role matrix, `can()` policy, event-scope resolvers
│   │       ├── integrations/     sheets/, drive/, sync-queue/ (Phase 7)
│   │       ├── storage/          StorageProvider + LocalDiskStorage
│   │       ├── email/            EmailProvider + dev outbox + templates
│   │       └── audit/            append-only audit writer
│   └── web/                      React SPA
│       └── src/
│           ├── styles/           tokens.css, base.css (fonts, resets)
│           ├── ui/               brand design-system components (see BRAND_IMPLEMENTATION.md)
│           ├── shell/            app shell, event switcher, role navigation, route guards
│           ├── features/         auth, events, guidebook, people, submissions, judging, results, staff, feedback, certificates
│           ├── lib/              api client, query keys, formatting (time zones), csv download
│           └── routes.tsx
├── packages/
│   └── shared/                   Zod schemas, DTO types, permission matrix, **scoring engine**, rank/tie logic
├── docs/                         PRD, this file, plan, decisions, brand implementation notes
├── e2e/                          Playwright specs + visual-QA script (screenshots are git-ignored)
└── .env.example
```

Layering rule inside `apps/api/src/modules/<module>`:

```
routes.ts   parse + validate (Zod) → call service → shape response       (no business logic, no Prisma)
service.ts  business rules, transactions, audit writes, calls policy      (no Express types)
policy.ts   module-specific authorisation using authz/can()               (pure functions)
repo.ts     all Prisma access for the module                              (no business rules)
```

The scoring engine and rank/tie logic live in `packages/shared` as pure, dependency-light functions so they
are testable without a database and reusable by the UI for previews.

## 4. Roles, permissions and tenancy

### 4.1 Model (PRD §8)

* `User` is a global account. Authority comes from `EventMembership(event, user, role)`;
  **one row per (event, user)**, unique constraint (PRD 8.2). Roles: `ADMIN` (Core Admin), `JUDGE`,
  `STAFF`, `PARTICIPANT`. A user can be a Judge in event A and a Participant in event B.
* **Platform-level vs event-level scope** (brief requirement). There is no platform-admin role and no operator
  allowlist (DECISIONS D-06, OQ-02 default): any verified user may create an event and becomes its owner and
  Core Admin. Event data is reachable only through an event membership; creating events grants nothing
  elsewhere.
* "Event organisers / POCs" are Core Admins of that event. Admin can never see another event's records.

### 4.2 Enforcement

1. `sessionMiddleware` resolves the cookie to a `User` (or 401).
2. `eventContext` middleware resolves the **event from the requested record itself** (e.g. submission →
   team → event), then loads the caller's membership for *that* event. A crafted request cannot borrow
   a role from another event (PRD 8.2-4).
3. `can(actor, action, resource)` in `authz/` is the **only** place permission decisions are made.
   The matrix of PRD §8.1 is encoded as data in `packages/shared` (`PERMISSIONS[action][role] =
   NONE | OWN | ASSIGNED | READ | FULL`). `OWN` and `ASSIGNED` are evaluated against the resource
   (team membership; `JudgeAssignment`).
4. Out-of-scope records return **404 "not found"**, not 403, and the denied attempt is logged (PRD 8.3).
5. Files are served by `GET /events/:id/files/:fileId`, which re-checks permission on every request instead of
   issuing signed URLs (DECISIONS D-31), with `Content-Disposition: attachment` and `nosniff`.
6. Frontend route guards and hidden menu items are *presentation only*.

### 4.3 Permission test harness (NFR-S4)

A generated test iterates the matrix: for every (action × role) cell it makes one allowed and one denied
request (denied = wrong role, wrong event, wrong team or unassigned). Adding an endpoint without a matrix
entry fails CI. This directly covers the ten security cases listed in the brief and AT-15, AT-19, AT-20.

## 5. Domain modules (API) and the PRD they implement

| Module | Responsibility | PRD |
|---|---|---|
| `auth` | Sign-up, email verification, sign-in, sign-out, reset, sessions, lockout (5 failures/15 min → 15 min) | FR-001, NFR-S1–3, S9 |
| `events` | Create/edit, slug, status (Draft→Published→Concluded→Archived), registration status, publish checks | FR-002–FR-008 |
| `rounds` | Rounds, deadlines, grace, late policy, submission form field definitions | FR-010–FR-015, FR-059 |
| `catalog` | Tracks and problem statements | FR-016–FR-018 |
| `registration` | Registration fields (fixed + custom), participant record, declarations, locked fields | FR-050–FR-052, FR-056 |
| `teams` | Create/join (join code), size rules, one-team-per-event, leave/dissolve, transfer leadership, `team_code` | FR-053–FR-058 |
| `people` | Admin lists, search/filter, correction, invites for judges/staff/admins, removal effects | FR-019–FR-022, §8.4 |
| `guidebook` | Draft sections, published versions, preview, PDF export | FR-023–FR-028 |
| `announcements` | Audience-scoped announcements | FR-043 |
| `submissions` | Draft/submitted versions, file validation, deadline enforcement, extensions, receipts | FR-059–FR-073 |
| `rubrics` | Generic template → copied per round; criteria; activate/lock/unlock | FR-140–FR-145 |
| `judging` | Judge assignments (bulk, manual, balance), conflicts, judge workspace, evaluations, reopen | FR-090–FR-102, FR-146–FR-150 |
| `results` | Compute, flag ties, exclusions, approve (snapshot), publish, invalidate | FR-149–FR-156 |
| `staff` | Tasks, issues, check-in | FR-120–FR-130 |
| `feedback` | Participant and judge forms, responses, confidentiality | FR-230–FR-237 |
| `certificates` | Templates, generate, review, release, revoke, correction, download | Module I |
| `exports` | CSV with formula-injection neutralisation | FR-039, NFR-S8 |
| `audit` | Append-only log writer + admin reader | FR-046 |
| `integrations` | Sheets one-way push, Drive mirror, sync queue (Phase 7, optional) | Modules F, G |

## 6. Data model

Defined in `apps/api/prisma/schema.prisma` from PRD §9.1; this section records the **decisions that
constrain it**. We only create entities the V1 workflows need.

**Core entities:** `User`, `Session`, `AuthToken` (verify/reset), `Event`, `EventMembership`,
`RegistrationFieldDef`, `Registration`, `Track`, `ProblemStatement`, `Round`, `SubmissionFormField`,
`Team`, `TeamMember`, `Submission`, `SubmissionVersion`, `SubmissionFile`, `Guidebook`,
`GuidebookVersion`, `Announcement`, `Rubric`, `RubricCriterion`, `JudgeAssignment`, `Evaluation`,
`CriterionScore`, `EvaluationVersion`, `ResultSnapshot`, `CheckIn`, `StaffTask`, `IssueReport`,
`FeedbackForm`, `FeedbackResponse`, `CertificateTemplate`, `Certificate`, `IdempotencyKey`,
`OutboxEmail` (dev), `AuditLog`; later `IntegrationConnection`, `SyncJob`.
`RoundParticipation` is implicit for Round 1 and added only when shortlisting (P1) is built (PRD 9.1 note).

**Invariants enforced by the database, not only by code (PRD 9.3):**

| Invariant | Mechanism |
|---|---|
| One role per user per event | `UNIQUE (eventId, userId)` on `EventMembership` |
| One active team per participant per event | partial unique index on `TeamMember (eventId, membershipId) WHERE leftAt IS NULL` |
| Unique active team name per event (case-insensitive) | unique index on `(eventId, lower(name))` where status active |
| Team code unique per event, never reused | `UNIQUE (eventId, teamCode)`; sequence counter on `Event`, soft delete only |
| Team belongs to the event of its members/submissions | composite FKs carry `eventId`; `TeamMember.eventId` must equal `Team.eventId` |
| One submission per (round, team); versions immutable | `UNIQUE (roundId, teamId)`; `UNIQUE (submissionId, versionNo)`; no update path on submitted versions |
| One evaluation per judge per team per round | `UNIQUE` on `JudgeAssignment (roundId, teamId, judgeMembershipId)`; `UNIQUE (assignmentId)` on `Evaluation` |
| Score ranges | `CHECK` on criterion (`min ∈ {0,1}`, `max > min`, `weight 1..100`); service validates `min ≤ score ≤ max` and integer |
| Weights total exactly 100 on activation | service check inside the activation transaction + test; Active rubric criteria are immutable until unlocked |
| Complete evaluation | submit transaction requires exactly one `CriterionScore` per criterion |
| Audit log append-only | `BEFORE UPDATE OR DELETE` trigger raising an exception (NFR-S10) |
| Result snapshots immutable | no update path; invalidation sets status via a dedicated function, rows stay |
| Certificate uniqueness | `UNIQUE (certificateCode)`, `UNIQUE (eventId, membershipId, type, awardKey)` |
| Soft deletion for teams, participants, memberships | `deletedAt`/`status`; no hard deletes |

**Concurrency and idempotency**

* Editable records carry `version Int`; updates use `WHERE id AND version` and return a stale-version
  conflict message naming the editor and time (PRD 6.0-3). Never silent overwrite.
* "Join last slot" (AT-03N2): `SELECT … FOR UPDATE` on the team row inside the join transaction, then count.
* Write endpoints that create records (register, submit, evaluate, generate) accept an
  `Idempotency-Key` header; `IdempotencyKey(key, userId, route, responseHash)` makes retries safe.
* Deadlines are evaluated with **server time** only (PRD 6.0-6); the event time zone is used for display
  and for interpreting admin input (default `Asia/Kolkata`). Times are stored as UTC `timestamptz`.

## 7. The scoring and results engine

Implemented once in `packages/shared/src/scoring`, exercised by unit tests and used by the API.

```
n_i = s_i / max_i                      criterion score as a fraction of its maximum
J   = Σ w_i · n_i      (Σ w_i = 100)   one judge's weighted score, J ∈ [0, 100]
T   = mean of counted J over m ≥ 1     team score for the round
```

* Exact decimal arithmetic (`decimal.js`), **no intermediate rounding**; stored/compared values rounded
  **half-up to 4 dp**, displayed to 2 dp. All criteria required; integer scores only; `min ∈ {0,1}`.
* No normalisation across judges by default and no silent fill-in of missing scores. An **optional per-round
  normalisation** was added later (DECISIONS D-54, off by default): it shifts each judge with at least three scores
  by (panel mean minus judge mean), clamps to 0-100 and averages. It has a known weakness (assignment is not
  random; the panel mean mixes tracks), and raw and adjusted scores are both shown.
* A team is *complete* when every required (non-excluded) assignment has a submitted evaluation; teams
  may have different counts only after an explicit admin exclusion with a reason, recorded in the snapshot.
* **Ranking and ties (documented assumption, resolves the brief's "document tie handling"):** teams are
  ranked by `T` descending using *standard competition ranking* (1, 2, 2, 4). Equal `T` (compared at 4 dp)
  forms a **tie group**. Ties are *never* auto-broken. A tie group that overlaps award positions blocks
  approval until an organiser resolves it (shared position, or an explicit order) with a recorded reason
  (FR-033, E.3). Ranking scope defaults to per-track when tracks exist, otherwise overall; 3 award
  positions (OQ-06 defaults), both configurable per round.
* **Approval** creates an immutable `ResultSnapshot` (entries, tie resolutions, exclusions, approver,
  timestamp). **Publication** is a separate explicit action on an approved snapshot. A reopened
  evaluation or a changed assignment after approval invalidates the snapshot (FR-155). Participants can
  only read published snapshots, and only the fields allowed by the event's visibility settings
  (default: winners list on; own rank and scores off — OQ-05).
* Test fixtures: the PRD E.1 worked example (J1 = 76.0000, J2 = 72.0000, T = 74.0000), boundary
  rounding (half-up at the 5th decimal), every row of E.3, and an independent spreadsheet recalculation
  of a seeded event (Phase 5 exit criterion).

## 8. Submissions and file handling

* A submission form is per round (PRD FR-059): text, URL, file fields with allowed types and size limits.
  Types: PPT/PPTX/PDF, code repository URL, demo video (URL or file), live project URL, other permitted files.
* Drafts are mutable; **Submit** creates an immutable `SubmissionVersion`. Later edits create version N+1
  before the deadline (AT-06). Incomplete drafts are **not** auto-submitted (OQ-04); the UI warns loudly.
* Late policy per round: reject, or accept-and-flag with `lateMinutes` (AT-07). Admin extensions are
  per-team and pause that team's judging assignments (PRD 18.9).
* Validation on the server: file type by **magic-number signature** (not extension or `Content-Type`),
  per-field size limits (default 25 MB), filename sanitised, stored under a random key outside the web root,
  SHA-256 checksum recorded. External URLs: `http(s)` only, length-limited, rendered with
  `rel="noopener noreferrer"`, never fetched server-side in V1 (no SSRF surface).
* Storage lives behind `StorageProvider`; the UI and docs describe it as "platform storage (local disk in
  development)". No claim of cloud storage until an object-storage adapter exists.
* PPT/PPTX inline preview is out of scope (OQ-11): download only; PDFs render in the viewer.

## 9. Integrations (optional, last)

*Status: built in Phase 7 (`apps/api/src/integrations`, `modules/integrations`). Tested with a fake provider; the REST client is unverified against real Google. See DECISIONS D-47, D-48.*

* **Sheets (P1):** one-way snapshot push of platform-owned tabs to a platform-created spreadsheet, queued
  through a persistent `SyncJob` table (idempotent by `(connectionId, key)`, coalescing, exponential
  backoff, restart-safe). Sheet edits are never imported; banner row and connection UI say so. Honest
  status per job: queued / running / succeeded / failed (with plain-language reason). CSV export is the P0
  fallback and is built first.
* **Drive (P1):** optional archive mirror of submission files; platform storage stays canonical.
* **Credentials:** OAuth client id/secret and token-encryption key come from environment variables only;
  tokens encrypted at rest (AES-256-GCM) with a key outside the database. Without credentials the
  integration screens show "Not connected", the app stays fully functional, and no success is simulated.
  A *fake* provider exists only for automated tests of retry/idempotency (AT-09).

## 10. Security checklist (mapped to the brief and PRD §11.1)

| Control | Where |
|---|---|
| Server-side Zod validation on every route; unknown keys stripped (mass-assignment protection) | `http/validate.ts`, per-route schemas using `.strict()` / explicit pick |
| AuthN: scrypt hashes, generic login error, lockout, 30-min single-use reset links, email verification | `auth/` |
| AuthZ: matrix + event-scope resolution, 404 on out-of-scope | `authz/` |
| Cookies: HTTP-only, SameSite=Lax, Secure in production; CSRF defence via `SameSite` + custom header (`X-Requested-With`) required on mutating requests | `http/middleware` |
| Security headers via `helmet`; CSP restricting scripts/styles to self + font files (fonts self-hosted) | `http/app.ts` |
| Rate limiting: sign-in, join code, invite/email sending, password reset | `http/rate-limit.ts` |
| Safe uploads (signature check, size, private storage, download headers) | `storage/`, `submissions/` |
| CSV formula-injection neutralisation (`=`, `+`, `-`, `@` prefix → `'`) | `exports/` |
| Non-sequential public IDs (`cuid2`); sequential `teamCode` is display-only and never an access key | schema |
| Transactions for join, submit, evaluate, approve, generate certificates | services |
| Audit trail of consequential actions; admin-only reader; append-only trigger | `audit/` |
| Secrets only in env; `.env*` ignored (except `.env.example`); logs redact tokens and passwords | repo + `pino` |
| Errors: typed `AppError` → safe messages; stack traces never returned | `http/error.ts` |

Audited actions (Ⓐ in the PRD) include: event create/edit/publish, registration status, team record changes,
rubric edits/activation/unlock, judge assignment changes, evaluation submit/reopen, result approval/
invalidation/publication, certificate generate/release/revoke, integration connect/disconnect, CSV export,
extensions, membership changes.

## 11. Frontend architecture

* **Routing** mirrors PRD §5.4: `/` (My Events) → `/events/:eventSlug/...` with a role-specific layout
  chosen from the membership returned by `/api/v1/me/events`. Public landing at `/e/:eventSlug`.
  Four navigation configs share one `AppShell` so admin, participant, judge and staff UIs are visibly the
  same product.
* **Data fetching:** TanStack Query; a typed `api` client built on `fetch`, credentials included, sends the
  CSRF header and idempotency keys for creates; maps API errors to field errors.
* **Design system:** all visual decisions flow through `styles/tokens.css` → Tailwind theme → components in
  `src/ui/`. Feature code never uses raw hex values. See `docs/BRAND_IMPLEMENTATION.md`.
* **Accessibility:** WCAG 2.1 AA target, keyboard-complete flows, visible focus ring, labels bound to
  inputs, error summary + inline errors, status never colour-only, 360 px layouts for staff/participant
  (PRD §11.5). Judge workspace is laptop-first but not broken on narrow screens.
* **Time:** all deadlines shown in the event time zone with the zone label ("23:59 IST"), with a live
  server-synchronised countdown near deadlines.
* **Autosave:** judge scoring and submission drafts autosave; connectivity loss shows a clear banner and
  retries (PRD edge case 25), no offline mode.

## 12. Environments and configuration

`.env.example` (placeholders only):

```
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/arthakram
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/arthakram_test
SESSION_SECRET=change-me
APP_BASE_URL=http://localhost:5173
API_PORT=4000
STORAGE_DIR=./.data/uploads
EMAIL_PROVIDER=console            # console | smtp
SMTP_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
TOKEN_ENCRYPTION_KEY=
```

Root scripts: `dev` (api + web), `build`, `lint`, `typecheck`, `test`, `test:e2e`, `db:migrate`,
`db:seed`, `db:reset`. Seed creates a demo event ("HackSonipat 2026" — the PRD's example data), seeded
accounts per role with development-only passwords documented in the README, a generic rubric
template, and a few teams/submissions; the seed refuses to run when `NODE_ENV=production`.

## 13. Quality gates

A change is mergeable only when, as applicable: migrations apply cleanly on an empty database;
`typecheck`, `lint` and unit/API tests pass; permission harness is green; the feature has UI + API +
persistence + validation + authorisation + error states + tests; and, for UI work, the rendered pages were
inspected via Playwright screenshots at desktop (1440) and mobile (390) widths against the brand rules
(see the plan's visual-QA protocol). Screenshots are kept out of git.

## 14. Explicit non-goals (inherited from PRD §3.2)

Payments, QR check-in, public leaderboards, bidirectional Sheets sync, multi-tenant org
administration/SSO, offline mode, native apps, anonymous judging, public discovery. (AI features and judge-bias
normalisation were also non-goals; both now exist as optional, off-by-default features, DECISIONS D-54 and D-55.
Public certificate verification, formerly P2, exists too, D-56.) Where the brief's prompt mentioned QR check-in or AI "where in scope / later", the PRD
non-goal wins (DECISIONS D-02, D-03).
