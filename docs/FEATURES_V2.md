# Expanded event workspace

The implementation keeps React/Vite, Express, Prisma and PostgreSQL. QR code generation is the only new runtime library. No Redis, separate queue server, or paid analytics service is required.

## Available locally

- Helpdesk: event-scoped conversations, participant privacy, staff assignment, replies and status updates.
- Exception desk: approve/deny deadline extensions and submission unlocks; atomic registered-participant replacements preserve the departing participant's team role. Decisions and changes are audited.
- Application review: bulk accept/reject/waitlist, team-visible decisions and queued notifications. Once the first screening decision is made, the event requires accepted applications for submission. Existing events remain open to submission until screening starts.
- Round shortlists: choose submitted teams for later rounds; enforce eligibility on submission writes; notify all teams. Shortlisting must precede destination-round submitted projects or judging.
- Judge matching: existing auto-balancer now respects declared college affiliations, track preferences and shortlist eligibility. If constraints leave too few eligible judges, the existing judging overview shows missing coverage. Manual assignment remains an admin override.
- Calibration: score distribution, judge averages, outlier indicators after three evaluations, and possible duration-drop indicators after six. Elapsed draft-to-submit time includes breaks, so it is not a measurement of focused judging effort.
- Optional normalisation: mean-centre each judge to the panel mean, clamp to 0–100, and average adjusted scores. Judges with fewer than three scores stay unadjusted. Off by default. Raw and adjusted team scores appear together. Approved results must be invalidated before changing the method. **Known weakness:** assignment is not random and the panel mean mixes tracks, so a judge who drew strong teams is marked up; do not rely on it for prizes without reading DECISIONS D-54.
- Targeted communication: all participants, selected tracks, or round shortlist cohorts. Persistent email outbox, bounded retries, delivery history, and automatic one-hour submission reminders. Participants can read queued event messages in the platform even if email delivery fails.
- Engagement: event activity, guidebook opens and draft timestamps. Explicit Unknown state prevents equating missing telemetry with inactivity. Active <=24 hours, Slipping <=72 hours, Inactive >72 hours. Estimates support human outreach and are not confirmed attendance counts.
- Teammate discovery: opt-in profiles, skills, interests and participant-chosen contact details, restricted to event members. Team joining continues to use the existing team invitation-code flow.
- Access: event owner controls access labels and judge-matching metadata. Co-admin uses Admin permissions; Staff Lead currently uses Staff permissions; Sponsor Viewer is restricted server-side to the aggregate impact report. Existing judge and participant permissions remain enforced.
- Impact PDF: brand fonts, aggregate totals, college and track bars, explicitly collected SELECT gender/diversity breakdowns, and latest-round track evaluation averages. Demographics are never inferred.
- Certificates: unique IDs, QR verification links on newly rendered PDFs, and a public page distinguishing released and revoked certificates. Previously generated PDFs need regeneration to gain QR codes.
- Project review: public GitHub repository history checks; admin-selected reference source-file comparison with matching substantial lines side by side; private integrity notes; judge-facing market context; optional participant release of market context. Requires human decisions; does not disqualify automatically.
- Practice workspace: copy the selected participant/judge, actual round fields, upload limits, assigned team names, and rubric into a local-memory simulation. It does not impersonate their live session or reproduce every existing screen. Practice files are never uploaded and evaluations are never persisted.
- Existing guidebook, check-in, feedback moderation, audit/export, Google integration and results workflows remain available.

## External setup and remaining scope

1. **Email:** configure `EMAIL_PROVIDER=smtp`, `SMTP_URL`, and `EMAIL_FROM` in the ignored `.env`. The local default is console delivery, stored in `OutboxEmail`; it does not email participants. SMTP retries can duplicate delivery after a process crash because SMTP has no universal idempotency key.
2. **Google Sheets/Drive:** supply OAuth client ID and secret, register the existing callback URL, and configure a random `TOKEN_ENCRYPTION_KEY`. Connect through the Integrations screen. Real Google access has not been exercised here.
3. **AI and broad prior-art discovery:** not implemented pending the user's provider choice, API access and budget. Current market context is entered by admins. Current code comparison requires an admin-selected public reference repository and a shared file path; it is not a global plagiarism scanner, semantic authorship detector, or automated startup/product search.
4. **Private repositories:** public GitHub history/file checks work without a token subject to GitHub rate limits. Private-repository review needs a scoped credential integration; no private token is currently accepted or stored by this feature.
5. **GitHub publishing:** merged to `main` as PR #3 (2026-10-28). No deployment has been performed.
6. **Rate limits:** GitHub checks are unauthenticated (60 requests per hour per server IP) and the public certificate page has no request limit (`PRODUCT_AUDIT_2026-10-28.md` A9, A11).

## Run and inspect

Start Postgres.app, then run `npm run dev` from the repository root. Open `http://localhost:5173/events`. The seeded admin is `admin@arthakram.test` with password `Password!2345` (local development only).

The new navigation is grouped into event operations, judging, setup and reporting. Database changes are additive migrations `20261025120000_workspace_features` and `20261025123000_application_screening_swaps`. Both have been applied to this machine's development and test databases.

## Validation

- Production build, TypeScript checks, ESLint, brand lint and whitespace checks.
- Fourteen new workspace tests cover privacy, cross-event isolation, one-time exception decisions, extensions, team replacement, application gating, shortlisting, opt-in discovery, sponsor restrictions, institution conflicts, engagement states, public certificate status, review-note privacy and substantial-line comparison.
- Integration, security and Google stand-in tests rerun after fixing the test-only fallback for a blank token-encryption key.
- Browser inspection of event navigation and judge calibration.

The test database remains separate from the development database. API test fixtures use simulated Google providers and a console email provider.

Validation outcome at the time: 23 shared tests and 32 web tests passed. The API run passed 371 of 377 tests; long host pauses caused two timeouts and dependent journey failures, resolved on an isolated rerun. **Re-run on 28 Oct 2026 after the merge:** 386 of 386 API tests, 69 of 69 web tests and 16 of 16 Playwright specs pass (see `RELEASE_READINESS.md` section 11). Separately, all 59 workspace/security/Google integration tests passed. Build, typecheck, ESLint, brand lint, Prettier and `git diff --check` passed. No real SMTP or Google provider call was used to establish these results.
