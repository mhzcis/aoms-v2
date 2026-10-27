#!/usr/bin/env bash
# Creates a fresh database, applies the Supabase stub + migrations, runs the DB tests.
# Usage: supabase/tests/run-all.sh <dbname> [migration-count]   (needs psql + a local PG; PGHOST/PGPORT/PGUSER honoured)
set -uo pipefail
DB=${1:-aoms_test}; N=${2:-99}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
export PGHOST=${PGHOST:-127.0.0.1} PGPORT=${PGPORT:-54329} PGUSER=${PGUSER:-postgres}
build_db() {
psql -X -q -c "drop database if exists $DB" -c "create database $DB" || exit 2
FILES=("$ROOT/supabase/tests/00_supabase_stub.sql" $(ls "$ROOT"/supabase/migrations/*.sql | sort | head -n "$N"))
for f in "${FILES[@]}"; do
  echo "=== apply $(basename "$f")"
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 | grep -v -e 'wal_level' -e 'HINT' -e 'does not exist, skipping' -e 'already been granted'
  rc=${PIPESTATUS[0]}; echo "EXIT=$rc"; [ "$rc" = 0 ] || exit 3
done
}
# each suite runs on its own freshly built database
RC=0
for T in run-db-tests.mjs run-db-acceptance.mjs; do
  build_db
  echo "=== suite $T"
  PGURL="postgres://$PGUSER@$PGHOST:$PGPORT/$DB" timeout 300 node "$ROOT/supabase/tests/$T" || RC=1
done
exit $RC
