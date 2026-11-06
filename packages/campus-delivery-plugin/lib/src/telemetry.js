"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_URL_MAX = exports.ERROR_STACK_MAX = exports.ERROR_MESSAGE_MAX = exports.TRACK_TIME_MAX_AGE_MS = exports.TRACK_TIME_MAX_FUTURE_MS = exports.TRACK_PROPS_MAX_CHARS = exports.TRACK_SESSION_MAX = exports.TRACK_PAGE_MAX = exports.TRACK_EVENT_NAME_MAX = exports.TRACK_BATCH_MAX = void 0;
exports.sanitizeTrackEvent = sanitizeTrackEvent;
exports.normalizeTrackEventBatch = normalizeTrackEventBatch;
exports.sanitizeErrorReport = sanitizeErrorReport;
exports.buildTrend = buildTrend;
exports.rowsToDayCounts = rowsToDayCounts;
const core_1 = require("@vendure/core");
const campus_time_1 = require("./campus-time");
/** 单次批量上报事件上限（端侧 10 条/5s，服务端再兜一层） */
exports.TRACK_BATCH_MAX = 20;
exports.TRACK_EVENT_NAME_MAX = 64;
exports.TRACK_PAGE_MAX = 128;
exports.TRACK_SESSION_MAX = 64;
exports.TRACK_PROPS_MAX_CHARS = 2000;
/** 端侧事件时间允许的时钟漂移（未来）与最长补传窗口（过去） */
exports.TRACK_TIME_MAX_FUTURE_MS = 5 * 60 * 1000;
exports.TRACK_TIME_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
exports.ERROR_MESSAGE_MAX = 2000;
exports.ERROR_STACK_MAX = 8000;
exports.ERROR_URL_MAX = 500;
function clip(v, max) {
    if (v == null)
        return '';
    return String(v).trim().slice(0, max);
}
function clipNullable(v, max) {
    const s = clip(v, max);
    return s ? s : null;
}
/** 属性体积裁剪：只保留可序列化对象，超限截断后仍保证是合法 JSON。 */
function normalizeProps(raw) {
    if (raw == null)
        return null;
    let obj = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        }
        catch (_a) {
            return null;
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj))
        return null;
    try {
        const json = JSON.stringify(obj);
        if (json.length <= exports.TRACK_PROPS_MAX_CHARS)
            return obj;
        return { _truncated: true, raw: json.slice(0, exports.TRACK_PROPS_MAX_CHARS) };
    }
    catch (_b) {
        return null;
    }
}
/** 解析端侧事件时间：只接受 ISO 字符串且落在 [now-30d, now+5min]，否则返回 null。 */
function parseEventTime(raw, now = Date.now()) {
    if (typeof raw !== 'string' || !raw.trim())
        return null;
    const ts = Date.parse(raw);
    if (!Number.isFinite(ts))
        return null;
    if (ts > now + exports.TRACK_TIME_MAX_FUTURE_MS)
        return null;
    if (ts < now - exports.TRACK_TIME_MAX_AGE_MS)
        return null;
    return new Date(ts);
}
/** 单条事件裁剪：无事件名直接丢弃（返回 null）。 */
function sanitizeTrackEvent(raw) {
    const eventName = clip(raw === null || raw === void 0 ? void 0 : raw.eventName, exports.TRACK_EVENT_NAME_MAX);
    if (!eventName)
        return null;
    const rawCreatedAt = raw === null || raw === void 0 ? void 0 : raw.createdAt;
    const createdAt = parseEventTime(rawCreatedAt);
    if (!createdAt && rawCreatedAt != null && String(rawCreatedAt).trim() !== '') {
        // 端侧提供了时间但非法/越界：回落入库时间，留痕便于识别伪造或时钟异常
        core_1.Logger.warn(`[campusTelemetry] createdAt 回落服务器时间: eventName=${eventName}, raw=${String(rawCreatedAt).slice(0, 64)}`);
    }
    return {
        eventName,
        page: clipNullable(raw === null || raw === void 0 ? void 0 : raw.page, exports.TRACK_PAGE_MAX),
        sessionId: clipNullable(raw === null || raw === void 0 ? void 0 : raw.sessionId, exports.TRACK_SESSION_MAX),
        props: normalizeProps(raw === null || raw === void 0 ? void 0 : raw.props),
        createdAt,
    };
}
/**
 * 批量裁剪：逐条清洗 + 批内去重（同名事件在同一 session/page 下同一批只记一次），
 * 并截断到 batchLimit 条。端侧重复上报/重试时会命中此处的去重。
 */
