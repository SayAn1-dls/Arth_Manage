# Product audit, 28 October 2026

Scope: `v1_runthrough` after the merge of PR #1 to #3 and the collapsible sidebar (`e8cbf06`). Method: all ten
files in `docs/`, the PRD (sections 0-2, 13, the section 16 test list and 18.8 read in full; sections 6-8 and 15
through `TECHNICAL_ARCHITECTURE.md`), the code, and these runs. Statements are tagged **Verified** (run and
observed), **Docs claim** (a document says so, not re-checked) or **Unverified** (nobody has tested it).

> **Correction, same day:** the first draft listed `FEATURES_V2.md` as understating its migrations. It lists its
> own two correctly (the third migration belongs to the judge portal), so that row was wrong and is fixed below.

## 1. Evidence gathered (Verified)

| Check | Result |
|---|---|
| API tests | 386 of 386 pass (24 files) |
| Web tests | 69 of 69 pass |
| Playwright e2e | 16 of 16 pass, with `EMAIL_PROVIDER=console` and `RATE_LIMIT_DISABLED=true` (finding A6) |
| Production build, ESLint, brand lint | pass |
| Screen sweep | 65 sidebar screens (admin 32, participant 17, judge 9, staff 7) load with no failed API call, console error or error banner, on a freshly seeded event. This proves the screens render, not that every workflow works with real data |
| Before this follow-up | `npm run typecheck` failed for the API (3 errors), `npm audit` reported 1 high, `format:check` failed on 2 files, two certificate constraints were absent |

## 2. Findings

IDs are stable; `CHANGELOG.md` and `RELEASE_READINESS.md` section 11 refer to them.

| ID | Severity | Finding | Status |
|---|---|---|---|
| A1 | High | `20261023150259_first_migration` dropped `certificate_member_same_event` and `cert_exception_member_same_event`, so the database no longer stopped a certificate pointing at a member of another event. `migrations.test.ts` excused every dropped rule, so it passed anyway | **Fixed**: new migration `20261028100000_restore_certificate_event_constraints` and a fixed must-exist list in the test |
| A2 | High (product) | Optional score normalisation shifts each judge by (panel mean - judge mean) once they have 3 scores. Assignment is not random and the panel mean mixes tracks, so it can change winners. The PRD lists it as P2 and `TECHNICAL_ARCHITECTURE.md` section 7 says there is none | **Open**: decision needed; documented as D-54 |
| A3 | Medium | Shortlist notices used a key containing `Date.now()` (never de-duplicated) and went to members of dissolved and disqualified teams | **Fixed** with a regression test |
| A4 | Medium | `npm run typecheck` failed for the API: 3 TS2532 errors in `email/provider.test.ts` | **Fixed** |
| A5 | Medium | `body-parser` 2.0.0-2.3.0, high severity (GHSA-27r3-jxmh-p828) | **Fixed** (lockfile) |
| A6 | Medium | e2e needs `EMAIL_PROVIDER=console` and `RATE_LIMIT_DISABLED=true`; with the repo `.env` (`EMAIL_PROVIDER=smtp`) every signup test fails "No email for ...", and the 10/hour registration limit blocks the rest. Not documented | **Fixed** in README |
| A7 | Medium | Nine of the ten PR #3 tables checked have no foreign keys (only `JudgeMemo` has one), so orphan rows are possible | **Open**: needs a data check before constraints are added |
| A8 | Low | The reminder and email worker retries every 30 s with no backoff and runs in every API instance | **Open** |
| A9 | Low | `/public/certificates/:code` is unauthenticated, unlimited and returns the holder's name. Codes are 8 characters from 32 symbols (about 1.1e12) | **Open**: add a rate limit |
| A10 | Process | PR #3 is one 5.9k-line commit touching scoring, assignment, the submission gate and certificates under a "judge workspace" title | **Process**: PRs split by concern from now on |
| A11 | Low | GitHub checks are unauthenticated: 60 requests per hour per server IP, shared by judge reading cards and admin scans | **Open**: add optional `GITHUB_TOKEN` |
| A12 | Medium | Documentation drift (see section 4) | **Fixed** in this follow-up (README, DECISIONS D-54 to D-58, RELEASE_READINESS section 11, DEPLOYMENT, FEATURES_V2, JUDGE_WORKSPACE, TECHNICAL_ARCHITECTURE) |

## 3. Functional status

Working and covered by tests: authentication and lockout; event, round, track and guidebook setup with PDF;
registration and teams; submissions with versions, deadlines and extensions; rubrics, assignments and
evaluations; results with ties, approval, publication and automatic invalidation; staff tasks, issues and
check-in; feedback and certificates; audit log with an append-only trigger; CSV exports; the PR #3 workspace
(helpdesk, exceptions, applications, shortlists, messages, calibration, engagement, discovery, access labels,
impact PDF, project review, practice workspace) and judge portal (scratchpad, stars, briefing and glossary,
compare, export, reading card, health checks).

Not functional or not proven:

| Item | State |
|---|---|
| Google Sheets and Drive | Unverified against real Google (local stand-in only); CSV is the fallback |
| SMTP in production | Unverified (local sink only); deliverability and SPF/DKIM untested |
| Real hosting, HTTPS, DNS | Not done. No Dockerfile or CI configuration exists |
| Object storage | Interface only. Local disk is valid only on a persistent disk and one instance |
| OpenAI reading summary | Unverified (mock only); off by default |
| Private-repository review, participant withdrawal, appreciation certificates, staff phone visibility | Not built |
| Extension pausing judging (PRD 18.9) | Simplified (D-36) |
| Load, restore, accessibility with assistive technology | Rehearsed or checked only as described in `RELEASE_READINESS.md` |
| Retention and privacy policy | Undecided (PRD OQ-15) |

## 4. Documentation drift found

| Document | Said | Reality |
|---|---|---|
| `DECISIONS.md` D-03 | No AI in V1 | Optional OpenAI summary exists |
| `TECHNICAL_ARCHITECTURE.md` section 7, PRD 13.2 | No judge normalisation | Optional normalisation exists |
| `RELEASE_READINESS.md`, `DEPLOYMENT.md` section 7, D-45 | Public certificate verification and email reminders not built | Both exist |
| `RELEASE_READINESS.md` section 2 | API 363, web 32 tests; audit clean | 386 and 69; audit was 1 high (now fixed) |
| `README.md` | Status stops at Phase 7 | PR #3 scope not mentioned |
| `FEATURES_V2.md` | Changes remain local | Merged as PR #3 |
| `JUDGE_WORKSPACE.md` | Nothing pushed | Merged |
| `TECHNICAL_ARCHITECTURE.md` | React Hook Form; signed 10-minute URLs | Replaced by D-21 and D-31 |
| `DECISIONS.md` | Rule: add a row for every departure from the PRD | No rows for the PR #3 departures |

## 5. Where it could connect

Google Sheets and Drive (built, unverified); SMTP (built, unverified); GitHub API (built, public repositories
only; token support missing); OpenAI (built, off); object storage (interface only); Google sign-in (skipped,
D-11); CI and containers (none); error tracking and metrics (logs only); SMS, WhatsApp or calendar through the
existing message queue (none); QR check-in (PRD non-goal).

## 6. Not verified by this audit

PRD sections 6, 7, 8 and 15 line by line; each acceptance test AT-01 to AT-23 individually; the load test, a
backup restore, an independent spreadsheet check of scores, and the staging rehearsal script; anything that
needs real Google, SMTP, OpenAI or a host; assistive-technology accessibility.
