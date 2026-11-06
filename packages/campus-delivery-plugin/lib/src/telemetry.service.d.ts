import { RequestContext, TransactionalConnection } from '@vendure/core';
import { TrackDayPoint } from './telemetry';
export interface TrackEventStats {
    todayEvents: number;
    totalEvents: number;
    todayErrors: number;
    totalErrors: number;
    /** 今日产生事件的去重顾客数（游客不计） */
    affectedUsers: number;
    trend: TrackDayPoint[];
    topEvents: Array<{
        name: string;
        count: number;
    }>;
}
export interface AdminListOptions {
    skip?: number;
    take?: number;
    /** 事件名精确过滤 / 错误等级过滤 */
    filter?: string;
}
/**
 * 每日每渠道写入预算（M2）：进程内限流可被轮换 IP / 多实例放大绕过，
 * 这里按「当日已入库行数」加一道跨实例兜底，超限后匿名写入直接丢弃。
 * 各实例每 60s 与 DB 对齐一次，窗口内独立累加，故实际上限约为 实例数×预算。
 */
declare const TRACK_DAILY_MAX_PER_CHANNEL = 50000;
declare const ERROR_DAILY_MAX_PER_CHANNEL = 2000;
export { TRACK_DAILY_MAX_PER_CHANNEL, ERROR_DAILY_MAX_PER_CHANNEL };
export declare class TelemetryService {
    private connection;
    /** 限流窗口：clientKey → {count, resetAt} */
    private rateWindows;
    /** 每日预算：`kind:channelId:dayStart` → {used, refreshedAt, warned} */
    private dailyBudgets;
    constructor(connection: TransactionalConnection);
    /** C 端批量埋点上报（匿名可用），返回实际入库条数。 */
    trackEvents(ctx: RequestContext, input: any): Promise<number>;
    /**
     * 错误上报（C 端匿名 / 后台登录均可）。
     * 同类错误 1 分钟内不重复落库，避免同一崩溃循环刷屏。
     */
    reportError(ctx: RequestContext, input: any): Promise<boolean>;
    /** 后台「系统监控」KPI + 近 7 日趋势 + Top 事件。 */
    stats(ctx: RequestContext): Promise<TrackEventStats>;
    /** 埋点明细（后台排障用，按时间倒序）。 */
    events(ctx: RequestContext, options: AdminListOptions): Promise<{
        items: {
            id: import("@vendure/core").ID;
            eventName: string;
            page: string | null;
            sessionId: string | null;
            customerId: string | null;
            props: string | null;
            createdAt: Date;
        }[];
        totalItems: number;
    }>;
    /** 错误报告明细（按时间倒序）。 */
    errors(ctx: RequestContext, options: AdminListOptions): Promise<{
        items: {
            id: import("@vendure/core").ID;
            source: string;
            level: string;
            message: string;
            stack: string | null;
            page: string | null;
            url: string | null;
            customerId: string | null;
            createdAt: Date;
        }[];
        totalItems: number;
    }>;
    /** 固定窗口限流：超限返回 false（丢弃本次上报，不抛错） */
    private allowRate;
    private pruneRateWindows;
    /**
     * 每日写入预算（M2）：首次/每 60s 从 DB 对齐当日已入库行数，
     * 返回 false 时调用方丢弃本次写入（不抛错，避免端侧上报链路被限流错误打断）。
     */
    private allowDailyBudget;
    private pruneDailyBudgets;
    /** 已登录顾客 id（游客返回 null）；失败不阻断上报。 */
    private resolveCustomerId;
    private dayCounts;
    private topEvents;
}
