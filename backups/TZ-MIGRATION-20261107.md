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
