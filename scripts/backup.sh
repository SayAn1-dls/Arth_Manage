#!/usr/bin/env bash
# Backs up the database and uploaded files, then proves the dump is readable.
# Usage: DATABASE_URL=... STORAGE_DIR=... scripts/backup.sh [output-dir]
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
: "${STORAGE_DIR:?set STORAGE_DIR}"
out="${1:-./backups}"
stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
dump="$out/arthakram-$stamp.dump"
files="$out/uploads-$stamp.tgz"

pg_dump --format=custom --no-owner --file="$dump" "$DATABASE_URL"
pg_restore --list "$dump" >/dev/null           # the archive must be readable
if [ -d "$STORAGE_DIR" ]; then
  tar -czf "$files" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
else
  echo "warning: $STORAGE_DIR does not exist; no files archived" >&2
fi
( cd "$out" && shasum -a 256 "$(basename "$dump")" $( [ -f "$files" ] && basename "$files" ) > "checksums-$stamp.txt" )
echo "database: $dump"
[ -f "$files" ] && echo "files:    $files"
echo "checksums: $out/checksums-$stamp.txt"
