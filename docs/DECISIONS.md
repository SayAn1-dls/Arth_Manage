# Decisions log

Format: **ID · decision · why · status**. Status: *Adopted* (proceeding), *Open* (needs user input,
a default is used meanwhile). PRD open questions (OQ-xx) keep the PRD's own defaults unless stated.

## Where the working brief and the PRD differ

| ID | Topic | Brief says | PRD says | Decision |
|---|---|---|---|---|
| D-02 | QR check-in | "QR check-in where in scope" | Non-goal for V1 (§3.2); search-based check-in | **PRD wins.** Search-based check-in only. *Adopted* |
| D-03 | AI features | "valuable later, not a priority" | Non-goal for V1 | **No AI in V1.** No provider abstraction built. *Adopted; partly superseded by D-55 (optional reading aid, off by default)* |
| D-04 | Google Sheets | "registration exports and synchronisation… updates without duplicate rows" | One-way snapshot push; no row upserts; sheet edits overwritten | **PRD wins:** whole-tab rewrite ⇒ duplicates are impossible by design; CSV is the guaranteed fallback. *Adopted* |
| D-05 | Drive | "event/team file organisation" | Native storage canonical; Drive is an optional one-way mirror (P1) | **PRD wins.** *Adopted* |
| D-06 | "Platform administrator" vs "organiser" | Separate permission scopes | No platform admin; Core Admin per event | No platform-admin role and no operator allowlist (resolves the earlier conflict with OQ-02): any verified user may create an event and becomes its owner and Core Admin; event data is reachable only through event membership. Organisers/POCs = Core Admins of their event. An allowlist is added only if explicitly required later. *Adopted* |
| D-07 | Roles | Admin, organiser/POC, participant, judge, staff | Core Admin, Participant, Judge, Helping Staff; one role per user per event | Four roles per PRD. *Adopted* |
| D-08 | Certificate eligibility etc. | "eligibility rules" | OQ-09 default: submitted in Round 1; OQ-16 Latin script only | Use PRD defaults. *Adopted* |

## Engineering choices (the PRD is stack-agnostic)

