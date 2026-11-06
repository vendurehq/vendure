/** 单次批量上报事件上限（端侧 10 条/5s，服务端再兜一层） */
export declare const TRACK_BATCH_MAX = 20;
export declare const TRACK_EVENT_NAME_MAX = 64;
export declare const TRACK_PAGE_MAX = 128;
export declare const TRACK_SESSION_MAX = 64;
export declare const TRACK_PROPS_MAX_CHARS = 2000;
/** 端侧事件时间允许的时钟漂移（未来）与最长补传窗口（过去） */
export declare const TRACK_TIME_MAX_FUTURE_MS: number;
export declare const TRACK_TIME_MAX_AGE_MS: number;
export declare const ERROR_MESSAGE_MAX = 2000;
export declare const ERROR_STACK_MAX = 8000;
export declare const ERROR_URL_MAX = 500;
export interface NormalizedTrackEvent {
    eventName: string;
    page: string | null;
    sessionId: string | null;
    props: Record<string, any> | null;
    /** 端侧事件发生时间；非法/超出窗口时为 null（回落入库时间） */
    createdAt: Date | null;
}
export interface NormalizedErrorReport {
    source: string;
    level: string;
    message: string;
    stack: string | null;
    page: string | null;
    url: string | null;
}
export interface TrackDayPoint {
    date: string;
    events: number;
    errors: number;
}
/** 单条事件裁剪：无事件名直接丢弃（返回 null）。 */
export declare function sanitizeTrackEvent(raw: any): NormalizedTrackEvent | null;
/**
 * 批量裁剪：逐条清洗 + 批内去重（同名事件在同一 session/page 下同一批只记一次），
 * 并截断到 batchLimit 条。端侧重复上报/重试时会命中此处的去重。
 */
export declare function normalizeTrackEventBatch(raw: unknown, batchLimit?: number): NormalizedTrackEvent[];
/** 错误报告裁剪：message 必填；source 归一为 c-end / admin。 */
export declare function sanitizeErrorReport(raw: any): NormalizedErrorReport | null;
/**
 * 近 N 日趋势（按校园时区自然日，缺日补 0，输出由旧到新）。
 * counts 为 { 'YYYY-MM-DD': n } 形式，避免服务端逐日查询。
 */
export declare function buildTrend(days: number, now: number, eventCounts: Record<string, number>, errorCounts: Record<string, number>): TrackDayPoint[];
/** 把 SQL 分组结果（[{ day, cnt }]）转成计数表。 */
export declare function rowsToDayCounts(rows: Array<{
    day?: string;
    cnt?: number | string;
}> | undefined): Record<string, number>;
