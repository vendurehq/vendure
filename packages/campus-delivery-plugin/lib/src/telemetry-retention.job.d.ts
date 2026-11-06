import { TransactionalConnection } from '@vendure/core';
/**
 * 埋点/错误报告保留天数：后台趋势只用 7 日、排障与售后追溯保留 90 天足够，
 * 避免匿名上报长期累积（M2 的日上限只限增量，不限制存量）。
 */
export declare const TELEMETRY_RETENTION_DAYS = 90;
/**
 * 埋点/错误报告过期清理（保留 TELEMETRY_RETENTION_DAYS 天）。
 * - 只按 createdAt 删除，保留统计口径不受影响（趋势只看 7 日）。
 * - 幂等：多实例并发执行只会重复删除同一批旧行，无副作用。
 * - 分批 + 每轮计数日志，便于观察存量收敛。
 */
export declare class TelemetryRetentionJob {
    private connection;
    private fallback;
    constructor(connection: TransactionalConnection);
    start(): void;
    stop(): void;
    run(): Promise<void>;
    private purge;
}
