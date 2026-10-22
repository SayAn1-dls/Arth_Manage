#!/usr/bin/env bash
# Rehearses a restore into a throwaway database and compares it with the source.
# Usage: DATABASE_URL=<source db> scripts/restore-check.sh <dump> [uploads.tgz]
# It never touches the source database and drops the scratch database afterwards.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
dump="${1:?usage: restore-check.sh <dump> [uploads.tgz]}"
files="${2:-}"
scratch="arthakram_restore_check_$$"
admin_url="${DATABASE_URL%/*}/postgres"
scratch_url="${DATABASE_URL%/*}/$scratch"
cleanup() { psql "$admin_url" -qc "DROP DATABASE IF EXISTS \"$scratch\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql "$admin_url" -qc "CREATE DATABASE \"$scratch\""
pg_restore --no-owner --dbname="$scratch_url" "$dump"

count() { psql "$1" -Atc "SELECT coalesce(sum((xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint),0) FROM pg_tables WHERE schemaname='public'"; }
src="$(count "$DATABASE_URL")"
dst="$(count "$scratch_url")"
triggers="$(psql "$scratch_url" -Atc "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")"
audit="$(psql "$scratch_url" -Atc 'SELECT count(*) FROM "AuditLog"')"
echo "rows in source:   $src"
echo "rows in restored: $dst"
echo "triggers restored: $triggers (audit, immutability)"
echo "audit entries restored: $audit"
if [ -n "$files" ]; then
  n="$(tar -tzf "$files" | grep -vc '/$' || true)"
  echo "files in archive: $n"
fi
if [ "$src" != "$dst" ]; then echo "FAIL: row counts differ (source may have changed since the dump)"; exit 1; fi
if [ "$triggers" -lt 1 ]; then echo "FAIL: triggers missing after restore"; exit 1; fi
echo "PASS"
