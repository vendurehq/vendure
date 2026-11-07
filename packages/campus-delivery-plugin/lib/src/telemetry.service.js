"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelemetryService = exports.ERROR_DAILY_MAX_PER_CHANNEL = exports.TRACK_DAILY_MAX_PER_CHANNEL = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const typeorm_1 = require("typeorm");
const telemetry_entities_1 = require("./telemetry.entities");
const telemetry_1 = require("./telemetry");
const campus_time_1 = require("./campus-time");
const TREND_DAYS = 7;
const TOP_EVENTS = 5;
/** 公开写入入口的进程内限流（多实例部署时每实例独立计数，仅用于抑制匿名刷写） */
const RATE_WINDOW_MS = 60000;
const TRACK_CALLS_PER_WINDOW = 40;
const ERROR_CALLS_PER_WINDOW = 10;
const RATE_MAP_MAX = 5000;
/**
 * 每日每渠道写入预算（M2）：进程内限流可被轮换 IP / 多实例放大绕过，
 * 这里按「当日已入库行数」加一道跨实例兜底，超限后匿名写入直接丢弃。
 * 各实例每 60s 与 DB 对齐一次，窗口内独立累加，故实际上限约为 实例数×预算。
 */
const TRACK_DAILY_MAX_PER_CHANNEL = 50000;
exports.TRACK_DAILY_MAX_PER_CHANNEL = TRACK_DAILY_MAX_PER_CHANNEL;
const ERROR_DAILY_MAX_PER_CHANNEL = 2000;
exports.ERROR_DAILY_MAX_PER_CHANNEL = ERROR_DAILY_MAX_PER_CHANNEL;
const BUDGET_REFRESH_MS = 60000;
function pageSize(take) {
    const n = Number(take !== null && take !== void 0 ? take : 20);
    if (!Number.isFinite(n) || n <= 0)
        return 20;
    return Math.min(Math.floor(n), 100);
}
function pageStart(skip) {
    const n = Number(skip !== null && skip !== void 0 ? skip : 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
let TelemetryService = class TelemetryService {
    constructor(connection) {
        this.connection = connection;
        /** 限流窗口：clientKey → {count, resetAt} */
        this.rateWindows = new Map();
        /** 每日预算：`kind:channelId:dayStart` → {used, refreshedAt, warned} */
        this.dailyBudgets = new Map();
    }
    /** C 端批量埋点上报（匿名可用），返回实际入库条数。 */
    async trackEvents(ctx, input) {
        var _a;
        // 公开入口限流：超限直接丢弃（不抛错，避免影响端侧上报链路）
        if (!this.allowRate(`track:${(_a = requestMeta(ctx).ip) !== null && _a !== void 0 ? _a : 'unknown'}`, TRACK_CALLS_PER_WINDOW))
            return 0;
        const events = (0, telemetry_1.normalizeTrackEventBatch)(input === null || input === void 0 ? void 0 : input.events);
        if (!events.length)
            return 0;
        // 每日预算兜底（跨实例 + 轮换 IP 上限），超限丢弃不抛错
        if (!(await this.allowDailyBudget(ctx, 'track', TRACK_DAILY_MAX_PER_CHANNEL, events.length)))
            return 0;
        const channelId = ctx.channelId;
        const customerId = await this.resolveCustomerId(ctx);
        const meta = requestMeta(ctx);
        const repo = this.connection.getRepository(ctx, telemetry_entities_1.CampusTrackEvent);
        const rows = events.map(ev => new telemetry_entities_1.CampusTrackEvent(Object.assign({ channelId,
            customerId, sessionId: ev.sessionId, eventName: ev.eventName, page: ev.page, props: ev.props, ua: meta.ua, ip: meta.ip }, (ev.createdAt ? { createdAt: ev.createdAt } : {}))));
        await repo.save(rows, { chunk: 50 });
        return rows.length;
    }
    /**
     * 错误上报（C 端匿名 / 后台登录均可）。
     * 同类错误 1 分钟内不重复落库，避免同一崩溃循环刷屏。
     */
    async reportError(ctx, input) {
        var _a;
        if (!this.allowRate(`error:${(_a = requestMeta(ctx).ip) !== null && _a !== void 0 ? _a : 'unknown'}`, ERROR_CALLS_PER_WINDOW))
            return false;
        const report = (0, telemetry_1.sanitizeErrorReport)(input);
        if (!report)
            return false;
        if (!(await this.allowDailyBudget(ctx, 'error', ERROR_DAILY_MAX_PER_CHANNEL, 1)))
            return false;
        const channelId = ctx.channelId;
        const customerId = await this.resolveCustomerId(ctx);
        const repo = this.connection.getRepository(ctx, telemetry_entities_1.CampusErrorReport);
        const since = new Date(Date.now() - 60000);
        const dup = await repo
            .createQueryBuilder('e')
            .where('e.channelId = :channelId', { channelId })
            .andWhere('e.source = :source', { source: report.source })
            .andWhere('e.message = :message', { message: report.message })
            .andWhere('e.createdAt >= :since', { since })
            .getCount();
        if (dup > 0)
            return true;
        const meta = requestMeta(ctx);
        await repo.save(new telemetry_entities_1.CampusErrorReport({
            channelId,
            source: report.source,
            level: report.level,
            message: report.message,
            stack: report.stack,
            page: report.page,
            url: report.url,
            ua: meta.ua,
            customerId,
        }));
        return true;
    }
    /** 后台「系统监控」KPI + 近 7 日趋势 + Top 事件。 */
    async stats(ctx) {
        var _a;
        const channelId = ctx.channelId;
        const now = Date.now();
        const dayStart = new Date((0, campus_time_1.startOfCampusDay)(now));
        const weekStart = new Date((0, campus_time_1.startOfCampusDay)(now) - (TREND_DAYS - 1) * 24 * 3600000);
        const eventRepo = this.connection.getRepository(ctx, telemetry_entities_1.CampusTrackEvent);
        const errorRepo = this.connection.getRepository(ctx, telemetry_entities_1.CampusErrorReport);
        const [totalEvents, todayEvents, totalErrors, todayErrors, affectedUsers] = await Promise.all([
            eventRepo.count({ where: { channelId } }),
            eventRepo.count({ where: { channelId, createdAt: (0, typeorm_1.MoreThanOrEqual)(dayStart) } }),
            errorRepo.count({ where: { channelId } }),
            errorRepo.count({ where: { channelId, createdAt: (0, typeorm_1.MoreThanOrEqual)(dayStart) } }),
            eventRepo
                .createQueryBuilder('e')
                .select('COUNT(DISTINCT e.customerId)', 'cnt')
                .where('e.channelId = :channelId', { channelId })
                .andWhere('e.customerId IS NOT NULL')
                .andWhere('e.createdAt >= :dayStart', { dayStart })
                .getRawOne(),
        ]);
        const [eventDays, errorDays, topRows] = await Promise.all([
            this.dayCounts(ctx, 'campus_track_event', channelId, weekStart),
            this.dayCounts(ctx, 'campus_error_report', channelId, weekStart),
            this.topEvents(ctx, channelId, dayStart),
        ]);
        return {
            todayEvents,
            totalEvents,
            todayErrors,
            totalErrors,
            affectedUsers: Number((_a = affectedUsers === null || affectedUsers === void 0 ? void 0 : affectedUsers.cnt) !== null && _a !== void 0 ? _a : 0) || 0,
            trend: (0, telemetry_1.buildTrend)(TREND_DAYS, now, eventDays, errorDays),
            topEvents: topRows,
        };
    }
    /** 埋点明细（后台排障用，按时间倒序）。 */
    async events(ctx, options) {
        const channelId = ctx.channelId;
        const repo = this.connection.getRepository(ctx, telemetry_entities_1.CampusTrackEvent);
        const where = { channelId };
        if (options.filter)
            where.eventName = options.filter;
        const [items, totalItems] = await repo.findAndCount({
            where,
            order: { createdAt: 'DESC' },
            skip: pageStart(options.skip),
            take: pageSize(options.take),
        });
        return {
            items: items.map(e => ({
                id: e.id,
                eventName: e.eventName,
                page: e.page,
                sessionId: e.sessionId,
                customerId: e.customerId != null ? String(e.customerId) : null,
                props: e.props ? JSON.stringify(e.props) : null,
                createdAt: e.createdAt,
            })),
            totalItems,
        };
    }
    /** 错误报告明细（按时间倒序）。 */
    async errors(ctx, options) {
        const channelId = ctx.channelId;
        const repo = this.connection.getRepository(ctx, telemetry_entities_1.CampusErrorReport);
        const where = { channelId };
        if (options.filter)
            where.level = options.filter;
        const [items, totalItems] = await repo.findAndCount({
            where,
            order: { createdAt: 'DESC' },
            skip: pageStart(options.skip),
            take: pageSize(options.take),
        });
        return {
            items: items.map(e => ({
                id: e.id,
                source: e.source,
                level: e.level,
                message: e.message,
                stack: e.stack,
                page: e.page,
                url: e.url,
                customerId: e.customerId != null ? String(e.customerId) : null,
                createdAt: e.createdAt,
            })),
            totalItems,
        };
    }
    /** 固定窗口限流：超限返回 false（丢弃本次上报，不抛错） */
    allowRate(key, limit, now = Date.now()) {
        if (this.rateWindows.size >= RATE_MAP_MAX)
            this.pruneRateWindows(now);
        const w = this.rateWindows.get(key);
        if (!w || w.resetAt <= now) {
            this.rateWindows.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
            return true;
        }
        if (w.count >= limit)
            return false;
        w.count += 1;
        return true;
    }
    pruneRateWindows(now) {
        for (const [key, w] of this.rateWindows) {
            if (w.resetAt <= now)
                this.rateWindows.delete(key);
        }
    }
    /**
     * 每日写入预算（M2）：首次/每 60s 从 DB 对齐当日已入库行数，
     * 返回 false 时调用方丢弃本次写入（不抛错，避免端侧上报链路被限流错误打断）。
     */
    async allowDailyBudget(ctx, kind, limit, amount) {
        const channelId = ctx.channelId;
        const dayStart = (0, campus_time_1.startOfCampusDay)(Date.now());
        const key = `${kind}:${channelId}:${dayStart}`;
        const now = Date.now();
        let b = this.dailyBudgets.get(key);
        if (!b) {
            if (this.dailyBudgets.size >= RATE_MAP_MAX)
                this.pruneDailyBudgets(dayStart);
            b = { dayStart, used: 0, refreshedAt: 0, warned: false };
            this.dailyBudgets.set(key, b);
        }
        if (now - b.refreshedAt >= BUDGET_REFRESH_MS) {
            const repo = this.connection.getRepository(ctx, kind === 'track' ? telemetry_entities_1.CampusTrackEvent : telemetry_entities_1.CampusErrorReport);
            const used = await repo.count({
                where: { channelId, createdAt: (0, typeorm_1.MoreThanOrEqual)(new Date(dayStart)) },
            });
            b.used = Math.max(b.used, used);
            b.refreshedAt = now;
        }
        if (b.used >= limit) {
            if (!b.warned) {
                b.warned = true;
                core_1.Logger.warn(`渠道 ${channelId} 今日${kind === 'track' ? '埋点' : '错误上报'}已达上限 ${limit}，后续匿名写入将被丢弃`
                    + `（多实例按 60s 对齐独立计数，实际总量约为实例数×上限）`, 'TelemetryService');
            }
            return false;
        }
        b.used += amount;
        return true;
    }
    pruneDailyBudgets(dayStart) {
        for (const [key, b] of this.dailyBudgets) {
            if (b.dayStart < dayStart)
                this.dailyBudgets.delete(key);
        }
    }
    /** 已登录顾客 id（游客返回 null）；失败不阻断上报。 */
    async resolveCustomerId(ctx) {
        if (!ctx.activeUserId)
            return null;
        try {
            const customer = await this.connection.getRepository(ctx, core_1.Customer).findOne({
                where: { user: { id: ctx.activeUserId } },
                relations: { user: true },
            });
            return customer ? customer.id : null;
        }
        catch (_a) {
            return null;
        }
    }
    async dayCounts(ctx, table, channelId, from) {
        var _a;
        const manager = this.connection.getRepository(ctx, telemetry_entities_1.CampusTrackEvent).manager;
        // 口径说明（勿再叠加偏移）：campus_track_event / campus_error_report 的 createdAt 是
        // timestamptz（绝对时刻），SQL 里 +8 hours 只用于把绝对时刻落成北京自然日；
        // 传入的 from 也是绝对时刻，可直接比较。两处都不需要按 timestamp 的墙钟口径再换算。
        const raw = await manager.query(`SELECT to_char((("createdAt" + interval '8 hours')::date), 'YYYY-MM-DD') AS day, COUNT(*)::int AS cnt
             FROM ${table} WHERE "channelId" = $1 AND "createdAt" >= $2 GROUP BY 1`, [channelId, from]);
        const rows = (_a = (Array.isArray(raw) ? raw : raw === null || raw === void 0 ? void 0 : raw.rows)) !== null && _a !== void 0 ? _a : [];
        return (0, telemetry_1.rowsToDayCounts)(rows);
    }
    async topEvents(ctx, channelId, from) {
        var _a;
        const manager = this.connection.getRepository(ctx, telemetry_entities_1.CampusTrackEvent).manager;
        const raw = await manager.query(`SELECT "eventName" AS name, COUNT(*)::int AS cnt
             FROM campus_track_event WHERE "channelId" = $1 AND "createdAt" >= $2
             GROUP BY 1 ORDER BY cnt DESC LIMIT ${TOP_EVENTS}`, [channelId, from]);
        const rows = (_a = (Array.isArray(raw) ? raw : raw === null || raw === void 0 ? void 0 : raw.rows)) !== null && _a !== void 0 ? _a : [];
        return rows.map((r) => { var _a, _b; return ({ name: String((_a = r === null || r === void 0 ? void 0 : r.name) !== null && _a !== void 0 ? _a : ''), count: Number((_b = r === null || r === void 0 ? void 0 : r.cnt) !== null && _b !== void 0 ? _b : 0) || 0 }); });
    }
};
exports.TelemetryService = TelemetryService;
exports.TelemetryService = TelemetryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], TelemetryService);
/** 从请求上下文取 UA / IP（拿不到就留空，不影响入库）。 */
function requestMeta(ctx) {
    var _a, _b, _c, _d, _e;
    const req = ctx.req;
    const ua = (_a = req === null || req === void 0 ? void 0 : req.headers) === null || _a === void 0 ? void 0 : _a['user-agent'];
    const forwarded = (_b = req === null || req === void 0 ? void 0 : req.headers) === null || _b === void 0 ? void 0 : _b['x-forwarded-for'];
    const ip = ((_e = (_d = (_c = (Array.isArray(forwarded) ? forwarded[0] : forwarded)) === null || _c === void 0 ? void 0 : _c.split) === null || _d === void 0 ? void 0 : _d.call(_c, ',')) === null || _e === void 0 ? void 0 : _e[0]) || (req === null || req === void 0 ? void 0 : req.ip);
    return {
        ua: ua ? String(ua).slice(0, 255) : null,
        ip: ip ? String(ip).trim().slice(0, 64) : null,
    };
}
//# sourceMappingURL=telemetry.service.js.map