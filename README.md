# Arthakram hackathon and case competition platform

A web platform for the Arthakram Product & Consulting Club (Rishihood University) to run hackathons and case
competitions from event setup to certificates: registration and teams, submissions, judging, results,
feedback and certificates, with four role-specific interfaces (Core Admin, Participant, Judge, Helping Staff).
The platform database is the source of truth; Google Sheets/Drive are optional, late integrations.

* Product requirements: `docs/PRD-Hackathon-and-Case-Competition-Platform.pdf`
* How it is built: `docs/TECHNICAL_ARCHITECTURE.md`
* Plan, commit trail and live checklist: `docs/IMPLEMENTATION_PLAN.md`
* Decisions and deviations: `docs/DECISIONS.md`
* Visual identity rules: `docs/BRAND_IMPLEMENTATION.md`

**Status:** Phases 0–1 complete (foundation, authentication, permissions). See the checklist for what exists.

## Prerequisites

* Node.js 26 (see `.nvmrc`; 22.18+ also satisfies `engines`) and npm 11
* PostgreSQL 16 running locally
* For browser tests: `npx playwright install chromium`, or set `PW_CHANNEL=chrome` to use installed Chrome

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
`hacksonipat-2026`: `admin@`, `judge1@`, `judge2@`, `staff@`, `asha@`, `ravi@` + `arthakram.test`.
They exist for local development only; the seed refuses to run when `NODE_ENV=production`.
Emails are never sent in development: links appear in the API log and the `OutboxEmail` table
(`GET /api/v1/dev/outbox?to=<email>`, mounted only outside production).

## Environment variables

See `.env.example`. Placeholders only; real values live in your untracked `.env`.
`SESSION_SECRET` must be at least 32 characters. Google variables are optional; the app works without them.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API on :4000 and web on :5173 (web proxies `/api`) |
| `npm run build` | Type-check and build shared, API and web |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run lint` / `npm run format:check` | ESLint / Prettier |
| `npm run lint:brand` | Brand guardrails (no raw colours outside tokens, no forbidden fonts, etc.) |
| `npm test` | Unit and API integration tests (Vitest) |
| `npm run test:e2e` | Playwright end-to-end tests (starts/reuses `npm run dev`) |
| `npm run qa:visual` | Screenshots at 1440 and 390 px into `.qa-screenshots/` for brand review |

Open `http://localhost:5173/_design` (development only) for the component gallery.

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

* `Invalid environment configuration` on API start: check `.env` against `.env.example`.
* Prisma "Connection url is empty": `DATABASE_URL` is missing from `.env`.
* Playwright "Executable doesn't exist": run `npx playwright install chromium` or use `PW_CHANNEL=chrome`.
* Port in use: change `API_PORT` or stop the other process on 4000/5173.