function normalizeTrackEventBatch(raw, batchLimit = exports.TRACK_BATCH_MAX) {
    var _a, _b, _c;
    // 兼容两种入参：事件数组，或 { events: [...] } 批量体
    const list = Array.isArray(raw) ? raw : Array.isArray(raw === null || raw === void 0 ? void 0 : raw.events) ? raw.events : [];
    const out = [];
    const seen = new Set();
    for (const item of list) {
        const ev = sanitizeTrackEvent(item);
        if (!ev)
            continue;
        const key = `${ev.eventName}|${(_a = ev.page) !== null && _a !== void 0 ? _a : ''}|${(_b = ev.sessionId) !== null && _b !== void 0 ? _b : ''}|${JSON.stringify((_c = ev.props) !== null && _c !== void 0 ? _c : null)}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(ev);
        if (out.length >= batchLimit)
            break;
    }
    return out;
}
/** 错误报告裁剪：message 必填；source 归一为 c-end / admin。 */
function sanitizeErrorReport(raw) {
    const message = clip(raw === null || raw === void 0 ? void 0 : raw.message, exports.ERROR_MESSAGE_MAX);
    if (!message)
        return null;
    const sourceRaw = clip(raw === null || raw === void 0 ? void 0 : raw.source, 16).toLowerCase();
    const source = sourceRaw === 'admin' ? 'admin' : 'c-end';
    const level = clip(raw === null || raw === void 0 ? void 0 : raw.level, 16).toLowerCase() === 'warn' ? 'warn' : 'error';
    return {
        source,
        level,
        message,
        stack: clipNullable(raw === null || raw === void 0 ? void 0 : raw.stack, exports.ERROR_STACK_MAX),
        page: clipNullable(raw === null || raw === void 0 ? void 0 : raw.page, exports.TRACK_PAGE_MAX),
        url: clipNullable(raw === null || raw === void 0 ? void 0 : raw.url, exports.ERROR_URL_MAX),
    };
}
/**
 * 近 N 日趋势（按校园时区自然日，缺日补 0，输出由旧到新）。
 * counts 为 { 'YYYY-MM-DD': n } 形式，避免服务端逐日查询。
 */
function buildTrend(days, now, eventCounts, errorCounts) {
    var _a, _b;
    const todayStart = (0, campus_time_1.startOfCampusDay)(now);
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
        const date = (0, campus_time_1.campusDayKey)(todayStart - i * 24 * 3600000);
        out.push({ date, events: (_a = eventCounts[date]) !== null && _a !== void 0 ? _a : 0, errors: (_b = errorCounts[date]) !== null && _b !== void 0 ? _b : 0 });
    }
    return out;
}
/** 把 SQL 分组结果（[{ day, cnt }]）转成计数表。 */
function rowsToDayCounts(rows) {
    var _a, _b;
    const out = {};
    for (const r of rows !== null && rows !== void 0 ? rows : []) {
        const day = String((_a = r === null || r === void 0 ? void 0 : r.day) !== null && _a !== void 0 ? _a : '').slice(0, 10);
        if (!day)
            continue;
        out[day] = Number((_b = r === null || r === void 0 ? void 0 : r.cnt) !== null && _b !== void 0 ? _b : 0) || 0;
    }
    return out;
}
//# sourceMappingURL=telemetry.js.map