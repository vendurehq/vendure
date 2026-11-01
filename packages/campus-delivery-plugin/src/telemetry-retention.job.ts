import { Injectable } from '@nestjs/common';
import { Logger, TransactionalConnection } from '@vendure/core';
import { PeriodicFallback } from './periodic-fallback';

const loggerCtx = 'CampusTelemetryRetention';
/** 首跑延迟：等迁移/DB 就绪，避免与应用启动争抢锁 */
const BOOT_DELAY_MS = 5 * 60_000;
/** 每日一轮即可（清理与埋点写入是同一批表，低频更稳） */
const INTERVAL_MS = 24 * 3600_000;
/**
 * 埋点/错误报告保留天数：后台趋势只用 7 日、排障与售后追溯保留 90 天足够，
 * 避免匿名上报长期累积（M2 的日上限只限增量，不限制存量）。
 */
export const TELEMETRY_RETENTION_DAYS = 90;
/** 分批删除，避免一次大 DELETE 长时间持锁影响埋点写入 */
const DELETE_CHUNK = 5000;
/** 单表单轮最多删除 100 万行，超出部分下一轮继续（防止异常数据把一轮拖死） */
const MAX_CHUNKS = 200;

const TABLES = ['campus_track_event', 'campus_error_report'] as const;

/**
 * 埋点/错误报告过期清理（保留 TELEMETRY_RETENTION_DAYS 天）。
 * - 只按 createdAt 删除，保留统计口径不受影响（趋势只看 7 日）。
 * - 幂等：多实例并发执行只会重复删除同一批旧行，无副作用。
 * - 分批 + 每轮计数日志，便于观察存量收敛。
 */
@Injectable()
export class TelemetryRetentionJob {
    private fallback: PeriodicFallback | null = null;

    constructor(private connection: TransactionalConnection) {}

    start(): void {
        if (this.fallback) return;
        this.fallback = new PeriodicFallback({
            name: 'telemetry-retention',
            intervalMs: INTERVAL_MS,
            bootDelayMs: BOOT_DELAY_MS,
            loggerCtx,
        });
        this.fallback.start(() => this.run());
    }

    stop(): void {
        this.fallback?.stop();
        this.fallback = null;
    }

    async run(): Promise<void> {
        const cutoff = new Date(Date.now() - TELEMETRY_RETENTION_DAYS * 24 * 3600_000);
        for (const table of TABLES) {
            try {
                const deleted = await this.purge(table, cutoff);
                if (deleted > 0) {
                    Logger.info(`清理 ${table} 过期数据 ${deleted} 行（早于 ${cutoff.toISOString()}）`, loggerCtx);
                }
            } catch (e: any) {
                Logger.error(`清理 ${table} 失败: ${e?.message}`, loggerCtx);
            }
        }
    }

    private async purge(table: string, cutoff: Date): Promise<number> {
        if (!TABLES.includes(table as any)) throw new Error(`unexpected table ${table}`);
        let total = 0;
        for (let i = 0; i < MAX_CHUNKS; i++) {
            const raw: any = await this.connection.rawConnection.query(
                `DELETE FROM ${table} WHERE id IN (`
                + ` SELECT id FROM ${table} WHERE "createdAt" < $1 ORDER BY id LIMIT ${DELETE_CHUNK}`
                + ` ) RETURNING id`,
                [cutoff],
            );
            const rows = Array.isArray(raw) ? raw : (raw?.rows ?? []);
            total += rows.length;
            if (!rows.length) break;
        }
        return total;
    }
}
