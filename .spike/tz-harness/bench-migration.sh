#!/usr/bin/env bash
# OSS-1007: how long does timestamp -> timestamptz take on a large table, and does it rewrite it?
# Usage: bench-migration.sh <rows>   (needs the oss1007-pg container)
set -euo pipefail
ROWS=${1:-5000000}
PSQL=(docker exec -i oss1007-pg psql -U vendure -v ON_ERROR_STOP=1 -At)
"${PSQL[@]}" -d tz -c "DROP DATABASE IF EXISTS bench" >/dev/null
"${PSQL[@]}" -d tz -c "CREATE DATABASE bench" >/dev/null
P=("${PSQL[@]}" -d bench)

echo "rows: $ROWS  postgres: $("${P[@]}" -c 'SHOW server_version')"
"${P[@]}" <<SQL >/dev/null
CREATE TABLE template (
  id serial PRIMARY KEY,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "orderPlacedAt" timestamp,
  code varchar(32) NOT NULL,
  total int NOT NULL
);
INSERT INTO template ("createdAt", "updatedAt", "orderPlacedAt", code, total)
SELECT t, t + interval '5 minutes', CASE WHEN i % 3 = 0 THEN NULL ELSE t + interval '4 minutes' END, md5(i::text), i % 10000
FROM (SELECT i, timestamp '2020-01-01' + (i * interval '37 seconds') AS t FROM generate_series(1, $ROWS) i) s;
SQL
echo "table size: $("${P[@]}" -c "SELECT pg_size_pretty(pg_total_relation_size('template'))")"

bench() {
  local name="$1"; shift
  local sql="$1"
  "${P[@]}" >/dev/null <<SQL
DROP TABLE IF EXISTS t;
CREATE TABLE t (LIKE template INCLUDING ALL);
INSERT INTO t SELECT * FROM template;
CREATE INDEX t_created ON t ("createdAt");
CREATE INDEX t_placed ON t ("orderPlacedAt");
VACUUM ANALYZE t;
SQL
  local before after idx_before idx_after start end
  before=$("${P[@]}" -c "SELECT relfilenode FROM pg_class WHERE relname = 't'")
  idx_before=$("${P[@]}" -c "SELECT relfilenode FROM pg_class WHERE relname = 't_created'")
  start=$(date +%s%N)
  "${P[@]}" >/dev/null <<SQL
BEGIN;
$sql
COMMIT;
SQL
  end=$(date +%s%N)
  after=$("${P[@]}" -c "SELECT relfilenode FROM pg_class WHERE relname = 't'")
  idx_after=$("${P[@]}" -c "SELECT relfilenode FROM pg_class WHERE relname = 't_created'")
  local check
  check=$("${P[@]}" -c "SELECT \"createdAt\" FROM t WHERE id = 1")
  printf '%-58s %8d ms  table rewritten: %-3s  index rebuilt: %-3s  row1.createdAt=%s\n' "$name" $(((end - start) / 1000000)) \
    "$([ "$before" != "$after" ] && echo yes || echo no)" "$([ "$idx_before" != "$idx_after" ] && echo yes || echo no)" "$check"
}

Z="'Europe/Vienna'"
CASE_EXPR() { echo "CASE WHEN (((\"$1\" AT TIME ZONE $Z) - interval '1 hour') AT TIME ZONE $Z) = \"$1\" THEN (\"$1\" AT TIME ZONE $Z) - interval '1 hour' ELSE (\"$1\" AT TIME ZONE $Z) END"; }

bench "A. session UTC, no USING (data was UTC)" \
  "SET LOCAL timezone = 'UTC'; ALTER TABLE t ALTER COLUMN \"createdAt\" TYPE timestamptz, ALTER COLUMN \"updatedAt\" TYPE timestamptz, ALTER COLUMN \"orderPlacedAt\" TYPE timestamptz;"
bench "B. session Vienna, no USING (implicit cast, data was Vienna)" \
  "SET LOCAL timezone = 'Europe/Vienna'; ALTER TABLE t ALTER COLUMN \"createdAt\" TYPE timestamptz, ALTER COLUMN \"updatedAt\" TYPE timestamptz, ALTER COLUMN \"orderPlacedAt\" TYPE timestamptz;"
bench "C. USING col AT TIME ZONE 'Europe/Vienna'" \
  "SET LOCAL timezone = 'UTC'; ALTER TABLE t ALTER COLUMN \"createdAt\" TYPE timestamptz USING \"createdAt\" AT TIME ZONE $Z, ALTER COLUMN \"updatedAt\" TYPE timestamptz USING \"updatedAt\" AT TIME ZONE $Z, ALTER COLUMN \"orderPlacedAt\" TYPE timestamptz USING \"orderPlacedAt\" AT TIME ZONE $Z;"
bench "D. USING helper CASE (earlier instant for the repeated hour)" \
  "SET LOCAL timezone = 'UTC'; ALTER TABLE t ALTER COLUMN \"createdAt\" TYPE timestamptz USING $(CASE_EXPR createdAt), ALTER COLUMN \"updatedAt\" TYPE timestamptz USING $(CASE_EXPR updatedAt), ALTER COLUMN \"orderPlacedAt\" TYPE timestamptz USING $(CASE_EXPR orderPlacedAt);"
bench "E. what TypeORM generates (DROP + ADD: data loss)" \
  "ALTER TABLE t DROP COLUMN \"orderPlacedAt\"; ALTER TABLE t ADD \"orderPlacedAt\" timestamptz;"
bench "F. revert A (timestamptz -> timestamp, session UTC)" \
  "SET LOCAL timezone = 'UTC'; ALTER TABLE t ALTER COLUMN \"createdAt\" TYPE timestamptz, ALTER COLUMN \"updatedAt\" TYPE timestamptz, ALTER COLUMN \"orderPlacedAt\" TYPE timestamptz; ALTER TABLE t ALTER COLUMN \"createdAt\" TYPE timestamp, ALTER COLUMN \"updatedAt\" TYPE timestamp, ALTER COLUMN \"orderPlacedAt\" TYPE timestamp;"
"${PSQL[@]}" -d tz -c "DROP DATABASE bench" >/dev/null
