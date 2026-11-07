# 时区归一迁移记录（2026-11-07）

## 结论

- 705 个 `timestamp without time zone` 列 → `timestamptz`（改后全库 853 个 timestamptz / 0 个 timestamp）
- 分类口径：`column_default` 含 `now()` 或 `CURRENT_TIMESTAMP` → 按 UTC 转换（468 列）；其余 → 按 Asia/Shanghai 转换（237 列）
- 应用层换算全部摘除（28 个 src 文件、删除 4 个文件、83 处调用点、4 处 `AT TIME ZONE 'UTC'`）
- 库级时区改为 `Asia/Shanghai`

## 产物

| 项 | 路径 | 说明 |
| --- | --- | --- |
| 分类清单 | `backups/tz-map-20261107-165803.tsv` | 705 行；UTC 468 / SH 237；def_now 460、def_current_ts 8 |
| 停机点位备份 | `backups/vendure-pre-tz-20261107-165803.dump` | 4.5MB；TOC 385 TABLE DATA / 385 TABLE |
| 演练备份（曾还原到临时库核对行数） | `backups/vendure-pre-tz-20261107-161839.dump` | 4.5MB |
| 逐表行数基线 | `backups/tz-rows-20261107-165803.json` | 385 表 / 111,999 行 |
| 改前指标基线 | `backups/tz-before-final.txt` | 销售 / 配送 / 售后 / 派单 |
| 执行脚本 | 工作区 `tz-apply.sh`、`tz-reverse.sh`、`run-migration.sh` | 反向脚本支持按 map 还列类型或整库恢复 |

sha256：

```
5d799d5be06f369e15bc7d161f0b990affcf2fc3047068f8e22d8113712d25dc  backups/vendure-pre-tz-20261107-165803.dump
bd01e79c9d26347d94f886118c055693971d3bdfc5dae8398b85ad267558bedb  backups/vendure-pre-tz-20261107-161839.dump
```

## 执行时间线（2026-11-07，时区 Asia/Shanghai）

- 16:57:5x `pm2 stop vendure`（`PM2_PID=0`，应用连接 0）
- 16:58:03 停机点位 dump（sha256 见上，TOC 385/385）
- 16:58:18 前完成 708 行 DDL 单事务 COMMIT，随后 `ALTER DATABASE vendure SET timezone='Asia/Shanghai'`
- 约 16:58:46 `pm2 start vendure`，`/health` 200，时区自检偏差 0ms
- 停机约 1 分钟（预算 8–15 分钟）

## 回滚

### A. 整库恢复（推荐，回到迁移前状态）

```bash
cd /www/apps/vendure
sha256sum backups/vendure-pre-tz-20261107-165803.dump   # 应为 5d799d5b...
pm2 stop vendure
docker cp backups/vendure-pre-tz-20261107-165803.dump 1Panel-postgresql-pIe0:/tmp/pre.dump
docker exec 1Panel-postgresql-pIe0 pg_restore -U vendure -d vendure --clean --if-exists --no-owner /tmp/pre.dump
docker exec 1Panel-postgresql-pIe0 psql -U vendure -d vendure -c "ALTER DATABASE vendure SET timezone='UTC'"
git checkout -- packages/        # 撤销本次源码与 lib 改动（若已提交，用 git revert <hash>）
pm2 start vendure
curl -s http://127.0.0.1:3020/health
```

### B. 仅把列类型改回 timestamp（不动数据）

```bash
bash tz-reverse.sh backups/tz-map-20261107-165803.tsv
# UTC 列: col AT TIME ZONE 'UTC'；SH 列: col AT TIME ZONE 'Asia/Shanghai'
```

## 验收快照

- 类型：`timestamp with time zone = 853`，`timestamp without time zone = 0`
- 时区自检：`偏差 0ms；DB TimeZone=Asia/Shanghai，进程 TZ=Asia/Shanghai（offset -480min）`
- 抽样订单 474：`created 08:28:14+08 / placed 08:28:16 / hallEntered 08:28:37 / delivered 08:39:36`（改前 created 为 00:28）
- 默认值写入探针：`createdAt/updatedAt/now()` 均为 `2026-11-07 17:01:52+08`，ROLLBACK 无残留
- 销售按日、配送完成、售后 SLA、KDS 待出餐、巡检 P95 与改前一致
- telemetry 日报为北京日界修正：11-03 531→526、11-04 65→70、11-05 4→3、11-06 37→33、11-07 14→19，
  差异全部来自北京时间 00:00–08:00 的事件归位，满足 `OLD(d) = NEW(d) − early(d) + early(d+1)`，无丢失无重复

## 后续：防回归护栏（2026-11-07 补装）