| ID | Decision | Why |
|---|---|---|
| D-01 | npm-workspaces monorepo: `apps/api`, `apps/web`, `packages/shared`; React + Vite + Tailwind; Express; Prisma + PostgreSQL; Zod; Vitest + Playwright | As briefed; shared package makes validation and the scoring engine single-sourced. *Adopted* |
| D-09 | Logo artwork | **Resolved.** Logo is a static file in the repo: vector lockup and feather mark extracted from the live bezier paths in the local kit and committed as SVGs under `apps/web/src/assets/logo/` (default, white, on-ink, feather, feather-white) plus the favicon. The kit PDF itself is never committed. The Rishihood university logo is not used in the internal UI. |
| D-10 | Semantic status colours | Success/warning/error/info are needed for statuses. Use muted, warm-compatible tones defined as separate tokens (`--status-*`), always paired with an icon + text, never replacing Ember. Documented in BRAND_IMPLEMENTATION. *Adopted* |
| D-11 | Auth | Email + password, email verification and reset links per FR-001; Google sign-in is P1 and skipped. Passwords hashed with `node:crypto` scrypt. *Adopted* |
| D-12 | Email | Provider interface; dev adapter logs and stores to `OutboxEmail`; SMTP adapter for real use. *Adopted* |
| D-13 | Storage | `StorageProvider` interface with local-disk adapter; described honestly as local storage. *Adopted* |
| D-14 | Node 26 | **Resolved.** Verified on Node 26.9.0: Prisma 7.10.1 (migrate, generate, pg adapter), Express 5, Vite 8, Vitest 5 and Playwright all run. `.nvmrc` pins 26; `engines` allows >=22.18. Prisma 8 is still release-candidate, so 7.10.1 is pinned. |
| D-15 | Brand PDF handling | Ignored via `.gitignore` patterns (`Arthakram-Brand-Kit*.pdf`, `*Brand-Kit*`, etc.); never copied into the repo or served; verified before every push. *Adopted* |
| D-16 | Visual QA | Playwright Chromium (already installed) screenshots at 1440 and 390 px, inspected by viewing the images. If a screen is not captured it is not claimed. *Adopted* |
| D-17 | PDF generation | `pdf-lib` for guidebook PDF and certificates (no headless browser dependency in production). *Adopted* |
| D-18 | Ranking | Standard competition ranking (1,2,2,4); ties flagged and resolved manually with reason; never auto-broken. Ranking scope default: per track if tracks exist else overall; 3 award positions. *Adopted* |
| D-19 | Time | Server time is authoritative; stored UTC; shown in the event time zone (default Asia/Kolkata) with zone label. *Adopted* |
| D-20 | Public IDs | `cuid2` ids in URLs; `teamCode` (T-0042) is a display label only. *Adopted* |
| D-21 | Web forms | Plain controlled/uncontrolled forms with server-side Zod validation mapped to field errors via `useFormErrors`, instead of React Hook Form. Fewer dependencies; the server is the validator of record (PRD 6.0-4). *Adopted* |
| D-22 | Session lifetime | Decided at sign-in: 12 h when the user is an active Core Admin of any event, otherwise 7 days (OQ-14 defaults); not sliding. *Adopted* |
| D-23 | Unverified accounts | Sign-in is refused (403 `email_not_verified`) until the email is verified, with a resend option. Registration answers identically for new and existing emails to avoid account enumeration. *Adopted* |
| D-24 | Prisma generated client | Generated to `apps/api/src/generated` (git-ignored) with ESM `.js` import extensions; regenerated on install and build. *Adopted* |
| D-25 | PDF fonts | Guidebook and certificate PDFs embed Bricolage Grotesque and Instrument Sans TTFs from the open-licence `@expo-google-fonts/*` npm packages (the `@fontsource` packages ship only WOFF). Print documents sit on White with Ember rules, per the kit. *Adopted* |
| D-26 | Markdown italics | The guidebook Markdown subset accepts `*italic*`, but the web renders it semibold because the kit allows bold as the only inline emphasis. The PDF mirrors this. *Adopted* |
| D-27 | Delete-in-use checks | Blocking deletion of tracks, problem statements and rounds that teams or submissions use lives in `modules/events/usage.ts`; the bodies are completed in Phase 3 when those tables exist. Until then nothing can be in use. *Adopted* |
| D-28 | Problem statement attachments | The optional PDF attachment (PRD FR-011) depends on the storage provider and is built after Phase 3's storage work; timed release ("visible from") and per-problem caps are P1 and skipped. *Adopted* |
| D-29 | Dev rate limits | Rate limiting is on by default; `RATE_LIMIT_DISABLED=true` (in the untracked `.env` for local runs) lets browser tests sign in repeatedly. Tests enable the limiter explicitly to assert it works. *Adopted* |
| D-30 | Publish rules | Publishing requires at least one round with a submission deadline (FR-005). An unpublished guidebook only warns. Concluding without published results needs explicit confirmation until Phase 5 supplies published snapshots. *Adopted* |
| D-31 | File downloads | Instead of 10-minute signed URLs (PRD §8.3), `GET /events/:id/files/:fileId` checks the caller's permission on every request (own team or Core Admin; unassigned judges and staff get 404) and sends `Content-Disposition: attachment`, `nosniff`, a sandbox CSP and `no-store`. Same-origin cookies make a signed URL unnecessary, and a revoked member loses access immediately. *Adopted* |
| D-32 | Upload transport | Files are uploaded as the raw request body (`PUT .../files/:fieldId`, name in `X-Filename`) with XHR progress, avoiding a multipart dependency. Validated by magic number and size before anything is stored. *Adopted* |
| D-33 | Withdraw (P1) | Participant self-withdrawal (FR-058) is not built; admins remove participants, and a removed participant cannot return. The schema keeps `Registration.status = WITHDRAWN` for it. *Adopted* |
| D-34 | Judge file access | Judges can download only files of teams assigned to them; assignments arrive in Phase 4, so until then no judge can read any submission file. *Adopted* |
| D-35 | Delete-in-use | Tracks and problem statements in use by a team block deletion with the team list; rounds with submissions cannot be deleted; maximum team size cannot drop below an existing team (all tested). *Adopted* |
| D-36 | Extension vs judging | A team extension changes only whether the team can still submit. If judging has already opened, a late resubmission is simply the new judged version; evaluations already submitted are not auto-reopened (PRD 18.9 describes pausing and reopening). Admins can reopen individual evaluations or unlock the rubric when that is needed. *Adopted, simplification* |
| D-37 | Missing-file report | The judge's "Report missing file" action (FR-094) needs the issue queue, so it is delivered with staff issue reports in Phase 5. The workspace links to download the file as a fallback. *Deferred to Phase 5* |
| D-38 | Draft rubrics | Drafts may total any weight (they must total 100 to activate), but each criterion must individually be valid (weight 1-100, min 0 or 1, max above min) so the database constraints can mirror the PRD limits. *Adopted* |
| D-39 | Judge visibility | Before judging opens a judge sees only their assigned team names; project content, files and the rubric appear when judging is Open or Closed. Files are served for the judged (last submitted) version only. *Adopted* |
| D-40 | Not required | "Did not submit" assignments are derived (no submitted version once the submission window closed) rather than stored, so granting an extension restores them automatically. *Adopted* |
| D-41 | Result invalidation | Instead of hooking every write path, the ranking inputs are fingerprinted (evaluations and versions, assignment statuses, team states, tie decisions, not-ranked marks, round and rubric settings) and compared whenever results are reviewed or published; a mismatch marks the snapshot withdrawn and writes an audit entry. Participants keep the last published version. *Adopted* |
| D-42 | Approvable team | A team is ready for approval when it has all required counted evaluations, or no pending assignment and at least one counted evaluation (after exclusions with reasons), or is explicitly marked Not ranked. Teams that did not submit or are disqualified never block approval. *Adopted (FR-149 reading)* |
| D-43 | Judge file report | Resolved: an assigned judge's "Report a missing file" creates a Technical issue linked to the team in the admin issue queue (supersedes D-37). *Adopted* |
| D-44 | Staff phone numbers | Staff cards show name, institution, year, track and attendance only. The optional "staff can see phone numbers" and "visible to staff" custom-field settings (P1) are not built. *Adopted* |
| D-45 | Certificate scope | Participation and winner certificates only; judge/staff appreciation certificates, public verification page and certificate email reminders are deferred (P1/P2). *The public verification page was later built, see D-56.* Participants' own detail edits lock once a certificate exists, so changes go through a recorded name correction that keeps the certificate ID and bumps the version. Release needs an explicit "reviewed" confirmation and is blocked while any certificate is flagged or needs regeneration. *Adopted* |
| D-46 | Feedback | Each event has one participant and one judge form (defaults from the PRD). Responses are final. Confidential forms never expose respondent names, even in CSV. Judge comments reach a team only after the round's results are published and the organiser releases them, labelled Judge 1, Judge 2. *Adopted* |
| D-47 | Google integration shape | One connection per event with an AES-256-GCM encrypted refresh token (key from `TOKEN_ENCRYPTION_KEY`), `drive.file` scope only. Sheets: whole-tab clear-and-rewrite of Participants, Teams and Submissions, tabs matched by Google tab id, banner rows, never scores/comments/feedback, values written RAW and formula-neutralised. Drive: keyed mirror rows so retries never duplicate. A `GoogleProvider` interface isolates Google; tests use an in-memory fake. The REST client is unverified against real Google. *Adopted* |
| D-48 | Sync queue | Postgres-backed `SyncJob` with partial unique indexes (one queued, one running per kind and connection), 60 s debounce capped at 5 min, retries at 1/2/4/8/16 min, a newer queued job supersedes a failed one, stuck jobs recover on start, claims are conditional updates. Changes are detected by one response hook on the API router, not by editing every write path. *Adopted* |
| D-49 | Production build | Shared package compiles to `dist`; a `source` export condition keeps dev tooling on TypeScript sources. The API serves `apps/web/dist` in production. Production refuses to start without SMTP email and an https `APP_BASE_URL`. *Adopted* |
| D-50 | Email | `SmtpEmailProvider` (nodemailer) added so production can deliver verification, reset and invitation emails; the dev outbox remains non-production only. *Adopted* |
| D-51 | Release audit | Findings and fixes are in `docs/RELEASE_READINESS.md`. Two decisions: `TRUST_PROXY_HOPS` is configurable (default 1) because rate limits key on the client address; API responses are `no-store`. *Adopted* |
| D-52 | Google verification status | Real Google has not been tested. A local stand-in server exercises the real REST client and queue and is labelled as not-Google in code and docs. The integration stays "unverified" until the manual steps in RELEASE_READINESS section 5 are recorded. *Adopted* |
| D-53 | Storage for the pilot | Local disk, one instance, persistent volume, backed up. An object-storage adapter is required if the host has an ephemeral disk; not built because no host is chosen. *Adopted* |

