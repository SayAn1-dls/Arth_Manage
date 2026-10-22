#!/usr/bin/env bash
# Staging rehearsal on one machine, using the documented production configuration:
#   production build, NODE_ENV=production, HTTPS (self-signed), SMTP (local sink), a fresh database, migrations
#   deployed (never the seed), a real storage directory. Then it runs the acceptance specs over HTTPS.
# It proves the deployment recipe works. It does not prove a real host, a real certificate or a real mail provider.
# Usage: scripts/staging/rehearse.sh [workdir]
set -euo pipefail
cd "$(dirname "$0")/../.."
work="${1:-$(mktemp -d)}"
db="arthakram_staging_$$"
pg="${STAGING_PG_URL:-postgresql://$(whoami)@localhost:5432}"
mkdir -p "$work/uploads"
cleanup() { kill ${pids:-} 2>/dev/null || true; psql "$pg/postgres" -qc "DROP DATABASE IF EXISTS \"$db\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -keyout "$work/key.pem" -out "$work/cert.pem" -days 2 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost" >/dev/null 2>&1
psql "$pg/postgres" -qc "CREATE DATABASE \"$db\""
export NODE_ENV=production
export DATABASE_URL="$pg/$db"
export SESSION_SECRET="$(openssl rand -base64 48)"
export APP_BASE_URL="https://localhost:8443"
export API_PORT=4020
export STORAGE_DIR="$work/uploads"
export EMAIL_PROVIDER=smtp
export SMTP_URL="smtp://127.0.0.1:2525"
export EMAIL_FROM="Arthakram <no-reply@localhost>"
export TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export TRUST_PROXY_HOPS=1
# The browser specs register dozens of accounts from one address, which the production limit (10 per hour) would
# refuse. Limits are covered by the API tests; the rehearsal turns them off only for this run.
export RATE_LIMIT_DISABLED=true

echo "== environment validation: production must refuse unsafe settings"
if EMAIL_PROVIDER=console node apps/api/dist/server.js >"$work/refuse.log" 2>&1; then echo "FAIL: started with console email"; exit 1; fi
grep -q "EMAIL_PROVIDER" "$work/refuse.log" && echo "ok: refused console email in production"
if APP_BASE_URL=http://example.org node apps/api/dist/server.js >"$work/refuse2.log" 2>&1; then echo "FAIL: started with http base url"; exit 1; fi
grep -q "https" "$work/refuse2.log" && echo "ok: refused http base URL in production"

echo "== migrations on an empty database"
(cd apps/api && npx prisma migrate deploy 2>&1 | tail -2)

: > "$work/mail.jsonl"
node scripts/staging/smtp-sink.mjs 2525 "$work/mail.jsonl" & pids="$!"
node apps/api/dist/server.js >"$work/api.log" 2>&1 & api_pid=$!; pids="$pids $api_pid"
node scripts/staging/https-proxy.mjs 8443 4020 "$work/key.pem" "$work/cert.pem" & pids="$pids $!"
for i in $(seq 1 40); do curl -fks https://localhost:8443/api/v1/health >/dev/null && break; sleep 0.5; done
echo "== health over HTTPS"; curl -ks https://localhost:8443/api/v1/health; echo
echo "== headers"; curl -ksI https://localhost:8443/ | grep -iE "strict-transport|content-security|x-content-type|cache-control" || true
echo "== dev-only routes must not exist in production"
code="$(curl -ks -o /dev/null -w '%{http_code}' https://localhost:8443/api/v1/dev/outbox?to=a@b.c)"; echo "GET /api/v1/dev/outbox -> $code"; [ "$code" = "404" ]

echo "== acceptance workflow over HTTPS against the staging stack"
E2E_BASE_URL=https://localhost:8443 E2E_MAIL_FILE="$work/mail.jsonl" PW_CHANNEL="${PW_CHANNEL:-}" \
  npx playwright test e2e/engage.spec.ts e2e/acceptance.spec.ts e2e/results.spec.ts e2e/staff.spec.ts e2e/judging.spec.ts e2e/participant.spec.ts --workers=2
echo "== session persistence across an API restart, cookie flags"
H='X-Requested-With: arthakram'; A=https://localhost:8443/api/v1; me="restart-$$@example.test"
curl -ks -H "$H" -H 'Content-Type: application/json' -d "{\"name\":\"Restart Check\",\"email\":\"$me\",\"password\":\"A-long-passphrase-1\"}" $A/auth/register >/dev/null
for i in $(seq 1 20); do tok="$(grep -F "\"to\":\"$me\"" "$work/mail.jsonl" | tail -1 | grep -o 'token=[A-Za-z0-9_-]*' | head -1 | cut -d= -f2)"; [ -n "$tok" ] && break; sleep 0.3; done
curl -ks -H "$H" -H 'Content-Type: application/json' -d "{\"token\":\"$tok\"}" $A/auth/verify-email >/dev/null
curl -ks -D "$work/login.headers" -c "$work/jar.txt" -H "$H" -H 'Content-Type: application/json' -d "{\"email\":\"$me\",\"password\":\"A-long-passphrase-1\"}" $A/auth/login >/dev/null
grep -i '^set-cookie' "$work/login.headers" | grep -qi 'secure' && grep -i '^set-cookie' "$work/login.headers" | grep -qi 'httponly' && echo "ok: session cookie is Secure and HttpOnly"
kill "$api_pid"; sleep 1
node apps/api/dist/server.js >>"$work/api.log" 2>&1 & pids="$pids $!"
for i in $(seq 1 40); do curl -fks $A/health >/dev/null && break; sleep 0.5; done
code="$(curl -ks -o /dev/null -w '%{http_code}' -b "$work/jar.txt" $A/me)"; echo "GET /me after restart -> $code"; [ "$code" = "200" ]
echo "== errors logged during the run (should be none besides expected 4xx)"
grep -c '"level":50' "$work/api.log" || true
echo "== mail captured: $(wc -l < "$work/mail.jsonl") messages"
echo "REHEARSAL COMPLETE (logs in $work)"
