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
var DispatchJobService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DispatchJobService = void 0;
exports.isFirstLegFulfilled = isFirstLegFulfilled;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const core_2 = require("@vendure/core");
const capacity_service_1 = require("./capacity.service");
const campus_dedupe_service_1 = require("./campus-dedupe.service");
const campus_fulfillment_config_entity_1 = require("./campus-fulfillment-config.entity");
const campus_notify_service_1 = require("./campus-notify.service");
const compensation_task_service_1 = require("./compensation-task.service");
const feishu_notify_service_1 = require("./feishu/feishu-notify.service");
const hall_grab_service_1 = require("./hall-grab.service");
const handover_code_1 = require("./handover-code");
const hall_service_1 = require("./hall.service");
const refund_payment_1 = require("./refund-payment");
const third_party_delivery_service_1 = require("./third-party-delivery.service");
const rider_credit_service_1 = require("./rider-credit.service");
const periodic_fallback_1 = require("./periodic-fallback");
const support_service_1 = require("./support.service");
const NOT_PICKED_TIMEOUT_MIN = 15;
/** 外部运单轮询对账间隔（防平台回调丢失）：每单 5min 一次主动查询 */
const EXTERNAL_SYNC_INTERVAL_MIN = 5;
/** 超时赔付扫描：仅处理近 24h 送达单，单轮上限防长事务 */
const TIMEOUT_COMPENSATION_WINDOW_H = 24;
const TIMEOUT_COMPENSATION_LIMIT = 200;
/** 赔付闸过期回收：认领后 15min 仍未写入券 id（发券后落库失败/进程中断）视为僵死认领，允许重新赔付 */
const TIMEOUT_COMPENSATION_CLAIM_STALE_MIN = 15;
// F6 单渠道单轮扫描上限：按各状态桶的计时锚升序截断（最老的最紧急），超限告警暴露积压
const SCAN_LIMIT = 200;
/** 预约单桶上限：预约单永远排在活单之后，积压时若与活单共享窗口会被长期饿死（放量/兜底不执行） */
const SCHEDULED_SCAN_LIMIT = 100;
/** 骑手轨迹保留天数（P8-4）：后台轨迹页按同一口径提示运营 */
const LOCATION_RETENTION_DAYS = 30;
/** 轨迹清理频率：每 6h 最多一次（DELETE 跨渠道，无需每轮都跑） */
const LOCATION_CLEANUP_INTERVAL_MS = 6 * 3600000;
/**
 * A4 方案二：第一段是否已履约（餐/包裹已到校园交接点）。
 * 判定依据（任一命中即为已履约，禁止再按「无人接单」整单自动退款）：
 * - `handoverAt`：第一段交接完成的权威时间，R1 商户/自营、R2 外部快递入厅时与 hallStatus='open' 同语句落库；
 * - `leg1Status='arrived_gate'`：R2 学生兜底确认（回调丢失时写入，历史数据可能缺 handoverAt）；
 * - `thirdPartyState='delivered'`：外部运单已送达交接点的原始事实（回调迟到/竞态导致 handoverAt 未落）。
 */