## Decisions added after the 28 Oct 2026 audit

These record departures that shipped in PR #3 and the follow-up without a row here (audit finding A12). The PRD
still governs V1; each of these goes beyond it, so each states what it costs and what would justify removing it.

| ID | Decision | Why and consequences | Status |
|---|---|---|---|
| D-54 | Optional score normalisation per round (`Round.normalisation`, off by default) | Departs from PRD 13.2 (judge-bias normalisation is P2) and `TECHNICAL_ARCHITECTURE.md` section 7. Each judge with at least 3 scores is shifted by (panel mean minus judge mean), results are clamped to 0-100 and averaged; raw and adjusted scores are both shown, and approved results must be invalidated before the method changes. **Known weakness (audit A2):** assignment is not random and the panel mean mixes tracks, so a judge who drew the strongest teams is marked up and those teams down; three scores is mostly noise. Do not enable it for an event whose prizes depend on it until the panel mean is computed per track and the minimum sample is raised. | *Adopted, off by default; hardening open* |
| D-55 | Optional AI reading aid for judges (`JUDGE_AI_ENABLED`, `OPENAI_API_KEY`, `JUDGE_SUMMARY_MODEL`) | Departs from D-03. It summarises supplied evidence only, never scores or ranks, uses a strict three-field schema and `store: false`, and falls back to source-only reading. Enabling it sends project titles, summaries and public README excerpts to OpenAI, so it needs an explicit privacy decision (PRD OQ-15). Tested with a mocked response only. | *Adopted, off by default, unverified against OpenAI* |
| D-56 | Public certificate verification page and event reminders | Departs from D-45. `GET /api/v1/public/certificates/:code` is unauthenticated and returns the holder's name, event, award and status; new PDFs carry a QR code. Codes are 8 symbols from 32 (about 1.1e12). Limited to 60 requests per minute per address (audit A9, fixed). Reminders are a worker that queues one-hour-before-deadline messages. | *Adopted* |
| D-57 | Extended organiser workflow: helpdesk, exception desk, application screening, round shortlists, targeted messages with a persistent email queue, engagement, teammate discovery, access labels (co-admin, staff lead, sponsor viewer), impact PDF, GitHub project review | Not in the PRD. Roles stay the four in D-07; access labels only narrow or reuse them and are enforced server-side. Shortlisting and application screening change who may submit and who is judged, so they are covered by tests. Notices use a key derived from the decision so repeating it does not re-send (audit A3). | *Adopted* |
| D-58 | Migration integrity policy | Prisma does not model the composite same-event keys, so `prisma migrate dev` proposes to drop them (this happened in `20261023150259_first_migration`, audit A1). They were restored by `20261028100000_restore_certificate_event_constraints`. Rules: read every generated migration for `DROP CONSTRAINT`, `DROP TRIGGER` and `DROP INDEX` before committing; `migrations.test.ts` now holds a fixed must-exist list that a drop cannot excuse; removing a rule means editing that list in review. | *Adopted* |

## PRD open questions — defaults in force

OQ-02 any verified user may create events; creator becomes Core Admin (no allowlist, see D-06) ·
OQ-04 no auto-submit at deadline · OQ-05 winners list on, own rank/scores off by default (per-event toggle) ·
OQ-06 per-track ranking when tracks exist, 3 awards · OQ-07 email not changeable · OQ-09 participation
certificate = team submitted in Round 1 · OQ-11 PPT download only · OQ-12 admins extend deadlines, never
upload on a team's behalf · OQ-13 judge ≠ staff in the same event · OQ-14 12 h admin / 7 d other sessions ·
OQ-16 Latin script only. Needs real stakeholders (not decided here): OQ-01 hosting, OQ-03 pilot event,
OQ-08 email provider, OQ-15 retention/legal.

## Change process

Add a row here whenever the code departs from the PRD, the architecture doc or the brand notes, and link the
commit in its message body.