### A. 启动自检（`packages/harden-plugin/src/timezone-drift-check.ts`）

每次启动在现有时区自检之后追加一条：

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public' AND data_type='timestamp without time zone'
```

- 列数为 0 → `info` 日志「时区列自检通过：timestamp without time zone 列数 0」（证明检查真的跑了）
- 列数 > 0 → `error` 日志列出最多 20 个 `表.列`，并尝试推送飞书（复用 `FEISHU_ENABLED` / `FEISHU_WEBHOOK` / `FEISHU_SECRET`，
  与 FeishuClient 同一 webhook、同一 `HMAC-SHA256(timestamp\nsecret)` 签名；未配置时只留一行「告警未发送」日志）
- **只告警、不抛错、不阻塞启动**（新建表当天不能把服务卡死），超时 5 秒

### B. 发布前预检（`scripts/tz-guard.sh`）

```bash
scripts/tz-guard.sh            # 发布前必跑：新增命中即 exit 1
scripts/tz-guard.sh --all      # 连历史基线一起判失败（全量清账）
scripts/tz-guard.sh --bootstrap  # 重新生成基线（维护用）
```

三块检查：

1. 数据库 `public` schema 的 `timestamp without time zone` 列（任何命中即失败，不受基线影响）
2. 实体 `.entity.ts` 里的 `'timestamp'`（排除注释与 `timestamptz`）
3. 迁移文件里的 `timestamp` 建列（排除注释、`lib/` 构建产物与 `timestamptz` / `timestamp with time zone`）

存量历史写法冻结在 `scripts/tz-guard-baseline.txt`（61 条：迁移已应用、`synchronize=false` 不会落库），
默认只对**不在基线内**的新增命中判失败；`--all` 可查全量欠账。

标准发布流程：

```bash
cd /www/apps/vendure && scripts/tz-guard.sh && pm2 restart vendure
```

环境变量：`TZ_GUARD_CONTAINER`(默认 `1Panel-postgresql-pIe0`)、`TZ_GUARD_DB`(默认 `vendure`)、
`TZ_GUARD_USER`(默认 `vendure`)；无 docker 时回退到 `PGHOST/PGPORT/PGUSER` 直连。

### 已验证

- 造 `tz_guard_probe("createdAt" timestamp without time zone)` → 重启：`error 时区列自检失败：发现 1 个 …tz_guard_probe.createdAt`，
  `/health` 200（未阻塞启动）；`tz-guard.sh` exit 1 并列出该列
- 删表 → `tz-guard.sh` exit 0「RESULT: PASS」；再重启：`info 时区列自检通过：列数 0`
- 最终：`timestamp without time zone = 0`，无 `tz_guard*` 临时表残留


## 清账：实体注解统一 `timestamptz`（2026-11-07）

### 范围与结论

- 全仓实体 `.entity.ts` 中的 `type: 'timestamp'` 全部改为 `type: 'timestamptz'`：**44 列 / 23 文件**
  - **A 类**（库列已是 `timestamp with time zone`）：39 列 / 20 文件
  - **A0 类**（对应表尚未创建、插件未启用）：5 列 / 3 文件（`affiliate_relation` / `affiliate_withdrawal` / `community_activity`）
- 未执行任何 DDL、未生成迁移、未重放历史迁移。生产 `DB_SYNC=0`（`synchronize:false`），注解只影响 TypeORM 元数据。
- TypeORM 0.3.31 行为已核对：`normalizeType` 把 `timestamptz` 归一为 `timestamp with time zone`；`preparePersistentValue` 对 `timestamp` 与 `timestamp with time zone` 同走 `DateUtils.mixedDateToDate`（返回 Date 对象），序列化路径一致，读写行为无变化。

### A / A0 改动清单（44 列）

| 文件 | 列 |
| --- | --- |
| cjk-plugin/delivery/delivery-record.entity.ts | sentAt, deliveredAt, returnedAt, exceptionAt |
| cjk-plugin/inventory/stock-reservation.entity.ts | expiresAt |
| cjk-plugin/order/merchant-settlement-ledger.entity.ts | occurredAt, collectedAt |
| cjk-plugin/picking/pick-batch-order.entity.ts | addedAt |
| cjk-plugin/picking/pick-batch.entity.ts | pickedAt, printedAt, shippedAt, handoverAt, reviewedAt, exceptionAt |
| cjk-plugin/reconcile/reconciliation.entity.ts | startedAt, finishedAt, fixedAt |
| cjk-plugin/stocktake/stocktake-line.entity.ts | countedAt |
| cjk-plugin/stocktake/stocktake-task.entity.ts | postedAt |
| cjk-plugin/stocktake/stocktake-wave.entity.ts | claimedAt, submittedAt |
| cjk-plugin/tenant/tenant-member.entity.ts | resetPasswordExpiresAt |
| live-streaming-plugin/live-room.entity.ts | scheduledStartAt, startedAt, endedAt |
| review-plugin/review.entity.ts | reviewedAt |
| subscription-plugin/subscription-occurrence.entity.ts | scheduledDate |
| subscription-plugin/subscription.entity.ts | startDate, endDate |
| voucher-plugin/service-voucher.entity.ts | expiresAt, usedAt, refundedAt |
| voucher-plugin/voucher-booking.entity.ts | slotAt |
| campus-delivery-plugin/campus-address-change.entity.ts | settledAt |
| campus-delivery-plugin/compensation-task.entity.ts | nextAttemptAt |
| campus-delivery-plugin/rider-withdrawal.entity.ts | reviewedAt |
| vcash-offline-plugin/entities/offline-sync-queue.entity.ts | clientCreatedAt, clientUpdatedAt, syncedAt |
| affiliate-plugin/affiliate-relation.entity.ts | boundAt（A0） |
| affiliate-plugin/affiliate-withdrawal.entity.ts | paidAt（A0） |
| community-plugin/community-activity.entity.ts | windowStart, windowEnd, cutoffTime（A0） |

### B 类：历史迁移写法，保持不动（35 条命中）

这些写法都已在生产执行过，且 `synchronize:false` 不会再次落库；重放或改写会带来无收益的 DDL 风险，所以**一行不改**，仅在此标注为历史写法：

- `bill-pay-plugin/src/migrations/create-bill-pay-tables.ts`（8 条，含 4 表共用的 `createdAt`/`updatedAt` 模板）
- `campus-delivery-plugin/src/migrations/`：`add-address-change-pricing.ts`(3)、`add-withdraw-payout.ts`(1)、`p13-auto-accept.ts`(1)、`p36-compensation-task.ts`(3)、`p4-ops-hardening.ts`(1)、`p5-timestamp-timezone.ts`(1)、`p9-p5-rider-compliance.ts`(3)
- `cjk-plugin/src/migrations/`：`migrate-hotel-booking-reschedule-columns.ts`(1)、`migrate-pick-batch-handover-columns.ts`(4)、`migrate-pickup-store-link-soft-delete.ts`(1)、`migrate-reservation-expires-at.ts`(1)、`migrate-tenant-member-column.ts`(1)
- `coupon-plugin/src/migrations/add-coupon-promo-fields.ts`(1)
- `merchant-plugin/src/migrations/`：`add-merchant-deleted-at.ts`(1)、`create-merchant-tables.ts`(2，类型工厂，覆盖 4 表 19 个日期列)
- `subscription-plugin/src/migrations/migrate-subscription-tables.ts`(1，类型工厂，覆盖 3 表 12 个日期列)
- `voucher-plugin/src/migrations/migrate-voucher-tables.ts`(1，类型工厂，覆盖 2 表 10 个日期列)

对应库列现全部为 `timestamptz`（已在上文 705 列迁移中转好）。

### 3 条误报（不算历史 `timestamp` 写法）

1. `campus-delivery-plugin/src/migrations/p5-timestamp-timezone.ts:13`：`SELECT ... WHERE data_type='timestamp without time zone'` 是**检测语句**，不是建列。
2. `cjk-plugin/src/migrations/migrate-pickup-store-link-soft-delete.ts:33`：模板变量名是 `${timestamp}`，但第 22 行 `isPostgres ? 'timestamptz' : 'datetime'`，PG 分支实际写 `timestamptz`。
3. `merchant-plugin/src/migrations/add-merchant-deleted-at.ts:26`：同上，变量名误导，实际值 `timestamptz`。

### 约束：今后新迁移必须写 `timestamptz`

新增迁移或建表脚本里的时间列一律写 `timestamptz`（SQLite 分支写 `datetime`）。该约束已固化为发布前预检：

```bash
cd /www/apps/vendure && scripts/tz-guard.sh && pm2 restart vendure
```

数据库出现 `timestamp without time zone`、实体出现 `'timestamp'`、迁移新增 `timestamp`，任一命中即 exit 1。

### 护栏数字

- `scripts/tz-guard.sh --all`：改前基线 **61 条**（同文件同样式行去重后的存量条目；原始命中 79 条）→ 改后 **35 条，全部位于 `src/migrations/`**。
- `scripts/tz-guard-baseline.txt` 已重新生成：**35 行**，非迁移行 0。
- 默认模式 `scripts/tz-guard.sh`：`RESULT: PASS`，exit 0。
