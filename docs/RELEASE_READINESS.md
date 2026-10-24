# Release readiness: controlled pilot

Written after a hands-on audit of the running system, not from earlier completion reports. Everything is
labelled **Verified** (I ran it and saw the result), **Partly verified**, or **Not verified**. Dates are 22 Oct 2026.

## 1. Verdict

Ready for a **controlled pilot on a single API instance with persistent local disk**, provided the manual
configuration in section 8 is done first. Three defects found in this pass would each have broken a real
deployment (section 3); all are fixed and covered by tests. The Google Sheets/Drive integration has **never
talked to real Google** and must not be relied on until the trial in section 5 is done. CSV export is the fallback.

## 2. What was checked, and how

| Area | Result | Evidence |
|---|---|---|
| Automated checks on the final tree | Verified | ESLint, brand lint, typecheck, build clean; API 363, shared 23, web 32 unit/integration tests pass |
| Browser specs (dev servers, Chrome) | Verified | 16 Playwright specs pass |
| Browser specs against a production-configured stack over HTTPS | Verified | `scripts/staging/rehearse.sh`: 6 specs pass, 0 server errors logged, 82 emails captured |
| Whole journey on an empty database | Verified | `src/journey/journey.test.ts` (12 steps, truncated DB) |
| Every event route: 401 anonymous, 404 non-member, 403 without CSRF header | Verified | `src/security/security.test.ts` reads routes from source |
| Garbage ids, queries, bodies on every route | Verified | same file; found six 500s, now 400 |
| Migrations on an empty database, constraints survive | Verified | `src/schema/migrations.test.ts`, staging rehearsal |
| Backup and restore | Verified locally | `scripts/backup.sh`, `scripts/restore-check.sh` |
| Load profile (1,000 participants, 250 teams) | Verified on one laptop, warm cache | `npm run test:load -w @arthakram/api` |
| `npm audit` | 0 known vulnerabilities today | rerun before the event |
| Google Sheets/Drive against real Google | **Not verified** | no credentials available |
| Real SMTP provider, real certificate, real host | **Not verified** | rehearsal used a local SMTP sink and a self-signed certificate |

## 3. Defects found in this pass, and fixes

| # | Defect | Impact | Fix and regression test |
|---|---|---|---|
| 1 | The integrations migration had a timestamp that sorted before the migrations it depends on, and its generated SQL dropped two hand-written composite foreign keys (`certificate_member_same_event`, `cert_exception_member_same_event`) | `migrate deploy` failed on every fresh database, so a new installation could not start. My development and test databases had silently lost two integrity rules | Migration renamed to sort last, drops removed, dev and test databases rebuilt. `migrations.test.ts` checks order and that every trigger, check, partial index and composite key still exists (it fails if one is dropped) |
| 2 | The SMTP provider sent only the message body; the verification, reset and invitation link was stored in a separate field and never emailed | In production nobody could verify an account or accept an invitation. The dev outbox hid it | Link appended to the delivered text. Unit test keeps the link out of the body so it fails if dropped. Found by the staging rehearsal |
| 3 | Production had no email delivery at all (only the dev outbox) | Same as above | SMTP provider added; the server refuses to start in production without it, or with an http `APP_BASE_URL` |
| 4 | Parallel wrong-password attempts all read the same failure count | The 5-attempt lockout could be outrun | Atomic database increment. Test fires 8 parallel guesses and expects exactly 8 counted |
| 5 | Rate limiter never evicted expired windows | Unbounded memory growth under scanning traffic | Periodic sweep |
| 6 | Invitation emails had no send limit (PRD NFR-S9) | An admin account could be used to send bulk mail | 100 per hour limit with a test |
| 7 | Six routes answered 500 to bad input: unknown enum filters, invalid dates in the audit filter, NUL characters in search text | Noisy errors, and 500s hide real faults | Prisma validation errors map to 400; NUL characters rejected up front; fuzz test over every route |
| 8 | Oversized request bodies answered 500 | Wrong status | 413 |
| 9 | Malformed `X-Filename` percent-encoding answered 500 on upload | Wrong status | Treated as a plain name; test |
| 10 | CSP allowed any https stylesheet and font; API responses were cacheable; proxy trust hard-coded | Weaker than intended | Same-origin-only CSP, `Cache-Control: no-store` on `/api`, `TRUST_PROXY_HOPS` setting with tests |
| 11 | Expired sessions and spent tokens were never deleted | Unbounded tables | Purge every 6 hours with a test |
| 12 | A mail outage returned a generic 500 | Confusing; looked like a lost account | 503 "couldn't send the email right now"; account kept; resend works; test |
| 13 | The production API could not start (`node dist/server.js` failed on TypeScript from the shared package) | No production start | Shared package compiled; API also serves the web build |
| 14 | Participants, judges and staff saw organiser screens render (data was still protected by the API) | Confusing, and untidy | Event workspace shows "This page isn't available to you" |
| 15 | Judges and staff had a "Certificates" menu entry for something they never receive | Misleading | Removed from their menus |
| 16 | Progress bars rendered default green/grey; locked form fields had low-contrast text | Off-brand, hard to read | Ember-on-Blush bars; locked fields use full Graphite text |

