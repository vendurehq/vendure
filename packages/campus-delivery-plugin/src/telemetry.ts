import { Logger } from '@vendure/core';

import { campusDayKey, startOfCampusDay } from './campus-time';

/** 单次批量上报事件上限（端侧 10 条/5s，服务端再兜一层） */
export const TRACK_BATCH_MAX = 20;
export const TRACK_EVENT_NAME_MAX = 64;
export const TRACK_PAGE_MAX = 128;
export const TRACK_SESSION_MAX = 64;
export const TRACK_PROPS_MAX_CHARS = 2000;
/** 端侧事件时间允许的时钟漂移（未来）与最长补传窗口（过去） */
export const TRACK_TIME_MAX_FUTURE_MS = 5 * 60 * 1000;
export const TRACK_TIME_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
export const ERROR_MESSAGE_MAX = 2000;
export const ERROR_STACK_MAX = 8000;
export const ERROR_URL_MAX = 500;

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

function clip(v: unknown, max: number): string {
    if (v == null) return '';
    return String(v).trim().slice(0, max);
}

function clipNullable(v: unknown, max: number): string | null {
    const s = clip(v, max);
    return s ? s : null;
}

/** 属性体积裁剪：只保留可序列化对象，超限截断后仍保证是合法 JSON。 */
function normalizeProps(raw: unknown): Record<string, any> | null {
    if (raw == null) return null;
    let obj: any = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    try {
        const json = JSON.stringify(obj);
        if (json.length <= TRACK_PROPS_MAX_CHARS) return obj;
        return { _truncated: true, raw: json.slice(0, TRACK_PROPS_MAX_CHARS) };
    } catch {
        return null;
    }
}

/** 解析端侧事件时间：只接受 ISO 字符串且落在 [now-30d, now+5min]，否则返回 null。 */
function parseEventTime(raw: unknown, now = Date.now()): Date | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const ts = Date.parse(raw);
    if (!Number.isFinite(ts)) return null;
    if (ts > now + TRACK_TIME_MAX_FUTURE_MS) return null;
    if (ts < now - TRACK_TIME_MAX_AGE_MS) return null;
    return new Date(ts);
}

/** 单条事件裁剪：无事件名直接丢弃（返回 null）。 */
export function sanitizeTrackEvent(raw: any): NormalizedTrackEvent | null {
    const eventName = clip(raw?.eventName, TRACK_EVENT_NAME_MAX);
    if (!eventName) return null;
    const rawCreatedAt = raw?.createdAt;
    const createdAt = parseEventTime(rawCreatedAt);
    if (!createdAt && rawCreatedAt != null && String(rawCreatedAt).trim() !== '') {
        // 端侧提供了时间但非法/越界：回落入库时间，留痕便于识别伪造或时钟异常
        Logger.warn(
            `[campusTelemetry] createdAt 回落服务器时间: eventName=${eventName}, raw=${String(rawCreatedAt).slice(0, 64)}`,
        );
    }
    return {
        eventName,
        page: clipNullable(raw?.page, TRACK_PAGE_MAX),
        sessionId: clipNullable(raw?.sessionId, TRACK_SESSION_MAX),
        props: normalizeProps(raw?.props),
        createdAt,
    };
}

/**
 * 批量裁剪：逐条清洗 + 批内去重（同名事件在同一 session/page 下同一批只记一次），
 * 并截断到 batchLimit 条。端侧重复上报/重试时会命中此处的去重。
 */
export function normalizeTrackEventBatch(raw: unknown, batchLimit = TRACK_BATCH_MAX): NormalizedTrackEvent[] {
    // 兼容两种入参：事件数组，或 { events: [...] } 批量体
    const list = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.events) ? (raw as any).events : [];
    const out: NormalizedTrackEvent[] = [];
    const seen = new Set<string>();
    for (const item of list) {
        const ev = sanitizeTrackEvent(item);
        if (!ev) continue;
        const key = `${ev.eventName}|${ev.page ?? ''}|${ev.sessionId ?? ''}|${JSON.stringify(ev.props ?? null)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ev);
        if (out.length >= batchLimit) break;
    }
    return out;
}

/** 错误报告裁剪：message 必填；source 归一为 c-end / admin。 */
export function sanitizeErrorReport(raw: any): NormalizedErrorReport | null {
    const message = clip(raw?.message, ERROR_MESSAGE_MAX);
    if (!message) return null;
    const sourceRaw = clip(raw?.source, 16).toLowerCase();
    const source = sourceRaw === 'admin' ? 'admin' : 'c-end';
    const level = clip(raw?.level, 16).toLowerCase() === 'warn' ? 'warn' : 'error';
    return {
        source,
        level,
        message,
        stack: clipNullable(raw?.stack, ERROR_STACK_MAX),
        page: clipNullable(raw?.page, TRACK_PAGE_MAX),
        url: clipNullable(raw?.url, ERROR_URL_MAX),
    };
}

/**
 * 近 N 日趋势（按校园时区自然日，缺日补 0，输出由旧到新）。
 * counts 为 { 'YYYY-MM-DD': n } 形式，避免服务端逐日查询。
 */
export function buildTrend(
    days: number,
    now: number,
    eventCounts: Record<string, number>,
    errorCounts: Record<string, number>,
): TrackDayPoint[] {
    const todayStart = startOfCampusDay(now);
    const out: TrackDayPoint[] = [];
    for (let i = days - 1; i >= 0; i--) {
        const date = campusDayKey(todayStart - i * 24 * 3600_000);
        out.push({ date, events: eventCounts[date] ?? 0, errors: errorCounts[date] ?? 0 });
    }
    return out;
}

/** 把 SQL 分组结果（[{ day, cnt }]）转成计数表。 */
export function rowsToDayCounts(rows: Array<{ day?: string; cnt?: number | string }> | undefined): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows ?? []) {
        const day = String(r?.day ?? '').slice(0, 10);
        if (!day) continue;
        out[day] = Number(r?.cnt ?? 0) || 0;
    }
    return out;
}
