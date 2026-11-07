import { Injectable } from '@nestjs/common';
import { Customer, Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import { MoreThanOrEqual } from 'typeorm';

import { CampusTrackEvent, CampusErrorReport } from './telemetry.entities';
import {
    buildTrend,
    normalizeTrackEventBatch,
    rowsToDayCounts,
    sanitizeErrorReport,
    TrackDayPoint,
} from './telemetry';
import { startOfCampusDay } from './campus-time';

export interface TrackEventStats {
    todayEvents: number;
    totalEvents: number;
    todayErrors: number;
    totalErrors: number;
    /** 今日产生事件的去重顾客数（游客不计） */
    affectedUsers: number;
    trend: TrackDayPoint[];
    topEvents: Array<{ name: string; count: number }>;
}

export interface AdminListOptions {
    skip?: number;
    take?: number;
    /** 事件名精确过滤 / 错误等级过滤 */
    filter?: string;
}

const TREND_DAYS = 7;
const TOP_EVENTS = 5;
/** 公开写入入口的进程内限流（多实例部署时每实例独立计数，仅用于抑制匿名刷写） */
const RATE_WINDOW_MS = 60_000;
const TRACK_CALLS_PER_WINDOW = 40;
const ERROR_CALLS_PER_WINDOW = 10;
const RATE_MAP_MAX = 5000;

/**
 * 每日每渠道写入预算（M2）：进程内限流可被轮换 IP / 多实例放大绕过，
 * 这里按「当日已入库行数」加一道跨实例兜底，超限后匿名写入直接丢弃。
 * 各实例每 60s 与 DB 对齐一次，窗口内独立累加，故实际上限约为 实例数×预算。
 */
const TRACK_DAILY_MAX_PER_CHANNEL = 50_000;
const ERROR_DAILY_MAX_PER_CHANNEL = 2_000;
export { TRACK_DAILY_MAX_PER_CHANNEL, ERROR_DAILY_MAX_PER_CHANNEL };
const BUDGET_REFRESH_MS = 60_000;

function pageSize(take?: number): number {
    const n = Number(take ?? 20);
    if (!Number.isFinite(n) || n <= 0) return 20;
    return Math.min(Math.floor(n), 100);
}

function pageStart(skip?: number): number {
    const n = Number(skip ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

@Injectable()
export class TelemetryService {
    /** 限流窗口：clientKey → {count, resetAt} */
    private rateWindows = new Map<string, { count: number; resetAt: number }>();
    /** 每日预算：`kind:channelId:dayStart` → {used, refreshedAt, warned} */
    private dailyBudgets = new Map<string, { dayStart: number; used: number; refreshedAt: number; warned: boolean }>();

    constructor(private connection: TransactionalConnection) {}

    /** C 端批量埋点上报（匿名可用），返回实际入库条数。 */
    async trackEvents(ctx: RequestContext, input: any): Promise<number> {
        // 公开入口限流：超限直接丢弃（不抛错，避免影响端侧上报链路）
        if (!this.allowRate(`track:${requestMeta(ctx).ip ?? 'unknown'}`, TRACK_CALLS_PER_WINDOW)) return 0;
        const events = normalizeTrackEventBatch(input?.events);
        if (!events.length) return 0;
        // 每日预算兜底（跨实例 + 轮换 IP 上限），超限丢弃不抛错
        if (!(await this.allowDailyBudget(ctx, 'track', TRACK_DAILY_MAX_PER_CHANNEL, events.length))) return 0;
        const channelId = ctx.channelId as number;
        const customerId = await this.resolveCustomerId(ctx);
        const meta = requestMeta(ctx);
        const repo = this.connection.getRepository(ctx, CampusTrackEvent);
        const rows = events.map(
            ev =>
                new CampusTrackEvent({
                    channelId,
                    customerId,
                    sessionId: ev.sessionId,
                    eventName: ev.eventName,
                    page: ev.page,
                    props: ev.props,
                    ua: meta.ua,
                    ip: meta.ip,
                    ...(ev.createdAt ? { createdAt: ev.createdAt } : {}),
                } as any),
        );
        await repo.save(rows, { chunk: 50 });
        return rows.length;
    }

    /**
     * 错误上报（C 端匿名 / 后台登录均可）。
     * 同类错误 1 分钟内不重复落库，避免同一崩溃循环刷屏。
     */
    async reportError(ctx: RequestContext, input: any): Promise<boolean> {
        if (!this.allowRate(`error:${requestMeta(ctx).ip ?? 'unknown'}`, ERROR_CALLS_PER_WINDOW)) return false;
        const report = sanitizeErrorReport(input);
        if (!report) return false;
        if (!(await this.allowDailyBudget(ctx, 'error', ERROR_DAILY_MAX_PER_CHANNEL, 1))) return false;
        const channelId = ctx.channelId as number;
        const customerId = await this.resolveCustomerId(ctx);
        const repo = this.connection.getRepository(ctx, CampusErrorReport);
        const since = new Date(Date.now() - 60_000);
        const dup = await repo
            .createQueryBuilder('e')
            .where('e.channelId = :channelId', { channelId })
            .andWhere('e.source = :source', { source: report.source })
            .andWhere('e.message = :message', { message: report.message })
            .andWhere('e.createdAt >= :since', { since })
            .getCount();
        if (dup > 0) return true;
        const meta = requestMeta(ctx);
        await repo.save(
            new CampusErrorReport({
                channelId,
                source: report.source,
                level: report.level,
                message: report.message,
                stack: report.stack,
                page: report.page,
                url: report.url,
                ua: meta.ua,
                customerId,
            } as any),
        );
        return true;
    }

    /** 后台「系统监控」KPI + 近 7 日趋势 + Top 事件。 */
    async stats(ctx: RequestContext): Promise<TrackEventStats> {
        const channelId = ctx.channelId as number;
        const now = Date.now();
        const dayStart = new Date(startOfCampusDay(now));
        const weekStart = new Date(startOfCampusDay(now) - (TREND_DAYS - 1) * 24 * 3600_000);

        const eventRepo = this.connection.getRepository(ctx, CampusTrackEvent);
        const errorRepo = this.connection.getRepository(ctx, CampusErrorReport);

        const [totalEvents, todayEvents, totalErrors, todayErrors, affectedUsers] = await Promise.all([
            eventRepo.count({ where: { channelId } as any }),
            eventRepo.count({ where: { channelId, createdAt: MoreThanOrEqual(dayStart) } as any }),
            errorRepo.count({ where: { channelId } as any }),
            errorRepo.count({ where: { channelId, createdAt: MoreThanOrEqual(dayStart) } as any }),
            eventRepo
                .createQueryBuilder('e')
                .select('COUNT(DISTINCT e.customerId)', 'cnt')
                .where('e.channelId = :channelId', { channelId })
                .andWhere('e.customerId IS NOT NULL')
                .andWhere('e.createdAt >= :dayStart', { dayStart })
                .getRawOne<{ cnt: string }>(),
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
            affectedUsers: Number(affectedUsers?.cnt ?? 0) || 0,
            trend: buildTrend(TREND_DAYS, now, eventDays, errorDays),
            topEvents: topRows,
        };
    }

    /** 埋点明细（后台排障用，按时间倒序）。 */
    async events(ctx: RequestContext, options: AdminListOptions) {
        const channelId = ctx.channelId as number;
        const repo = this.connection.getRepository(ctx, CampusTrackEvent);
        const where: any = { channelId };
        if (options.filter) where.eventName = options.filter;
        const [items, totalItems] = await repo.findAndCount({
            where,
            order: { createdAt: 'DESC' } as any,
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
    async errors(ctx: RequestContext, options: AdminListOptions) {
        const channelId = ctx.channelId as number;
        const repo = this.connection.getRepository(ctx, CampusErrorReport);
        const where: any = { channelId };
        if (options.filter) where.level = options.filter;
        const [items, totalItems] = await repo.findAndCount({
            where,
            order: { createdAt: 'DESC' } as any,
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
    private allowRate(key: string, limit: number, now = Date.now()): boolean {
        if (this.rateWindows.size >= RATE_MAP_MAX) this.pruneRateWindows(now);
        const w = this.rateWindows.get(key);
        if (!w || w.resetAt <= now) {
            this.rateWindows.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
            return true;
        }
        if (w.count >= limit) return false;
        w.count += 1;
        return true;
    }

    private pruneRateWindows(now: number): void {
        for (const [key, w] of this.rateWindows) {
            if (w.resetAt <= now) this.rateWindows.delete(key);
        }
    }

    /**
     * 每日写入预算（M2）：首次/每 60s 从 DB 对齐当日已入库行数，
     * 返回 false 时调用方丢弃本次写入（不抛错，避免端侧上报链路被限流错误打断）。
     */
    private async allowDailyBudget(
        ctx: RequestContext,
        kind: 'track' | 'error',
        limit: number,
        amount: number,
    ): Promise<boolean> {
        const channelId = ctx.channelId as number;
        const dayStart = startOfCampusDay(Date.now());
        const key = `${kind}:${channelId}:${dayStart}`;
        const now = Date.now();
        let b = this.dailyBudgets.get(key);
        if (!b) {
            if (this.dailyBudgets.size >= RATE_MAP_MAX) this.pruneDailyBudgets(dayStart);
            b = { dayStart, used: 0, refreshedAt: 0, warned: false };
            this.dailyBudgets.set(key, b);
        }
        if (now - b.refreshedAt >= BUDGET_REFRESH_MS) {
            const repo = this.connection.getRepository(ctx, kind === 'track' ? CampusTrackEvent : CampusErrorReport);
            const used = await repo.count({
                where: { channelId, createdAt: MoreThanOrEqual(new Date(dayStart)) } as any,
            });
            b.used = Math.max(b.used, used);
            b.refreshedAt = now;
        }
        if (b.used >= limit) {
            if (!b.warned) {
                b.warned = true;
                Logger.warn(
                    `渠道 ${channelId} 今日${kind === 'track' ? '埋点' : '错误上报'}已达上限 ${limit}，后续匿名写入将被丢弃`
                    + `（多实例按 60s 对齐独立计数，实际总量约为实例数×上限）`,
                    'TelemetryService',
                );
            }
            return false;
        }
        b.used += amount;
        return true;
    }

    private pruneDailyBudgets(dayStart: number): void {
        for (const [key, b] of this.dailyBudgets) {
            if (b.dayStart < dayStart) this.dailyBudgets.delete(key);
        }
    }

    /** 已登录顾客 id（游客返回 null）；失败不阻断上报。 */
    private async resolveCustomerId(ctx: RequestContext): Promise<number | null> {
        if (!ctx.activeUserId) return null;
        try {
            const customer = await this.connection.getRepository(ctx, Customer).findOne({
                where: { user: { id: ctx.activeUserId } } as any,
                relations: { user: true },
            } as any);
            return customer ? (customer.id as number) : null;
        } catch {
            return null;
        }
    }

    private async dayCounts(ctx: RequestContext, table: string, channelId: number, from: Date) {
        const manager = this.connection.getRepository(ctx, CampusTrackEvent).manager;
        // 口径说明（勿再叠加偏移）：campus_track_event / campus_error_report 的 createdAt 是
        // timestamptz（绝对时刻），SQL 里 +8 hours 只用于把绝对时刻落成北京自然日；
        // 传入的 from 也是绝对时刻，可直接比较。两处都不需要按 timestamp 的墙钟口径再换算。
        const raw = await manager.query(
            `SELECT to_char((("createdAt" + interval '8 hours')::date), 'YYYY-MM-DD') AS day, COUNT(*)::int AS cnt
             FROM ${table} WHERE "channelId" = $1 AND "createdAt" >= $2 GROUP BY 1`,
            [channelId, from],
        );
        const rows = (Array.isArray(raw) ? raw : (raw as any)?.rows) ?? [];
        return rowsToDayCounts(rows);
    }

    private async topEvents(ctx: RequestContext, channelId: number, from: Date) {
        const manager = this.connection.getRepository(ctx, CampusTrackEvent).manager;
        const raw = await manager.query(
            `SELECT "eventName" AS name, COUNT(*)::int AS cnt
             FROM campus_track_event WHERE "channelId" = $1 AND "createdAt" >= $2
             GROUP BY 1 ORDER BY cnt DESC LIMIT ${TOP_EVENTS}`,
            [channelId, from],
        );
        const rows = (Array.isArray(raw) ? raw : (raw as any)?.rows) ?? [];
        return rows.map((r: any) => ({ name: String(r?.name ?? ''), count: Number(r?.cnt ?? 0) || 0 }));
    }
}

/** 从请求上下文取 UA / IP（拿不到就留空，不影响入库）。 */
function requestMeta(ctx: RequestContext): { ua: string | null; ip: string | null } {
    const req: any = (ctx as any).req;
    const ua = req?.headers?.['user-agent'];
    const forwarded = req?.headers?.['x-forwarded-for'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split?.(',')?.[0] || req?.ip;
    return {
        ua: ua ? String(ua).slice(0, 255) : null,
        ip: ip ? String(ip).trim().slice(0, 64) : null,
    };
}
