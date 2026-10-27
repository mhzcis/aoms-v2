#!/usr/bin/env bash
# Fresh aoms_e2e DB + seed, then Playwright run. Needs: local PG (54329), PostgREST on 54330 (e2e/postgrest.conf),
# `vite preview` on 4173 of a build made with VITE_SUPABASE_URL=https://aomslocal.supabase.co.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
export PGHOST=${PGHOST:-127.0.0.1} PGPORT=${PGPORT:-54329} PGUSER=${PGUSER:-postgres}
psql -X -q -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='aoms_e2e' and pid<>pg_backend_pid()" >/dev/null
psql -X -q -c "drop database if exists aoms_e2e" -c "create database aoms_e2e"
for f in supabase/tests/00_supabase_stub.sql supabase/migrations/*.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -d aoms_e2e -f "$f" 2>&1 | grep -v -e wal_level -e HINT -e 'skipping' -e 'already been granted' || true
done
PGURL=postgres://$PGUSER@$PGHOST:$PGPORT/aoms_e2e node e2e/seed.mjs
pkill -USR1 -f "postgrest e2e/postgrest.conf" || true   # reload schema cache
sleep 1
node e2e/run-e2e.mjs
