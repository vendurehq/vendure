#!/bin/bash
# 发布前时区护栏（防回归 B）
#
# 三类检查，任一「新增」命中即 exit 非 0，用于在 pm2 restart 前拦截：
#   1) 数据库 public schema 里是否又出现 timestamp without time zone 列（应为 0）
#   2) 实体定义里是否出现 'timestamp' 写法（应为 timestamptz）
#   3) 迁移文件里是否用 timestamp 建列（排除注释与 timestamptz / timestamp with time zone）
#
# 存量历史写法（迁移已应用、synchronize=false 不会落库）冻结在 scripts/tz-guard-baseline.txt，
# 默认只对「不在基线里」的新增命中判失败，避免老账每次都红。
#
# 用法：
#   scripts/tz-guard.sh              # 发布前预检：新增命中即失败
#   scripts/tz-guard.sh --all        # 连基线一起判失败（全量清账时用）
#   scripts/tz-guard.sh --bootstrap  # 重新生成基线文件（仅维护用）
#
# 环境变量：TZ_GUARD_CONTAINER / TZ_GUARD_DB / TZ_GUARD_USER，或 PGHOST+PGUSER+PGPORT 直连。

set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

CONT=${TZ_GUARD_CONTAINER:-1Panel-postgresql-pIe0}
DB=${TZ_GUARD_DB:-vendure}
DBU=${TZ_GUARD_USER:-vendure}
BASELINE=scripts/tz-guard-baseline.txt
MODE=${1:-}
fail=0

note() { printf '%s\n' "$*"; }

scan_entities() {
    grep -rn "'timestamp'" packages/*/src --include='*.entity.ts' 2>/dev/null \
        | grep -viE 'timestamptz|timestamp with time zone' \
        | grep -vE ':[0-9]+:[[:space:]]*(//|\*|/\*)'
}

scan_migrations() {
    find packages -path '*/src/migrations/*' -name '*.ts' -not -path '*/lib/*' -print0 2>/dev/null \
        | xargs -0 grep -nE "'timestamp'|\btimestamp\b" 2>/dev/null \
        | grep -viE 'timestamptz|timestamp with time zone|timestampTz' \
        | grep -vE ':[0-9]+:[[:space:]]*(//|\*|/\*)'
}

key_of() {
    printf '%s\n' "$1" | sed -E 's/^([^:]+):[0-9]+:/\1|/; s/[[:space:]]+/ /g'
}

if [ "$MODE" = "--bootstrap" ]; then
    { scan_entities; scan_migrations; } | while IFS= read -r l; do key_of "$l"; done | sort -u > "$BASELINE"
    note "已写入 $BASELINE（$(wc -l < "$BASELINE" | tr -d ' ') 条基线）"
    exit 0
fi

# ---------- 1/3 数据库 ----------
note "=== [1/3] 数据库 timestamp without time zone 列 ==="
SQL="select table_name||'.'||column_name from information_schema.columns where table_schema='public' and data_type='timestamp without time zone' order by table_name, ordinal_position"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONT"; then
    DBHITS=$(docker exec "$CONT" psql -U "$DBU" -d "$DB" -Atc "$SQL" 2>/dev/null) || DBHITS='__ERR__'
else
    DBHITS=$(psql -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" -U "${PGUSER:-$DBU}" -d "$DB" -Atc "$SQL" 2>/dev/null) || DBHITS='__ERR__'
fi
if [ "$DBHITS" = '__ERR__' ]; then
    note "  ! 无法连接数据库（默认视为失败）"
    fail=1
elif [ -n "$DBHITS" ]; then
    N=$(printf '%s\n' "$DBHITS" | wc -l | tr -d ' ')
    note "  x 发现 $N 个无时区列："
    printf '%s\n' "$DBHITS" | head -20 | while IFS= read -r l; do note "    - $l"; done
    [ "$N" -gt 20 ] && note "    ...（仅列前 20）"
    fail=1
else
    note "  ok 0 列"
fi

# ---------- 2/3 实体 ----------
note ""
note "=== [2/3] 实体定义中的 'timestamp' ==="
ENT=$(scan_entities)
if [ -z "$ENT" ]; then
    note "  ok 无命中"
else
    while IFS= read -r line; do
        k=$(key_of "$line")
        if [ "$MODE" != "--all" ] && [ -f "$BASELINE" ] && grep -Fxq -- "$k" "$BASELINE"; then
            note "    [基线] $line"
        else
            note "    x $line"
            fail=1
        fi
    done < <(printf '%s\n' "$ENT")
fi

# ---------- 3/3 迁移 ----------
note ""
note "=== [3/3] 迁移文件中的 timestamp 建列 ==="
MIG=$(scan_migrations)
if [ -z "$MIG" ]; then
    note "  ok 无命中"
else
    while IFS= read -r line; do
        k=$(key_of "$line")
        if [ "$MODE" != "--all" ] && [ -f "$BASELINE" ] && grep -Fxq -- "$k" "$BASELINE"; then
            note "    [基线] $line"
        else
            note "    x $line"
            fail=1
        fi
    done < <(printf '%s\n' "$MIG")
fi

note ""
if [ "$fail" -ne 0 ]; then
    note "RESULT: FAIL —— 存在无时区列或新增 timestamp 写法，禁止发布"
    exit 1
fi
note "RESULT: PASS —— 时区护栏通过"
exit 0
