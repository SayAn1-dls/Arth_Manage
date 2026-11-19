# Deployment

How to run the platform for a real event. Nothing here has been run against a real cloud host yet: the
steps were checked on a developer machine (Node 26.9, PostgreSQL 16, macOS). Hosting is still an open
question (PRD OQ-01), so this guide stays provider-neutral.

## 1. What you need

| Need | Notes |
|---|---|
| Node.js 26 | `.nvmrc` pins 26; `engines` accepts >= 22.18. |
| PostgreSQL 16 | One database. The app creates no extensions. |
| Persistent disk | `STORAGE_DIR` holds uploaded files and certificate PDFs. Back it up with the database. |
| HTTPS | The API sets HSTS, secure cookies and `upgrade-insecure-requests` in production. Terminate TLS at a reverse proxy or the host. |
| An SMTP account | Verification, password reset and invitation emails. Without it nobody can sign up. |
| (Optional) a Google Cloud OAuth client | Only for the Sheets and Drive integration. |

## 2. Configuration

Copy `.env.example` to `.env` and fill it in. `TRUST_PROXY_HOPS` is the number of reverse proxies in front of the API (default 1; use 0 when the API is exposed directly, otherwise a client could fake its address and dodge rate limits). The server refuses to start in production unless
`EMAIL_PROVIDER=smtp` (with `SMTP_URL`) and `APP_BASE_URL` is `https://`. `SESSION_SECRET` must be at
least 32 characters. Never commit `.env`.

Optional features stay off unless configured: `JUDGE_AI_ENABLED=true` with `OPENAI_API_KEY` and `JUDGE_SUMMARY_MODEL`
sends project titles, summaries and public README excerpts to OpenAI (DECISIONS D-55; decide privacy first), and
the Google variables in section 5. Score normalisation is a per-round setting, off by default (D-54).

Generate secrets with `openssl rand -base64 48` (session) and `openssl rand -hex 32` (token key).
Losing `TOKEN_ENCRYPTION_KEY` only means the organiser must reconnect Google; it does not affect any
other data. Changing `SESSION_SECRET` signs out OAuth flows in progress and nothing else.

## 3. Build and start

```bash
npm ci
npm run build                # compiles shared + api (dist/) and the web app (apps/web/dist)
npm run db:deploy -w @arthakram/api   # applies migrations (idempotent)
NODE_ENV=production npm run start -w @arthakram/api
```

In production the API serves `apps/web/dist` itself and falls back to `index.html` for client routes, so
one process runs everything. Put it behind your reverse proxy (`trust proxy` is set to 1 hop). Run it under
a process manager (systemd, a container restart policy) so it restarts after a crash; queued sync jobs
survive restarts.

Health check: `GET /api/v1/health` returns `{"status":"ok","database":"up"}`.

The seed (`npm run db:seed`) creates **fake development accounts with a public password**. It refuses to
run when `NODE_ENV=production`. Never seed a real event database.

## 4. First organiser

Anyone can register and verify their email, then create an event and becomes its Core Admin (DECISIONS
D-06). There is no platform-wide admin and no allowlist. Event data is visible only to that event's members.

## 5. Google Sheets and Drive (optional)

1. In Google Cloud, create an OAuth client (Web). Enable the Google Sheets API and Google Drive API.
2. Add the redirect URI `{APP_BASE_URL}/api/v1/integrations/google/callback`.
3. The requested scope is `drive.file` (only files the app creates) plus basic profile email.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY`, restart.
5. As Core Admin open the event > Integrations > Connect Google.

**Not verified against real Google.** The queue, retries, idempotency and error mapping are tested with an
in-memory fake. The REST client (`apps/api/src/integrations/google.ts`) has never talked to Google. Do a
trial connect with a throwaway event before relying on it, and keep using CSV export as the fallback. Google
may also require OAuth app verification before non-test users can consent.

## 6. Upgrades

Take a backup (see the runbook), `git pull`, `npm ci`, `npm run build`, `npm run db:deploy -w
@arthakram/api`, restart. Migrations are forward-only; to roll back, restore the backup. Never generate a migration
with `prisma migrate dev` and commit it unread: Prisma proposes to drop the composite same-event keys it does not
model (DECISIONS D-58).

## 7. Known limits

* Storage is the local disk. There is no object-storage adapter yet, so "provider-level redundancy"
  (PRD 11.3) depends on the host's disk and your backups.
* One API process. The sync worker runs inside it; running two is safe (job claims are conditional) but
  untested under load.
* Rate limiting is in memory per process.
* No withdraw flow or appreciation certificates (P1/P2). Deadline reminders and the public certificate verification page exist (PR #3, D-56) but have only been exercised on a development machine.
* The email and reminder worker (`modules/workspace/worker.ts`) runs inside every API process, retries failed mail every 30 seconds up to three times with no backoff, and can duplicate a message after a crash because SMTP has no idempotency key. Run one instance.
* `GET /api/v1/public/certificates/:code` is unauthenticated and returns the holder's name. It is limited to 60 requests per minute per address (audit A9); the limit is in process memory, so with a reverse proxy set `TRUST_PROXY_HOPS` correctly.
* GitHub checks for project review and judge reading cards call the GitHub API without a token (60 requests per hour per server IP).

## 8. Staging rehearsal (what was actually run)

`scripts/staging/rehearse.sh` builds the production configuration on one machine: empty database, `migrate deploy`
(never the seed), `NODE_ENV=production`, a self-signed HTTPS terminator standing in for your proxy, a local SMTP
sink standing in for your mail provider, a real storage directory. It checks that production refuses unsafe
settings, health over HTTPS, no dev routes, Secure/HttpOnly cookies, that a session survives an API restart, and
runs the browser acceptance specs against it. Results and the defects it found are in `docs/RELEASE_READINESS.md`.
It does **not** prove a real host, certificate, DNS or mail provider; repeat the rehearsal there with a throwaway event.

## 9. Storage: when local disk is and is not acceptable

Acceptable: one API instance on a host whose disk persists across restarts and redeploys, with the backup in the
runbook. Not acceptable: platforms with ephemeral filesystems or more than one instance. In those cases an
object-storage adapter implementing `put`, `get` and `check` (`apps/api/src/storage/provider.ts`) must be written
and tested before the event. It has not been built.

## 10. Backups

`scripts/backup.sh` (database dump verified readable, uploads archive, checksums) and `scripts/restore-check.sh`
(restore into a scratch database, compare row counts and triggers, drop it). Schedule the first daily and run the
second after each backup rehearsal. Backups contain personal data: restrict access and delete on the same schedule as the data.