function isFirstLegFulfilled(cf) {
    var _a, _b;
    const handoverAt = cf === null || cf === void 0 ? void 0 : cf.handoverAt;
    if (handoverAt != null && String(handoverAt).trim() !== '')
        return true;
    if (String((_a = cf === null || cf === void 0 ? void 0 : cf.leg1Status) !== null && _a !== void 0 ? _a : '') === 'arrived_gate')
        return true;
    return String((_b = cf === null || cf === void 0 ? void 0 : cf.thirdPartyState) !== null && _b !== void 0 ? _b : '') === 'delivered';
}
/** 飞书/工单时间文案（校园时区 UTC+8，与后台报表同口径） */
const campusTimeText = (v) => {
    if (v == null || String(v).trim() === '')
        return '无';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '无' : d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
};
let DispatchJobService = DispatchJobService_1 = class DispatchJobService {
    constructor(connection, grab, hall, capacity, credit, moduleRef, thirdParty, feishu, notify, compensation, 
    /** R7：外部运单异常自动建工单（同插件服务，平台 ctx 可用） */
    support, 
    /** M4 跨实例去重/计数（多实例下告警限频与取消失败计数共享）；未注入退回进程内 Map */
    dedupe) {
        this.connection = connection;
        this.grab = grab;
        this.hall = hall;
        this.capacity = capacity;
        this.credit = credit;
        this.moduleRef = moduleRef;
        this.thirdParty = thirdParty;
        this.feishu = feishu;
        this.notify = notify;
        this.compensation = compensation;
        this.support = support;
        this.dedupe = dedupe;
        /** 统一兜底调度器（单飞 / unref / 优雅关闭由 PeriodicFallback 统一保证） */
        this.fallback = null;
        this.running = false;
        /** 超时赔付缺配置告警限频（避免每分钟刷日志） */
        this.compensationWarnAt = 0;
        /** 外部运单取消失败连续轮次（进程内，仅用于告警升级；不落库，多实例各自计数可接受） */
        this.externalCancelFails = new Map();
        /** 轨迹清理上次执行时间（跨渠道全局，每 6h 一次） */
        this.lastLocationCleanupAt = 0;
        /** §6 外部运单异常态告警去重 key（单号:外部运单号）→ 首次告警时间，状态恢复后移除 */
        this.externalExceptionAlertedAt = new Map();
    }
    /** 外部异常告警去重：按「单号:运单号」保留 24h（DB 去重表跨实例；无 dedupe 时退回进程内 Map） */
    async shouldAlertExternalException(key) {
        if (this.dedupe) {
            return !(await this.dedupe.seenOrMark(`dispatch:exception_alert:${key}`, DispatchJobService_1.EXTERNAL_EXCEPTION_ALERT_TTL_MS));
        }
        const now = Date.now();
        const at = this.externalExceptionAlertedAt.get(key);
        if (at != null) {
            if (now - at < DispatchJobService_1.EXTERNAL_EXCEPTION_ALERT_TTL_MS)
                return false;
            this.externalExceptionAlertedAt.delete(key);
        }
        this.externalExceptionAlertedAt.set(key, now);
        return true;
    }
    /** 取消失败计数 +1（多实例共享；返回连续失败轮次） */
    async bumpCancelFail(code) {
        var _a;
        const fail = (_a = this.externalCancelFails.get(code)) !== null && _a !== void 0 ? _a : { n: 0, alertedAt: 0 };
        fail.n += 1;
        this.externalCancelFails.set(code, fail);
        if (!this.dedupe)
            return fail.n;
        return this.dedupe.incr(`dispatch:cancel_fail:${code}`, 24 * 3600000);
    }
    /** 取消失败升级告警限频（30min；多实例共享） */
    async shouldAlertCancelFail(code, now) {
        if (this.dedupe) {
            return !(await this.dedupe.seenOrMark(`dispatch:cancel_alert:${code}`, 30 * 60000));
        }
        const fail = this.externalCancelFails.get(code);
        if (fail && now - fail.alertedAt <= 30 * 60000)
            return false;
        if (fail)
            fail.alertedAt = now;
        return true;
    }
    /** R7：外部运单异常建工单（幂等由 dedupeKey 保证）；建单失败不影响告警主流程 */
    async createExceptionTicket(ctx, input) {
        var _a;
        if (!this.support)
            return null;
        try {
            const res = await this.support.createSystemTicket(ctx, {
                dedupeKey: input.dedupeKey,
                orderCode: input.order.code,
                orderId: Number(input.order.id),
                category: 'delivery',
                source: 'third_party_exception',
                content: input.content,
                channelId: ctx.channelId,
            });
            return res.id;
        }
        catch (e) {
            core_2.Logger.warn(`订单 ${input.order.code} 外部异常建工单失败: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, 'CampusDispatch');
            return null;
        }
    }
    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项） */
    get injector() {
        return new core_2.Injector(this.moduleRef);
    }
    start(intervalMs = 60000) {
        if (this.fallback)
            return;
        this.fallback = new periodic_fallback_1.PeriodicFallback({ name: 'dispatch', intervalMs, loggerCtx: 'CampusDispatch' });
        this.fallback.start(() => this.tick());
    }
    onApplicationShutdown() {
        var _a;
        (_a = this.fallback) === null || _a === void 0 ? void 0 : _a.stop();
        this.fallback = null;
    }
    async tick() {
        if (this.running)
            return; // 上一轮未结束跳过
        this.running = true;
        try {
            // 扫描跨渠道：逐渠道配置构造真实 RequestContext（getRepository 仅接受 RequestContext 实例）
            const cfgs = await this.connection.rawConnection
                .getRepository(campus_fulfillment_config_entity_1.CampusFulfillmentConfig)
                .find();
            for (const cfg of cfgs) {
                await this.scanChannelWithLock(cfg.channelId);
            }
            await this.cleanupRiderLocations();
        }
        finally {
            this.running = false;
        }
    }
    /** 骑手轨迹过期清理（P8-4）：保留 30 天，避免位置表无限增长。失败只告警不影响调度。 */
    async cleanupRiderLocations() {
        var _a;
        if (Date.now() - this.lastLocationCleanupAt < LOCATION_CLEANUP_INTERVAL_MS)
            return;
        this.lastLocationCleanupAt = Date.now();
        try {
            await this.connection.rawConnection.query('DELETE FROM campus_rider_location WHERE "reportedAt" < now() - ($1 || \' days\')::interval', [String(LOCATION_RETENTION_DAYS)]);
        }
        catch (e) {
            core_2.Logger.warn(`rider location cleanup failed: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, 'CampusDispatch');
        }
    }
    /**
     * 按渠道加扫描锁：多实例幂等（pm2 多进程/多副本时同一渠道同一轮只允许一个实例扫描），
     * 同时把渠道间故障隔离——单渠道扫描抛错不再中断其余渠道（上一版全局锁整体串行，渠道多时
     * 一轮超 60s 会被 running 标志跳过，造成积压）。
     */
    async scanChannelWithLock(channelId) {
        var _a;
        const runner = this.connection.rawConnection.createQueryRunner();
        await runner.connect();
        const lockKey = `campus:dispatch:scan:${channelId}`;
        try {
            const got = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
            const rows = Array.isArray(got) && Array.isArray(got[0]) ? got[0] : got;
            if (!((_a = rows === null || rows === void 0 ? void 0 : rows[0]) === null || _a === void 0 ? void 0 : _a.ok))
                return;
            try {
                await this.scan(await this.ctxForChannel(channelId));
            }
            catch (e) {
                core_2.Logger.error(`dispatch scan failed for channel ${channelId}: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
            }
        }
        finally {
            try {
                await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
            }
            catch (_b) {
                // 释放失败交给连接回收兜底
            }
            await runner.release();
        }
    }
    async ctxForChannel(channelId) {
        var _a;
        // 必须查完整 Channel 实体（含 defaultTaxZone）：手工 new Channel({id}) 无 taxZone，
        // order-calculator 重算价时 taxZoneStrategy.determineTaxZone 返回 undefined → error.no-active-tax-zone
        const channel = (_a = (await this.connection.rawConnection.getRepository(core_2.Channel).findOne({
            where: { id: channelId },
            relations: ['defaultTaxZone'],
        }))) !== null && _a !== void 0 ? _a : new core_2.Channel({ id: channelId });
        return new core_2.RequestContext({
            apiType: 'admin',
            channel,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
    }
    /**
     * 扫描当前 ctx 渠道：
     * 1) assigned 超 15min 未取货 → 回大厅 + 骑手扣分
     * 2) open 超 autoAssignMinutes → 强派最佳在线骑手（T2）
     * （T4 退款扫描在 Task 8 追加到此方法）
     */
    async scan(ctx) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
        const repo = this.connection.getRepository(ctx, core_2.Order);
        // 积压策略：按状态分桶独立取数、独立限额，而不是全状态共享一个最老 200 窗口。
        // 旧实现里大量「刚进大厅、还没到强派/退款时间」的 open 单会占满窗口，
        // 同一渠道的 pending_merchant / third_party / exception 兜底与预约单放量全部被饿死，
        // 造成「越积压越卡死」。分桶后每个状态组都保证有扫描配额，且各组仍按紧急度锚点升序。
        const orders = [];
        const truncated = [];
        for (const bucket of DispatchJobService_1.SCAN_BUCKETS) {
            const rows = await repo.createQueryBuilder('order')
                .leftJoin('order.channels', 'channel')
                .where('channel.id = :ch', { ch: ctx.channelId })
                .andWhere('order.customFields.hallStatus IN (:...statuses)', { statuses: bucket.statuses })
                // 已取消单即使 hallStatus 未及时清也绝不参与扫描：所有兜底写都必须落在活单上
                .andWhere('order.state != :cancelled', { cancelled: 'Cancelled' })
                // 排序锚 = 该状态下真正计时的那一列：预约单看 scheduledFor（空值排后），
                // open 看入厅时间，在途单优先看接单时间（骑手取货/送达超时从 assignedAt 起算）。
                // 用 limit 而非 take：take + join 会走 TypeORM 的 distinct 性分页（子查询），
                // 该路径把表达式里的 "order" 当成别名解析导致整轮报错；本查询已按 channel 过滤不会重复行。
                // 预约单空值排后：nulls 必须走 orderBy 第三参数，拼进排序表达式会被二次追加 ASC 导致
                // `... ASC NULLS LAST ASC` 语法报错（生产 errorMissingColumn 之外的 syntax error at or near "ASC"）。
                .orderBy(bucket.orderBy, 'ASC', bucket.key === 'scheduled' ? 'NULLS LAST' : undefined)
                .limit(bucket.limit)
                .getMany();
            if (rows.length >= bucket.limit)
                truncated.push(`${bucket.key}(${bucket.limit})`);
            orders.push(...rows);
        }
        if (truncated.length) {
            core_2.Logger.warn(`channel ${ctx.channelId} dispatch backlog: ${truncated.join(',')} reached bucket limit, scan truncated (oldest-first per bucket)`, 'CampusDispatch');
            // 积压时年轻订单可能被 oldest-first 长期饿死，日志之外必须让运营看到
            void ((_a = this.feishu) === null || _a === void 0 ? void 0 : _a.pushEvent('alert', '调度扫描积压', `渠道 ${ctx.channelId} 在途订单分桶已达上限（${truncated.join('、')}），本轮只处理各桶最老订单，请及时增派运力/清理异常单。`, undefined, `dispatch_backlog:${ctx.channelId}`));
        }
        const now = Date.now();
        // P1 骑手超时提前告警阈值：兜底前 1.5min 先告警（原值 3min，缩短一倍）
        const notPickedAlertMs = Math.max(60000, Math.round((NOT_PICKED_TIMEOUT_MIN - 1.5) * 60000));
        // 1) assigned 超 15min 未取货 → 回大厅 + 扣分（逐单隔离：单笔异常不阻断本轮）
        for (const o of orders) {
            const cf = o.customFields;
            // P1 提前告警：骑手接了单迟迟不来取货（dedupe 5min 窗口）
            if (cf.hallStatus === 'grabbed' && cf.deliveryStatus === 'assigned' && cf.assignedAt) {
                const elapsed = now - new Date(cf.assignedAt).getTime();
                const alertMin = Math.round(notPickedAlertMs / 60000);
                if (elapsed >= notPickedAlertMs && elapsed <= NOT_PICKED_TIMEOUT_MIN * 60000) {
                    const mins = Math.round(elapsed / 60000);
                    const dedupeKey = `rider_pick_alert:${o.code}`;
                    void ((_b = this.feishu) === null || _b === void 0 ? void 0 : _b.pushEvent('alert', '⏱ 骑手取货超时', `订单 ${o.code} 骑手已抢单 ${mins} 分钟未取货，${NOT_PICKED_TIMEOUT_MIN} 分钟后将自动回大厅重派。`, o.code, dedupeKey));
                }
                if (elapsed > NOT_PICKED_TIMEOUT_MIN * 60000) {
                    try {
                        // 条件回厅：并发取消/送达时不得把终态单改回 open，也不应再扣骑手信用分
                        const back = await this.hall.backToHall(ctx, o.id);
                        if (!back)
                            continue;
                        // A3 责任区分：派单那一刻交接码就已过期 = 系统原因（历史单/旧流程码没重签），
                        // 骑手拿到的码本来就不可能用，回厅不扣骑手信用分；
                        // 只有在派单时码仍有效（A2 后 assignedAt=handoverCodeAt，必然有效）却 15min 未取餐，
                        // 才算骑手真超时，照常扣分。
                        const issuedAt = cf.handoverCodeAt ? new Date(cf.handoverCodeAt).getTime() : NaN;
                        const assignedAt = cf.assignedAt ? new Date(cf.assignedAt).getTime() : NaN;
                        const codeExpiredAtAssign = !!cf.handoverCode
                            && Number.isFinite(issuedAt) && Number.isFinite(assignedAt)
                            && assignedAt - issuedAt > handover_code_1.HANDOVER_CODE_TTL_MS;
                        if (codeExpiredAtAssign) {
                            core_2.Logger.warn(`Order ${o.code} back to hall without credit deduction: handover code already expired at assignment `
                                + `(issued ${Math.round((assignedAt - issuedAt) / 60000)}min before assignment)`, 'CampusDispatch');
                            void ((_c = this.feishu) === null || _c === void 0 ? void 0 : _c.pushEvent('alert', '骑手超时回厅（交接码过期/系统原因，未扣分）', `订单 ${o.code} 派单时交接码已过期（早于派单 ${Math.round((assignedAt - issuedAt) / 60000)} 分钟），`
                                + `已回抢单大厅重派，未扣骑手信用分，请核对派单链路。`, o.code, `handover_code_expired:${o.code}`));
                        }
                        else {
                            await this.credit.adjust(ctx, Number(cf.deliveryStaffId), rider_credit_service_1.CREDIT_TIMEOUT, 'timeout_not_picked', o.id);
                        }
                        core_2.Logger.warn(`Order ${o.code} reassigned (rider ${cf.deliveryStaffId} not picked in ${NOT_PICKED_TIMEOUT_MIN}min)`, 'CampusDispatch');
                        void ((_d = this.feishu) === null || _d === void 0 ? void 0 : _d.pushEvent('exception', '骑手取货超时自动回厅', `订单 ${o.code} 骑手 ${NOT_PICKED_TIMEOUT_MIN} 分钟未取货，已回抢单大厅。`, o.code, o.code));
                    }
                    catch (e) {
                        core_2.Logger.error(`not-picked timeout failed for order ${(_e = o.code) !== null && _e !== void 0 ? _e : o.id}: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
                    }
                }
            }
        }
        // 2) T2 强派（无在线骑手时跳过，不阻断 T4）
        const cfg = await this.connection
            .getRepository(ctx, campus_fulfillment_config_entity_1.CampusFulfillmentConfig)
            .findOne({ where: { channelId: ctx.channelId } });
        if (cfg) {
            // 0) 预约单放量（plan 3.1）：到 scheduledFor 前 30min 才进入商家确认/大厅
            const toRelease = orders.filter(o => {
                const cf = o.customFields;
                if (cf.hallStatus !== 'scheduled')
                    return false;
                const t = cf.scheduledFor ? new Date(cf.scheduledFor).getTime() : NaN;
                return !Number.isNaN(t) && t - now <= hall_service_1.HallService.SCHEDULE_RELEASE_MIN * 60000;
            });
            for (const o of toRelease) {
                try {
                    const released = await this.hall.releaseScheduled(ctx, o, cfg);
                    if (!released)
                        continue; // 并发下已不是 scheduled（取消/已放量），本轮跳过
                    // 内存同步防同轮 T2/T4 误处理：释放即离开 scheduled 态，入口统一按 releaseTarget 决定；
                    // 同时刷新 hallEnteredAt 作计时锚点（否则下游按 createdAt 判定，预约单一放量就被判超时）
                    const cf = o.customFields;
                    cf.hallStatus = hall_service_1.HallService.releaseTarget(cf, cfg);
                    cf.hallEnteredAt = new Date();
                }
                catch (e) {
                    core_2.Logger.error(`scheduled release failed for order ${(_f = o.code) !== null && _f !== void 0 ? _f : o.id}: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
                }
            }
            // scheduledFor 缺失/非法（改单清空、脏数据）：放量条件永远不成立，订单会永久停在 scheduled。
            // 直接转 open 让大厅兜底接手，并告警核对下单数据。
            const badScheduled = orders.filter(o => {
                const cf = o.customFields;
                if (cf.hallStatus !== 'scheduled')
                    return false;
                const t = cf.scheduledFor ? new Date(cf.scheduledFor).getTime() : NaN;
                return Number.isNaN(t);
            });
            for (const o of badScheduled) {
                try {
                    const enteredAt = new Date();
                    const moved = await this.hall.transitionFrom(ctx, Number(o.id), ['scheduled'], {
                        hallStatus: 'open',
                        hallEnteredAt: enteredAt,
                        campusCause: 'scheduled_missing_time',
                    });
                    if (!moved)
                        continue;
                    const cf = o.customFields;
                    cf.hallStatus = 'open';
                    cf.hallEnteredAt = enteredAt;
                    core_2.Logger.warn(`Order ${o.code} scheduled without valid scheduledFor → hall`, 'CampusDispatch');
                    void ((_g = this.feishu) === null || _g === void 0 ? void 0 : _g.pushEvent('alert', '预约时间缺失，已转入大厅', `订单 ${o.code} 缺少有效预约时间（scheduledFor=${String((_h = cf.scheduledFor) !== null && _h !== void 0 ? _h : '')}），已直接进入抢单大厅，请核对下单/改单数据。`, o.code, `scheduled_bad:${o.code}`));
                }
                catch (e) {
                    core_2.Logger.error(`bad scheduled release failed for order ${(_j = o.code) !== null && _j !== void 0 ? _j : o.id}: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
                }
            }
            // 路线兜底（R1/R2/R3）：商户接单超时转自营、送达超时回落大厅、外部快递推送/接单超时
            await this.sweepRouteTimeouts(ctx, cfg, orders, now);
            // 异常上报超时未处置：自动回大厅重派，避免卡死在 exception
            await this.sweepExceptionTimeout(ctx, cfg, orders, now);
            // 骑手已取货却久不送达：先告警，超 2×SLA 转异常单（餐在骑手手上，不能直接回厅）
            await this.sweepRiderInProgress(ctx, cfg, orders, now);
            // 超时赔付：送达超承诺 → 自动发定向券（开关默认开，缺券模板时限频告警）
            await this.sweepTimeoutCompensation(ctx, cfg, now);
            // 骑手信用自动恢复：7 天没 timeout 扣分的骑手 credit<100 时 +5 分
            try {
                await this.credit.sweepRecovery(ctx);
            }
            catch (e) {
                core_2.Logger.warn(`credit recovery sweep failed channel=${cfg.channelId}: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
            }
            // 商家确认模式卡单兜底：待接单/备餐中超 merchantAutoOpenMinutes 自动入厅
            // （跳过商家确认，campusCause 留痕；计时锚 hallEnteredAt：预约单 createdAt 可能早于放量数小时）
            // 注意：兜底只看 hallStatus，不受 merchantConfirmEnabled 影响——运营关掉开关后，
            // 存量 pending_merchant/accepted 单否则会失去唯一出口（不退款、不入厅、不告警）。
            {
                const merchantStale = orders.filter(o => {
                    var _a;
                    const cf = o.customFields;
                    return (cf.hallStatus === 'pending_merchant' || cf.hallStatus === 'accepted')
                        && now - this.enteredMs(o) > ((_a = cfg.merchantAutoOpenMinutes) !== null && _a !== void 0 ? _a : 15) * 60000;
                });
                for (const o of merchantStale) {
                    try {
                        const enteredAt = new Date();
                        const moved = await this.hall.transitionFrom(ctx, Number(o.id), ['pending_merchant', 'accepted'], {
                            hallStatus: 'open',
                            hallEnteredAt: enteredAt,
                            // 履约快照必须同步切换：否则 R1 单仍带着 merchant/to_campus_rider 进入抢单大厅，
                            // C 端承运方展示、改址重推判定都会按旧计划走（与规则 1b/2 的兜底写法保持一致）
                            deliveryPlan: 'campus_rider',
                            handoverMode: '',
                            campusCause: 'merchant_timeout',
                        });
                        if (!moved)
                            continue; // 期间已被商家接单/取消
                        core_2.Logger.warn(`Order ${o.code} auto-opened (merchant not responding)`, 'CampusDispatch');
                        const cf = o.customFields;
                        cf.hallStatus = 'open';
                        cf.hallEnteredAt = enteredAt; // 同步锚点，避免同轮 T2 按旧锚点立即强派
                        cf.deliveryPlan = 'campus_rider';
                        cf.handoverMode = '';
                    }
                    catch (e) {
                        core_2.Logger.error(`merchant stale auto-open failed for order ${(_k = o.code) !== null && _k !== void 0 ? _k : o.id}: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
                    }
                }
            }
            // T1.5 多单顺路打包（plan 3.3）：同楼栋+同时段 open 配送单写同一 routeGroupId，
            // 后续 T2 强派逐单派给同一骑手天然同车；骑手抢单由 HallGrabService.grab 整组接走。
            await this.packRoutes(ctx, orders);
            const riders = await this.capacity.listOnlineRiders(ctx);
            const eligible = riders
                .filter(r => { var _a; return ((_a = r.customFields.riderCredit) !== null && _a !== void 0 ? _a : 100) >= rider_credit_service_1.CREDIT_LIMIT; })
                .sort((a, b) => {
                var _a, _b;
                const ca = (_a = a.customFields.riderCredit) !== null && _a !== void 0 ? _a : 100;
                const cb = (_b = b.customFields.riderCredit) !== null && _b !== void 0 ? _b : 100;
                if (cb !== ca)
                    return cb - ca; // 信用分高者优先
                const ta = new Date(a.customFields.riderOnlineAt).getTime();
                const tb = new Date(b.customFields.riderOnlineAt).getTime();
                return tb - ta; // 最近活跃优先
            });
            if (eligible.length) {
                // 在途负载：同一骑手已持有的配送中订单数（T2 轮转派单，避免所有超时单全塞给信用最高的一人）
                const load = new Map();
                for (const o of orders) {
                    const cf = o.customFields;
                    const rid = Number((_l = cf.deliveryStaffId) !== null && _l !== void 0 ? _l : NaN);
                    if (!Number.isFinite(rid) || !rid)
                        continue;
                    const active = ['assigned', 'in_progress'].includes(String((_m = cf.deliveryStatus) !== null && _m !== void 0 ? _m : ''))
                        || ['grabbed', 'owned_dispatched'].includes(String((_o = cf.hallStatus) !== null && _o !== void 0 ? _o : ''));
                    if (!active)
                        continue;
                    load.set(rid, ((_p = load.get(rid)) !== null && _p !== void 0 ? _p : 0) + 1);
                }
                const pickRider = () => {
                    var _a, _b;
                    // eligible 已按「信用分高→最近活跃」排序：仅负载严格更低时才换人，平局保持原优先级
                    let best = eligible[0];
                    let bestLoad = (_a = load.get(Number(best.id))) !== null && _a !== void 0 ? _a : 0;
                    for (const r of eligible) {
                        const l = (_b = load.get(Number(r.id))) !== null && _b !== void 0 ? _b : 0;
                        if (l < bestLoad) {
                            best = r;
                            bestLoad = l;
                        }
                    }
                    return best;
                };
                const stale = orders.filter(o => {
                    var _a;
                    const cf = o.customFields;
                    // 历史/外部写入可能缺 hallEnteredAt：回退 createdAt（UTC 墙钟，需还原），否则这类 open 单永不强派
                    return cf.hallStatus === 'open' && this.orderInChannel(o, cfg)
                        && now - this.enteredMs(o) > ((_a = cfg.autoAssignMinutes) !== null && _a !== void 0 ? _a : 10) * 60000;
                }).sort((a, b) => this.enteredMs(a) - this.enteredMs(b));
                for (const o of stale) {
                    try {
                        const rider = pickRider();
                        const ok = await this.grab.grabByRider(ctx, o.id, rider);
                        if (ok) {
                            load.set(Number(rider.id), ((_q = load.get(Number(rider.id))) !== null && _q !== void 0 ? _q : 0) + 1);
                            core_2.Logger.warn(`Order ${o.code} auto-assigned to rider ${rider.id} (T2)`, 'CampusDispatch');
                        }
                        // 无论成败，该单已离开 open 大厅（成功→grabbed；失败→已被抢/已退款），
                        // 内存标记防止同轮 T4 对已派单误退款（grabByRider 事务内有二次校验兜底）。
                        o.customFields.hallStatus = 'grabbed';
                    }
                    catch (e) {
                        core_2.Logger.error(`T2 auto-assign failed for order ${(_r = o.code) !== null && _r !== void 0 ? _r : o.id}: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
                    }
                }
            }
            // 3) T4: open 超 autoRefundMinutes 无人接 → 自动退款终态（降级阶梯最后一级）
            const staleFinal = orders.filter(o => {
                var _a;
                const cf = o.customFields;
                // 同上：缺 hallEnteredAt 的历史单回退 createdAt（UTC 墙钟，需还原），否则永不自动退款
                return cf.hallStatus === 'open'
                    && now - this.enteredMs(o) > ((_a = cfg.autoRefundMinutes) !== null && _a !== void 0 ? _a : 30) * 60000;
            });
            for (const o of staleFinal) {
                try {
                    await this.refundNoRider(ctx, o, cfg);
                }
                catch (e) {
                    core_2.Logger.error(`T4 auto-refund failed for order ${(_s = o.code) !== null && _s !== void 0 ? _s : o.id}: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
                }
            }
        }
    }
    /**
     * 异常上报超时升级（改人工介入）：异常单超 SLA 未处置时**不再自动回大厅**，
     * 保持异常标记与状态不变，只发升级告警进人工介入队列（调度墙 exception 列表），
     * 避免「餐可能仍在骑手手上」被系统自动重派造成丢餐。
     * 告警 dedupe 按订单 code 收敛，重复轮询不会重复刷屏。
     */
    async sweepExceptionTimeout(ctx, cfg, orders, now) {
        var _a, _b, _c, _d, _e, _f, _g;
        const slaMs = ((_a = cfg.inProgressSlaMinutes) !== null && _a !== void 0 ? _a : 45) * 60000;
        // P1 提前告警：兜底前 1/6 时间点（原值 1/3，缩短一倍；默认 7.5min 先推群）
        const alertMs = Math.max(30000, Math.floor(slaMs / 6));
        for (const o of orders) {
            const cf = o.customFields;
            if (cf.deliveryStatus !== 'exception')
                continue;
            const at = cf.exceptionReportedAt ? new Date(cf.exceptionReportedAt).getTime() : NaN;
            if (Number.isNaN(at))
                continue;
            // P1 提前告警：异常已上报但还没到人工介入升级时间（dedupe 5min 窗口）
            if (now - at >= alertMs && now - at < slaMs) {
                const mins = Math.round((now - at) / 60000);
                const dedupeKey = `exception_alert:${o.code}`;
                void ((_b = this.feishu) === null || _b === void 0 ? void 0 : _b.pushEvent('alert', '🚨 异常待处置', `订单 ${o.code} 异常上报 ${mins} 分钟未处置（${(_c = cf.exceptionType) !== null && _c !== void 0 ? _c : '未知类型'}），${(_d = cfg.inProgressSlaMinutes) !== null && _d !== void 0 ? _d : 45} 分钟后升级人工介入。`, o.code, dedupeKey));
            }
            if (now - at < slaMs)
                continue;
            // 到点只升级告警，不改状态、不回大厅（人工介入队列 = 调度墙 exception 列表）
            // dedupe：按 30 分钟分桶，同一异常单每半小时最多再提醒一次
            const bucket = Math.floor((now - at) / (30 * 60000));
            void ((_e = this.feishu) === null || _e === void 0 ? void 0 : _e.pushEvent('exception', '异常超时待人工介入', `订单 ${o.code} 异常上报 ${(_f = cfg.inProgressSlaMinutes) !== null && _f !== void 0 ? _f : 45} 分钟未处置（${(_g = cf.exceptionType) !== null && _g !== void 0 ? _g : '未知类型'}），系统不再自动回厅，请运营人工介入。`, o.code, `exception_manual:${o.code}:${bucket}`));
        }
    }
    /**
     * 骑手已取餐（in_progress）超 SLA 兜底（改人工介入）：已取餐意味着餐在骑手手上，
     * 15 分钟回收与 2×SLA 自动转异常一律禁用——只告警，状态全程不变，等运营人工介入。
     * 时钟只认 pickedUpAt（缺失退回 assignedAt），缺失时跳过，绝不回退 createdAt。
     */
    async sweepRiderInProgress(ctx, cfg, orders, now) {
        var _a, _b, _c, _d, _e;
        const slaMs = ((_a = cfg.inProgressSlaMinutes) !== null && _a !== void 0 ? _a : 45) * 60000;
        for (const o of orders) {
            const cf = o.customFields;
            if (cf.deliveryStatus !== 'in_progress')
                continue;
            const anchor = (_b = cf.pickedUpAt) !== null && _b !== void 0 ? _b : cf.assignedAt;
            const at = anchor ? new Date(anchor).getTime() : NaN;
            if (Number.isNaN(at))
                continue;
            const elapsed = now - at;
            if (elapsed < slaMs)
                continue;
            const mins = Math.round(elapsed / 60000);
            if (elapsed < slaMs * 2) {
                void ((_c = this.feishu) === null || _c === void 0 ? void 0 : _c.pushEvent('alert', '🚴 配送超 SLA', `订单 ${o.code} 骑手已取餐 ${mins} 分钟未送达（SLA ${(_d = cfg.inProgressSlaMinutes) !== null && _d !== void 0 ? _d : 45} 分钟），请及时联系骑手。`, o.code, `rider_sla:${o.code}`));
                continue;
            }
            // 超 2×SLA：只升级人工介入告警，不改 deliveryStatus / hallStatus（不再自动转异常）
            // dedupe：按 30 分钟分桶，同一订单每半小时最多再提醒一次，避免每个 tick 刷屏
            const bucket = Math.floor(elapsed / (30 * 60000));
            core_2.Logger.warn(`Order ${o.code} rider in_progress over 2×SLA → manual intervention (state kept)`, 'CampusDispatch');
            void ((_e = this.feishu) === null || _e === void 0 ? void 0 : _e.pushEvent('exception', '骑手配送超时待人工介入', `订单 ${o.code} 骑手已取餐 ${mins} 分钟未送达（超 2×SLA），系统不再自动改派，请运营人工介入。`, o.code, `rider_manual:${o.code}:${bucket}`));
        }
    }
    /**
     * 路线超时兜底：
     * 1) R1 pending_merchant 超 merchantAcceptMinutes → 转自营快递池（owned_pool，等人接单）
     * 2) merchant_delivering 超 merchantAutoOpenMinutes → 回抢单大厅（传信者到档口取餐）
     * 3) pending_dispatch 超 externalPushTimeoutMinutes → 回抢单大厅
     * 4) third_party 超 externalFallbackMinutes → 取消外部快递；R2 回待推送换一家，R3 回大厅
     *    （平台已接单/取货不按该阈值取消，仅 3× 硬上限兜底）
     * 5) owned_pool 超 merchantAutoOpenMinutes 无人接 → 回大厅
     * 6) owned_dispatched 超 merchantAutoOpenMinutes 未送达交接点 → 回大厅并清空骑手
     */
    async sweepRouteTimeouts(ctx, cfg, orders, now) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22;
        const minutes = (v, def) => (v !== null && v !== void 0 ? v : def) * 60000;
        const acceptMs = minutes(cfg.merchantAcceptMinutes, 5);
        const deliverMs = minutes(cfg.merchantAutoOpenMinutes, 15);
        const pushMs = minutes(cfg.externalPushTimeoutMinutes, 10);
        const fallbackMs = minutes(cfg.externalFallbackMinutes, 20);
        // P1 告警阈值：兜底前 1min 先告警（原值 2min，缩短一倍）
        const merchantAlertMs = acceptMs > 0 ? Math.max(30000, acceptMs - 60000) : 0;
        for (const o of orders) {
            const cf = o.customFields;
            const route = String((_a = cf.fulfillmentRoute) !== null && _a !== void 0 ? _a : '');
            // 逐单隔离：单笔规则异常（DB/外部网关）只跳过该单，不阻断同轮其余订单兜底
            try {
                const enteredAt = this.enteredMs(o);
                // P1 提前告警：商家即将超时但还没兜底（dedupe 5min 窗口防刷屏）
                if (cf.hallStatus === 'pending_merchant' && (route === 'R1' || route === 'R2')
                    && merchantAlertMs > 0 && acceptMs > 0
                    && now - enteredAt >= merchantAlertMs && now - enteredAt < acceptMs) {
                    const mins = Math.round((now - enteredAt) / 60000);
                    const dedupeKey = `accept_alert:${o.code}`;
                    void ((_b = this.feishu) === null || _b === void 0 ? void 0 : _b.pushEvent('alert', '⚠️ 商家即将超时', `订单 ${o.code} 入厅 ${mins} 分钟，商家 ${(_c = cfg.merchantAcceptMinutes) !== null && _c !== void 0 ? _c : 5} 分钟内未接单将自动${route === 'R1' ? '转自营快递' : '回大厅'}。`, o.code, dedupeKey));
                }
                // 1) 商户接单超时 → R1 转自营快递；R2 降级传信者到店取餐直送（外部快递无餐可取，不能推）
                //    计时锚 hallEnteredAt：预约单 createdAt 可能早于放量数小时，必须从放量/入厅时刻起算
                if (cf.hallStatus === 'pending_merchant' && (route === 'R1' || route === 'R2') && acceptMs > 0
                    && now - enteredAt > acceptMs) {
                    if (route === 'R1') {
                        // 转自营快递池，而不是 owned_dispatched：后者语义为「已指派某骑手」，
                        // acceptOwned/pickupOwned 均以 deliveryStatus='assigned' 为前提；
                        // 此处尚无骑手，写 owned_dispatched 会让接单与取餐两个接口全部拒绝。
                        // hallEnteredAt 是自营池无人接单的计时锚点（不可沿用 createdAt，否则下一轮立即判超时）。
                        // 同时清空骑手指派/取餐残留，避免旧值让取餐判断错。
                        const enteredAt = new Date();
                        const moved = await this.hall.transitionFrom(ctx, Number(o.id), ['pending_merchant'], {
                            hallStatus: 'owned_pool',
                            hallEnteredAt: enteredAt,
                            deliveryPlan: 'owned',
                            deliveryStaffId: null,
                            deliveryStatus: null,
                            assignedAt: null,
                            pickedUpAt: null,
                            campusCause: 'merchant_accept_timeout',
                        });
                        if (!moved)
                            continue;
                        core_2.Logger.warn(`Order ${o.code} merchant accept timeout → owned pool`, 'CampusDispatch');
                        void ((_d = this.feishu) === null || _d === void 0 ? void 0 : _d.pushEvent('exception', '商户接单超时（转自营）', `订单 ${o.code} 商户 ${(_e = cfg.merchantAcceptMinutes) !== null && _e !== void 0 ? _e : 5} 分钟未接单，已转自营快递池等待骑手接单。`, o.code, o.code));
                        cf.hallStatus = 'owned_pool';
                        cf.hallEnteredAt = enteredAt;
                        cf.deliveryPlan = 'owned';
                    }
                    else {
                        const moved = await this.hall.transitionFrom(ctx, Number(o.id), ['pending_merchant'], {
                            hallStatus: 'open',
                            hallEnteredAt: new Date(),
                            deliveryPlan: 'campus_rider',
                            handoverMode: '',
                            campusCause: 'merchant_accept_timeout',
                        });
                        if (!moved)
                            continue;
                        core_2.Logger.warn(`Order ${o.code} merchant accept timeout (R2) → hall`, 'CampusDispatch');
                        void ((_f = this.feishu) === null || _f === void 0 ? void 0 : _f.pushEvent('exception', '商户接单超时（回大厅）', `订单 ${o.code} 商户 ${(_g = cfg.merchantAcceptMinutes) !== null && _g !== void 0 ? _g : 5} 分钟未接单，已回抢单大厅。`, o.code, o.code));
                        cf.hallStatus = 'open';
                        cf.deliveryPlan = 'campus_rider';
                        cf.hallEnteredAt = new Date();
                    }
                    continue;
                }
                // 1b) 已接单但久未出餐（出餐闸门卡住）→ 降级传信者到店取餐直送。
                //     R1/R2 都要兜底：R1 若只依赖上面的 merchantConfirmEnabled 开关块，渠道关闭确认模式后
                //     遗留 accepted 单会永久卡死（不退款、不进墙、不告警）。
                if (cf.hallStatus === 'accepted' && (route === 'R1' || route === 'R2')
                    && now - this.enteredMs(o) > deliverMs) {
                    const moved = await this.hall.transitionFrom(ctx, Number(o.id), ['accepted'], {
                        hallStatus: 'open',
                        hallEnteredAt: new Date(),
                        deliveryPlan: 'campus_rider',
                        handoverMode: '',
                        campusCause: 'merchant_cooking_timeout',
                    });
                    if (!moved)
                        continue;
                    core_2.Logger.warn(`Order ${o.code} ${route} cooking timeout → hall`, 'CampusDispatch');
                    void ((_h = this.feishu) === null || _h === void 0 ? void 0 : _h.pushEvent('exception', '商户出餐超时', `订单 ${o.code} 商户 ${(_j = cfg.merchantAutoOpenMinutes) !== null && _j !== void 0 ? _j : 15} 分钟未出餐（${route}），已回抢单大厅。`, o.code, o.code));
                    cf.hallStatus = 'open';
                    cf.deliveryPlan = 'campus_rider';
                    cf.handoverMode = '';
                    cf.hallEnteredAt = new Date();
                    continue;
                }
                // 2) 商户久未送达交接点 → 回大厅（传信者到档口取餐直送）
                if (cf.hallStatus === 'merchant_delivering' && cf.assignedAt
                    && now - new Date(cf.assignedAt).getTime() > deliverMs) {
                    const enteredAt = new Date();
                    const moved = await this.hall.transitionFrom(ctx, Number(o.id), ['merchant_delivering'], {
                        hallStatus: 'open',
                        hallEnteredAt: enteredAt,
                        deliveryPlan: 'campus_rider',
                        handoverMode: '',
                        campusCause: 'merchant_deliver_timeout',
                    });
                    if (!moved)
                        continue;
                    core_2.Logger.warn(`Order ${o.code} merchant deliver timeout → hall`, 'CampusDispatch');
                    void ((_k = this.feishu) === null || _k === void 0 ? void 0 : _k.pushEvent('exception', '商户送达交接点超时', `订单 ${o.code} 商户 ${(_l = cfg.merchantAutoOpenMinutes) !== null && _l !== void 0 ? _l : 15} 分钟未送达交接点，已回抢单大厅。`, o.code, o.code));
                    (_m = this.notify) === null || _m === void 0 ? void 0 : _m.user(ctx, Number(o.id), 'deliveryFallback', '超时转传信者配送', (_o = cfg.h5BaseUrl) !== null && _o !== void 0 ? _o : undefined);
                    cf.hallStatus = 'open';
                    cf.hallEnteredAt = enteredAt;
                    continue;
                }
                // 3) 迟迟未推送外部快递 → 回大厅（R2 出餐闸门后从出餐时刻计时，避免把备餐时间算进超时）
                //    计时锚取「接单/出餐」与「最近一次推送/回落」中较晚者：旧实现优先 assignedAt，
                //    R2 超时回落后重推时仍沿用出餐时刻，下一轮立刻再判超时，“换一家重推”窗口形同虚设。
                const pushAnchor = Math.max(cf.assignedAt ? new Date(cf.assignedAt).getTime() : 0, cf.thirdPartyDispatchAt ? new Date(cf.thirdPartyDispatchAt).getTime() : 0, cf.hallEnteredAt ? new Date(cf.hallEnteredAt).getTime() : 0, this.createdMs(o));
                if (cf.hallStatus === 'pending_dispatch' && now - pushAnchor > pushMs) {
                    const enteredAt = new Date();
                    const moved = await this.hall.transitionFrom(ctx, Number(o.id), ['pending_dispatch'], {
                        hallStatus: 'open',
                        hallEnteredAt: enteredAt,
                        deliveryPlan: 'campus_rider',
                        handoverMode: '',
                        campusCause: 'external_push_timeout',
                    });
                    if (!moved)
                        continue;
                    core_2.Logger.warn(`Order ${o.code} external push timeout → hall`, 'CampusDispatch');
                    void ((_p = this.feishu) === null || _p === void 0 ? void 0 : _p.pushEvent('exception', '外部快递推送超时', `订单 ${o.code} ${(_q = cfg.externalPushTimeoutMinutes) !== null && _q !== void 0 ? _q : 10} 分钟未推送外部快递，已回抢单大厅。`, o.code, o.code));
                    (_r = this.notify) === null || _r === void 0 ? void 0 : _r.user(ctx, Number(o.id), 'deliveryFallback', '超时转传信者配送', (_s = cfg.h5BaseUrl) !== null && _s !== void 0 ? _s : undefined);
                    cf.hallStatus = 'open';
                    cf.hallEnteredAt = enteredAt;
                    continue;
                }
                // 4) 已推送但久未接单/取货 → 取消并回落。
                //    平台已接单/取货（accepted/pickup）不按 fallbackMs 取消，避免把在途骑手干掉；
                //    但仍设 3×fallbackMs 硬上限，防止「接单后永不送达」永久占用。
                const tpState = String((_t = cf.thirdPartyState) !== null && _t !== void 0 ? _t : '');
                // 离开 third_party 后清理取消失败计数，避免 Map 随历史单增长
                if (cf.hallStatus !== 'third_party') {
                    this.externalCancelFails.delete(o.code);
                    await ((_u = this.dedupe) === null || _u === void 0 ? void 0 : _u.del(`dispatch:cancel_fail:${o.code}`));
                }
                const inDelivery = tpState === 'accepted' || tpState === 'pickup';
                // §6 异常态（平台判定运力失败/拒收/破损等）：同样不等待，先告警 + 通知顾客，再由下方 tpStale 取消回落。
                // 去重键带外部运单号：回落重推后新运单异常会再次告警。
                const exceptionKey = `${o.code}:${String((_v = cf.thirdPartyNo) !== null && _v !== void 0 ? _v : '')}`;
                // R7：工单关闭后回写 exceptionResolvedAt → 同一异常不再重复告警/建单
                const exceptionResolved = !!cf.exceptionResolvedAt;
                if (tpState !== 'exception') {
                    this.externalExceptionAlertedAt.delete(exceptionKey);
                    await ((_w = this.dedupe) === null || _w === void 0 ? void 0 : _w.del(`dispatch:exception_alert:${exceptionKey}`));
                }
                else if (!exceptionResolved
                    && cf.hallStatus === 'third_party'
                    && (await this.shouldAlertExternalException(exceptionKey))) {
                    core_2.Logger.warn(`Order ${o.code} external courier exception (${String((_x = cf.thirdPartyNo) !== null && _x !== void 0 ? _x : '-')})`, 'CampusDispatch');
                    const ticketId = await this.createExceptionTicket(ctx, {
                        dedupeKey: `third_party:${exceptionKey}`,
                        order: o,
                        cf,
                        content: `外部运单异常：平台 ${String((_y = cf.thirdPartyProvider) !== null && _y !== void 0 ? _y : '-')}，运单 ${String((_z = cf.thirdPartyNo) !== null && _z !== void 0 ? _z : '-')}，订单卡在 third_party。请核实运单状态与外部平台沟通，处置后关闭本工单。`,
                    });
                    void ((_0 = this.feishu) === null || _0 === void 0 ? void 0 : _0.pushEvent('exception', '外部运单异常', `订单 ${o.code} 外部运单${cf.thirdPartyNo ? ` ${cf.thirdPartyNo}` : ''} 状态异常，${ticketId ? `已建工单 #${ticketId}` : '请尽快人工核实'}；超时将自动取消并回落。`, o.code, `${o.code}:external_exception`));
                    (_1 = this.notify) === null || _1 === void 0 ? void 0 : _1.user(ctx, Number(o.id), 'deliveryFallback', '运力异常，重新派送', (_2 = cfg.h5BaseUrl) !== null && _2 !== void 0 ? _2 : undefined);
                }
                const tpElapsed = cf.thirdPartyDispatchAt
                    ? now - new Date(cf.thirdPartyDispatchAt).getTime()
                    : 0;
                const tpStale = cf.thirdPartyDispatchAt
                    && ((!inDelivery && tpElapsed > fallbackMs) || tpElapsed > fallbackMs * 3);
                // P1 提前告警：外部快递在途超 fallbackMs-2.5min 仍无有效状态 → 推群（原值 5min，缩短一倍）
                const tpAlertMs = cf.thirdPartyDispatchAt ? Math.max(30000, fallbackMs - Math.round(2.5 * 60000)) : 0;
                if (cf.hallStatus === 'third_party' && tpAlertMs > 0 && tpElapsed >= tpAlertMs && tpElapsed < fallbackMs) {
                    const mins = Math.round(tpElapsed / 60000);
                    const dedupeKey = `third_party_alert:${o.code}`;
                    void ((_3 = this.feishu) === null || _3 === void 0 ? void 0 : _3.pushEvent('alert', '📦 外部快递在途超时', `订单 ${o.code} 外部快递已在途 ${mins} 分钟（状态：${tpState || '未知'}），${(_4 = cfg.externalFallbackMinutes) !== null && _4 !== void 0 ? _4 : 20} 分钟后将自动回落。`, o.code, dedupeKey));
                }
                if (cf.hallStatus === 'third_party' && tpStale) {
                    // 取消失败绝不回落/重推：外部运单仍有效，回落后再推会产生双运单双份运费。
                    // 保持 third_party 留痕并下轮重试取消，直到平台确认取消。
                    let cancelOk = true;
                    // 无外部网关：没有需要取消的运单，本地直接回落
                    let skipped = !this.thirdParty;
                    if (this.thirdParty) {
                        try {
                            const res = await this.thirdParty.cancel(ctx, Number(o.id), 'external fallback timeout');
                            cancelOk = !!(res === null || res === void 0 ? void 0 : res.ok);
                            skipped = !!(res === null || res === void 0 ? void 0 : res.skipped);
                        }
                        catch (e) {
                            cancelOk = false;
                            core_2.Logger.error(`Order ${o.code} cancel external failed: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
                        }
                    }
                    if (!cancelOk) {
                        const failN = await this.bumpCancelFail(o.code);
                        await this.hall.transitionFrom(ctx, Number(o.id), ['third_party'], {
                            campusCause: 'external_cancel_failed',
                        });
                        core_2.Logger.error(`Order ${o.code} external cancel not confirmed; stay third_party and retry (no fallback to avoid duplicate delivery)`, 'CampusDispatch');
                        // 连续 3 轮仍未确认取消：升级飞书异常（30min 限频），绝不自动回落（会双运单双份运费）
                        if (failN >= 3 && (await this.shouldAlertCancelFail(o.code, now))) {
                            const ticketId = !exceptionResolved
                                ? await this.createExceptionTicket(ctx, {
                                    dedupeKey: `third_party_cancel:${exceptionKey}`,
                                    order: o,
                                    cf,
                                    content: `外部运单取消失败：平台 ${String((_5 = cf.thirdPartyProvider) !== null && _5 !== void 0 ? _5 : '-')}，运单 ${String((_6 = cf.thirdPartyNo) !== null && _6 !== void 0 ? _6 : '-')}，连续 ${failN} 轮取消未确认。订单保持 third_party 不回落（防双运单双份运费），请人工核实平台运单状态后关闭本工单。`,
                                })
                                : null;
                            void ((_7 = this.feishu) === null || _7 === void 0 ? void 0 : _7.pushEvent('exception', '外部运单取消失败', `订单 ${o.code} 外部运单连续 ${failN} 轮取消未确认（${String((_8 = cf.thirdPartyNo) !== null && _8 !== void 0 ? _8 : '-')}），已保持 third_party 不回落；${ticketId ? `已建工单 #${ticketId}` : '请人工核实平台运单状态'}。`, o.code, `${o.code}:cancel_failed`));
                        }
                        continue;
                    }
                    this.externalCancelFails.delete(o.code);
                    await ((_9 = this.dedupe) === null || _9 === void 0 ? void 0 : _9.del(`dispatch:cancel_fail:${o.code}`));
                    // cancel() 成功时内部已按路线回写本地状态（R2 待推送 / R3 大厅）；未推送（skipped）时本地补写
                    if (skipped) {
                        const patch = route === 'R2'
                            ? { hallStatus: 'pending_dispatch', thirdPartyDispatchAt: new Date(), thirdPartyState: 'cancelled', campusCause: 'external_fallback' }
                            : { hallStatus: 'open', hallEnteredAt: new Date(), deliveryPlan: 'campus_rider', handoverMode: '', thirdPartyState: 'cancelled', campusCause: 'external_fallback' };
                        await this.hall.transitionFrom(ctx, Number(o.id), ['third_party'], patch);
                    }
                    if (route === 'R2') {
                        cf.hallStatus = 'pending_dispatch';
                        cf.thirdPartyDispatchAt = new Date();
                    }
                    else {
                        cf.hallStatus = 'open';
                        cf.hallEnteredAt = new Date();
                    }
                    cf.thirdPartyState = 'cancelled';
                    core_2.Logger.warn(`Order ${o.code} external fallback (${route})`, 'CampusDispatch');
                    void ((_10 = this.feishu) === null || _10 === void 0 ? void 0 : _10.pushEvent('exception', '外部快递超时回落', `订单 ${o.code} 外部快递 ${(_11 = cfg.externalFallbackMinutes) !== null && _11 !== void 0 ? _11 : 20} 分钟未接单/取货，已回落（${route}）。`, o.code, `${o.code}:fallback`));
                }
                // 5) 自营快递池久无人接单 → 回抢单大厅（传信者兜底）
                if (cf.hallStatus === 'owned_pool'
                    && now - this.enteredMs(o) > deliverMs) {
                    const enteredAt = new Date();
                    const moved = await this.hall.transitionFrom(ctx, Number(o.id), ['owned_pool'], {
                        hallStatus: 'open',
                        hallEnteredAt: enteredAt,
                        deliveryPlan: 'campus_rider',
                        handoverMode: '',
                        campusCause: 'owned_pool_timeout',
                    });
                    if (!moved)
                        continue;
                    core_2.Logger.warn(`Order ${o.code} owned pool timeout → hall`, 'CampusDispatch');
                    void ((_12 = this.feishu) === null || _12 === void 0 ? void 0 : _12.pushEvent('exception', '自营快递无人接单', `订单 ${o.code} 自营快递池 ${(_13 = cfg.merchantAutoOpenMinutes) !== null && _13 !== void 0 ? _13 : 15} 分钟无人接单，已回抢单大厅。`, o.code, o.code));
                    (_14 = this.notify) === null || _14 === void 0 ? void 0 : _14.user(ctx, Number(o.id), 'deliveryFallback', '超时转传信者配送', (_15 = cfg.h5BaseUrl) !== null && _15 !== void 0 ? _15 : undefined);
                    cf.hallStatus = 'open';
                    cf.hallEnteredAt = enteredAt;
                    continue;
                }
                // 6) 自营快递已派出但久未送达交接点 → 回抢单大厅（已取餐在途单除外：只告警、不回收）
                if (cf.hallStatus === 'owned_dispatched' && cf.assignedAt
                    && String((_16 = cf.deliveryStatus) !== null && _16 !== void 0 ? _16 : '') !== 'in_progress'
                    && now - new Date(cf.assignedAt).getTime() > deliverMs) {
                    const enteredAt = new Date();
                    const moved = await this.hall.transitionFrom(ctx, Number(o.id), ['owned_dispatched'], {
                        hallStatus: 'open',
                        hallEnteredAt: enteredAt,
                        deliveryPlan: 'campus_rider',
                        handoverMode: '',
                        deliveryStaffId: null,
                        deliveryStatus: null,
                        assignedAt: null,
                        campusCause: 'owned_deliver_timeout',
                    });
                    if (!moved)
                        continue;
                    core_2.Logger.warn(`Order ${o.code} owned courier timeout → hall`, 'CampusDispatch');
                    void ((_17 = this.feishu) === null || _17 === void 0 ? void 0 : _17.pushEvent('exception', '自营快递送达超时', `订单 ${o.code} 自营快递 ${(_18 = cfg.merchantAutoOpenMinutes) !== null && _18 !== void 0 ? _18 : 15} 分钟未送达交接点，已回抢单大厅。`, o.code, o.code));
                    (_19 = this.notify) === null || _19 === void 0 ? void 0 : _19.user(ctx, Number(o.id), 'deliveryFallback', '超时转传信者配送', (_20 = cfg.h5BaseUrl) !== null && _20 !== void 0 ? _20 : undefined);
                    cf.hallStatus = 'open';
                    cf.hallEnteredAt = enteredAt;
                }
                // 7) 外部运单轮询对账（防平台回调丢失）：third_party 在途单每 5min 主动查询一次
                if (cf.hallStatus === 'third_party' && cf.thirdPartyDeliveryOrderId && this.thirdParty) {
                    const lastSync = cf.thirdPartySyncAt ? new Date(cf.thirdPartySyncAt).getTime() : 0;
                    if (now - lastSync > EXTERNAL_SYNC_INTERVAL_MIN * 60000) {
                        cf.thirdPartySyncAt = new Date();
                        await this.hall.updateOrder(ctx, o.id, {
                            customFields: { thirdPartySyncAt: cf.thirdPartySyncAt },
                        });
                        try {
                            const res = await this.thirdParty.syncStatus(ctx, Number(o.id));
                            // 网关可能返回未知状态串，只接受回调状态机定义的枚举
                            const syncable = ['pending', 'accepted', 'pickup', 'delivered', 'cancelled', 'exception'];
                            if ((res === null || res === void 0 ? void 0 : res.state) && syncable.includes(res.state)) {
                                // 对账命中的状态必须落库（复用回调同一套幂等/条件写/入厅逻辑）：
                                // 旧实现只改内存，回调丢失时订单在 DB 里永远停在 third_party，
                                // 超时后会把已送达的运单取消并重派（重复配送）。
                                cf.thirdPartyState = res.state;
                                await this.thirdParty.onDeliveryStatus(ctx, {
                                    orderId: Number(o.id),
                                    thirdPartyNo: String((_21 = cf.thirdPartyNo) !== null && _21 !== void 0 ? _21 : ''),
                                    status: res.state,
                                });
                                core_2.Logger.info(`Order ${o.code} external status synced → ${res.state}`, 'CampusDispatch');
                            }
                        }
                        catch (e) {
                            core_2.Logger.warn(`Order ${o.code} external status sync failed: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
                        }
                    }
                }
            }
            catch (e) {
                core_2.Logger.error(`route timeout sweep failed for order ${(_22 = o.code) !== null && _22 !== void 0 ? _22 : o.id}: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
            }
        }
    }
    /**
     * 超时赔付（P0）：回扫窗口内（默认近 24h，可配）已送达单，实际送达超出承诺时间 + 宽限 → 自动发定向券。
     * 幂等：timeoutCompensatedAt 作闸，已赔单不再扫；发券失败不落痕，下一轮重试。
     * 归因（粗判）：无骑手承接 = platform；接单前耗时 > 骑手在途 = merchant，否则 rider。
     */
    async sweepTimeoutCompensation(ctx, cfg, now) {
        var _a, _b, _c;
        if (!cfg.timeoutCompensationEnabled)
            return;
        // 回扫窗口可配（默认 24h），钳制 1-168 防脏配置把陈年旧单批量补赔
        const windowH = Math.min(168, Math.max(1, Number((_a = cfg.timeoutCompensationWindowHours) !== null && _a !== void 0 ? _a : TIMEOUT_COMPENSATION_WINDOW_H)));
        const since = new Date(now - windowH * 3600000);
        const repo = this.connection.getRepository(ctx, core_2.Order);
        // 赔付闸过期回收：已认领但券 id 一直为空（落库失败/进程中断）的单，超过阈值视为僵死认领可重新赔付，
        // 否则该单永久漏赔
        const staleBefore = new Date(now - TIMEOUT_COMPENSATION_CLAIM_STALE_MIN * 60000);
        let rows;
        try {
            rows = await repo.createQueryBuilder('order')
                .leftJoin('order.channels', 'channel')
                .where('channel.id = :ch', { ch: ctx.channelId })
                .andWhere('order.customFields.deliveredAt IS NOT NULL')
                .andWhere('order.customFields.deliveredAt >= :since', { since })
                .andWhere('order.customFields.promisedAt IS NOT NULL')
                .andWhere('(order.customFields.timeoutCompensatedAt IS NULL '
                + 'OR (order.customFields.timeoutCompensationCouponId IS NULL '
                + 'AND order.customFields.timeoutCompensatedAt < :staleBefore))', { staleBefore })
                .andWhere('order.state != :cancelled', { cancelled: 'Cancelled' })
                // 已全额退款的订单不再赔付（退款单 state 未必是 Cancelled：先退后取消/部分流程）
                .andWhere(`NOT EXISTS (
                    SELECT 1 FROM "payment" p
                    WHERE p."orderId" = "order"."id"
                      AND COALESCE((SELECT SUM(r.total) FROM "refund" r WHERE r."paymentId" = p.id), 0) >= p.amount
                )`)
                .take(TIMEOUT_COMPENSATION_LIMIT)
                .getMany();
        }
        catch (e) {
            core_2.Logger.warn(`timeout compensation query failed: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
            return;
        }
        if (!rows.length)
            return;
        const grace = (_b = cfg.timeoutGraceMinutes) !== null && _b !== void 0 ? _b : 10;
        const templateId = cfg.timeoutCompensationCouponTemplateId;
        // 开关开但未配券模板：不写闸（保留待赔资格），限频告警等运营补配置
        if (!templateId) {
            if (now - this.compensationWarnAt > 10 * 60000) {
                this.compensationWarnAt = now;
                core_2.Logger.warn(`timeout compensation enabled but no coupon template for channel ${cfg.channelId}; ${rows.length} order(s) pending`, 'CampusDispatch');
            }
            return;
        }
        const { coupon } = this.services();
        for (const o of rows) {
            try {
                const cf = o.customFields;
                const deliveredMs = new Date(cf.deliveredAt).getTime();
                const promisedMs = new Date(cf.promisedAt).getTime();
                const lateMin = Math.floor((deliveredMs - promisedMs) / 60000);
                if (lateMin <= grace)
                    continue;
                // 先抢赔付闸（CAS）：发券与写闸合并为「先认领后发券」，部署重启/并发扫描不会重复发券。
                // 认领失败说明已被其他轮次赔付（或正赔付中），本轮跳过。
                // 过期回收：券 id 为空且认领时间早于 staleBefore 的僵死认领允许重新抢闸（见上方 staleBefore 注释）
                const claimedAt = new Date();
                const claimed = await this.connection.rawConnection.query('UPDATE "order" SET "customFieldsTimeoutcompensatedat" = $1 '
                    + 'WHERE id = $2 AND ("customFieldsTimeoutcompensatedat" IS NULL '
                    + 'OR ("customFieldsTimeoutcompensationcouponid" IS NULL '
                    + 'AND "customFieldsTimeoutcompensatedat" < $3)) RETURNING id', [claimedAt, o.id, staleBefore]);
                const claimedRows = Array.isArray(claimed) && Array.isArray(claimed[0]) ? claimed[0] : claimed;
                if (!Array.isArray(claimedRows) || !claimedRows.length)
                    continue;
                const releaseClaim = () => this.connection.rawConnection.query('UPDATE "order" SET "customFieldsTimeoutcompensatedat" = NULL '
                    + 'WHERE id = $1 AND "customFieldsTimeoutcompensatedat" = $2', [o.id, claimedAt]).catch(() => undefined);
                let couponId = '';
                if (o.customerId && coupon) {
                    try {
                        const ids = await coupon.grantCoupon(ctx, templateId, [o.customerId]);
                        couponId = (ids === null || ids === void 0 ? void 0 : ids[0]) ? String(ids[0]) : '';
                    }
                    catch (e) {
                        // 发券失败释放闸，下轮重试（模板配错等需人工修配置）
                        await releaseClaim();
                        core_2.Logger.error(`timeout compensation coupon failed for ${o.code}: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
                        continue;
                    }
                    // 空券等价于未发（端口返回空数组不抛错）：必须放闸，否则写个空 couponId 把闸占死、永久漏赔
                    if (!couponId) {
                        await releaseClaim();
                        core_2.Logger.warn(`timeout compensation coupon returned empty for ${o.code} (template ${templateId}), released claim for retry`, 'CampusDispatch');
                        continue;
                    }
                }
                else {
                    await releaseClaim();
                    core_2.Logger.warn(`timeout compensation skipped for ${o.code}: coupon service/customer unavailable (channel ${cfg.channelId})`, 'CampusDispatch');
                    continue;
                }
                await this.hall.updateOrder(ctx, o.id, {
                    customFields: {
                        timeoutCompensationCouponId: couponId,
                        timeoutLateMinutes: lateMin,
                        timeoutAttribution: this.timeoutAttribution(o),
                    },
                });
                core_2.Logger.warn(`Order ${o.code} timeout compensation: late ${lateMin}min, attribute=${this.timeoutAttribution(o)}, coupon=${couponId || 'none'}`, 'CampusDispatch');
            }
            catch (e) {
                // 逐单隔离：单笔赔付异常（DB/券端口）只跳过该单，不阻断本轮其余订单赔付
                core_2.Logger.error(`timeout compensation failed for order ${(_c = o.code) !== null && _c !== void 0 ? _c : o.id}: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
            }
        }
    }
    /**
     * 订单创建时间（绝对毫秒）。
     * order.createdAt 是 timestamp + DB DEFAULT now()，库里存 UTC 墙钟，必须还原；
     * customFields 里的各类锚点（hallEnteredAt/assignedAt/deliveredAt 等）是 timestamptz，可直接用。
     */
    createdMs(o) {
        return o.createdAt ? new Date(o.createdAt).getTime() : NaN;
    }
    /**
     * 入厅计时锚（绝对毫秒）：hallEnteredAt 是 timestamptz，直接用；
     * 历史/外部写入缺锚时回退 order.createdAt（DB now() 的 UTC 墙钟，需还原）。
     */
    enteredMs(o) {
        const cf = o.customFields;
        return cf.hallEnteredAt ? new Date(cf.hallEnteredAt).getTime() : this.createdMs(o);
    }
    /** 超时归因粗判：无骑手承接=platform；接单前耗时更长=merchant，否则=rider */
    timeoutAttribution(order) {
        const cf = order.customFields;
        const deliveredMs = new Date(cf.deliveredAt).getTime();
        if (!cf.assignedAt)
            return 'platform';
        const assignedMs = new Date(cf.assignedAt).getTime();
        const preAssignMs = assignedMs - this.createdMs(order);
        return preAssignMs > deliveredMs - assignedMs ? 'merchant' : 'rider';
    }
    /**
     * T1.5 多单顺路打包（plan 3.3）：同渠道 hallStatus='open' 的 R1/R3 配送单
     * （errand 跑腿单性质不同不打包）按「同楼栋 + 同时段」分桶：
     * - 有 deliverySlotId：slot 相等即同时段；
     * - 即时单：按 hallEnteredAt 聚类，相邻时间差 ≤ ROUTE_IMM_WINDOW_MIN 分钟归一批。
     * 每批 ≥2 单写同一 routeGroupId（批内已有组 id 则复用，保持组稳定不抖动）。
     * 组 id 仅用于整组抢单与展示聚合，不严格维护成员一致性——子单被抢/回厅/退款后
     * 自然脱组（回厅清指派字段，成员过滤以 hallStatus='open' 为准）。
     */
    async packRoutes(ctx, orders) {
        var _a, _b, _c;
        const deliverable = orders.filter(o => {
            const cf = o.customFields;
            return cf.hallStatus === 'open'
                && (cf.fulfillmentRoute === 'R1' || cf.fulfillmentRoute === 'R3');
        });
        if (deliverable.length < 2)
            return;
        // 分桶：buildingId + slotKey
        const buckets = new Map();
        for (const o of deliverable) {
            const cf = o.customFields;
            const key = `${(_a = cf.buildingId) !== null && _a !== void 0 ? _a : ''}|${(_b = cf.deliverySlotId) !== null && _b !== void 0 ? _b : 'imm'}`;
            const arr = (_c = buckets.get(key)) !== null && _c !== void 0 ? _c : [];
            arr.push(o);
            buckets.set(key, arr);
        }
        const groups = [];
        for (const [key, arr] of buckets) {
            if (!key.endsWith('|imm')) {
                if (arr.length >= 2)
                    groups.push(arr);
                continue;
            }
            // 即时单：按入厅时间聚类（升序，相邻差超窗口即断批）
            const entered = (o) => this.enteredMs(o);
            const sorted = [...arr].sort((a, b) => entered(a) - entered(b));
            let cluster = [];
            for (const o of sorted) {
                if (cluster.length
                    && entered(o) - entered(cluster[cluster.length - 1])
                        > DispatchJobService_1.ROUTE_IMM_WINDOW_MIN * 60000) {
                    if (cluster.length >= 2)
                        groups.push(cluster);
                    cluster = [];
                }
                cluster.push(o);
            }
            if (cluster.length >= 2)
                groups.push(cluster);
        }
        for (const g of groups) {
            const existing = g
                .map(o => o.customFields.routeGroupId)
                .find(Boolean);
            const gid = existing !== null && existing !== void 0 ? existing : `rg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const todo = g.filter(o => o.customFields.routeGroupId !== gid);
            if (!todo.length)
                continue;
            // 条件写（P2-9）：仅对仍在大厅且未取消的单写组 id，避免把并发下已抢/已取消单写回 open 口径的聚合组
            const res = await this.connection.rawConnection.query('UPDATE "order" SET "customFieldsRoutegroupid" = $1 '
                + 'WHERE id = ANY($2::int[]) AND "customFieldsHallstatus" = $3 '
                + `AND "state" <> 'Cancelled' RETURNING id`, [gid, todo.map(o => Number(o.id)), 'open']);
            const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
            const hit = new Set((Array.isArray(rows) ? rows : []).map((r) => Number(r.id)));
            for (const o of todo) {
                if (hit.has(Number(o.id)))
                    o.customFields.routeGroupId = gid;
            }
            if (!hit.size)
                continue;
            core_2.Logger.info(`Route packed: ${gid} (${hit.size}/${g.length} orders, buildings=${[...new Set(g.map(o => o.customFields.buildingId))].join('/')})`, 'CampusDispatch');
        }
    }
    /** 订单渠道匹配：channels 关联未加载（无 scalar channelId 可比对）时视为匹配，
     * grabByRider 事务内二次校验 hallStatus 保证幂等，跨渠道重复尝试无害。 */
    orderInChannel(o, cfg) {
        const channels = o.channels;
        return !(channels === null || channels === void 0 ? void 0 : channels.length) || channels.some(c => c.id != null && String(c.id) === String(cfg.channelId));
    }
    /** T4 惰性服务解析（job 定时器首跳早于完整依赖可用，首次退款时才初始化） */
    services() {
        var _a;
        if (!this.orderSvc) {
            this.orderSvc = this.injector.get(core_2.OrderService);
            this.couponSvc = this.tryGetCouponService();
        }
        return { order: this.orderSvc, coupon: (_a = this.couponSvc) !== null && _a !== void 0 ? _a : null };
    }
    /** 补偿券服务：coupon-plugin 为可选依赖，动态 require + Injector 解析，
     * 未安装/未启用/解析失败一律返回 null（跳过发券，不阻断退款主流程）。 */
    tryGetCouponService() {
        var _a;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require('@vendure/coupon-plugin');
            if (mod === null || mod === void 0 ? void 0 : mod.CouponService)
                return (_a = this.injector.get(mod.CouponService)) !== null && _a !== void 0 ? _a : null;
        }
        catch (_b) {
            // coupon-plugin 未安装或未启用
        }
        return null;
    }
    /**
     * A4 方案二：第一段已履约但第二段无人接单 → **不自动退款**，按 A9 同通道转人工（飞书告警 + 系统工单）。
     * - 状态写 `no_rider_manual`：不在 ACTIVE_HALL_STATUSES / 扫描桶内，退出自动履约；
     *   也**不写 refund_failed**，避免 A9 退款重试 job 把已履约单再次抓去退款。
     * - 条件写（仅 open）：与抢单/取消并发时只有一方成功，幂等且不会把已派单的单改成人工态。
     * - 工单/告警失败不抛出，仅 Logger 留痕（状态已是人工态，调度墙会持续暴露）。
     */
    async escalateFirstLegNoRider(ctx, order, cf, cfg) {
        var _a, _b, _c, _d, _e, _f, _g;
        const moved = await this.hall.transitionFrom(ctx, Number(order.id), ['open'], {
            hallStatus: 'no_rider_manual',
            campusCause: 'first_leg_no_rider',
        });
        if (!moved)
            return; // 等锁期间已被抢单/取消：不进人工队列
        // 应付金额：与 A9 升级口径一致（成功支付合计），查询失败不影响告警
        let paid = 0;
        try {
            const rows = await this.connection.rawConnection.query(`SELECT COALESCE(SUM(amount), 0) AS paid FROM payment
                  WHERE "orderId" = $1 AND state IN ('Settled', 'Authorized')`, [Number(order.id)]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            paid = Number((_b = (_a = list === null || list === void 0 ? void 0 : list[0]) === null || _a === void 0 ? void 0 : _a.paid) !== null && _b !== void 0 ? _b : 0);
        }
        catch (e) {
            core_2.Logger.warn(`A4 应付金额核算失败 order=${order.code}: ${String((_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e)}`, 'CampusDispatch');
        }
        const enteredMs = cf.hallEnteredAt ? new Date(cf.hallEnteredAt).getTime() : NaN;
        const waitedMin = Number.isNaN(enteredMs) ? null : Math.max(0, Math.round((Date.now() - enteredMs) / 60000));
        const detail = [
            `订单：${order.code}`,
            `应付：${(paid / 100).toFixed(2)} 元（${paid} 分）`,
            `第一段交接：${campusTimeText(cf.handoverAt)}`,
            `第二段入厅：${campusTimeText(cf.hallEnteredAt)}`,
            `无人接单：${waitedMin == null ? '未知' : `${waitedMin} 分钟`}（阈值 ${(_d = cfg.autoRefundMinutes) !== null && _d !== void 0 ? _d : 30} 分钟）`,
            '第一段已履约，系统不自动退款，请人工决定退款/重派/补偿',
        ].join('；');
        let ticketId = null;
        if (this.support) {
            try {
                const ticket = await this.support.createSystemTicket(ctx, {
                    dedupeKey: `first_leg_no_rider:${order.code}`,
                    orderCode: order.code,
                    orderId: Number(order.id),
                    category: 'refund',
                    source: 'first_leg_no_rider',
                    content: detail,
                    channelId: ctx.channelId,
                });
                ticketId = (_e = ticket === null || ticket === void 0 ? void 0 : ticket.id) !== null && _e !== void 0 ? _e : null;
            }
            catch (e) {
                core_2.Logger.error(`A4 转人工建工单失败 order=${order.code}: ${String((_f = e === null || e === void 0 ? void 0 : e.message) !== null && _f !== void 0 ? _f : e)}`, 'CampusDispatch');
            }
        }
        void ((_g = this.feishu) === null || _g === void 0 ? void 0 : _g.pushEvent('exception', '第一段已履约但无人接单，转人工', `${detail}${ticketId ? `；工单 ${ticketId}` : '；工单创建失败，请在调度台认领'}`, order.code, `first_leg_no_rider:${order.code}`));
        core_2.Logger.warn(`Order ${order.code} first leg fulfilled, no rider ${waitedMin !== null && waitedMin !== void 0 ? waitedMin : '?'}min → manual (no auto refund)`, 'CampusDispatch');
    }
    /**
     * T4: open 超 autoRefundMinutes 无人接单 → 全额原路退款 + Cancelled + no_rider 对账标记 + 定向补偿券。
     * 本 fork 无 core RefundService，退款走 OrderService.refundOrder/settleRefund（与 after-sales 插件同源）。
     * 失败降级：同样写 campusCause='no_rider' + hallStatus='no_rider_final' 留人工，Logger 留痕，不抛出。
     */
    async refundNoRider(ctx, order, cfg) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        const mark = () => this.hall.updateOrder(ctx, order.id, {
            customFields: { campusCause: 'no_rider', hallStatus: 'no_rider_final' },
        });
        // 多实例/与商家拒单并发：咨询锁按订单串行化退款，抢不到说明另一路正在处理，本轮跳过
        const runner = this.connection.rawConnection.createQueryRunner();
        await runner.connect();
        const lockKey = `campus:refund:${order.id}`;
        // 退款是否已真实发生（catch 里区分「退款失败」与「已退款仅取消失败」）
        let refundedAny = false;
        // 第一段已履约（锁内复查结论）：catch 里禁止写 refund_failed，否则会被 A9 重试 job 退款
        let firstLegFulfilled = false;
        try {
            const got = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
            const rows = Array.isArray(got) && Array.isArray(got[0]) ? got[0] : got;
            if (!((_a = rows === null || rows === void 0 ? void 0 : rows[0]) === null || _a === void 0 ? void 0 : _a.ok))
                return;
            try {
                // 锁内复查：排队等锁期间订单可能已被抢单/商家改派/用户取消，
                // 对已离开 open 的单退款会造成「已派单又退款」；hallEnteredAt 被刷新的单也需重新计时
                const fresh = await this.connection.getRepository(ctx, core_2.Order).findOne({
                    where: { id: order.id },
                });
                const fcf = ((_b = fresh === null || fresh === void 0 ? void 0 : fresh.customFields) !== null && _b !== void 0 ? _b : {});
                if (String((_c = fcf.hallStatus) !== null && _c !== void 0 ? _c : '') !== 'open')
                    return;
                const enteredMs = fcf.hallEnteredAt ? new Date(fcf.hallEnteredAt).getTime() : NaN;
                if (!Number.isNaN(enteredMs)
                    && Date.now() - enteredMs <= ((_d = cfg.autoRefundMinutes) !== null && _d !== void 0 ? _d : 30) * 60000)
                    return;
                // A4 方案二：第一段已履约（餐/包裹已到交接点）→ 不自动整单退款，转人工。
                // 该判定必须在创建任何退款之前、且用锁内 fresh 数据：handoverAt 与「入厅」是同一语句落库，
                // 因此不存在「先退款、后才发现已履约」——扫描快照里没有 handoverAt 而锁内 fresh 有，
                // 说明第一段在本轮等锁期间已完成，此时退款会退掉商户/快递已履约的单。
                if (isFirstLegFulfilled(fcf)) {
                    firstLegFulfilled = true;
                    // 转人工本身失败也不能落到退款分支：保持 open，下一轮重新转人工
                    try {
                        await this.escalateFirstLegNoRider(ctx, order, fcf, cfg);
                    }
                    catch (e) {
                        core_2.Logger.error(`A4 第一段已履约转人工失败 order=${order.code}: ${String((_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e)}`, 'CampusDispatch');
                    }
                    return;
                }
                const { order: orderSvc, coupon } = this.services();
                // 只退成功支付且仍有余额的支付单（避免选中 Declined/Error 重试单；已全额退则列表为空）
                const refundable = await (0, refund_payment_1.refundablePayments)(this.connection, Number(order.id));
                for (const picked of refundable) {
                    const created = await (0, refund_payment_1.createOrderRefund)(orderSvc, ctx, {
                        orderId: order.id,
                        paymentId: picked.payment.id,
                        amount: picked.remaining,
                        // fork 的 refund 表 shipping/adjustment 列 NOT NULL，非 COD 路径由 helper 显式给 0；
                        // 全额退款经 amount 通道
                        reason: `no_rider auto refund (${order.code})`,
                        paymentMethod: picked.payment.method,
                    });
                    if (!created || created instanceof Error || created.errorCode) {
                        throw new Error(`refundOrder failed: ${(_g = (_f = created === null || created === void 0 ? void 0 : created.errorCode) !== null && _f !== void 0 ? _f : created === null || created === void 0 ? void 0 : created.message) !== null && _g !== void 0 ? _g : 'no result'}`);
                    }
                    await (0, refund_payment_1.settleRefundOrMarkFailed)(this.connection, orderSvc, ctx, created.id);
                    refundedAny = true;
                }
                // 用 cancelOrder 而非 transitionToState(Cancelled)：默认 checkAllItemsBeforeCancel 要求
                // 订单行先取消，cancelOrder 内部完成行取消+状态转换；transitionToState 会静默返回 ErrorResult
                let cancelled = await orderSvc.cancelOrder(ctx, {
                    orderId: order.id,
                    reason: `no_rider auto cancel (${order.code})`,
                });
                // 钱已退时取消失败会让「已退款单」继续处于 Processing，重试一次再降级告警
                if (cancelled && cancelled.errorCode) {
                    cancelled = await orderSvc.cancelOrder(ctx, {
                        orderId: order.id,
                        reason: `no_rider auto cancel retry (${order.code})`,
                    });
                }
                if (cancelled && cancelled.errorCode) {
                    throw new Error(`cancelOrder failed: ${cancelled.errorCode}`);
                }
                await mark();
                const templateId = cfg.compensationCouponTemplateId;
                if (templateId && order.customerId && coupon) {
                    try {
                        await coupon.grantCoupon(ctx, templateId, [order.customerId]);
                    }
                    catch (e) {
                        // 退款/取消已成功，发券失败不能算「退款失败」：订单已是终态，券不能静默丢失
                        core_2.Logger.error(`T4 compensation coupon failed for order ${order.code}: ${(_h = e === null || e === void 0 ? void 0 : e.message) !== null && _h !== void 0 ? _h : e}`, 'CampusDispatch');
                        if (this.compensation && order.customerId) {
                            // R2：先持久化补偿任务由定时任务退避重试；耗尽才告警（避免只有一条易漏的飞书消息）
                            void this.compensation.enqueueCoupon({
                                orderId: Number(order.id),
                                channelId: Number(ctx.channelId),
                                customerId: Number(order.customerId),
                                templateId: String(templateId),
                                orderCode: order.code,
                            });
                        }
                        else {
                            void ((_j = this.feishu) === null || _j === void 0 ? void 0 : _j.pushEvent('alert', '无人接单补偿券发放失败', `订单 ${order.code} 已自动退款，但补偿券（模板 ${templateId}）发放失败，请人工补发。原因：${(_k = e === null || e === void 0 ? void 0 : e.message) !== null && _k !== void 0 ? _k : e}`, order.code, `compensation_coupon_failed:${order.code}`));
                        }
                    }
                }
                core_2.Logger.warn(`Order ${order.code} auto-refunded (no rider within ${(_l = cfg.autoRefundMinutes) !== null && _l !== void 0 ? _l : 30}min)`, 'CampusDispatch');
            }
            catch (e) {
                core_2.Logger.error(`T4 refund failed for order ${order.code}: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusDispatch');
                // 第一段已履约的单绝不写 refund_failed：那是 A9 退款重试 job 的入口，
                // 写进去等于让重试任务把已履约单自动整单退掉。保持 open，下一轮重新走转人工。
                if (firstLegFulfilled)
                    return;
                // 退款失败绝不能写 no_rider_final：那是终态，调度墙/大厅/商家台会一起跳过，
                // 已付款未送达的单会静默消失。改为独立的 refund_failed 状态退出自动重试，
                // 由调度墙按告警暴露给运营人工退款/取消（条件写在取消竞态下不复活已取消单）。
                try {
                    const marked = await this.hall.transitionFrom(ctx, Number(order.id), ['open'], {
                        hallStatus: 'refund_failed',
                        campusCause: 'refund_failed',
                    });
                    if (marked) {
                        // 已退款但取消失败：只需人工/重试取消，绝不能再退一次
                        const title = refundedAny ? '已退款但取消失败' : '无人接单自动退款失败';
                        const detail = refundedAny
                            ? `订单 ${order.code} 已全额退款，但订单取消失败（仍为 Processing），请人工取消订单，勿重复退款。原因：${(_m = e === null || e === void 0 ? void 0 : e.message) !== null && _m !== void 0 ? _m : e}`
                            : `订单 ${order.code} 超时无骑手且自动退款失败，请人工退款/取消。原因：${(_o = e === null || e === void 0 ? void 0 : e.message) !== null && _o !== void 0 ? _o : e}`;
                        void ((_p = this.feishu) === null || _p === void 0 ? void 0 : _p.pushEvent('exception', title, detail, order.code, `refund_failed:${order.code}`));
                    }
                }
                catch (e2) {
                    core_2.Logger.error(`T4 refund_failed mark failed for order ${order.code}: ${e2 === null || e2 === void 0 ? void 0 : e2.message}`, 'CampusDispatch');
                }
            }
        }
        finally {
            try {
                await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
            }
            catch (_q) {
                // 释放失败交给连接回收兜底
            }
            await runner.release();
        }
    }
};
exports.DispatchJobService = DispatchJobService;
/** 外部异常告警去重 TTL（进程内幂等，pm2 单实例足够；多实例需换 Redis/DB） */
DispatchJobService.EXTERNAL_EXCEPTION_ALERT_TTL_MS = 24 * 3600000;
/**
 * 扫描分桶（P2 积压策略）：状态互斥、各自限额，保证任何单一状态爆量都不会挤掉其它状态的兜底。
 * - open：量最大，T2 强派 / T4 退款；
 * - scheduled：预约单必须独立配额，否则永远排在活单之后拿不到放量；
 * - inflight：已接单/待商家/外部快递/自营，负责取货超时、异常 SLA、外部对账。
 */
DispatchJobService.SCAN_BUCKETS = [
    {
        key: 'open',
        statuses: ['open'],
        limit: SCAN_LIMIT,
        // 列已归一为 timestamptz：createdAt 与 hallEnteredAt 同为绝对时刻，可直接 COALESCE
        orderBy: "COALESCE(order.customFields.hallEnteredAt, order.createdAt)",
    },
    { key: 'scheduled', statuses: ['scheduled'], limit: SCHEDULED_SCAN_LIMIT, orderBy: 'order.customFields.scheduledFor' },
    {
        key: 'inflight',
        statuses: ['grabbed', 'pending_merchant', 'accepted', 'pending_dispatch', 'third_party', 'owned_pool', 'owned_dispatched', 'merchant_delivering'],
        limit: SCAN_LIMIT,
        orderBy: "COALESCE(order.customFields.assignedAt, order.customFields.hallEnteredAt, order.createdAt)",
    },
];
/** 即时单（无 deliverySlotId）打包时间窗：入厅时间差 ≤10min 视为顺路 */
DispatchJobService.ROUTE_IMM_WINDOW_MIN = 10;
exports.DispatchJobService = DispatchJobService = DispatchJobService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_2.TransactionalConnection,
        hall_grab_service_1.HallGrabService,
        hall_service_1.HallService,
        capacity_service_1.CapacityService,
        rider_credit_service_1.RiderCreditService,
        core_1.ModuleRef,
        third_party_delivery_service_1.ThirdPartyDeliveryService,
        feishu_notify_service_1.FeishuNotifyService,
        campus_notify_service_1.CampusNotifyService,
        compensation_task_service_1.CompensationTaskService,
        support_service_1.SupportService,
        campus_dedupe_service_1.CampusDedupeService])
], DispatchJobService);
//# sourceMappingURL=dispatch-job.service.js.map