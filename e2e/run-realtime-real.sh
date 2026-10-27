#!/usr/bin/env bash
# SYNC-007 against a REAL supabase/realtime server (two browser devices, real WAL -> Realtime -> websocket).
# Run after e2e/run-e2e.sh (DB seeded, PostgREST + vite preview up). Needs, outside this repo:
#   * PostgreSQL with wal_level=logical, wal2json installed and allowed as output plugin;
#   * supabase/realtime running on REALTIME_WS (default ws://127.0.0.1:4000) with tenant "aomslocal"
#     whose jwt_secret is the PostgREST secret and whose postgres_cdc_rls settings point at aoms_e2e.
# Hosted Supabase provides all of this itself; this script only reproduces it locally.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
export PGHOST=${PGHOST:-127.0.0.1} PGPORT=${PGPORT:-54329} PGUSER=${PGUSER:-postgres}
psql -X -q -d aoms_e2e -c "create schema if not exists realtime" \
  -c "grant usage on schema realtime to postgres, anon, authenticated, service_role" >/dev/null
REALTIME_WS=${REALTIME_WS:-ws://127.0.0.1:4000} ONLY=realtimeReal RESULTS=e2e-realtime-results.json node e2e/run-e2e.mjs
