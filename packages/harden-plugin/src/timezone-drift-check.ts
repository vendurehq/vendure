import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Logger, TransactionalConnection } from '@vendure/core';

import { loggerCtx } from './constants';

/** 允许的最大偏差：超过即打 error（仅告警，不阻断启动） */
const DRIFT_LIMIT_MS = 60_000;

/**
 * 启动自检：数据库 now() 与 Node Date.now() 偏差 > 60 秒打 error。
 *
 * 目的：尽早暴露「进程 TZ / 数据库 TimeZone / 宿主时区」不一致。
 * 这类不一致会让 `timestamp without time zone` 列与 `now()` / JS `Date.now()` 的比较
 * 出现整体偏移（典型为 8 小时），且不会报错，只会让业务判断悄悄错。
 */
@Injectable()
export class TimezoneDriftCheck implements OnApplicationBootstrap {
    constructor(private connection: TransactionalConnection) {}

    async onApplicationBootstrap(): Promise<void> {
        try {
            const before = Date.now();
            const rows: any = await this.connection.rawConnection.query(
                `SELECT now() AS db_now, current_setting('TimeZone') AS db_tz`,
            );
            const after = Date.now();
            const row = (Array.isArray(rows) ? rows[0] : rows?.rows?.[0]) ?? {};
            const dbNowMs = new Date(row.db_now).getTime();
            // 网络往返让 DB now() 略早于 after，取调用前后中点做近似
            const nodeNowMs = (before + after) / 2;
            const driftMs = Math.abs(dbNowMs - nodeNowMs);
            const processTz = process.env.TZ ?? '(未设置)';
            const processTzOffsetMin = new Date().getTimezoneOffset();

            if (driftMs > DRIFT_LIMIT_MS) {
                Logger.error(
                    `时区自检失败：DB now() 与 Node Date.now() 偏差 ${driftMs}ms (>${DRIFT_LIMIT_MS}ms)；`
                    + `DB TimeZone=${row.db_tz}，进程 TZ=${processTz}（offset ${processTzOffsetMin}min）`,
                    loggerCtx,
                );
            } else {
                Logger.info(
                    `时区自检通过：偏差 ${driftMs}ms；DB TimeZone=${row.db_tz}，`
                    + `进程 TZ=${processTz}（offset ${processTzOffsetMin}min）`,
                    loggerCtx,
                );
            }
        } catch (e: any) {
            // 自检失败不能阻断启动
            Logger.warn(`时区自检跳过（无法查询 now()）：${String(e?.message ?? e)}`, loggerCtx);
        }
    }
}