Not changed on purpose: a locked account answers 429 "account_locked", which confirms the account exists to
someone who guesses its email (the PRD asks for this message); the audit log keeps the changed fields of a
registration (including a phone number) visible only to Core Admins, who can already see them.

## 4. Product workflow on a fresh database

Verified by `journey.test.ts` (API level, empty database) plus the browser specs. Steps: register, refuse sign-in
before verification, verify once (second use refused); create event; configure round, deadline, team size,
tracks (duplicate refused), guidebook draft and publish; publish (blocked until a deadline exists; stale edit
refused); register participants (repeat updates, never duplicates); create and join teams (wrong code, second
team and duplicate names refused); upload (a fake PDF is rejected, a bad link is rejected, a stale draft is
refused); late submission refused then allowed by an audited extension; invite judges, accept (another person
cannot use the link; single use); assign (repeat creates no duplicates; participants cannot); evaluate (range,
incomplete, wrong judge refused; double submit refused; submitted evaluations locked); results (deterministic
score, equal scores flagged as a tie, approval blocked until resolved with a real reason, participants see
nothing until publication and never see judge detail); feedback (closed until opened, one response each,
confidential, formula-neutral CSV); judge comments (hidden until released, then anonymised); certificates
(generated twice, no duplicates; unreleased are 404; release needs the review confirmation; only the owner
downloads); CSV exports (organiser only); audit (every key action present; rows cannot be updated or deleted).

Not covered by an automated browser run on a fresh database: the setup screens through the UI for every
option; the browser specs create their own events through the API and UI and passed on both dev and staging stacks.

## 5. Google Sheets and Drive

**Real Google: not tested. No credentials were available, and none were requested.** What exists:

* The sync queue, retries, idempotency and error mapping are tested against an in-memory fake.
* The real REST client (`integrations/google.ts`) and the queue are now also exercised over HTTP against a
  **local stand-in server** (`googleStub.ts`) written from Google's public documentation. This catches request
  shape, URL encoding, tab-id matching, rename/delete handling, 429/401/404 mapping, multipart upload and folder
  layout. It is **not Google**: it proves nothing about quotas, consent screens, scope behaviour or API quirks.
  The stand-in found and fixed one encoding detail (the values range is now encoded as a single A1 reference).

Exact manual steps to verify for real (about 30 minutes, throwaway event and a test Google account):

