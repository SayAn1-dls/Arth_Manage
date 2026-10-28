# Arthakram hackathon and case competition platform

A web platform for the Arthakram Product & Consulting Club (Rishihood University) to run hackathons and case
competitions from event setup to certificates: registration and teams, submissions, judging, results,
feedback and certificates, with four role-specific interfaces (Core Admin, Participant, Judge, Helping Staff).
The platform database is the source of truth; Google Sheets/Drive are optional, late integrations.

- Product requirements: `docs/PRD-Hackathon-and-Case-Competition-Platform.pdf`
- How it is built: `docs/TECHNICAL_ARCHITECTURE.md`
- Plan, commit trail and live checklist: `docs/IMPLEMENTATION_PLAN.md`
- Decisions and deviations: `docs/DECISIONS.md`
- Visual identity rules: `docs/BRAND_IMPLEMENTATION.md`
- Running it for real: `docs/DEPLOYMENT.md`; event-day operations and backups: `docs/RUNBOOK.md`
- Verification status and risks: `docs/RELEASE_READINESS.md`; latest product audit: `docs/PRODUCT_AUDIT_2026-10-28.md`
- Every change since the audit: `docs/CHANGELOG.md`
- Expanded workspace and judge portal: `docs/FEATURES_V2.md`, `docs/JUDGE_WORKSPACE.md`

**Status:** V1 implemented through Phase 7 (foundation, authentication, permissions, events, guidebook, registration, teams, submissions, judging, results, staff operations, dashboard and audit history, feedback and certificates, Google Sheets/Drive integration with a persistent sync queue, security pass, deployment and runbook docs). The Google REST client has not been exercised against real Google. See the checklist and `docs/DEPLOYMENT.md`.

Since Phase 7 the branch also contains the expanded event workspace and judge portal (PR #3: helpdesk, exception desk, application screening, round shortlists, targeted messages, calibration and optional score normalisation, project review, optional AI reading summary, public certificate verification) and a collapsible role-aware sidebar. Several of these go beyond the PRD's V1 scope; see `docs/DECISIONS.md` D-54 to D-58 and the open findings in `docs/PRODUCT_AUDIT_2026-10-28.md`.

## Prerequisites

- Node.js 26 (see `.nvmrc`; 22.18+ also satisfies `engines`) and npm 11
- PostgreSQL 16 running locally
- For browser tests: `npx playwright install chromium`, or set `PW_CHANNEL=chrome` to use installed Chrome

## Setup

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL / TEST_DATABASE_URL / SESSION_SECRET
createdb arthakram && createdb arthakram_test
npm run db:migrate              # creates and migrates the development database
npm run db:seed                 # demo data (arrives with Phase 1; refuses to run in production)
```

Apply migrations to the test database once: `DATABASE_URL=<test url> npm run db:deploy -w @arthakram/api`.
Generate the Prisma client with `npm run db:generate -w @arthakram/api` (run automatically by `db:migrate`).

## Development accounts

`npm run db:seed` creates clearly fake accounts (all verified, password `Password!2345`) and the demo event
`hacksonipat-2026` (open for registration) and `case-cup-2026` (submissions closed, judging open, with teams, assignments and one submitted evaluation): `admin@`, `judge1@`, `judge2@`, `staff@`, `asha@`, `ravi@` + `arthakram.test`.
They exist for local development only; the seed refuses to run when `NODE_ENV=production`.
Emails are never sent in development: links appear in the API log and the `OutboxEmail` table
(`GET /api/v1/dev/outbox?to=<email>`, mounted only outside production).

## Environment variables

See `.env.example`. Placeholders only; real values live in your untracked `.env`.
`SESSION_SECRET` must be at least 32 characters. Google variables are optional; the app works without them.

## Commands

| Command                                 | What it does                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`                           | API on :4000 and web on :5173 (web proxies `/api`)                                 |
| `npm run build`                         | Type-check and build shared, API and web                                           |
| `npm run typecheck`                     | `tsc --noEmit` in every workspace                                                  |
| `npm run lint` / `npm run format:check` | ESLint / Prettier                                                                  |
| `npm run lint:brand`                    | Brand guardrails (no raw colours outside tokens, no forbidden fonts, etc.)         |
| `npm test`                              | Unit and API integration tests (Vitest)                                            |
| `npm run test:load -w @arthakram/api`   | PRD load profile (1,000 participants, 250 teams) timings against the test database |
| `npm run start -w @arthakram/api`       | Run the built API (serves `apps/web/dist` in production)                           |
| `npm run test:e2e`                      | Playwright end-to-end tests (starts/reuses `npm run dev`); see the note below      |
| `npm run qa:visual`                     | Screenshots at 1440 and 390 px into `.qa-screenshots/` for brand review            |

Open `http://localhost:5173/_design` (development only) for the component gallery.

**Running the e2e specs.** The specs sign up dozens of accounts from one address and read verification links from
the dev outbox. Start the API with `EMAIL_PROVIDER=console RATE_LIMIT_DISABLED=true` (process variables beat
`.env`), for example `EMAIL_PROVIDER=console RATE_LIMIT_DISABLED=true npm run dev:api`, then `npm run test:e2e`.
With `EMAIL_PROVIDER=smtp` in `.env` every signup spec fails with "No email for ...", and the 10 per hour
registration limit blocks the rest. The specs also need the API's database migrated (`npm run db:deploy -w @arthakram/api`).

## Layout

`apps/api` Express + Prisma · `apps/web` React + Vite + Tailwind · `packages/shared` Zod schemas and the
scoring engine · `e2e` Playwright specs · `scripts` repo tooling · `docs` specification and decisions.

## Brand kit

The Arthakram Brand Kit PDF is a **local-only** reference and is git-ignored. Never commit it. Only the
extracted logo SVGs in `apps/web/src/assets/logo/` are tracked.

## Integrations

Google Sheets and Drive are optional and implemented last (Phase 7). Without credentials the app stays fully
functional and shows integrations as "Not connected". Setup instructions will be added with that phase.

## Troubleshooting

- `Invalid environment configuration` on API start: check `.env` against `.env.example`.
- Prisma "Connection url is empty": `DATABASE_URL` is missing from `.env`.
- e2e fails with "No email for ...": the API is using SMTP or the rate limiter; see "Running the e2e specs".
- Playwright "Executable doesn't exist": run `npx playwright install chromium` or use `PW_CHANNEL=chrome`.
- Port in use: change `API_PORT` or stop the other process on 4000/5173.
