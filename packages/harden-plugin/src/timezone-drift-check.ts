import { createHmac } from 'node:crypto';

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Logger, TransactionalConnection } from '@vendure/core';

import { loggerCtx } from './constants';

/** 允许的最大偏差：超过即打 error（仅告警，不阻断启动） */
const DRIFT_LIMIT_MS = 60_000;
/** 告警文本最多列出的列名数量 */
const MAX_REPORTED_COLUMNS = 20;
/** 飞书 webhook 推送超时 */
const FEISHU_TIMEOUT_MS = 5_000;

/**
 * 启动自检：
 * 1. 数据库 now() 与 Node Date.now() 偏差 > 60 秒打 error。
 * 2. 库里是否又出现 `timestamp without time zone` 列（时区归一后应为 0），发现即 error + 飞书告警。
 *
 * 目的：尽早暴露「进程 TZ / 数据库 TimeZone / 宿主时区」不一致，以及新表/新迁移重新引入
 * 无时区列。这类问题不会报错，只会让业务时间判断悄悄偏移（典型为 8 小时）。
 *
 * 两条自检都只告警、不抛错、不阻塞启动：新建表当天不能把服务卡死。
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

        await this.checkLegacyTimestampColumns();
    }

    /** 时区列自检：`timestamp without time zone` 应为 0；发现即 error + 飞书告警，但不阻断启动 */
    private async checkLegacyTimestampColumns(): Promise<void> {
        try {
            const rows: any = await this.connection.rawConnection.query(
                `SELECT table_name, column_name
                   FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND data_type = 'timestamp without time zone'
                  ORDER BY table_name, ordinal_position`,
            );
            const list: Array<{ table_name: string; column_name: string }> =
                (Array.isArray(rows) ? rows : rows?.rows) ?? [];
            const count = list.length;
            if (count === 0) {
                Logger.info('时区列自检通过：timestamp without time zone 列数 0', loggerCtx);
                return;
            }

            const shown = list.slice(0, MAX_REPORTED_COLUMNS)
                .map(r => `${r.table_name}.${r.column_name}`)
                .join(', ');
            const more = count > MAX_REPORTED_COLUMNS ? ` …（共 ${count} 列，仅列前 ${MAX_REPORTED_COLUMNS}）` : '';
            const text = `时区列自检失败：发现 ${count} 个 timestamp without time zone 列（应为 0）：${shown}${more}`;
            Logger.error(text, loggerCtx);
            await this.notifyFeishu(`【时区护栏】${text}`);
        } catch (e: any) {
            // 自检失败不能阻断启动
            Logger.warn(`时区列自检跳过（无法查询 information_schema）：${String(e?.message ?? e)}`, loggerCtx);
        }
    }

    /** 复用现有飞书群机器人 webhook（与 FeishuClient 同一通道、同一签名算法）；未配置则静默跳过 */
    private async notifyFeishu(text: string): Promise<void> {
        try {
            const enabled = /^(true|1)$/i.test(String(process.env.FEISHU_ENABLED ?? ''));
            const webhook = process.env.FEISHU_WEBHOOK?.trim();
            if (!enabled || !webhook) {
                Logger.info('时区列自检告警未发送：飞书通道未启用或未配置 FEISHU_WEBHOOK', loggerCtx);
                return;
            }
            const secret = process.env.FEISHU_SECRET?.trim();
            const payload: Record<string, unknown> = { msg_type: 'text', content: { text } };
            if (secret) {
                const ts = String(Math.floor(Date.now() / 1000));
                payload.timestamp = ts;
                payload.sign = createHmac('sha256', `${ts}\n${secret}`).update('').digest('base64');
            }
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), FEISHU_TIMEOUT_MS);
            try {
                const res = await fetch(webhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify(payload),
                    signal: ctrl.signal,
                });
                const json: any = await res.json().catch(() => null);
                const code = json?.code ?? json?.StatusCode;
                if (res.ok && (code === 0 || code === undefined)) {
                    Logger.info('时区列自检告警已推送飞书', loggerCtx);
                } else {
                    Logger.warn(`时区列自检告警推送失败：HTTP ${res.status}，code=${code ?? 'n/a'}`, loggerCtx);
                }
            } finally {
                clearTimeout(timer);
            }
        } catch (e: any) {
            Logger.warn(`时区列自检告警推送异常：${String(e?.message ?? e)}`, loggerCtx);
        }
    }
}