1. In Google Cloud: create a project, enable the Sheets and Drive APIs, configure the OAuth consent screen
   (External, Testing, add the test account), create a Web OAuth client with redirect URI
   `{APP_BASE_URL}/api/v1/integrations/google/callback`.
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`), restart.
3. Create a throwaway event with 3 teams and one submission. Integrations > tick the confirmation > Connect Google.
4. Check: the spreadsheet is created in the test account; Participants, Teams and Submissions tabs have the banner
   rows and the right counts; Sync now three times leaves identical content.
5. Edit a participant's name; Sync now; the same row changes, no new row. Rename the Teams tab in Google; sync;
   no second Teams tab. Delete the Participants tab; sync; it comes back.
6. Turn on the Drive archive; submit; check Event > Round > Team folders and `links.txt`; resubmit and check a v2 file appears and v1 stays.
7. Revoke the app at myaccount.google.com/permissions; Sync now; expect "Needs reconnecting". Reconnect; sync works.
8. Delete the spreadsheet in Google; sync; expect "can't be found"; "Create a new spreadsheet" recovers.
9. Record results here and in DECISIONS.md. Until then the Google section of this document stays **Not verified**.

Google may require OAuth app verification before accounts outside the test list can consent.

## 6. Storage and deployment assumptions

* **Verified:** the pilot design is one API process plus a persistent directory (`STORAGE_DIR`) plus PostgreSQL.
  Uploads and certificate PDFs are written once under random keys and never overwritten; the health check
  (`/api/v1/health`) writes, reads and deletes a probe object and answers 503 if it fails; the server refuses to
  start without writable storage. Backup, restore and a restored file download were rehearsed (section 7).
* **Why local disk is acceptable for the pilot:** one instance, one disk, backups of both the database and the
  directory. **When it is not:** any host with an ephemeral filesystem (many container and serverless platforms
  discard local files on restart or redeploy). Do not run the pilot there. If hosting is of that kind, an
  object-storage adapter is required before the event; the storage interface has two methods (`put`, `get`) plus
  `check`, so it is small, but **it has not been written** because no host was chosen.
* **Single instance:** rate limiting and the sync worker are in process. Two instances would each have their own
  limits; the sync queue is safe with two workers but untested.
* **Durability:** no replication. Loss of the disk loses uploads since the last backup. Back up after the submission
  deadline and after result approval, as the runbook says.
* **Retention:** not decided (PRD OQ-15). Nothing is deleted automatically except expired sessions and spent tokens.
  Backups contain personal data and must be stored and deleted under the same rules.

## 7. Deployment rehearsal

Run: `PW_CHANNEL=chrome scripts/staging/rehearse.sh` (needs PostgreSQL, OpenSSL, Chrome).

| Check | Result |
|---|---|
| Production refuses console email and an http base URL | Verified |
| Migrations on an empty database | Verified (this found defect 1) |
| Health over HTTPS reports database and storage | Verified |
| Security headers; HSTS; no dev routes in production (404) | Verified |
| SMTP delivery of verification, invitation and notification emails (local sink) | Verified (found defect 2) |
| Secure and HttpOnly session cookie over HTTPS; session survives an API restart | Verified |
| Acceptance specs over HTTPS (organiser, participants, judges, staff, results, certificates) | 6 passed |
| Server errors logged during the run | 0 |
| Backup, restore into a scratch database, app boots on it, a restored file downloads | Verified on the development database (2,141 rows, 6 triggers, 552 audit entries) |
| Real hosting, real certificate, real mail provider, real DNS | **Not verified** |

The rehearsal turns the rate limiter off (the specs register dozens of accounts from one address). Limits are
covered by the API tests, not by the rehearsal.

## 8. Required manual configuration before the pilot

1. Choose hosting with a **persistent** disk, HTTPS and a process manager (see DEPLOYMENT.md).
2. Create the production database; set `DATABASE_URL`, `SESSION_SECRET` (32+ random characters), `APP_BASE_URL`
   (https), `STORAGE_DIR`, `SMTP_URL`, `EMAIL_FROM`, `TRUST_PROXY_HOPS` (1 behind one proxy, 0 with none).
3. Send a real verification email to two real addresses (different providers) and confirm the link works and
   does not land in spam. Set SPF/DKIM for the sending domain.
4. Schedule `scripts/backup.sh` daily (30 days retained) and run `scripts/restore-check.sh` once on real data.
5. Decide who is the named on-call developer during the event window (PRD 11.3).
6. Do the Google trial (section 5), or tell organisers to use CSV export only.
7. Agree retention and deletion rules (OQ-15) and who can access backups.
8. Rehearse once on the real host with a throwaway event and fake participants before inviting real ones.

## 9. Visual QA (Playwright screenshots at 1440 × 900 and 390 × 844, viewed)

Roles in the product: Core Admin (this is also the "event organiser"; there is no separate organiser role, DECISIONS D-06/D-07),
Participant (with Team), Judge, Helping Staff.

**Viewed and judged:**

* Core Admin: event overview and dashboard (desktop and mobile), setup (desktop), guidebook editor (desktop),
  participants list (mobile, desktop empty), judging (desktop), rubric (desktop, mobile), results (desktop),
  feedback (desktop), certificates (desktop, mobile; revoke dialog), integrations (desktop, mobile).
* Participant: overview (mobile), team (desktop), team with no team (mobile), submission (desktop), feedback (mobile), certificates (mobile).
* Judge: overview (desktop, mobile), evaluation workspace (desktop, mobile).
* Helping Staff: overview (mobile), tasks (desktop), check-in (mobile), report an issue (mobile).
* States: loading skeleton (dashboard), request error with retry (dashboard mobile), empty lists (participants, judging, certificates),
  out-of-role page (mobile), unknown event (mobile), registration validation summary (desktop), sign-in error (mobile), confirmation dialog (revoke certificate).

**Captured by the same runs and not individually inspected:** the other desktop/mobile counterparts of the screens above
(for example staff and participant pages at the other width, teams, submissions, people, tasks, issues and audit
screens, public event page, auth pages), and the not-ranked dialog and unknown-page captures. The capture script
confirmed there is no horizontal page scroll on any of them, but that is not a visual review.

**Not seen at all:** the Integrations page while connected (no credentials); Google consent screens.

Issues found and fixed in this pass: progress bars off-brand, locked fields low contrast, empty-list titles ("No matches" on an empty event),
judge/staff Certificates menu entries. Known and accepted: on phones the section menu scrolls sideways with no visible hint;
wide admin tables scroll inside their card rather than restacking.

Screenshots are written to `.qa-screenshots/` (git-ignored). The brand kit PDF was never opened by the tooling, committed or copied.

## 10. Remaining risks

* **High:** Google integration unverified against real Google (mitigation: CSV, section 5).
* **High if hosting is ephemeral:** local-disk storage (section 6).
* **Medium:** email deliverability untested with a real provider and domain.
* **Medium:** single process; a crash during the event needs a process manager and an on-call person.
* **Medium:** load figures are from one laptop; no soak test, no concurrent-upload test at the deadline with large files.
* **Low:** accessibility has had keyboard/contrast attention but no assistive-technology test.
* **Low:** locked-account message reveals account existence; audit log holds some personal data.
* **Not built:** judge/staff appreciation certificates, public certificate verification, participant withdraw, email reminders, staff phone visibility.
