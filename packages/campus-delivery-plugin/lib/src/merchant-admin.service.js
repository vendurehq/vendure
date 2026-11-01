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
exports.MerchantAdminService = exports.KDS_LATE_MINUTES = exports.KDS_WARN_MINUTES = void 0;
exports.isUrgePending = isUrgePending;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const typeorm_1 = require("typeorm");
const core_2 = require("@vendure/core");
const after_sales_plugin_1 = require("@vendure/after-sales-plugin");
const campus_building_entity_1 = require("./campus-building.entity");
const campus_fulfillment_config_entity_1 = require("./campus-fulfillment-config.entity");
const campus_config_service_1 = require("./campus-config.service");
const campus_dedupe_service_1 = require("./campus-dedupe.service");
const campus_notify_service_1 = require("./campus-notify.service");
const campus_time_1 = require("./campus-time");
const business_hours_1 = require("./business-hours");
const hall_service_1 = require("./hall.service");
const refund_payment_1 = require("./refund-payment");
const third_party_delivery_service_1 = require("./third-party-delivery.service");
const waimai_store_service_1 = require("./waimai-store.service");
const cloud_print_service_1 = require("./cloud-print.service");
const feishu_client_1 = require("./feishu/feishu.client");
const privacy_number_service_1 = require("./privacy-number.service");
const after_sales_sla_1 = require("./after-sales-sla");
const addon_fee_1 = require("./addon-fee");
const daily_limit_1 = require("./daily-limit");
const auto_accept_1 = require("./auto-accept");
const closure_calendar_1 = require("./closure-calendar");
const after_sales_duty_1 = require("./after-sales-duty");
const batch_orders_1 = require("./batch-orders");
/** 需商家处理的状态：Pending=待审批 / Appealed=顾客申诉（商家可再次同意） */
const AFTER_SALES_PENDING_STATES = ['Pending', 'Appealed'];
/** 出餐屏超时阈值（分钟）：15 分钟预警、25 分钟催单 */
exports.KDS_WARN_MINUTES = 15;
exports.KDS_LATE_MINUTES = 25;
/**
 * 商家接单工作台（admin-api，CampusMerchant 权限，渠道隔离 = 商家角色绑定渠道）。
 * 状态机（merchantConfirmEnabled 渠道）：支付 → pending_merchant（待商家接单）
 * → accepted（备餐中，campusMerchantAcceptOrder）→ open（出餐完成入大厅，
 * campusMerchantCookingDone）→ 骑手 grabbed/delivering → delivered。
 */
let MerchantAdminService = class MerchantAdminService {
    constructor(connection, config, hall, notify, thirdParty, orderService, privacy, cloud, feishu, moduleRef, 
    /** M5 跨实例冷却/预警去重；未注入退回进程内 Map */
    dedupe) {
        this.connection = connection;
        this.config = config;
        this.hall = hall;
        this.notify = notify;
        this.thirdParty = thirdParty;
        this.orderService = orderService;
        this.privacy = privacy;
        this.cloud = cloud;
        this.feishu = feishu;
        this.moduleRef = moduleRef;
        this.dedupe = dedupe;
        /** 退款重试冷却（§82）：同单 30 秒内只放行一次，防连点重复调用退款核心 */
        this.refundRetryAt = new Map();
        /** 催办顾客冷却（§84）：同单 60 秒内只发一次站内信，防对顾客骚扰 */
        this.remindAt = new Map();
        /** 无人值班预警去重（§100）：channelId:校园日，同一天只预警一次 */
        this.dutyWarnAt = new Map();
    }
    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项） */
    getAfterSales() {
        var _a, _b, _c;
        if (this.afterSalesSvc !== undefined)
            return (_a = this.afterSalesSvc) !== null && _a !== void 0 ? _a : null;
        try {
            this.afterSalesSvc = this.moduleRef ? new core_2.Injector(this.moduleRef).get(after_sales_plugin_1.AfterSalesService) : null;
        }
        catch (e) {
            this.afterSalesSvc = null;
            core_2.Logger.warn(`AfterSalesService 不可用，商家端售后处理降级: ${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`, 'CampusMerchant');
        }
        return (_c = this.afterSalesSvc) !== null && _c !== void 0 ? _c : null;
    }
    /** 补偿券服务（§100）：coupon-plugin 未安装/未启用时返回 null，发券失败降级为仅退款 */
    getCouponService() {
        var _a, _b, _c;
        if (this.couponSvc !== undefined)
            return (_a = this.couponSvc) !== null && _a !== void 0 ? _a : null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require('@vendure/coupon-plugin');
            this.couponSvc = (mod === null || mod === void 0 ? void 0 : mod.CouponService) && this.moduleRef
                ? new core_2.Injector(this.moduleRef).get(mod.CouponService)
                : null;
        }
        catch (e) {
            this.couponSvc = null;
            core_2.Logger.warn(`CouponService 不可用，补偿挽留降级为仅退款: ${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`, 'CampusMerchant');
        }
        return (_c = this.couponSvc) !== null && _c !== void 0 ? _c : null;
    }
    /** 商家自助经营：门店资料（营业时间/公告/电话/营业状态） */
    async storeProfile(ctx) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4;
        const cfg = await this.config.getConfig(ctx);
        const channel = await this.connection.getRepository(ctx, core_2.Channel)
            .findOne({ where: { id: ctx.channelId } });
        if (!channel)
            throw new core_2.UserInputError('当前店铺渠道不存在');
        const hours = (_b = ((_a = channel.customFields) !== null && _a !== void 0 ? _a : {}).waimaiBusinessHours) !== null && _b !== void 0 ? _b : null;
        // 日报失败原因（§119）：只有失败发生在「最近一次成功」之后就展示，避免成功后仍挂旧错误
        const pushCf = ((_c = channel.customFields) !== null && _c !== void 0 ? _c : {});
        const failAt = Number((_d = pushCf.waimaiDailyPushLastFailAt) !== null && _d !== void 0 ? _d : 0) || 0;
        const lastPushDate = String((_e = pushCf.waimaiDailyPushLastDate) !== null && _e !== void 0 ? _e : '');
        const failVisible = failAt > 0 && (lastPushDate === '' || (0, campus_time_1.campusDayKey)(failAt) > lastPushDate);
        const closureDates = (0, closure_calendar_1.safeClosureDates)(cfg.closureDates);
        const closure = (0, closure_calendar_1.closedToday)(closureDates);
        // 未出餐订单（§71）：休业日提醒商家仍有待接单/备餐中订单需处理；轮询 10s 一次，轻量计数
        const unfinishedOrders = await this.connection.getRepository(ctx, core_2.Order)
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere("order.customFields.hallStatus IN ('pending_merchant','accepted')")
            .getCount();
        return {
            storeName: channel.code,
            businessHours: hours,
            storeNotice: (_f = cfg.storeNotice) !== null && _f !== void 0 ? _f : null,
            storePhone: (_g = cfg.storePhone) !== null && _g !== void 0 ? _g : null,
            paused: cfg.paused,
            // 与 C 端 openNow / 下单闸门同口径：营业时段内、未临时休息、且今日不在休业日历
            openNow: (0, business_hours_1.isWithinBusinessHours)(hours) && !cfg.paused && !closure,
            closedToday: !!closure,
            closureNote: (_h = closure === null || closure === void 0 ? void 0 : closure.note) !== null && _h !== void 0 ? _h : null,
            closureDates,
            nextTransition: (0, business_hours_1.nextBusinessTransition)(hours),
            unfinishedOrders,
            // 日报推送（§86）：Channel 自定义字段，空时间按 21:30
            dailyPushEnabled: !!((_j = channel.customFields) !== null && _j !== void 0 ? _j : {}).waimaiDailyPushEnabled,
            dailyPushTime: ((_k = channel.customFields) !== null && _k !== void 0 ? _k : {}).waimaiDailyPushTime || '21:30',
            // 推送渠道（§118）：飞书未配置时日报无法送达，设置页显示降级提示
            dailyPushChannelReady: this.feishu.enabled,
            // 失败原因可见（§119）：最近一次失败时间（epoch ms）与原因，仅当失败晚于最近成功日
            dailyPushLastFailAt: failVisible ? failAt : 0,
            dailyPushLastFailReason: failVisible ? String((_l = pushCf.waimaiDailyPushLastFailReason) !== null && _l !== void 0 ? _l : '') : '',
            // 售后月度摘要推送（§95）：空按每月 1 日 21:30
            monthlyPushEnabled: !!((_m = channel.customFields) !== null && _m !== void 0 ? _m : {}).waimaiAfterSalesMonthlyPushEnabled,
            monthlyPushDay: Number((_p = ((_o = channel.customFields) !== null && _o !== void 0 ? _o : {}).waimaiAfterSalesMonthlyPushDay) !== null && _p !== void 0 ? _p : 1) || 1,
            monthlyPushTime: ((_q = channel.customFields) !== null && _q !== void 0 ? _q : {}).waimaiAfterSalesMonthlyPushTime || '21:30',
            // 售后自动化（§96）：自动分配 + 异常预警，阈值 0=关闭该项
            autoAssignEnabled: !!((_r = channel.customFields) !== null && _r !== void 0 ? _r : {}).waimaiAfterSalesAutoAssignEnabled,
            autoAssignMax: Math.max(0, Number((_t = ((_s = channel.customFields) !== null && _s !== void 0 ? _s : {}).waimaiAfterSalesAutoAssignMax) !== null && _t !== void 0 ? _t : 0) || 0),
            alertEnabled: !!((_u = channel.customFields) !== null && _u !== void 0 ? _u : {}).waimaiAfterSalesAlertEnabled,
            alertRefundRate: Math.max(0, Number((_w = ((_v = channel.customFields) !== null && _v !== void 0 ? _v : {}).waimaiAfterSalesAlertRefundRate) !== null && _w !== void 0 ? _w : 0) || 0),
            alertOverdueCount: Math.max(0, Number((_y = ((_x = channel.customFields) !== null && _x !== void 0 ? _x : {}).waimaiAfterSalesAlertOverdueCount) !== null && _y !== void 0 ? _y : 0) || 0),
            // 信任文案（§113）：店铺级配置，空文案回落 C 端默认文案
            trustQualityEnabled: (_z = cfg.trustQualityEnabled) !== null && _z !== void 0 ? _z : true,
            trustQualityText: (_0 = cfg.trustQualityText) !== null && _0 !== void 0 ? _0 : null,
            trustServiceEnabled: (_1 = cfg.trustServiceEnabled) !== null && _1 !== void 0 ? _1 : true,
            trustServiceText: (_2 = cfg.trustServiceText) !== null && _2 !== void 0 ? _2 : null,
            trustTimeEnabled: (_3 = cfg.trustTimeEnabled) !== null && _3 !== void 0 ? _3 : true,
            trustTimeText: (_4 = cfg.trustTimeText) !== null && _4 !== void 0 ? _4 : null,
        };
    }
    /** 商家自助修改门店资料：营业时间走 Channel 自定义字段，公告/电话走履约配置白名单 */
    async updateStore(ctx, input) {
        var _a, _b, _c;
        const patch = {};
        if (input.businessHours !== undefined) {
            const raw = String((_a = input.businessHours) !== null && _a !== void 0 ? _a : '').trim();
            if (raw) {
                if (raw.length > 100)
                    throw new core_2.UserInputError('营业时间不能超过 100 个字符');
                // 必须能被营业时段解析器读懂，否则 C 端展示/下单闸门会误判
                if (!(0, business_hours_1.parseBusinessHours)(raw).length) {
                    throw new core_2.UserInputError('营业时间格式不正确，示例：10:00-22:00 或 10:00-14:00,17:00-21:00');
                }
            }
            const repo = this.connection.getRepository(ctx, core_2.Channel);
            const channel = await repo.findOne({ where: { id: ctx.channelId } });
            if (!channel)
                throw new core_2.UserInputError('当前店铺渠道不存在');
            channel.customFields.waimaiBusinessHours = raw || null;
            await repo.save(channel);
            // §99：营业时间影响售后 SLA，变更后立即重算未完结单截止时间
            await this.recomputeSlaDeadlines(ctx);
        }
        if (input.storeNotice !== undefined)
            patch.storeNotice = String((_b = input.storeNotice) !== null && _b !== void 0 ? _b : '').trim() || null;
        if (input.storePhone !== undefined)
            patch.storePhone = String((_c = input.storePhone) !== null && _c !== void 0 ? _c : '').trim() || null;
        if (Object.keys(patch).length)
            await this.config.updateConfig(ctx, patch);
        return this.storeProfile(ctx);
    }
    /**
     * 信任文案（§113）：评价页信任签名卡「质量→服务→时间」三行，店铺级自定义。
     * 未传的项保留原值；文案留空/纯空白 = 回落 C 端默认文案（传 null 即清空自定义）。
     */
    async updateTrustCopy(ctx, input) {
        const patch = {};
        if (input.qualityEnabled != null)
            patch.trustQualityEnabled = !!input.qualityEnabled;
        if (input.serviceEnabled != null)
            patch.trustServiceEnabled = !!input.serviceEnabled;
        if (input.timeEnabled != null)
            patch.trustTimeEnabled = !!input.timeEnabled;
        if (input.qualityText !== undefined)
            patch.trustQualityText = this.trustText(input.qualityText, '质量');
        if (input.serviceText !== undefined)
            patch.trustServiceText = this.trustText(input.serviceText, '服务');
        if (input.timeText !== undefined)
            patch.trustTimeText = this.trustText(input.timeText, '时间');
        if (Object.keys(patch).length)
            await this.config.updateConfig(ctx, patch);
        return this.storeProfile(ctx);
    }
    /** 信任文案归一：去空白、超长拒绝、空串转 null（C 端按 null 回落默认文案） */
    trustText(value, label) {
        const text = String(value !== null && value !== void 0 ? value : '').trim();
        if (text.length > campus_fulfillment_config_entity_1.TRUST_TEXT_MAX_LENGTH) {
            throw new core_2.UserInputError(`${label}文案最多 ${campus_fulfillment_config_entity_1.TRUST_TEXT_MAX_LENGTH} 字`);
        }
        return text || null;
    }
    /**
     * 每日日报推送设置（§86）：开关 + 推送时间。
     * - 时间按校园时区解释，格式 HH:MM，空=沿用 21:30；改时间不清 lastDate，同一天不会重复推。
     * - 关闭只改开关，历史 lastDate 保留，重开当天若已推过则不再推（幂等键按「已推送的昨日」记）。
     */
    async updateDailyPush(ctx, enabled, time) {
        var _a;
        const raw = String(time !== null && time !== void 0 ? time : '').trim();
        if (raw && !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
            throw new core_2.UserInputError('推送时间格式应为 HH:MM（如 21:30）');
        }
        const repo = this.connection.getRepository(ctx, core_2.Channel);
        const channel = await repo.findOne({ where: { id: ctx.channelId } });
        if (!channel)
            throw new core_2.UserInputError('当前店铺渠道不存在');
        const cf = ((_a = channel.customFields) !== null && _a !== void 0 ? _a : {});
        cf.waimaiDailyPushEnabled = !!enabled;
        cf.waimaiDailyPushTime = raw || null;
        await repo.save(channel);
        return this.storeProfile(ctx);
    }
    /**
     * 售后月度摘要推送设置（§95）：开关 + 每月推送日（1-28）+ 推送时间。
     * - 时间按校园时区解释，格式 HH:MM，空=沿用 21:30；推送日空=每月 1 日。
     * - 每月只推一次（按上月 'YYYY-MM' 幂等），改设置不会重复推。
     */
    async updateAfterSalesMonthlyPush(ctx, enabled, day, time) {
        var _a;
        const d = day == null ? null : Math.floor(Number(day));
        if (d != null && (!Number.isFinite(d) || d < 1 || d > 28)) {
            throw new core_2.UserInputError('推送日应为 1-28（避免月末缺日）');
        }
        const raw = String(time !== null && time !== void 0 ? time : '').trim();
        if (raw && !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
            throw new core_2.UserInputError('推送时间格式应为 HH:MM（如 21:30）');
        }
        const repo = this.connection.getRepository(ctx, core_2.Channel);
        const channel = await repo.findOne({ where: { id: ctx.channelId } });
        if (!channel)
            throw new core_2.UserInputError('当前店铺渠道不存在');
        const cf = ((_a = channel.customFields) !== null && _a !== void 0 ? _a : {});
        cf.waimaiAfterSalesMonthlyPushEnabled = !!enabled;
        cf.waimaiAfterSalesMonthlyPushDay = d;
        cf.waimaiAfterSalesMonthlyPushTime = raw || null;
        await repo.save(channel);
        return this.storeProfile(ctx);
    }
    /**
     * 售后自动化设置（§96）：自动分配 + 异常预警。
     * - 仅更新显式传入的项（null/undefined 保持原值），阈值传 0 表示关闭该项。
     * - autoAssignMax=0 不限制单人未完结单量；refundRate/overdueCount 为 0 时对应预警不触发。
     */
    async updateAfterSalesAutomation(ctx, input) {
        var _a;
        const intOrThrow = (v, name, max) => {
            if (v == null)
                return null;
            const n = Math.floor(Number(v));
            if (!Number.isFinite(n) || n < 0 || n > max)
                throw new core_2.UserInputError(`${name}应为 0-${max}`);
            return n;
        };
        const maxAssign = intOrThrow(input.autoAssignMax, '单人未完结上限', 100);
        const refundRate = intOrThrow(input.alertRefundRate, '退款率阈值（百分比）', 100);
        const overdueCount = intOrThrow(input.alertOverdueCount, '超时待处理阈值（单）', 999);
        const repo = this.connection.getRepository(ctx, core_2.Channel);
        const channel = await repo.findOne({ where: { id: ctx.channelId } });
        if (!channel)
            throw new core_2.UserInputError('当前店铺渠道不存在');
        const cf = ((_a = channel.customFields) !== null && _a !== void 0 ? _a : {});
        if (input.autoAssignEnabled != null)
            cf.waimaiAfterSalesAutoAssignEnabled = !!input.autoAssignEnabled;
        if (maxAssign != null)
            cf.waimaiAfterSalesAutoAssignMax = maxAssign;
        if (input.alertEnabled != null)
            cf.waimaiAfterSalesAlertEnabled = !!input.alertEnabled;
        if (refundRate != null)
            cf.waimaiAfterSalesAlertRefundRate = refundRate;
        if (overdueCount != null)
            cf.waimaiAfterSalesAlertOverdueCount = overdueCount;
        await repo.save(channel);
        return this.storeProfile(ctx);
    }
    /** 营业日历（§70）：整体替换休业日期列表（传空数组=关闭休业日历），返回最新门店资料 */
    async updateClosureDates(ctx, dates) {
        const list = (dates !== null && dates !== void 0 ? dates : []).map(d => { var _a, _b; return ({ date: String((_a = d === null || d === void 0 ? void 0 : d.date) !== null && _a !== void 0 ? _a : '').trim(), note: String((_b = d === null || d === void 0 ? void 0 : d.note) !== null && _b !== void 0 ? _b : '').trim() }); });
        await this.config.updateConfig(ctx, { closureDates: list });
        return this.storeProfile(ctx);
    }
    /** 商家自助经营数据：今日/近 7 日（含今日）单量、营业额、客单价、取消退款；另附近 30 日逐日明细供导出 */
    async revenue(ctx) {
        var _a;
        const now = Date.now();
        const today0 = (0, campus_time_1.startOfCampusDay)(now);
        const DAY_MS = 24 * 3600000;
        const DAYS = 30;
        const since = today0 - (DAYS - 1) * DAY_MS;
        const last7From = (0, campus_time_1.campusDayKey)(today0 - 6 * DAY_MS);
        const orders = await this.connection.getRepository(ctx, core_2.Order)
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere('order.customFields.hallStatus IS NOT NULL')
            .andWhere('order.createdAt >= :since', { since: new Date(since) })
            .getMany();
        const dayMap = new Map();
        for (let i = DAYS - 1; i >= 0; i--) {
            const key = (0, campus_time_1.campusDayKey)(today0 - i * DAY_MS);
            dayMap.set(key, { date: key.slice(5), dateFull: key, orders: 0, gross: 0, cancelled: 0, cancelledAmount: 0 });
        }
        const todayKey = (0, campus_time_1.campusDayKey)(now);
        const empty = () => ({ orders: 0, gross: 0, avgTicket: 0, cancelled: 0, cancelledAmount: 0 });
        const today = empty();
        const last7 = empty();
        for (const o of orders) {
            const cf = o.customFields;
            const total = (_a = o.totalWithTax) !== null && _a !== void 0 ? _a : 0;
            if (o.state === 'Cancelled') {
                const key = (0, campus_time_1.campusDayKey)(new Date(o.createdAt).getTime());
                // 逐日口径：取消单按「下单日」归日，全额退款计 cancelledAmount
                const day = dayMap.get(key);
                if (day) {
                    day.cancelled += 1;
                    day.cancelledAmount += total;
                }
                // 窗口口径只统计近 7 日（查询窗口已扩到 30 日，必须显式收窄）
                if (key >= last7From) {
                    last7.cancelled += 1;
                    last7.cancelledAmount += total;
                    if (key === todayKey) {
                        today.cancelled += 1;
                        today.cancelledAmount += total;
                    }
                }
                continue;
            }
            if (cf.deliveryStatus !== 'delivered' || !cf.deliveredAt)
                continue;
            // 营业额按送达时间归日：跨零点订单计入实际送达当天
            const key = (0, campus_time_1.campusDayKey)(new Date(cf.deliveredAt).getTime());
            const day = dayMap.get(key);
            if (day) {
                day.orders += 1;
                day.gross += total;
            }
            if (key >= last7From) {
                last7.orders += 1;
                last7.gross += total;
                if (key === todayKey) {
                    today.orders += 1;
                    today.gross += total;
                }
            }
        }
        today.avgTicket = today.orders ? Math.round(today.gross / today.orders) : 0;
        last7.avgTicket = last7.orders ? Math.round(last7.gross / last7.orders) : 0;
        const allDays = [...dayMap.values()];
        return { today, last7, days: allDays.slice(-7), days30: allDays };
    }
    /**
     * 自定义区间逐日经营数据（§89 导出）：含起止两日，最多 366 天。
     * 口径与 revenue() 的 days30 完全一致（送达按 deliveredAt 归日、取消按下单日归日）。
     */
    async revenueRange(ctx, from, to) {
        var _a;
        const DAY_MS = 24 * 3600000;
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
        const rawFrom = String(from !== null && from !== void 0 ? from : '').trim();
        const rawTo = String(to !== null && to !== void 0 ? to : '').trim();
        if (!DATE_RE.test(rawFrom) || !DATE_RE.test(rawTo)) {
            throw new core_2.UserInputError('日期格式须为 YYYY-MM-DD');
        }
        const fromDay0 = (0, campus_time_1.startOfCampusDay)(Date.parse(`${rawFrom}T00:00:00+08:00`));
        const toDay0 = (0, campus_time_1.startOfCampusDay)(Date.parse(`${rawTo}T00:00:00+08:00`));
        if (Number.isNaN(fromDay0) || Number.isNaN(toDay0))
            throw new core_2.UserInputError('日期格式不合法');
        if (toDay0 < fromDay0)
            throw new core_2.UserInputError('结束日期不能早于开始日期');
        const DAY_COUNT = Math.round((toDay0 - fromDay0) / DAY_MS) + 1;
        if (DAY_COUNT > 366)
            throw new core_2.UserInputError('导出区间不能超过 366 天');
        // 结束日 0 点 + 1 天 = 开区间上界
        const start = new Date(fromDay0);
        const end = new Date(toDay0 + DAY_MS);
        const orders = await this.connection.getRepository(ctx, core_2.Order)
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere('order.customFields.hallStatus IS NOT NULL')
            // 取消单按下单时间、已送达单按送达时间归日，两者都要覆盖（送达可能跨零点）
            .andWhere(new typeorm_1.Brackets(qb => {
            qb.where('order.createdAt >= :start AND order.createdAt < :end', { start, end })
                .orWhere('order.customFields.deliveredAt >= :start AND order.customFields.deliveredAt < :end', { start, end });
        }))
            .getMany();
        const dayMap = new Map();
        for (let i = 0; i < DAY_COUNT; i++) {
            const key = (0, campus_time_1.campusDayKey)(fromDay0 + i * DAY_MS);
            dayMap.set(key, { date: key.slice(5), dateFull: key, orders: 0, gross: 0, cancelled: 0, cancelledAmount: 0 });
        }
        for (const o of orders) {
            const cf = o.customFields;
            const total = (_a = o.totalWithTax) !== null && _a !== void 0 ? _a : 0;
            if (o.state === 'Cancelled') {
                const day = dayMap.get((0, campus_time_1.campusDayKey)(new Date(o.createdAt).getTime()));
                if (day) {
                    day.cancelled += 1;
                    day.cancelledAmount += total;
                }
                continue;
            }
            if (cf.deliveryStatus !== 'delivered' || !cf.deliveredAt)
                continue;
            const day = dayMap.get((0, campus_time_1.campusDayKey)(new Date(cf.deliveredAt).getTime()));
            if (day) {
                day.orders += 1;
                day.gross += total;
            }
        }
        return [...dayMap.values()];
    }
    /** 商家侧顾客联系方式（号码保护）：本渠道订单可查，开启后只返回脱敏/虚拟号 */
    async customerContact(ctx, orderId) {
        var _a, _b;
        const order = await this.connection.getRepository(ctx, core_2.Order)
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .leftJoinAndSelect('order.customer', 'customer')
            .where('order.id = :id', { id: orderId })
            .andWhere('channel.id = :ch', { ch: ctx.channelId })
            .getOne();
        if (!order)
            throw new core_2.UserInputError('订单不存在或不属于当前店铺');
        return this.privacy.resolve(ctx, {
            channelId: ctx.channelId,
            orderCode: order.code,
            phone: (_b = (_a = order.customer) === null || _a === void 0 ? void 0 : _a.phoneNumber) !== null && _b !== void 0 ? _b : null,
        });
    }
    /** 本渠道营业时间（Channel.customFields.waimaiBusinessHours）；原生查询，供工作台高频轮询 */
    async channelBusinessHours(ctx) {
        var _a;
        const rows = await this.connection.rawConnection.query('SELECT "customFieldsWaimaibusinesshours" AS hours FROM channel WHERE id = $1', [ctx.channelId]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const hours = (_a = list === null || list === void 0 ? void 0 : list[0]) === null || _a === void 0 ? void 0 : _a.hours;
        return hours == null || hours === '' ? null : String(hours);
    }
    /**
     * 日报推送状态（§118 今日待办）：「已开启 + 已到点 + 今日未推成功」= 日报未推送。
     * 走原生单行查询（同 channel 表），避免工作台 10s 轮询实例化 Channel 实体。
     */
    async channelDailyPushState(ctx, now) {
        var _a, _b, _c;
        const rows = await this.connection.rawConnection.query('SELECT COALESCE("customFieldsWaimaidailypushenabled", false) AS enabled, '
            + '"customFieldsWaimaidailypushtime" AS time, '
            + '"customFieldsWaimaidailypushlastdate" AS last FROM channel WHERE id = $1', [ctx.channelId]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const row = (_a = list === null || list === void 0 ? void 0 : list[0]) !== null && _a !== void 0 ? _a : {};
        if (row.enabled !== true)
            return { enabled: false, due: false, pushedToday: false };
        const raw = String((_b = row.time) !== null && _b !== void 0 ? _b : '').trim();
        const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : '21:30';
        const [h, m] = time.split(':').map(Number);
        return {
            enabled: true,
            due: now >= (0, campus_time_1.startOfCampusDay)(now) + (h * 60 + m) * 60000,
            pushedToday: String((_c = row.last) !== null && _c !== void 0 ? _c : '') === (0, campus_time_1.campusDayKey)(now),
        };
    }
    /** 本渠道休业日列表（§100 SLA 口径）：含历史日期，供 businessDeadline 整天跳过 */
    async channelClosureDateKeys(ctx) {
        var _a;
        try {
            const cfg = await this.config.getConfig(ctx);
            return (0, closure_calendar_1.closureDateKeys)(cfg === null || cfg === void 0 ? void 0 : cfg.closureDates);
        }
        catch (e) {
            core_2.Logger.warn(`读取休业日历失败，SLA 按正常营业计算: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, 'CampusMerchantAfterSales');
            return [];
        }
    }
    async board(ctx) {
        var _a, _b, _c, _d, _e;
        const cfg = await this.config.getConfig(ctx);
        const repo = this.connection.getRepository(ctx, core_2.Order);
        const orders = await repo
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere('order.customFields.hallStatus IS NOT NULL')
            // 仅拉活跃流转单：排除 delivered / cancelled / exception_final / no_rider_final 等终态，避免历史单无限增长
            .andWhere("order.customFields.hallStatus IN ('pending_merchant','accepted','open','grabbed','pending_dispatch','third_party','owned_pool','owned_dispatched','merchant_delivering','scheduled')")
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('lines.productVariant', 'variant')
            // 顾客关联：工作台卡片展示脱敏手机号（便于按尾号检索/联系），不取明文
            .leftJoinAndSelect('order.customer', 'customer')
            .getMany();
        // 今日已送达口径：按校园时区（UTC+8）日界，不随部署服务器时区漂移
        const startOfDay = new Date((0, campus_time_1.startOfCampusDay)(Date.now()));
        const deliveredToday = await repo
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere("order.customFields.deliveryStatus = 'delivered'")
            .andWhere('order.customFields.deliveredAt >= :start', { start: startOfDay })
            .getMany();
        const active = orders.filter(o => {
            const cf = o.customFields;
            // 送达终态不再进流转栏（兼容历史脏数据：hallStatus 仍为 grabbed 但已送达）
            if (cf.deliveryStatus === 'delivered')
                return false;
            return [
                'pending_merchant', 'accepted', 'open', 'grabbed',
                'pending_dispatch', 'third_party', 'owned_pool', 'owned_dispatched', 'merchant_delivering',
            ].includes(cf.hallStatus);
        });
        // 预约单（scheduled）：按预约锚点升序，供商家提前备料知悉（不进入四栏流转）
        const scheduledOrders = orders
            .filter(o => o.customFields.hallStatus === 'scheduled')
            .sort((a, b) => {
            var _a, _b;
            const ta = new Date((_a = a.customFields.scheduledFor) !== null && _a !== void 0 ? _a : 0).getTime();
            const tb = new Date((_b = b.customFields.scheduledFor) !== null && _b !== void 0 ? _b : 0).getTime();
            return ta - tb;
        });
        const dtos = await this.toDto(ctx, active);
        const scheduledDtos = await this.toDto(ctx, scheduledOrders);
        const cfOf = (o) => o.customFields;
        const pending = dtos.filter((_, i) => cfOf(active[i]).hallStatus === 'pending_merchant');
        const cooking = dtos.filter((_, i) => cfOf(active[i]).hallStatus === 'accepted');
        const awaitingRider = dtos.filter((_, i) => cfOf(active[i]).hallStatus === 'open');
        const delivering = dtos.filter((_, i) => cfOf(active[i]).hallStatus === 'grabbed');
        const pick = (s) => dtos.filter((_, i) => cfOf(active[i]).hallStatus === s);
        const completedTodayAmount = deliveredToday.reduce((s, o) => s + (o.total || 0), 0);
        // 出餐超时（§83）：待接单/备餐中等待 ≥25 分钟，与出餐屏 late 同口径
        const nowMs = Date.now();
        const overdueOrders = active.filter(o => {
            const st = cfOf(o).hallStatus;
            if (st !== 'pending_merchant' && st !== 'accepted')
                return false;
            return (nowMs - new Date(o.createdAt).getTime()) / 60000 >= exports.KDS_LATE_MINUTES;
        }).length;
        // 售后待办（§83）：一次聚合拿到各状态计数，避免为两个数字各发一次 count 查询
        const asStateRows = await this.connection.getRepository(ctx, after_sales_plugin_1.AfterSalesRequest)
            .createQueryBuilder('a')
            .leftJoin('a.order', 'o')
            .leftJoin('o.channels', 'c')
            .where('c.id = :ch', { ch: ctx.channelId })
            .andWhere('o.customFields.hallStatus IS NOT NULL')
            .select('a.state', 'state')
            .addSelect('COUNT(*)', 'n')
            .groupBy('a.state')
            .getRawMany();
        const asCountOf = (states) => asStateRows
            .filter(r => { var _a; return states.includes(String((_a = r.state) !== null && _a !== void 0 ? _a : '')); })
            .reduce((s, r) => s + (Number(r.n) || 0), 0);
        const afterSalesPending = asCountOf(AFTER_SALES_PENDING_STATES);
        const refundFailed = asCountOf(['RefundFailed']);
        const printProvider = String((_a = cfg.printProvider) !== null && _a !== void 0 ? _a : 'local');
        // 日报推送状态（§118 今日待办）：与业务设置页同源，判断「已到点但今日未推成功」
        const dailyPush = await this.channelDailyPushState(ctx, nowMs);
        // 营业时间（自动开关门）：轻量原生查询，避免工作台 10s 轮询时反复实例化 Channel 实体
        const hours = await this.channelBusinessHours(ctx);
        const closure = (0, closure_calendar_1.closedToday)((0, closure_calendar_1.safeClosureDates)(cfg.closureDates));
        return {
            paused: cfg.paused,
            openNow: (0, business_hours_1.isWithinBusinessHours)(hours) && !cfg.paused && !closure,
            businessHours: hours,
            nextTransition: (0, business_hours_1.nextBusinessTransition)(hours),
            merchantConfirmEnabled: cfg.merchantConfirmEnabled,
            printMode: (0, waimai_store_service_1.normalizePrintMode)(cfg.printMode),
            printProvider,
            cloudPrintConfigured: printProvider !== 'local' && !!cfg.printAccount && !!cfg.printDeviceSn && !!cfg.printDeviceKey,
            storeName: (_c = (_b = ctx.channel) === null || _b === void 0 ? void 0 : _b.code) !== null && _c !== void 0 ? _c : '',
            storePhone: (_d = cfg.storePhone) !== null && _d !== void 0 ? _d : null,
            pending,
            cooking,
            awaitingRider,
            delivering,
            pendingDispatch: pick('pending_dispatch'),
            thirdParty: pick('third_party'),
            ownedPool: pick('owned_pool'),
            ownedDispatched: pick('owned_dispatched'),
            merchantDelivering: pick('merchant_delivering'),
            scheduled: scheduledDtos,
            completedToday: deliveredToday.length,
            completedTodayAmount,
            closedToday: !!closure,
            closureNote: (_e = closure === null || closure === void 0 ? void 0 : closure.note) !== null && _e !== void 0 ? _e : null,
            // 未出餐 = 待接单 + 备餐中（出餐完成即退出该计数）
            unfinishedOrders: pending.length + cooking.length,
            // 待处理顾客催单（§78）：活跃单里催过且商家未「已知晓」的单数
            urgedCount: dtos.filter(d => d.urged).length,
            afterSalesPending,
            refundFailed,
            overdueOrders,
            // 日报未推送（§118）：推送渠道未配置时不计（该情形由设置页降级提示引导联系运营）
            dailyPushPending: this.feishu.enabled && dailyPush.enabled && dailyPush.due && !dailyPush.pushedToday,
        };
    }
    /**
     * 今日/区间已完成订单明细（§75 对账）：送达口径与工作台「今日完成」一致
     * （customFields.deliveryStatus = 'delivered' + deliveredAt 落区间），
     * 汇总按全区间统计（不受分页影响），退款取该单全部非 Failed 退款单之和。
     */
    async completedOrders(ctx, input) {
        var _a, _b, _c, _d, _e, _f, _g;
        const now = Date.now();
        const start = new Date(input.from ? String(input.from) : (0, campus_time_1.startOfCampusDay)(now));
        const end = new Date(input.to ? String(input.to) : now);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            throw new core_2.UserInputError('时间区间格式不合法');
        }
        if (start.getTime() >= end.getTime())
            throw new core_2.UserInputError('结束时间必须晚于开始时间');
        // 明细按区间累计，防止误传超长区间把工作台拖慢（92 天足够覆盖季度对账前查看）
        if (end.getTime() - start.getTime() > 92 * 24 * 3600000) {
            throw new core_2.UserInputError('查询区间不能超过 92 天');
        }
        const take = Math.min(Math.max(Number((_a = input.take) !== null && _a !== void 0 ? _a : 100) || 100, 1), 300);
        const skip = Math.max(Number((_b = input.skip) !== null && _b !== void 0 ? _b : 0) || 0, 0);
        const repo = this.connection.getRepository(ctx, core_2.Order);
        const base = () => repo
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere("order.customFields.deliveryStatus = 'delivered'")
            .andWhere('order.customFields.deliveredAt >= :start', { start })
            .andWhere('order.customFields.deliveredAt < :end', { end });
        // 汇总：单量 + 总额（全区间，不被分页截断）
        // 注意：Order.total / totalWithTax 都是实体 getter（无对应数据库列），聚合须落到真实列 subTotalWithTax + shippingWithTax
        const sums = await base()
            .select('COALESCE(SUM(COALESCE("order"."subTotalWithTax", 0) + COALESCE("order"."shippingWithTax", 0)), 0)', 'amount')
            .addSelect('COUNT("order"."id")', 'count')
            .getRawOne();
        const total = Number((_c = sums === null || sums === void 0 ? void 0 : sums.count) !== null && _c !== void 0 ? _c : 0);
        const totalAmount = Number((_d = sums === null || sums === void 0 ? void 0 : sums.amount) !== null && _d !== void 0 ? _d : 0);
        const orders = await base()
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('lines.productVariant', 'variant')
            .leftJoinAndSelect('order.customer', 'customer')
            .orderBy('order.customFields.deliveredAt', 'DESC', 'NULLS LAST')
            .skip(skip)
            .take(take)
            .getMany();
        // 退款金额：按订单聚合（payment 关联订单，Failed 退款不计入）
        const refunds = new Map();
        // 已支付金额（§76 可退余额口径）：只认 Settled/Authorized，与 refundablePayments 一致
        const paids = new Map();
        if (orders.length) {
            const ids = orders.map(o => Number(o.id));
            const rows = await this.connection.rawConnection.query(`SELECT p."orderId" AS "orderId", COALESCE(SUM(r.total), 0) AS "amount"
                   FROM refund r
                   JOIN payment p ON p.id = r."paymentId"
                  WHERE p."orderId" IN (${ids.map((_, i) => '$' + (i + 1)).join(',')})
                    AND r.state <> 'Failed'
                  GROUP BY p."orderId"`, ids);
            for (const row of rows !== null && rows !== void 0 ? rows : [])
                refunds.set(String(row.orderId), Number((_e = row.amount) !== null && _e !== void 0 ? _e : 0));
            const paidRows = await this.connection.rawConnection.query(`SELECT p."orderId" AS "orderId", COALESCE(SUM(p.amount), 0) AS "amount"
                   FROM payment p
                  WHERE p."orderId" IN (${ids.map((_, i) => '$' + (i + 1)).join(',')})
                    AND p.state IN ('Settled', 'Authorized')
                  GROUP BY p."orderId"`, ids);
            for (const row of paidRows !== null && paidRows !== void 0 ? paidRows : [])
                paids.set(String(row.orderId), Number((_f = row.amount) !== null && _f !== void 0 ? _f : 0));
        }
        const buildingIds = new Set();
        const riderIds = new Set();
        for (const o of orders) {
            const cf = o.customFields;
            if (cf.buildingId)
                buildingIds.add(String(cf.buildingId));
            if (cf.deliveryStaffId)
                riderIds.add(Number(cf.deliveryStaffId));
        }
        const buildings = buildingIds.size
            ? await this.connection.getRepository(ctx, campus_building_entity_1.CampusBuilding).findByIds([...buildingIds])
            : [];
        const buildingNames = new Map(buildings.map(b => [String(b.id), b.name]));
        const riders = riderIds.size
            ? await this.connection.rawConnection.getRepository('Customer').findByIds([...riderIds])
            : [];
        const riderNames = new Map(riders.map(c => { var _a, _b; return [String(c.id), (_b = (_a = c.customFields) === null || _a === void 0 ? void 0 : _a.riderRealName) !== null && _b !== void 0 ? _b : '']; }));
        const items = orders.map(o => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            const cf = o.customFields;
            const refundAmount = (_a = refunds.get(String(o.id))) !== null && _a !== void 0 ? _a : 0;
            // 可退余额 = 已支付 − 已退（§76）：未支付 / 已全额退款为 0，前端据此隐藏退款入口
            const refundable = Math.max(((_b = paids.get(String(o.id))) !== null && _b !== void 0 ? _b : 0) - refundAmount, 0);
            const lineText = ((_c = o.lines) !== null && _c !== void 0 ? _c : [])
                .map(l => { var _a, _b; return `${(_b = (_a = l.productVariant) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : ''}×${l.quantity}`; })
                .filter(s => s.length > 0)
                .join('、');
            return {
                id: String(o.id),
                code: o.code,
                deliveredAt: cf.deliveredAt ? new Date(cf.deliveredAt) : null,
                createdAt: o.createdAt,
                total: o.totalWithTax,
                refundAmount,
                netAmount: (o.totalWithTax || 0) - refundAmount,
                refundable,
                building: cf.buildingId ? (_d = buildingNames.get(String(cf.buildingId))) !== null && _d !== void 0 ? _d : '' : '',
                zone: (_e = cf.campusZone) !== null && _e !== void 0 ? _e : '',
                route: (_f = cf.fulfillmentRoute) !== null && _f !== void 0 ? _f : '',
                riderName: cf.deliveryStaffId ? (_g = riderNames.get(String(cf.deliveryStaffId))) !== null && _g !== void 0 ? _g : null : null,
                customerPhone: this.privacy.mask((_j = (_h = o.customer) === null || _h === void 0 ? void 0 : _h.phoneNumber) !== null && _j !== void 0 ? _j : null),
                lineText,
                note: (_k = cf.note) !== null && _k !== void 0 ? _k : null,
            };
        });
        // 区间退款总额：按订单聚合退款单（Failed 不计），不受分页影响
        const refundSum = await base()
            .leftJoin('order.payments', 'payment')
            .leftJoin('payment.refunds', 'refund')
            .select('COALESCE(SUM(refund.total), 0)', 'amount')
            .andWhere("refund.state <> 'Failed'")
            .getRawOne();
        const refundAmount = Number((_g = refundSum === null || refundSum === void 0 ? void 0 : refundSum.amount) !== null && _g !== void 0 ? _g : 0);
        return {
            items,
            total,
            totalAmount,
            refundAmount,
            netAmount: totalAmount - refundAmount,
            avgTicket: total > 0 ? Math.round((totalAmount - refundAmount) / total) : 0,
            start,
            end,
        };
    }
    /**
     * 退款记录台账（§77）：按渠道聚合退款单（refund → payment → order），
     * 与 §76 口径一致——Failed 退款单单独计数留痕但不计入退款总额；
     * reason 去掉商家退款留痕前缀（merchant refund (单号):）后再返回。
     */
    async refunds(ctx, input) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const now = Date.now();
        const start = new Date(input.from ? String(input.from) : (0, campus_time_1.startOfCampusDay)(now));
        const end = new Date(input.to ? String(input.to) : now);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            throw new core_2.UserInputError('时间区间格式不合法');
        }
        if (start.getTime() >= end.getTime())
            throw new core_2.UserInputError('结束时间必须晚于开始时间');
        if (end.getTime() - start.getTime() > 92 * 24 * 3600000) {
            throw new core_2.UserInputError('查询区间不能超过 92 天');
        }
        const take = Math.min(Math.max(Number((_a = input.take) !== null && _a !== void 0 ? _a : 100) || 100, 1), 300);
        const skip = Math.max(Number((_b = input.skip) !== null && _b !== void 0 ? _b : 0) || 0, 0);
        const raw = this.connection.rawConnection;
        const chId = Number(ctx.channelId);
        // 店铺隔离：退款单经支付单回落到订单，再用订单-渠道关联表判定归属（EXISTS 避免重复行）
        // 关联表名由 TypeORM 惯用命名生成：order_channels_channel
        const scope = `r."createdAt" >= $1 AND r."createdAt" < $2
              AND EXISTS (SELECT 1 FROM order_channels_channel oc WHERE oc."orderId" = o.id AND oc."channelId" = $3)`;
        const rows = await raw.query(`SELECT r.id AS "id", r.total AS "amount", r.state AS "state", r.reason AS "reason",
                    r."createdAt" AS "createdAt", p."orderId" AS "orderId", o.code AS "code"
               FROM refund r
               JOIN payment p ON p.id = r."paymentId"
               JOIN "order" o ON o.id = p."orderId"
              WHERE ${scope}
              ORDER BY r."createdAt" DESC
              LIMIT $4 OFFSET $5`, [start, end, chId, take, skip]);
        // 汇总：区分成功/失败笔数与金额（全区间，不受分页影响）
        const agg = await raw.query(`SELECT COUNT(*) FILTER (WHERE r.state <> 'Failed') AS "count",
                    COALESCE(SUM(r.total) FILTER (WHERE r.state <> 'Failed'), 0) AS "amount",
                    COUNT(*) FILTER (WHERE r.state = 'Failed') AS "failedCount",
                    COALESCE(SUM(r.total) FILTER (WHERE r.state = 'Failed'), 0) AS "failedAmount",
                    COUNT(*) AS "total"
               FROM refund r
               JOIN payment p ON p.id = r."paymentId"
               JOIN "order" o ON o.id = p."orderId"
              WHERE ${scope}`, [start, end, chId]);
        const sum = (_c = agg === null || agg === void 0 ? void 0 : agg[0]) !== null && _c !== void 0 ? _c : {};
        // 楼栋/区域：自定义字段只在订单实体上，按订单 id 回查（避免猜原生列名）
        const orderIds = [...new Set(rows.map(r => String(r.orderId)))];
        const orders = orderIds.length
            ? await this.connection.getRepository(ctx, core_2.Order).findByIds(orderIds)
            : [];
        const orderMap = new Map(orders.map(o => [String(o.id), o.customFields]));
        const buildingIds = new Set();
        for (const cf of orderMap.values())
            if (cf === null || cf === void 0 ? void 0 : cf.buildingId)
                buildingIds.add(String(cf.buildingId));
        const buildings = buildingIds.size
            ? await this.connection.getRepository(ctx, campus_building_entity_1.CampusBuilding).findByIds([...buildingIds])
            : [];
        const buildingNames = new Map(buildings.map(b => [String(b.id), b.name]));
        // 商家退款原因写入了「merchant refund (单号): 原因」留痕前缀，展示时剥掉
        const MERCHANT_PREFIX = /^merchant refund \([^)]*\):\s*/;
        const items = rows.map(r => {
            var _a, _b, _c, _d, _e, _f;
            const rawReason = String((_a = r.reason) !== null && _a !== void 0 ? _a : '');
            const cf = orderMap.get(String(r.orderId));
            return {
                id: String(r.id),
                orderId: String(r.orderId),
                code: String((_b = r.code) !== null && _b !== void 0 ? _b : ''),
                amount: Number((_c = r.amount) !== null && _c !== void 0 ? _c : 0),
                state: String((_d = r.state) !== null && _d !== void 0 ? _d : ''),
                reason: rawReason.replace(MERCHANT_PREFIX, ''),
                source: MERCHANT_PREFIX.test(rawReason) ? 'merchant' : 'platform',
                createdAt: new Date(r.createdAt),
                building: (cf === null || cf === void 0 ? void 0 : cf.buildingId) ? (_e = buildingNames.get(String(cf.buildingId))) !== null && _e !== void 0 ? _e : '' : '',
                zone: (_f = cf === null || cf === void 0 ? void 0 : cf.campusZone) !== null && _f !== void 0 ? _f : '',
            };
        });
        return {
            items,
            count: Number((_d = sum.count) !== null && _d !== void 0 ? _d : 0),
            amount: Number((_e = sum.amount) !== null && _e !== void 0 ? _e : 0),
            failedCount: Number((_f = sum.failedCount) !== null && _f !== void 0 ? _f : 0),
            failedAmount: Number((_g = sum.failedAmount) !== null && _g !== void 0 ? _g : 0),
            total: Number((_h = sum.total) !== null && _h !== void 0 ? _h : 0),
            start,
            end,
        };
    }
    /** 商家接单确认：pending_merchant → accepted */
    async acceptOrder(ctx, orderId) {
        const order = await this.assertChannelOrder(ctx, orderId, 'pending_merchant');
        const moved = await this.transitionToAccepted(ctx, order.id, 'manual');
        if (!moved)
            throw new core_2.UserInputError('订单状态已变更，请刷新');
        return { ok: true };
    }
    /** 接单内核（手动/自动共用）：条件写防并发 + 用户通知 + 接单即出票；返回是否真正迁移成功 */
    async transitionToAccepted(ctx, orderId, trigger) {
        var _a;
        const patch = { hallStatus: 'accepted' };
        // 自动接单留痕：既做每日上限统计，也方便客服区分人工/自动接单
        if (trigger === 'auto')
            patch.autoAcceptedAt = new Date();
        // 条件写：与用户取消/调度商家超时兜底并发时，已脱厅单不得被改回 accepted
        const moved = await this.hall.transitionFrom(ctx, Number(orderId), ['pending_merchant'], patch);
        if (!moved)
            return false;
        this.notify.user(ctx, orderId, 'orderAccepted');
        // 云打印（P1-4）：接单即出票（printMode=onAccepted 且走云通道）；失败只留任务记录，不阻塞接单
        const cfg = await this.config.getConfig(ctx);
        if ((0, waimai_store_service_1.normalizePrintMode)(cfg.printMode) === 'onAccepted' && String((_a = cfg.printProvider) !== null && _a !== void 0 ? _a : 'local') !== 'local') {
            void this.cloud.printOrder(ctx, orderId, 'auto').catch(() => undefined);
        }
        return true;
    }
    /** 商家拒单/商品缺货：接单前（pending_merchant）或备餐中（accepted）可拒，
     * 全额退款 + 取消订单（取消后由 Cancelled 转换自动脱厅/释放时段锁位）。
     * 退款幂等口径与 T4/异常处置一致：先查已退总额，仅退剩余部分。 */
    async rejectOrder(ctx, orderId, reason) {
        var _a, _b, _c, _d;
        const trimmed = (reason !== null && reason !== void 0 ? reason : '').trim();
        if (!trimmed)
            throw new core_2.UserInputError('请填写拒单原因');
        if (trimmed.length > 200)
            throw new core_2.UserInputError('拒单原因不能超过 200 个字符');
        const order = await this.assertChannelOrderState(ctx, orderId, ['pending_merchant', 'accepted']);
        // 并发防重退款：拒单是「查已退总额 → 退差额 → 取消」的复合动作，
        // 与 T4/运营处置并发时无锁会双退。用 PG 会话级咨询锁按订单串行化（同连接 runner 持有/释放）。
        const runner = this.connection.rawConnection.createQueryRunner();
        await runner.connect();
        const lockKey = `campus:refund:${order.id}`;
        try {
            const got = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
            const rows = Array.isArray(got) && Array.isArray(got[0]) ? got[0] : got;
            if (!((_a = rows === null || rows === void 0 ? void 0 : rows[0]) === null || _a === void 0 ? void 0 : _a.ok))
                throw new core_2.UserInputError('该订单正在退款处理中，请稍后重试');
            // 锁内复查：等待锁期间订单可能已被 T4/调度超时兜底改派或用户取消，
            // 此时再退款+取消会把已流转的单重复退款
            const fresh = await this.connection.getRepository(ctx, core_2.Order).findOne({
                where: { id: order.id },
            });
            const freshHs = String((_c = (_b = fresh === null || fresh === void 0 ? void 0 : fresh.customFields) === null || _b === void 0 ? void 0 : _b.hallStatus) !== null && _c !== void 0 ? _c : '');
            if (!['pending_merchant', 'accepted'].includes(freshHs)) {
                throw new core_2.UserInputError('订单状态已变更，请刷新');
            }
            // 只退成功支付且仍有余额的支付单（避免选中 Declined/Error 重试单导致退款失败）
            for (const picked of await (0, refund_payment_1.refundablePayments)(this.connection, Number(order.id))) {
                const rest = picked.remaining;
                if (rest > 0) {
                    const created = await this.orderService.refundOrder(ctx, {
                        paymentId: picked.payment.id,
                        amount: rest,
                        // refund 表 shipping/adjustment 列 NOT NULL，显式给 0（同 T4）
                        shipping: 0,
                        adjustment: 0,
                        reason: `merchant reject (${order.code})`,
                    });
                    if (!created || created.errorCode) {
                        throw new core_2.UserInputError(`退款失败：${(_d = created === null || created === void 0 ? void 0 : created.errorCode) !== null && _d !== void 0 ? _d : '未知原因'}`);
                    }
                    await (0, refund_payment_1.settleRefundOrMarkFailed)(this.connection, this.orderService, ctx, created.id);
                }
            }
            // 先留痕再取消：脱厅只写 hallStatus，不覆盖 campusCause
            await this.hall.updateOrder(ctx, order.id, {
                customFields: { campusCause: 'merchant_rejected' },
            });
            const cancelled = await this.orderService.cancelOrder(ctx, {
                orderId: order.id,
                reason: `商家拒单：${trimmed}`,
            });
            if (cancelled && cancelled.errorCode) {
                throw new Error(`cancelOrder failed: ${cancelled.errorCode}`);
            }
            this.notify.user(ctx, order.id, 'orderCancelled', trimmed);
            return { ok: true };
        }
        finally {
            try {
                await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
            }
            catch (_e) {
                // 释放失败交给连接回收兜底
            }
            await runner.release();
        }
    }
    /** 商家发起退款（§76）：已送达订单可整单/部分退款，复用既有 refund 通道。
     * 与拒单/运营异常处置共用订单级咨询锁，避免并发双退。 */
    async merchantRefund(ctx, orderId, amount, reason) {
        var _a, _b, _c, _d, _e, _f;
        const trimmed = (reason !== null && reason !== void 0 ? reason : '').trim();
        if (!trimmed)
            throw new core_2.UserInputError('请填写退款原因');
        if (trimmed.length > 200)
            throw new core_2.UserInputError('退款原因不能超过 200 个字符');
        const fen = Math.floor(Number(amount));
        if (!Number.isFinite(fen) || fen <= 0)
            throw new core_2.UserInputError('退款金额必须大于 0');
        const order = await this.connection.getRepository(ctx, core_2.Order).findOne({
            where: { id: orderId },
            relations: ['channels'],
        });
        const inChannel = (_a = order === null || order === void 0 ? void 0 : order.channels) === null || _a === void 0 ? void 0 : _a.some(c => String(c.id) === String(ctx.channelId));
        if (!order || !inChannel)
            throw new core_2.UserInputError('订单不存在或不属于当前店铺');
        // 只对已送达单开放：在途单请走「拒单」（备餐中）或联系运营异常处置，避免配送与退款错位
        if (String((_b = order.customFields.deliveryStatus) !== null && _b !== void 0 ? _b : '') !== 'delivered') {
            throw new core_2.UserInputError('仅已送达订单可发起退款');
        }
        const runner = this.connection.rawConnection.createQueryRunner();
        await runner.connect();
        const lockKey = `campus:refund:${order.id}`;
        try {
            const got = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
            const rows = Array.isArray(got) && Array.isArray(got[0]) ? got[0] : got;
            if (!((_c = rows === null || rows === void 0 ? void 0 : rows[0]) === null || _c === void 0 ? void 0 : _c.ok))
                throw new core_2.UserInputError('该订单正在退款处理中，请稍后重试');
            // 锁内重新统计余额（与运营处置/拒单并发时以最新余额为准）
            const payments = await (0, refund_payment_1.refundablePayments)(this.connection, Number(order.id));
            const remaining = payments.reduce((s, p) => s + p.remaining, 0);
            if (remaining <= 0)
                throw new core_2.UserInputError('该订单已无可退余额');
            if (fen > remaining) {
                throw new core_2.UserInputError(`退款金额超过可退余额（最多可退 ¥${(remaining / 100).toFixed(2)}）`);
            }
            // 新→旧逐张退，凑够本次金额（多支付单订单按各张余额分摊）
            let rest = fen;
            for (const picked of payments) {
                if (rest <= 0)
                    break;
                const part = Math.min(rest, picked.remaining);
                const created = await this.orderService.refundOrder(ctx, {
                    paymentId: picked.payment.id,
                    amount: part,
                    // refund 表 shipping/adjustment 列 NOT NULL，显式给 0（同 T4/拒单）
                    shipping: 0,
                    adjustment: 0,
                    reason: `merchant refund (${order.code}): ${trimmed}`,
                });
                if (!created || created.errorCode) {
                    throw new core_2.UserInputError(`退款失败：${(_d = created === null || created === void 0 ? void 0 : created.errorCode) !== null && _d !== void 0 ? _d : '未知原因'}`);
                }
                await (0, refund_payment_1.settleRefundOrMarkFailed)(this.connection, this.orderService, ctx, created.id);
                rest -= part;
            }
            // 售后触达顾客（未配置模板/短信网关时静默跳过）
            this.notify.user(ctx, order.id, 'afterSales', `商家退款 ¥${(fen / 100).toFixed(2)} 已原路退回`);
            // 回执口径与对账页一致：累计已退排除 Failed（结算失败单不改变实际余额）
            const refundedRows = await this.connection.rawConnection.query(`SELECT COALESCE(SUM(r.total), 0) AS "amount"
                   FROM refund r
                   JOIN payment p ON p.id = r."paymentId"
                  WHERE p."orderId" = $1 AND r.state <> 'Failed'`, [Number(order.id)]);
            const refundedTotal = Number((_f = (_e = refundedRows === null || refundedRows === void 0 ? void 0 : refundedRows[0]) === null || _e === void 0 ? void 0 : _e.amount) !== null && _f !== void 0 ? _f : 0);
            const after = await (0, refund_payment_1.refundablePayments)(this.connection, Number(order.id));
            const refundable = after.reduce((s, p) => s + p.remaining, 0);
            return { ok: true, amount: fen, refundedTotal, refundable };
        }
        finally {
            try {
                await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
            }
            catch (_g) {
                // 释放失败交给连接回收兜底
            }
            await runner.release();
        }
    }
    /** 出餐完成：按路线/承运分流（不再统一入抢单大厅） */
    async cookingDone(ctx, orderId) {
        var _a, _b;
        const order = await this.assertChannelOrder(ctx, orderId, 'accepted');
        const cf = order.customFields;
        const route = String((_a = cf.fulfillmentRoute) !== null && _a !== void 0 ? _a : '');
        const plan = String((_b = cf.deliveryPlan) !== null && _b !== void 0 ? _b : '');
        let patch;
        // R1：第一段由商户或自营快递完成，之后才进校园接力大厅
        if (route === 'R1') {
            patch = plan === 'owned'
                // 自营快递接单后送往交接点（cookingDone 即表示可以出发）
                ? { hallStatus: 'owned_dispatched', assignedAt: new Date() }
                : { hallStatus: 'merchant_delivering', assignedAt: new Date() };
        }
        else if (plan === 'external_courier') {
            // R2 与 R3-外部：等运营中心推送外部快递（assignedAt 标记出餐时刻，未推送超时从此计时）
            patch = { hallStatus: 'pending_dispatch', assignedAt: new Date() };
        }
        else if (plan === 'owned') {
            // R3-自营：进自营快递池抢单
            patch = { hallStatus: 'owned_pool' };
        }
        else {
            // R3-传信者：正常入抢单大厅
            patch = { hallStatus: 'open', hallEnteredAt: new Date() };
        }
        // 条件写：与用户取消/调度超时兜底并发时，已脱厅单不得被改回流转态
        const moved = await this.hall.transitionFrom(ctx, Number(order.id), ['accepted'], patch);
        if (!moved)
            throw new core_2.UserInputError('订单状态已变更，请刷新');
        this.notify.user(ctx, order.id, 'cookingDone');
        return { ok: true };
    }
    /** 批量接单（§73）：逐单复用单笔接单（含通知/云打印），失败跳过并回报 */
    async batchAcceptOrders(ctx, orderIds) {
        return this.runBatch(orderIds, id => this.acceptOrder(ctx, id));
    }
    /** 批量出餐（§73）：逐单复用单笔出餐分流，失败跳过并回报 */
    async batchCookingDone(ctx, orderIds) {
        return this.runBatch(orderIds, id => this.cookingDone(ctx, id));
    }
    /** 顺序执行批量动作：单笔失败（状态已变更/已脱厅/退款中等）只记明细，不中断后续单 */
    async runBatch(orderIds, run) {
        var _a;
        let ids;
        try {
            ids = (0, batch_orders_1.normalizeBatchOrderIds)(orderIds);
        }
        catch (err) {
            // 入参问题（空集合 / 超上限）属于调用方错误，直接以 UserInputError 反馈
            throw err instanceof batch_orders_1.BatchOrderInputError ? new core_2.UserInputError(err.message) : err;
        }
        let ok = 0;
        const failed = [];
        for (const id of ids) {
            try {
                await run(id);
                ok++;
            }
            catch (err) {
                failed.push({ orderId: id, message: (_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : '操作失败' });
            }
        }
        return { ok, failed };
    }
    /** 运营中心推送外部快递（选 dada / meituan） */
    async dispatchExternal(ctx, orderId, provider) {
        await this.assertAnyChannelOrder(ctx, orderId);
        return this.thirdParty.dispatchExternal(ctx, orderId, provider);
    }
    /** 取消外部快递（改推另一家 / 回落大厅前） */
    async cancelExternal(ctx, orderId, reason) {
        await this.assertAnyChannelOrder(ctx, orderId);
        return this.thirdParty.cancel(ctx, orderId, reason);
    }
    /** 自营快递接单（R1 商户超时转自营 / R3 自营池） */
    async acceptOwned(ctx, orderId) {
        await this.assertAnyChannelOrder(ctx, orderId);
        return this.thirdParty.acceptOwned(ctx, orderId);
    }
    /** R1：商户把餐送到校园交接点 → 传信者接力 */
    async markHandoverArrived(ctx, orderId) {
        await this.assertAnyChannelOrder(ctx, orderId);
        return this.thirdParty.completeFirstLeg(ctx, orderId, 'merchant_handover');
    }
    /** 自营快递送达（R1/R2 到交接点，R3 到学生） */
    async markOwnedArrived(ctx, orderId) {
        await this.assertAnyChannelOrder(ctx, orderId);
        return this.thirdParty.completeFirstLeg(ctx, orderId, 'owned_handover');
    }
    /** 营业开关：商家仅可切换本渠道 paused，其余配置仍归 CampusConfig 管理员 */
    async setPaused(ctx, paused) {
        await this.config.updateConfig(ctx, { paused });
        return { ok: true };
    }
    /** 自动接单设置（§69）：含今日已自动接单数与当前营业条件（休息中自动失效） */
    async autoAcceptSettings(ctx) {
        var _a, _b;
        const cfg = await this.config.getConfig(ctx);
        const hours = await this.channelBusinessHours(ctx);
        return {
            enabled: !!cfg.autoAcceptEnabled,
            delaySeconds: Number((_a = cfg.autoAcceptDelaySeconds) !== null && _a !== void 0 ? _a : auto_accept_1.AUTO_ACCEPT_DEFAULT_DELAY_SECONDS),
            dailyLimit: Number((_b = cfg.autoAcceptDailyLimit) !== null && _b !== void 0 ? _b : 0),
            routes: (0, auto_accept_1.normalizeAutoAcceptRoutes)(cfg.autoAcceptRoutes),
            acceptedToday: await this.countAutoAcceptedToday(ctx.channelId),
            // 与手动接单/C 端营业态同口径：营业时段内、未临时休息、且今日不在休业日历才会自动接
            openNow: (0, business_hours_1.isWithinBusinessHours)(hours) && !cfg.paused && !(0, closure_calendar_1.closedToday)((0, closure_calendar_1.safeClosureDates)(cfg.closureDates)),
            merchantConfirmEnabled: !!cfg.merchantConfirmEnabled,
        };
    }
    /** 自动接单设置保存：延迟/上限/路线走配置白名单校验（越界直接报错，不静默截断） */
    async updateAutoAccept(ctx, input) {
        const patch = { autoAcceptEnabled: !!input.enabled };
        if (input.delaySeconds !== undefined && input.delaySeconds !== null) {
            patch.autoAcceptDelaySeconds = Number(input.delaySeconds);
        }
        if (input.dailyLimit !== undefined && input.dailyLimit !== null) {
            patch.autoAcceptDailyLimit = Number(input.dailyLimit);
        }
        if (input.routes !== undefined && input.routes !== null) {
            patch.autoAcceptRoutes = (0, auto_accept_1.normalizeAutoAcceptRoutes)(input.routes);
        }
        await this.config.updateConfig(ctx, patch);
        return this.autoAcceptSettings(ctx);
    }
    /** 本店本校园日自动接单数（按 autoAcceptedAt 统计，跨零点自动归零） */
    async countAutoAcceptedToday(channelId) {
        var _a, _b;
        const rows = await this.connection.rawConnection.query('SELECT COUNT(*)::int AS n FROM "order" o '
            + 'JOIN order_channels_channel oc ON oc."orderId" = o.id AND oc."channelId" = $1 '
            + 'WHERE o."customFieldsAutoacceptedat" >= $2', [channelId, new Date((0, campus_time_1.startOfCampusDay)(Date.now()))]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return Number(Array.isArray(list) ? (_b = (_a = list[0]) === null || _a === void 0 ? void 0 : _a.n) !== null && _b !== void 0 ? _b : 0 : 0) || 0;
    }
    /** 小票打印回执：工作台打印成功后回写 waimaiPrintedAt（防重打 + 补打依据），不限订单状态 */
    async markPrinted(ctx, orderId) {
        var _a;
        const order = await this.connection.getRepository(ctx, core_2.Order).findOne({
            where: { id: orderId },
            relations: ['channels'],
        });
        const inChannel = (_a = order === null || order === void 0 ? void 0 : order.channels) === null || _a === void 0 ? void 0 : _a.some(c => String(c.id) === String(ctx.channelId));
        if (!order || !inChannel)
            throw new core_2.UserInputError('订单不存在或不属于当前店铺');
        await this.hall.updateOrder(ctx, order.id, {
            customFields: { waimaiPrintedAt: new Date() },
        });
        return { ok: true };
    }
    /** 商家确认「已知晓」顾客催单（§78）：只落小表时间戳，不改顾客侧 urged/urgedAt（骑手端仍可见催单标记） */
    async ackUrge(ctx, orderId) {
        var _a, _b;
        const order = await this.connection.getRepository(ctx, core_2.Order).findOne({
            where: { id: orderId },
            relations: ['channels'],
        });
        const inChannel = (_a = order === null || order === void 0 ? void 0 : order.channels) === null || _a === void 0 ? void 0 : _a.some(c => String(c.id) === String(ctx.channelId));
        if (!order || !inChannel)
            throw new core_2.UserInputError('订单不存在或不属于当前店铺');
        const cf = ((_b = order.customFields) !== null && _b !== void 0 ? _b : {});
        if (cf.urged !== true || !cf.urgedAt)
            throw new core_2.UserInputError('该订单没有待处理的顾客催单');
        await this.connection.rawConnection.query('INSERT INTO campus_urge_ack ("channelId", "orderId", "ackedAt") VALUES ($1, $2, now()) '
            + 'ON CONFLICT ("channelId", "orderId") DO UPDATE SET "ackedAt" = now(), "updatedAt" = now()', [ctx.channelId, Number(order.id)]);
        return { ok: true };
    }
    /** 批量取催单「已知晓」时间（§78）；小表缺失时按未处理兜底，不阻断工作台 */
    async urgeAckMap(ctx, orderIds) {
        const ids = orderIds.filter(n => Number.isFinite(n));
        if (!ids.length)
            return new Map();
        try {
            const rows = await this.connection.rawConnection.query('SELECT "orderId", "ackedAt" FROM campus_urge_ack WHERE "channelId" = $1 AND "orderId" = ANY($2::int[])', [ctx.channelId, ids]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            return new Map((Array.isArray(list) ? list : []).map((r) => [
                String(r.orderId),
                new Date(r.ackedAt),
            ]));
        }
        catch (_a) {
            return new Map();
        }
    }
    /** 云打印一张小票（后端签名直连服务商）：成功即回写 printedAt */
    async cloudPrint(ctx, orderId) {
        return this.cloud.printOrder(ctx, orderId, 'manual');
    }
    /** 云打印连通性测试（不占用订单） */
    async cloudPrintTest(ctx) {
        return this.cloud.testPrint(ctx);
    }
    /** 最近云打印任务（排障） */
    async printJobs(ctx, limit) {
        return this.cloud.recentJobs(ctx, limit);
    }
    /** KDS 出餐屏队列：待接单 + 备餐中（按支付先后出票，超时标红） */
    async kitchenQueue(ctx) {
        const orders = await this.connection.getRepository(ctx, core_2.Order)
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere("order.customFields.hallStatus IN ('pending_merchant','accepted')")
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('lines.productVariant', 'variant')
            .orderBy('order.createdAt', 'ASC')
            .getMany();
        const buildingIds = new Set();
        for (const o of orders) {
            const id = o.customFields.buildingId;
            if (id)
                buildingIds.add(String(id));
        }
        const buildings = buildingIds.size
            ? await this.connection.getRepository(ctx, campus_building_entity_1.CampusBuilding).findByIds([...buildingIds])
            : [];
        const buildingNames = new Map(buildings.map(b => [String(b.id), b.name]));
        const now = Date.now();
        const ackMap = await this.urgeAckMap(ctx, orders.map(o => Number(o.id)));
        const tickets = orders.map(o => {
            var _a, _b, _c, _d, _e, _f, _g;
            const cf = o.customFields;
            const urgedAt = cf.urgedAt ? new Date(cf.urgedAt) : null;
            const waitingMinutes = Math.max(0, Math.floor((now - new Date(o.createdAt).getTime()) / 60000));
            return {
                id: String(o.id),
                code: o.code,
                stage: cf.hallStatus === 'accepted' ? 'cooking' : 'pending',
                createdAt: o.createdAt,
                waitingMinutes,
                urgency: waitingMinutes >= exports.KDS_LATE_MINUTES ? 'late' : waitingMinutes >= exports.KDS_WARN_MINUTES ? 'warn' : 'normal',
                zone: (_a = cf.campusZone) !== null && _a !== void 0 ? _a : '',
                building: cf.buildingId ? (_b = buildingNames.get(String(cf.buildingId))) !== null && _b !== void 0 ? _b : '' : '',
                slotText: (_c = cf.deliverySlotText) !== null && _c !== void 0 ? _c : '',
                note: (_d = cf.note) !== null && _d !== void 0 ? _d : null,
                printedAt: (_e = cf.waimaiPrintedAt) !== null && _e !== void 0 ? _e : null,
                total: o.total,
                urged: isUrgePending(cf.urged, urgedAt, (_f = ackMap.get(String(o.id))) !== null && _f !== void 0 ? _f : null),
                lines: ((_g = o.lines) !== null && _g !== void 0 ? _g : []).map(l => {
                    var _a, _b, _c;
                    const addonsText = (0, addon_fee_1.addonDisplayText)((_a = l.customFields) === null || _a === void 0 ? void 0 : _a.waimaiAddons);
                    return {
                        name: (_c = (_b = l.productVariant) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : '',
                        quantity: l.quantity,
                        addons: addonsText ? addonsText.split(' / ') : [],
                    };
                }),
            };
        });
        // 顾客催单的票排前面（同催单状态下仍按支付先后）
        tickets.sort((a, b) => Number(b.urged) - Number(a.urged) || +a.createdAt - +b.createdAt);
        return {
            tickets,
            pendingCount: tickets.filter(t => t.stage === 'pending').length,
            cookingCount: tickets.filter(t => t.stage === 'cooking').length,
            lateCount: tickets.filter(t => t.urgency === 'late').length,
            urgedCount: tickets.filter(t => t.urged).length,
            warnMinutes: exports.KDS_WARN_MINUTES,
            lateMinutes: exports.KDS_LATE_MINUTES,
        };
    }
    /**
     * 备餐汇总（§79）：今日「待接单 + 备餐中」按商品聚合待做份数，
     * 叠加今日已送达份数，供后厨按份备料；加料/口味按同一商品合并计数。
     * 口径与出餐屏/工作台一致：待做取活跃单（不落小票），已做按送达时间归今日。
     */
    async prepSummary(ctx) {
        const repo = this.connection.getRepository(ctx, core_2.Order);
        const todoOrders = await repo
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere("order.customFields.hallStatus IN ('pending_merchant','accepted')")
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('lines.productVariant', 'variant')
            .getMany();
        const startOfDay = new Date((0, campus_time_1.startOfCampusDay)(Date.now()));
        const doneOrders = await repo
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere("order.customFields.deliveryStatus = 'delivered'")
            .andWhere('order.customFields.deliveredAt >= :start', { start: startOfDay })
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('lines.productVariant', 'variant')
            .getMany();
        const acc = new Map();
        const bump = (o, field) => {
            var _a, _b, _c, _d, _e, _f;
            for (const l of (_a = o.lines) !== null && _a !== void 0 ? _a : []) {
                const name = (_c = (_b = l.productVariant) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : '';
                if (!name)
                    continue;
                const cur = (_d = acc.get(name)) !== null && _d !== void 0 ? _d : { pending: 0, cooking: 0, done: 0, addons: new Map() };
                cur[field] += l.quantity;
                const addonsText = (0, addon_fee_1.addonDisplayText)((_e = l.customFields) === null || _e === void 0 ? void 0 : _e.waimaiAddons);
                if (addonsText) {
                    for (const opt of addonsText.split(' / ')) {
                        if (!opt)
                            continue;
                        cur.addons.set(opt, ((_f = cur.addons.get(opt)) !== null && _f !== void 0 ? _f : 0) + l.quantity);
                    }
                }
                acc.set(name, cur);
            }
        };
        for (const o of todoOrders)
            bump(o, o.customFields.hallStatus === 'accepted' ? 'cooking' : 'pending');
        for (const o of doneOrders)
            bump(o, 'done');
        return [...acc.entries()]
            .map(([name, v]) => ({
            name,
            pendingQty: v.pending,
            cookingQty: v.cooking,
            doneQty: v.done,
            todoQty: v.pending + v.cooking,
            totalQty: v.pending + v.cooking + v.done,
            addons: [...v.addons.entries()].map(([n, q]) => ({ name: n, quantity: q })),
        }))
            // 待做多的排前面（后厨优先看今天还要做多少），其次按今日总量、名称
            .sort((a, b) => b.todoQty - a.todoQty || b.totalQty - a.totalQty || a.name.localeCompare(b.name));
    }
    /** 营业日报（§80）：单日经营快照 —— KPI、时段分布、商品 Top5、对比昨日与近 7 日均值 */
    async dailyReport(ctx, date) {
        var _a, _b, _c, _d, _e, _f;
        const DAY_MS = 24 * 3600000;
        const now = Date.now();
        const today0 = (0, campus_time_1.startOfCampusDay)(now);
        const raw = String(date !== null && date !== void 0 ? date : '').trim();
        let day0 = today0;
        if (raw) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(raw).getTime())) {
                throw new core_2.UserInputError('日期格式不合法（YYYY-MM-DD）');
            }
            day0 = (0, campus_time_1.startOfCampusDay)(new Date(raw).getTime());
            if (day0 > today0)
                throw new core_2.UserInputError('不能查看未来日期的营业日报');
            if (day0 < today0 - 29 * DAY_MS)
                throw new core_2.UserInputError('营业日报最多回看 30 天');
        }
        const dayKey = (0, campus_time_1.campusDayKey)(day0);
        const prevKey = (0, campus_time_1.campusDayKey)(day0 - DAY_MS);
        const isToday = day0 === today0;
        // 一次查询覆盖「当日 + 前 7 日」，避免多次往返
        const orders = await this.connection
            .getRepository(ctx, core_2.Order)
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere('order.customFields.hallStatus IS NOT NULL')
            .andWhere('order.createdAt >= :since', { since: new Date(day0 - 7 * DAY_MS) })
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('lines.productVariant', 'variant')
            .getMany();
        const hourCount = isToday ? (0, campus_time_1.campusHour)(now) + 1 : 24;
        const hourly = Array.from({ length: hourCount }, (_, h) => ({ hour: h, orders: 0, gross: 0 }));
        const products = new Map();
        let ordersCur = 0;
        let grossCur = 0;
        let cancelled = 0;
        let cancelledAmount = 0;
        const prev = { orders: 0, gross: 0, avgTicket: 0 };
        let sum7Orders = 0;
        let sum7Gross = 0;
        for (const o of orders) {
            const cf = o.customFields;
            const total = (_a = o.totalWithTax) !== null && _a !== void 0 ? _a : 0;
            if (o.state === 'Cancelled') {
                // 取消单按下单日归日（与经营设置页营收口径一致）
                if ((0, campus_time_1.campusDayKey)(new Date(o.createdAt).getTime()) === dayKey) {
                    cancelled += 1;
                    cancelledAmount += total;
                }
                continue;
            }
            if (cf.deliveryStatus !== 'delivered' || !cf.deliveredAt)
                continue;
            // 营业额按送达时间归日：跨零点订单计入实际送达当天
            const doneAt = new Date(cf.deliveredAt).getTime();
            const doneKey = (0, campus_time_1.campusDayKey)(doneAt);
            if (doneKey === dayKey) {
                ordersCur += 1;
                grossCur += total;
                const h = (0, campus_time_1.campusHour)(doneAt);
                if (h < hourly.length) {
                    hourly[h].orders += 1;
                    hourly[h].gross += total;
                }
                for (const l of (_b = o.lines) !== null && _b !== void 0 ? _b : []) {
                    const name = (_d = (_c = l.productVariant) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : '';
                    if (!name)
                        continue;
                    const cur = (_e = products.get(name)) !== null && _e !== void 0 ? _e : { name, qty: 0, amount: 0 };
                    cur.qty += l.quantity;
                    cur.amount += (_f = l.linePriceWithTax) !== null && _f !== void 0 ? _f : 0;
                    products.set(name, cur);
                }
            }
            else if (doneKey === prevKey) {
                prev.orders += 1;
                prev.gross += total;
            }
            if (doneAt >= day0 - 7 * DAY_MS && doneAt < day0) {
                sum7Orders += 1;
                sum7Gross += total;
            }
        }
        prev.avgTicket = prev.orders ? Math.round(prev.gross / prev.orders) : 0;
        return {
            date: dayKey,
            orders: ordersCur,
            gross: grossCur,
            avgTicket: ordersCur ? Math.round(grossCur / ordersCur) : 0,
            cancelled,
            cancelledAmount,
            hourly,
            topProducts: [...products.values()]
                .sort((a, b) => b.qty - a.qty || b.amount - a.amount || a.name.localeCompare(b.name))
                .slice(0, 5),
            prev,
            // 近 7 日均值：单量/营业额按 7 天均摊，客单价用 7 日整体客单价
            last7Avg: {
                orders: Math.round(sum7Orders / 7),
                gross: Math.round(sum7Gross / 7),
                avgTicket: sum7Orders ? Math.round(sum7Gross / sum7Orders) : 0,
            },
        };
    }
    /** 售后申请清单（§81）：只列本店渠道订单的售后单；state 为空=全部 */
    async afterSalesList(ctx, state, opts = {}) {
        var _a, _b;
        const repo = this.connection.getRepository(ctx, after_sales_plugin_1.AfterSalesRequest);
        // 渠道隔离：售后单本身挂了 channels，但其归属以订单渠道为准（售后单可能由平台代建）
        const scoped = () => repo.createQueryBuilder('a')
            .leftJoin('a.order', 'o')
            .leftJoin('o.channels', 'c')
            .where('c.id = :ch', { ch: ctx.channelId })
            .andWhere('o.customFields.hallStatus IS NOT NULL');
        const { from, to } = this.afterSalesRange(opts);
        const rules = await this.afterSalesRules(ctx);
        /** 追加非 state 筛选条件（原地修改并返回，保持 QueryBuilder 类型以便 getMany 正常推断） */
        const applyFilters = (target) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const type = String((_a = opts.type) !== null && _a !== void 0 ? _a : '').trim();
            if (type)
                target.andWhere('a.type = :tp', { tp: type });
            const code = String((_b = opts.orderCode) !== null && _b !== void 0 ? _b : '').trim();
            if (code)
                target.andWhere('o.code ILIKE :code', { code: `%${code}%` });
            // 顾客关键字（§87）：手机号/姓/名模糊匹配；只做筛选，列表字段仍按既有脱敏口径
            const keyword = String((_c = opts.keyword) !== null && _c !== void 0 ? _c : '').trim();
            if (keyword) {
                target.leftJoin('a.customer', 'kwc')
                    .andWhere('(kwc."phoneNumber" ILIKE :kw OR kwc."firstName" ILIKE :kw OR kwc."lastName" ILIKE :kw)', {
                    kw: `%${keyword}%`,
                });
            }
            // 标签筛选（§88）：按本店标签过滤，跨店 tagId 自然无命中
            const tag = String((_d = opts.tag) !== null && _d !== void 0 ? _d : '').trim();
            if (tag) {
                target.andWhere('a.id IN (SELECT l."requestId" FROM campus_after_sales_tag_link l '
                    + 'WHERE l."channelId" = :tch AND l."tagId" = :tag)', { tch: Number(ctx.channelId), tag: Number(tag) });
            }
            if (from)
                target.andWhere('a.createdAt >= :from', { from });
            if (to)
                target.andWhere('a.createdAt < :to', { to });
            // 处理人筛选（§89）：'none'=未指派
            const assignee = String((_e = opts.assignee) !== null && _e !== void 0 ? _e : '').trim();
            if (assignee) {
                const ach = Number(ctx.channelId);
                if (assignee === 'none') {
                    target.andWhere('NOT EXISTS (SELECT 1 FROM campus_after_sales_assignee al '
                        + 'WHERE al."channelId" = :ach AND al."requestId" = a.id)', { ach });
                }
                else {
                    target.andWhere('a.id IN (SELECT al."requestId" FROM campus_after_sales_assignee al '
                        + 'WHERE al."channelId" = :ach AND al."assigneeUserId" = :assignee)', { ach, assignee: Number(assignee) });
                }
            }
            // 留言关键词（§91）：命中顾客或商家任一留言即可
            const messageKeyword = String((_f = opts.messageKeyword) !== null && _f !== void 0 ? _f : '').trim();
            if (messageKeyword) {
                target.andWhere('EXISTS (SELECT 1 FROM after_sales_message mk '
                    + 'WHERE mk."requestId" = a.id AND mk.content ILIKE :mk)', { mk: `%${messageKeyword}%` });
            }
            // 快捷筛选（§91）：超时 / 临期 / 未回复 / 回访到期（§95）
            const attention = String((_g = opts.attention) !== null && _g !== void 0 ? _g : '').trim();
            // SLA 截止时间（§95）：申请时间 + 时限 + 已暂停累计时长；暂停中不参与超时/临期判定
            // §99：优先用营业时段感知的 slaDeadlineAt（定时任务/规则变更时写入），缺失时退回日历口径
            const deadlineExpr = 'COALESCE(a."slaDeadlineAt", a."createdAt" + make_interval(hours => :toh) '
                + '+ (COALESCE(a."slaPausedMs", 0) / 1000) * interval \'1 second\')';
            if (attention) {
                if (attention === 'overdue') {
                    target.andWhere('a.state = \'Pending\'')
                        .andWhere('a."slaPausedAt" IS NULL')
                        .andWhere(`${deadlineExpr} <= now()`, { toh: this.afterSalesTimeoutHours(ctx) });
                }
                else if (attention === 'dueSoon') {
                    if (rules.dueSoonHours > 0) {
                        target.andWhere('a.state = \'Pending\'')
                            .andWhere('a."slaPausedAt" IS NULL')
                            .andWhere(`${deadlineExpr} > now()`, { toh: this.afterSalesTimeoutHours(ctx) })
                            .andWhere(`${deadlineExpr} - now() <= make_interval(hours => :dsh)`, {
                            toh: this.afterSalesTimeoutHours(ctx),
                            dsh: rules.dueSoonHours,
                        });
                    }
                    else {
                        target.andWhere('1 = 0');
                    }
                }
                else if (attention === 'unread') {
                    target.andWhere('(SELECT m."senderType" FROM after_sales_message m '
                        + 'WHERE m."requestId" = a.id ORDER BY m."createdAt" DESC LIMIT 1) = \'customer\'');
                }
                else if (attention === 'followUp') {
                    target.andWhere('EXISTS (SELECT 1 FROM campus_after_sales_followup fu '
                        + 'WHERE fu."channelId" = :fch AND fu."requestId" = a.id '
                        + 'AND fu."nextAt" IS NOT NULL AND fu."nextAt" <= now() '
                        + 'AND NOT EXISTS (SELECT 1 FROM campus_after_sales_followup fu2 '
                        + 'WHERE fu2."requestId" = fu."requestId" AND fu2."createdAt" > fu."createdAt"))', { fch: Number(ctx.channelId) });
                }
            }
            // 金额筛选（§92）：按退款金额（实际退款优先，未退款取申请额）
            const minAmount = Number(opts.minAmount);
            if (Number.isFinite(minAmount) && minAmount > 0) {
                target.andWhere('COALESCE(a."actualRefundAmount", a."refundAmount") >= :minA', { minA: Math.floor(minAmount) });
            }
            const maxAmount = Number(opts.maxAmount);
            if (Number.isFinite(maxAmount) && maxAmount > 0) {
                target.andWhere('COALESCE(a."actualRefundAmount", a."refundAmount") <= :maxA', { maxA: Math.floor(maxAmount) });
            }
            // 风险筛选（§94）：仅已标记且未解除
            if (String((_h = opts.risk) !== null && _h !== void 0 ? _h : '').trim() === 'flagged') {
                target.andWhere('EXISTS (SELECT 1 FROM campus_after_sales_risk rk '
                    + 'WHERE rk."channelId" = :rch AND rk."requestId" = a.id AND rk.active = true)', { rch: Number(ctx.channelId) });
            }
            return target;
        };
        // 状态计数不受 state 筛选影响：入口红点与页签角标口径统一
        const countRows = await scoped()
            .select('a.state', 'state')
            .addSelect('COUNT(*)', 'n')
            .groupBy('a.state')
            .getRawMany();
        const stateCounts = countRows
            .map(r => { var _a; return ({ state: String((_a = r.state) !== null && _a !== void 0 ? _a : ''), count: Number(r.n) || 0 }); })
            .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
        const pendingCount = stateCounts
            .filter(r => AFTER_SALES_PENDING_STATES.includes(r.state))
            .reduce((s, r) => s + r.count, 0);
        const wanted = String(state !== null && state !== void 0 ? state : '').trim();
        const totalQb = applyFilters(scoped());
        if (wanted)
            totalQb.andWhere('a.state = :st', { st: wanted });
        const total = await totalQb.getCount();
        const take = Math.min(Math.max(Number((_a = opts.take) !== null && _a !== void 0 ? _a : 50) || 50, 1), 100);
        const skip = Math.max(Number((_b = opts.skip) !== null && _b !== void 0 ? _b : 0) || 0, 0);
        const qb = applyFilters(scoped())
            .leftJoinAndSelect('a.customer', 'customer')
            // §115 退款失败单全局置顶：失败单排序权重 0、其余 1（跨分页稳定），同权重按申请时间倒序
            // 别名必须全小写：最终查询的 ORDER BY 别名不带引号，驼峰会被折叠成小写而找不到列
            .addSelect(`CASE WHEN a.state = 'RefundFailed' THEN 0 ELSE 1 END`, 'refund_pin')
            .orderBy('refund_pin', 'ASC')
            .addOrderBy('a.createdAt', 'DESC')
            .skip(skip)
            .take(take);
        if (wanted)
            qb.andWhere('a.state = :st', { st: wanted });
        const rows = await qb.getMany();
        const counts = await this.afterSalesMessageCounts(ctx, rows.map(r => Number(r.id)));
        const lastSender = await this.afterSalesLastSender(rows.map(r => Number(r.id)));
        const tagMap = await this.afterSalesTagNames(ctx, rows.map(r => Number(r.id)));
        const assigneeMap = await this.afterSalesAssigneeMap(ctx, rows.map(r => Number(r.id)));
        const riskMap = await this.afterSalesRiskReasons(ctx, rows.map(r => Number(r.id)));
        const slaPauseMap = await this.afterSalesSlaPauses(rows.map(r => Number(r.id)));
        const escalatedMap = await this.afterSalesEscalatedMap(ctx, rows.map(r => Number(r.id)));
        const reviewPending = await this.refundReviewPendingSet(ctx, rows.map(r => Number(r.id)));
        const timeoutHours = this.afterSalesTimeoutHours(ctx);
        const businessHours = await this.channelBusinessHours(ctx);
        const now = Date.now();
        return {
            items: rows.map(r => this.toAfterSalesRow(r, counts, timeoutHours, now, lastSender, {
                tags: tagMap,
                dueSoonHours: rules.dueSoonHours,
                assignees: assigneeMap,
                risks: riskMap,
                slaPauses: slaPauseMap,
                escalated: escalatedMap,
                refundReviewPending: reviewPending,
                businessHours,
            })),
            pendingCount,
            total,
            stateCounts,
            skip,
            take,
        };
    }
    /**
     * 同意售后（§81）：refund_only 由售后插件链式 Received → 退款到账，商家一次操作即闭环；
     * 先按「本店渠道 + 待处理」校验，避免越权或已处理单重复触发退款。
     * 顾客申诉（Rejected → Appealed）后商家仍可同意（appealRequest 已把申诉说明写入留言流）。
     * §99：退款金额达到渠道复核阈值时只登记待复核，由另一位管理员确认后才真正退款。
     */
    async afterSalesApprove(ctx, id) {
        var _a;
        const request = await this.assertChannelAfterSales(ctx, id, AFTER_SALES_PENDING_STATES);
        const svc = this.getAfterSales();
        if (!svc)
            throw new core_2.UserInputError('售后插件未安装，暂不能处理售后申请');
        const gated = await this.refundReviewGate(ctx, [Number(request.id)]);
        if (gated.has(Number(request.id))) {
            await this.createRefundReview(ctx, Number(request.id), gated.get(Number(request.id)));
            return this.afterSalesOne(ctx, id);
        }
        try {
            await svc.approveRequest(ctx, id);
        }
        catch (e) {
            throw new core_2.UserInputError(`同意售后失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
        await this.auditAfterSales(ctx, Number(id), 'approve');
        return this.afterSalesOne(ctx, id);
    }
    /**
     * 大额退款复核门槛（§99）：返回「需要复核」的售后单及申请退款金额。
     * 阈值为 0 或单金额低于阈值时无需复核，保持原直退链路。
     */
    async refundReviewGate(ctx, ids) {
        var _a, _b;
        const out = new Map();
        const list = Array.from(new Set(ids.filter(n => Number.isFinite(n) && n > 0)));
        if (!list.length)
            return out;
        const rules = await this.afterSalesRules(ctx);
        if (rules.refundReviewThreshold <= 0)
            return out;
        const rows = await this.connection.rawConnection.query('SELECT id, "refundAmount" AS amount, state FROM after_sales_request WHERE id = ANY($1::int[])', [list]);
        const rawList = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        for (const r of Array.isArray(rawList) ? rawList : []) {
            if (!AFTER_SALES_PENDING_STATES.includes(String((_a = r.state) !== null && _a !== void 0 ? _a : '')))
                continue;
            const amount = Math.round(Number((_b = r.amount) !== null && _b !== void 0 ? _b : 0));
            if (amount >= rules.refundReviewThreshold)
                out.set(Number(r.id), amount);
        }
        return out;
    }
    /** 登记待复核（§99）：同一售后单仅保留一条 Pending 记录（部分唯一索引兜底幂等） */
    async createRefundReview(ctx, requestId, amount) {
        var _a;
        try {
            await this.connection.rawConnection.query('INSERT INTO campus_after_sales_refund_review ("channelId", "requestId", amount, "requestedBy") '
                + 'VALUES ($1, $2, $3, $4) '
                + 'ON CONFLICT ("channelId", "requestId") WHERE status = \'Pending\' DO NOTHING', [Number(ctx.channelId), requestId, Math.round(amount), ctx.activeUserId ? Number(ctx.activeUserId) : null]);
        }
        catch (e) {
            throw new core_2.UserInputError(`大额退款复核登记失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
    }
    /** 大额退款复核队列（§99）：默认只列待复核，附订单号与申请人/复核人姓名 */
    async afterSalesRefundReviews(ctx, status) {
        var _a;
        const st = String(status !== null && status !== void 0 ? status : '').trim() || 'Pending';
        if (!['Pending', 'Approved', 'Rejected'].includes(st)) {
            throw new core_2.UserInputError('复核状态只能是 Pending / Approved / Rejected');
        }
        try {
            const rows = await this.connection.rawConnection.query(`SELECT r.id, r."requestId", r.amount, r.status, r."requestedBy", r."requestedAt",
                        r."reviewedBy", r."reviewedAt", r.note,
                        o.id AS "orderId", o.code AS "orderCode",
                        rb."firstName" AS rbf, rb."lastName" AS rbl,
                        vb."firstName" AS vbf, vb."lastName" AS vbl
                   FROM campus_after_sales_refund_review r
                   JOIN after_sales_request a ON a.id = r."requestId"
                   JOIN "order" o ON o.id = a."orderId"
                   LEFT JOIN administrator rb ON rb."userId" = r."requestedBy"
                   LEFT JOIN administrator vb ON vb."userId" = r."reviewedBy"
                  WHERE r."channelId" = $1 AND r.status = $2
                    AND (r.status <> 'Pending' OR a.state IN ('Pending', 'Appealed'))
                  ORDER BY r."requestedAt" ASC LIMIT 100`, [Number(ctx.channelId), st]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            return (Array.isArray(list) ? list : []).map(r => this.toRefundReview(ctx, r));
        }
        catch (e) {
            core_2.Logger.warn(`refund review list failed: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, 'CampusMerchantAfterSales');
            return [];
        }
    }
    /**
     * 复核大额退款（§99）：approve=true 才真正调用售后插件退款，false=驳回复核（售后单保持待处理）。
     * 必须由另一位管理员复核；申请人为空（系统登记）不受此限制。
     */
    async afterSalesResolveRefundReview(ctx, id, approve, note) {
        var _a;
        const chId = Number(ctx.channelId);
        const raw = this.connection.rawConnection;
        const rows = await raw.query('SELECT "requestId", "requestedBy", status FROM campus_after_sales_refund_review '
            + 'WHERE id = $1 AND "channelId" = $2', [Number(id), chId]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const row = Array.isArray(list) ? list[0] : null;
        if (!row)
            throw new core_2.UserInputError('复核记录不存在或不属于当前店铺');
        if (String(row.status) !== 'Pending')
            throw new core_2.UserInputError('该复核记录已处理');
        const requestedBy = row.requestedBy == null ? null : Number(row.requestedBy);
        if (requestedBy != null && ctx.activeUserId != null && Number(ctx.activeUserId) === requestedBy) {
            throw new core_2.UserInputError('大额退款需由另一位管理员复核');
        }
        const text = String(note !== null && note !== void 0 ? note : '').trim();
        if (text.length > 200)
            throw new core_2.UserInputError('复核备注最多 200 字');
        const requestId = Number(row.requestId);
        if (approve) {
            await this.assertChannelAfterSales(ctx, requestId, AFTER_SALES_PENDING_STATES);
            const svc = this.getAfterSales();
            if (!svc)
                throw new core_2.UserInputError('售后插件未安装，暂不能处理售后申请');
            try {
                await svc.approveRequest(ctx, requestId);
            }
            catch (e) {
                throw new core_2.UserInputError(`复核通过后执行退款失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
            }
        }
        await raw.query('UPDATE campus_after_sales_refund_review SET status = $2, "reviewedBy" = $3, "reviewedAt" = now(), '
            + 'note = $4, "updatedAt" = now() WHERE id = $1 AND status = \'Pending\'', [Number(id), approve ? 'Approved' : 'Rejected', ctx.activeUserId ? Number(ctx.activeUserId) : null, text || null]);
        await this.auditAfterSales(ctx, requestId, approve ? 'refundReviewApprove' : 'refundReviewReject', text ? `复核备注：${text}` : null);
        const one = await this.refundReviewOne(ctx, Number(id));
        if (!one)
            throw new core_2.UserInputError('复核记录读取失败');
        return one;
    }
    async refundReviewOne(ctx, id) {
        const rows = await this.connection.rawConnection.query(`SELECT r.id, r."requestId", r.amount, r.status, r."requestedBy", r."requestedAt",
                    r."reviewedBy", r."reviewedAt", r.note,
                    o.id AS "orderId", o.code AS "orderCode",
                    rb."firstName" AS rbf, rb."lastName" AS rbl,
                    vb."firstName" AS vbf, vb."lastName" AS vbl
               FROM campus_after_sales_refund_review r
               JOIN after_sales_request a ON a.id = r."requestId"
               JOIN "order" o ON o.id = a."orderId"
               LEFT JOIN administrator rb ON rb."userId" = r."requestedBy"
               LEFT JOIN administrator vb ON vb."userId" = r."reviewedBy"
              WHERE r.id = $1 AND r."channelId" = $2`, [id, Number(ctx.channelId)]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const r = Array.isArray(list) ? list[0] : null;
        return r ? this.toRefundReview(ctx, r) : null;
    }
    toRefundReview(ctx, r) {
        var _a, _b, _c;
        const requestedBy = r.requestedBy == null ? null : String(r.requestedBy);
        return {
            id: String(r.id),
            requestId: String(r.requestId),
            orderId: String((_a = r.orderId) !== null && _a !== void 0 ? _a : ''),
            orderCode: String((_b = r.orderCode) !== null && _b !== void 0 ? _b : ''),
            amount: Number(r.amount) || 0,
            status: String((_c = r.status) !== null && _c !== void 0 ? _c : ''),
            requestedBy,
            requestedByName: [r.rbf, r.rbl].filter(Boolean).join('') || null,
            requestedAt: new Date(r.requestedAt),
            reviewedBy: r.reviewedBy == null ? null : String(r.reviewedBy),
            reviewedByName: [r.vbf, r.vbl].filter(Boolean).join('') || null,
            reviewedAt: r.reviewedAt == null ? null : new Date(r.reviewedAt),
            note: r.note == null ? null : String(r.note),
            selfRequested: ctx.activeUserId != null && requestedBy != null
                && String(ctx.activeUserId) === requestedBy,
        };
    }
    /** 待复核标记（§99）：列表/详情标出「已提交复核」，避免商家误以为卡单 */
    async refundReviewPendingSet(ctx, ids) {
        const out = new Set();
        const list = Array.from(new Set(ids.filter(n => Number.isFinite(n) && n > 0)));
        if (!list.length)
            return out;
        try {
            const rows = await this.connection.rawConnection.query('SELECT "requestId" FROM campus_after_sales_refund_review '
                + 'WHERE "channelId" = $1 AND status = \'Pending\' AND "requestId" = ANY($2::int[])', [Number(ctx.channelId), list]);
            const rawList = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            for (const r of Array.isArray(rawList) ? rawList : [])
                out.add(Number(r.requestId));
        }
        catch (_a) {
            return out;
        }
        return out;
    }
    /**
     * 售后详情（§81）：售后单 + 协商留言（含顾客申诉说明）+ 状态时间线 + 退款失败留痕。
     * 渠道隔离同列表；留言表缺失时降级为空列表，不影响详情可用。
     */
    async afterSalesDetail(ctx, id) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const request = await this.assertChannelAfterSales(ctx, id, []);
        const counts = await this.afterSalesMessageCounts(ctx, [Number(request.id)]);
        const lastSender = await this.afterSalesLastSender([Number(request.id)]);
        const timeoutHours = this.afterSalesTimeoutHours(ctx);
        const messages = await this.afterSalesMessageRows(Number(request.id));
        const stateHistory = await this.afterSalesHistoryRows(Number(request.id));
        const order = request.order;
        const customer = request.customer;
        const addr = (_a = order === null || order === void 0 ? void 0 : order.shippingAddress) !== null && _a !== void 0 ? _a : null;
        const riskMap = await this.afterSalesRiskReasons(ctx, [Number(request.id)]);
        const slaPauseMap = await this.afterSalesSlaPauses([Number(request.id)]);
        const escalatedMap = await this.afterSalesEscalatedMap(ctx, [Number(request.id)]);
        const reviewPending = await this.refundReviewPendingSet(ctx, [Number(request.id)]);
        const businessHours = await this.channelBusinessHours(ctx);
        return {
            request: this.toAfterSalesRow(request, counts, timeoutHours, Date.now(), lastSender, {
                risks: riskMap,
                slaPauses: slaPauseMap,
                escalated: escalatedMap,
                refundReviewPending: reviewPending,
                businessHours,
            }),
            messages,
            messageTotal: (_b = counts.get(Number(request.id))) !== null && _b !== void 0 ? _b : messages.length,
            stateHistory,
            refundError: (_c = request.refundError) !== null && _c !== void 0 ? _c : null,
            actualRefundAmount: request.actualRefundAmount == null ? null : Number(request.actualRefundAmount),
            timeoutHours,
            customerPhone: (_d = customer === null || customer === void 0 ? void 0 : customer.phoneNumber) !== null && _d !== void 0 ? _d : null,
            shippingAddress: addr
                ? {
                    fullName: [addr.fullName, addr.company].filter(Boolean).join(' / ') || String((_e = addr.fullName) !== null && _e !== void 0 ? _e : ''),
                    phoneNumber: String((_f = addr.phoneNumber) !== null && _f !== void 0 ? _f : ''),
                    address: [addr.streetLine1, addr.streetLine2, addr.postalCode]
                        .filter(Boolean)
                        .join(' '),
                }
                : null,
            orderItems: await this.afterSalesOrderItems(Number((_g = order === null || order === void 0 ? void 0 : order.id) !== null && _g !== void 0 ? _g : request.orderId)),
            orderTotal: Number((_h = order === null || order === void 0 ? void 0 : order.totalWithTax) !== null && _h !== void 0 ? _h : 0),
            assignHistory: await this.afterSalesAssignLogs(Number(request.id)),
            followUps: await this.afterSalesFollowUps(Number(request.id)),
            slaPauses: await this.afterSalesSlaPauseLogs(Number(request.id)),
            escalations: await this.afterSalesEscalations(Number(request.id)),
        };
    }
    /**
     * 商家确认收到退货（§82）：Returning → Received，退货回补与退款收紧由售后插件同事务完成。
     * 收货备注先写留言流（失败只告警，不阻断收货）。
     */
    async afterSalesConfirmReturn(ctx, id, receivedQuantity, note) {
        var _a, _b;
        await this.assertChannelAfterSales(ctx, id, ['Returning']);
        const svc = this.getAfterSales();
        if (!svc)
            throw new core_2.UserInputError('售后插件未安装，暂不能处理售后申请');
        const qty = receivedQuantity == null ? undefined : Math.max(0, Math.floor(Number(receivedQuantity)));
        const remark = String(note !== null && note !== void 0 ? note : '').trim();
        try {
            if (remark) {
                try {
                    await svc.addMessage(ctx, id, 'admin', remark.slice(0, 500));
                }
                catch (e) {
                    core_2.Logger.warn(`确认收货备注写入留言失败: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, 'CampusMerchantAfterSales');
                }
            }
            await svc.confirmReceive(ctx, id, qty);
        }
        catch (e) {
            throw new core_2.UserInputError(`确认收货失败：${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`);
        }
        await this.auditAfterSales(ctx, Number(id), 'confirmReturn', `收货数量：${qty == null ? '未填' : qty}${remark ? `，备注：${remark}` : ''}`);
        return this.afterSalesOne(ctx, id);
    }
    /**
     * 售后退款失败重试（§82）：仅 RefundFailed 可重试，复用售后插件退款核心（按剩余可退额度继续退）。
     * 30 秒内同单只放行一次，避免连点造成重复退款尝试。
     */
    async afterSalesRetryRefund(ctx, id) {
        var _a, _b;
        await this.assertChannelAfterSales(ctx, id, ['RefundFailed']);
        const key = Number(id);
        if (this.dedupe) {
            // M5：跨实例共享冷却，避免多实例下连点绕过 30 秒限制
            if (await this.dedupe.seenOrMark(`merchant_refund_retry:${key}`, 30000)) {
                throw new core_2.UserInputError('退款重试过于频繁，请 30 秒后再试');
            }
        }
        else {
            const now = Date.now();
            if (now - ((_a = this.refundRetryAt.get(key)) !== null && _a !== void 0 ? _a : 0) < 30000) {
                throw new core_2.UserInputError('退款重试过于频繁，请 30 秒后再试');
            }
            this.refundRetryAt.set(key, now);
            // 防内存增长：清理 1 分钟前的记录
            if (this.refundRetryAt.size > 500) {
                for (const [k, t] of this.refundRetryAt) {
                    if (now - t > 60000)
                        this.refundRetryAt.delete(k);
                }
            }
        }
        const svc = this.getAfterSales();
        if (!svc)
            throw new core_2.UserInputError('售后插件未安装，暂不能处理售后申请');
        try {
            await svc.retryRefund(ctx, id);
        }
        catch (e) {
            throw new core_2.UserInputError(`退款重试失败：${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`);
        }
        await this.auditAfterSales(ctx, Number(id), 'retryRefund');
        return this.afterSalesOne(ctx, id);
    }
    /**
     * 换货发货（§83）：Received → ExchangeShipped，仅 exchange 类型可走。
     * 换货完成由顾客在本端确认收货（插件 exchangeReceive 校验归属），商家不代确认。
     */
    async afterSalesExchangeShip(ctx, id, trackingNo, carrier) {
        var _a;
        await this.assertChannelAfterSales(ctx, id, ['Received']);
        const svc = this.getAfterSales();
        if (!svc)
            throw new core_2.UserInputError('售后插件未安装，暂不能处理售后申请');
        const no = String(trackingNo !== null && trackingNo !== void 0 ? trackingNo : '').trim();
        const cr = String(carrier !== null && carrier !== void 0 ? carrier : '').trim();
        if (!no)
            throw new core_2.UserInputError('请填写换货运单号');
        if (no.length > 64 || cr.length > 64)
            throw new core_2.UserInputError('运单号或承运商过长（最多 64 字）');
        try {
            await svc.exchangeShip(ctx, id, no, cr);
        }
        catch (e) {
            throw new core_2.UserInputError(`换货发货失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
        await this.auditAfterSales(ctx, Number(id), 'exchangeShip', `运单号 ${no}${cr ? `，承运商 ${cr}` : ''}`);
        return this.afterSalesOne(ctx, id);
    }
    /** 批量同意（§83）：仅处理本渠道售后单，单条失败不阻断整批 */
    async afterSalesBatchApprove(ctx, ids) {
        return this.afterSalesBatch(ctx, this.normalizeBatchIds(ids), 'approve');
    }
    /** 批量驳回（§83）：整批共用一个驳回原因 */
    async afterSalesBatchReject(ctx, ids, reason) {
        const why = String(reason !== null && reason !== void 0 ? reason : '').trim();
        if (!why)
            throw new core_2.UserInputError('请填写驳回原因');
        if (why.length > 200)
            throw new core_2.UserInputError('驳回原因最多 200 字');
        return this.afterSalesBatch(ctx, this.normalizeBatchIds(ids), 'reject', why);
    }
    /** 读本店售后寄回地址（§83）：供货主/顾客寄回页展示 */
    async afterSalesReturnAddress(ctx) {
        const svc = this.getAfterSales();
        if (!svc)
            return '';
        return svc.getReturnAddress(ctx);
    }
    /** 写本店售后寄回地址（§83）：长度上限与插件字段一致 */
    async updateAfterSalesReturnAddress(ctx, address) {
        var _a;
        const svc = this.getAfterSales();
        if (!svc)
            throw new core_2.UserInputError('售后插件未安装，暂不能配置退货地址');
        const addr = String(address !== null && address !== void 0 ? address : '').trim();
        if (addr.length > 300)
            throw new core_2.UserInputError('退货地址最多 300 字');
        try {
            return await svc.updateReturnAddress(ctx, addr);
        }
        catch (e) {
            throw new core_2.UserInputError(`退货地址保存失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
    }
    /** 售后规则（§84）：渠道字段，缺省与售后插件默认一致（48h / 0 / 1） */
    async afterSalesRules(ctx) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const repo = this.connection.getRepository(ctx, core_2.Channel);
        const channel = await repo.findOne({ where: { id: ctx.channelId } });
        if (!channel)
            throw new core_2.UserInputError('当前店铺渠道不存在');
        const cf = ((_a = channel.customFields) !== null && _a !== void 0 ? _a : {});
        return {
            timeoutHours: Number((_b = cf.afterSalesTimeoutHours) !== null && _b !== void 0 ? _b : 48),
            autoApproveHours: Number((_c = cf.afterSalesAutoApproveHours) !== null && _c !== void 0 ? _c : 0),
            refundAutoRetry: Number((_d = cf.afterSalesRefundAutoRetry) !== null && _d !== void 0 ? _d : 1),
            firstResponseTargetHours: Number((_e = cf.afterSalesFirstResponseTargetHours) !== null && _e !== void 0 ? _e : 0),
            resolveTargetHours: Number((_f = cf.afterSalesResolveTargetHours) !== null && _f !== void 0 ? _f : 0),
            dueSoonHours: Number((_g = cf.afterSalesDueSoonHours) !== null && _g !== void 0 ? _g : 12),
            refundReviewThreshold: Math.max(0, Math.floor(Number((_h = cf.waimaiAfterSalesReviewThreshold) !== null && _h !== void 0 ? _h : 0) || 0)),
        };
    }
    /**
     * 保存售后规则（§84）：只写传入项，保留渠道其它自定义字段。
     * 超时提醒 1-168h；自动同意 0-168h（0=关闭）；自动重试 0-5 次（0=关闭）；
     * 首响/完结目标 0-168h（0=未设，§87）。
     */
    async updateAfterSalesRules(ctx, input) {
        var _a;
        const repo = this.connection.getRepository(ctx, core_2.Channel);
        const channel = await repo.findOne({ where: { id: ctx.channelId } });
        if (!channel)
            throw new core_2.UserInputError('当前店铺渠道不存在');
        const cf = ((_a = channel.customFields) !== null && _a !== void 0 ? _a : {});
        if (input.timeoutHours !== undefined) {
            const n = Math.floor(Number(input.timeoutHours));
            if (input.timeoutHours == null || !Number.isFinite(n) || n < 1 || n > 168) {
                throw new core_2.UserInputError('处理时限应为 1-168 小时');
            }
            cf.afterSalesTimeoutHours = n;
        }
        if (input.autoApproveHours !== undefined) {
            const n = Math.floor(Number(input.autoApproveHours));
            if (input.autoApproveHours == null || !Number.isFinite(n) || n < 0 || n > 168) {
                throw new core_2.UserInputError('自动同意时限应为 0-168 小时（0=关闭）');
            }
            cf.afterSalesAutoApproveHours = n;
        }
        if (input.refundAutoRetry !== undefined) {
            const n = Math.floor(Number(input.refundAutoRetry));
            if (input.refundAutoRetry == null || !Number.isFinite(n) || n < 0 || n > 5) {
                throw new core_2.UserInputError('自动重试次数应为 0-5（0=关闭）');
            }
            cf.afterSalesRefundAutoRetry = n;
        }
        if (input.firstResponseTargetHours !== undefined) {
            const n = Math.floor(Number(input.firstResponseTargetHours));
            if (input.firstResponseTargetHours == null || !Number.isFinite(n) || n < 0 || n > 168) {
                throw new core_2.UserInputError('首响目标应为 0-168 小时（0=不考核）');
            }
            cf.afterSalesFirstResponseTargetHours = n;
        }
        if (input.resolveTargetHours !== undefined) {
            const n = Math.floor(Number(input.resolveTargetHours));
            if (input.resolveTargetHours == null || !Number.isFinite(n) || n < 0 || n > 168) {
                throw new core_2.UserInputError('完结目标应为 0-168 小时（0=不考核）');
            }
            cf.afterSalesResolveTargetHours = n;
        }
        if (input.dueSoonHours !== undefined) {
            const n = Math.floor(Number(input.dueSoonHours));
            if (input.dueSoonHours == null || !Number.isFinite(n) || n < 0 || n > 72) {
                throw new core_2.UserInputError('临期提醒阈值应为 0-72 小时（0=关闭）');
            }
            cf.afterSalesDueSoonHours = n;
        }
        if (input.refundReviewThreshold !== undefined) {
            const n = Math.floor(Number(input.refundReviewThreshold));
            if (input.refundReviewThreshold == null || !Number.isFinite(n) || n < 0 || n > 1000000) {
                throw new core_2.UserInputError('大额退款复核阈值应为 0-1000000 分（0=关闭）');
            }
            cf.waimaiAfterSalesReviewThreshold = n;
        }
        channel.customFields = cf;
        await repo.save(channel);
        const saved = await this.afterSalesRules(ctx);
        // 规则变更立即生效（§86）：重排未执行任务，避免旧时限继续按原到期时间执行
        await this.rescheduleAfterSalesTasks(ctx, saved);
        // 退款重试次数变更立即生效（§87）：为 RefundFailed 单补排/复位重试任务
        await this.rescheduleRefundRetryTasks(ctx, saved);
        // 处理时限变更立即生效（§99）：按营业时段重算未完结单的 SLA 截止时间
        if (input.timeoutHours !== undefined)
            await this.recomputeSlaDeadlines(ctx);
        return saved;
    }
    /** 商家关闭待处理售后（§84）：Pending → Closed，原因必填并回显顾客 */
    async afterSalesClose(ctx, id, reason) {
        var _a;
        await this.assertChannelAfterSales(ctx, id, ['Pending']);
        const svc = this.getAfterSales();
        if (!svc)
            throw new core_2.UserInputError('售后插件未安装，暂不能处理售后申请');
        const why = String(reason !== null && reason !== void 0 ? reason : '').trim();
        if (!why)
            throw new core_2.UserInputError('请填写关闭原因');
        if (why.length > 200)
            throw new core_2.UserInputError('关闭原因最多 200 字');
        try {
            await svc.adminCancelRequest(ctx, id, why);
        }
        catch (e) {
            throw new core_2.UserInputError(`关闭售后失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
        await this.auditAfterSales(ctx, Number(id), 'close', `关闭原因：${why}`);
        return this.afterSalesOne(ctx, id);
    }
    /**
     * 暂停售后 SLA 计时（§95/§96）：等待顾客补充资料/回寄等场景，暂停期间不判超时与临期。
     * §96 起暂停原因必填，并写入暂停记录表供详情页时间线展示。
     * 幂等：已暂停时重复调用直接返回当前行（不重复记暂停记录）。
     */
    async afterSalesPauseSla(ctx, id, reason) {
        var _a;
        await this.assertChannelAfterSales(ctx, id, ['Pending', 'Appealed', 'Approved', 'Returning']);
        const text = String(reason !== null && reason !== void 0 ? reason : '').trim();
        if (!text)
            throw new core_2.UserInputError('请填写暂停原因（如等待顾客补充资料/回寄商品）');
        if (text.length > 200)
            throw new core_2.UserInputError('暂停原因最多 200 字');
        const chId = Number(ctx.channelId);
        const nid = Number(id);
        const raw = this.connection.rawConnection;
        const claimed = await raw.query('UPDATE after_sales_request SET "slaPausedAt" = now(), "slaPausedReason" = $2 '
            + 'WHERE id = $1 AND "slaPausedAt" IS NULL RETURNING id', [nid, text]);
        const list = Array.isArray(claimed) && Array.isArray(claimed[0]) ? claimed[0] : claimed;
        if (Array.isArray(list) && list.length) {
            try {
                await raw.query('INSERT INTO campus_after_sales_sla_pause ("channelId", "requestId", reason, "pausedAt") '
                    + 'VALUES ($1, $2, $3, now())', [chId, nid, text]);
            }
            catch (e) {
                // 记录表缺失（迁移未跑完）不影响暂停本身
                core_2.Logger.warn(`sla pause log failed: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, 'CampusMerchantAfterSales');
            }
        }
        await this.auditAfterSales(ctx, nid, 'pauseSla', `暂停原因：${text}`);
        return this.afterSalesOne(ctx, id);
    }
    /**
     * 恢复售后 SLA 计时（§95/§96）：把本次暂停时长累计进 slaPausedMs，截止时间随之后移，
     * 并回填暂停记录表的结束时间与本次时长。幂等：未暂停时重复调用无副作用。
     */
    async afterSalesResumeSla(ctx, id) {
        var _a;
        await this.assertChannelAfterSales(ctx, id, ['Pending', 'Appealed', 'Approved', 'Returning']);
        const nid = Number(id);
        const raw = this.connection.rawConnection;
        const openRows = await raw.query('SELECT "slaPausedAt" FROM after_sales_request WHERE id = $1 AND "slaPausedAt" IS NOT NULL', [nid]);
        const openList = Array.isArray(openRows) && Array.isArray(openRows[0]) ? openRows[0] : openRows;
        if (!Array.isArray(openList) || !openList.length)
            return this.afterSalesOne(ctx, id);
        const pausedAt = new Date(openList[0].slaPausedAt);
        const ms = Number.isNaN(pausedAt.getTime()) ? 0 : Math.max(0, Date.now() - pausedAt.getTime());
        await raw.query('UPDATE after_sales_request SET "slaPausedMs" = COALESCE("slaPausedMs", 0) + $2::bigint, '
            + '"slaPausedAt" = NULL, "slaPausedReason" = NULL '
            + 'WHERE id = $1 AND "slaPausedAt" IS NOT NULL', [nid, ms]);
        // §99：恢复后按营业时段重算截止时间，立即生效
        await this.refreshSlaDeadline(ctx, nid).catch(e => { var _a; return core_2.Logger.warn(`refresh sla deadline failed: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, 'CampusMerchantAfterSales'); });
        try {
            await raw.query('UPDATE campus_after_sales_sla_pause SET "resumedAt" = now(), "pausedMs" = $2::bigint '
                + 'WHERE id = (SELECT id FROM campus_after_sales_sla_pause '
                + 'WHERE "channelId" = $1 AND "requestId" = $3 AND "resumedAt" IS NULL '
                + 'ORDER BY "pausedAt" DESC LIMIT 1)', [Number(ctx.channelId), ms, nid]);
        }
        catch (e) {
            core_2.Logger.warn(`sla resume log failed: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, 'CampusMerchantAfterSales');
        }
        await this.auditAfterSales(ctx, nid, 'resumeSla', `暂停时长 ${Math.round(ms / 60000)} 分钟`);
        return this.afterSalesOne(ctx, id);
    }
    /** 批量关闭待处理售后（§95）：单批上限 50，逐单返回结果 */
    async afterSalesBatchClose(ctx, ids, reason) {
        var _a;
        const why = String(reason !== null && reason !== void 0 ? reason : '').trim();
        if (!why)
            throw new core_2.UserInputError('请填写关闭原因');
        if (why.length > 200)
            throw new core_2.UserInputError('关闭原因最多 200 字');
        const list = this.normalizeBatchIds(ids);
        const results = [];
        for (const id of list) {
            try {
                const row = await this.afterSalesClose(ctx, id, why);
                results.push({ id: String(id), success: true, state: String(row.state), message: '' });
            }
            catch (e) {
                results.push({ id: String(id), success: false, state: '', message: String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e) });
            }
        }
        return results;
    }
    /** 升级平台仲裁（§96）：商家无法自行处理时转平台客服；同一单仅保留一条未关闭工单 */
    async afterSalesEscalate(ctx, id, reason, priority) {
        await this.assertRequestInChannel(ctx, id);
        const text = String(reason !== null && reason !== void 0 ? reason : '').trim();
        if (!text)
            throw new core_2.UserInputError('请填写升级原因');
        if (text.length > 200)
            throw new core_2.UserInputError('升级原因最多 200 字');
        const p = String(priority !== null && priority !== void 0 ? priority : '').trim() || 'normal';
        if (!['normal', 'urgent'].includes(p))
            throw new core_2.UserInputError('优先级只能是 normal 或 urgent');
        const chId = Number(ctx.channelId);
        const nid = Number(id);
        const raw = this.connection.rawConnection;
        const openRows = await raw.query('SELECT id FROM campus_after_sales_escalation WHERE "requestId" = $1 AND status = \'Open\' LIMIT 1', [nid]);
        const openList = Array.isArray(openRows) && Array.isArray(openRows[0]) ? openRows[0] : openRows;
        if (Array.isArray(openList) && openList.length) {
            await raw.query('UPDATE campus_after_sales_escalation SET reason = $2, priority = $3, "updatedAt" = now() WHERE id = $1', [Number(openList[0].id), text, p]);
        }
        else {
            await raw.query('INSERT INTO campus_after_sales_escalation '
                + '("channelId", "requestId", reason, priority, "createdBy") '
                + 'VALUES ($1, $2, $3, $4, $5)', [chId, nid, text, p, ctx.activeUserId ? Number(ctx.activeUserId) : null]);
        }
        // §97 顾客端进度推送：升级平台仲裁告知顾客，减少追问
        const req = await this.connection.getRepository(ctx, after_sales_plugin_1.AfterSalesRequest).findOne({ where: { id: nid } });
        if ((req === null || req === void 0 ? void 0 : req.orderId) != null) {
            this.notify.user(ctx, req.orderId, 'afterSales', p === 'urgent' ? '售后已升级平台紧急仲裁' : '售后已升级平台仲裁', undefined, `escalate_${nid}_${Date.now()}`);
        }
        await this.auditAfterSales(ctx, nid, 'escalate', `原因：${text}，优先级：${p}`);
        return this.afterSalesEscalations(nid);
    }
    /** 关闭平台仲裁工单（§96）：平台/商家填写处理结论后置为 Resolved */
    async afterSalesEscalationResolve(ctx, id, resolution) {
        const text = String(resolution !== null && resolution !== void 0 ? resolution : '').trim();
        if (text.length > 300)
            throw new core_2.UserInputError('处理结论最多 300 字');
        const chId = Number(ctx.channelId);
        const raw = this.connection.rawConnection;
        const escRows = await raw.query('SELECT "requestId" FROM campus_after_sales_escalation WHERE id = $1 AND "channelId" = $2', [Number(id), chId]);
        const escList = Array.isArray(escRows) && Array.isArray(escRows[0]) ? escRows[0] : escRows;
        if (!Array.isArray(escList) || !escList.length)
            throw new core_2.UserInputError('升级工单不存在');
        await raw.query('UPDATE campus_after_sales_escalation SET status = \'Resolved\', "resolvedAt" = now(), '
            + 'resolution = $3, "updatedAt" = now() WHERE id = $1 AND "channelId" = $2', [Number(id), chId, text || null]);
        const rid = Number(escList[0].requestId);
        // §97 顾客端进度推送：仲裁工单关闭告知顾客
        const req = await this.connection.getRepository(ctx, after_sales_plugin_1.AfterSalesRequest).findOne({ where: { id: rid } });
        if ((req === null || req === void 0 ? void 0 : req.orderId) != null) {
            this.notify.user(ctx, req.orderId, 'afterSales', '平台已处理您升级的售后问题', undefined, `resolve_${Number(id)}_${Date.now()}`);
        }
        await this.auditAfterSales(ctx, rid, 'escalationResolve', text || '关闭平台仲裁工单');
        return this.afterSalesEscalations(rid);
    }
    /**
     * 售后自动分配（§96）：渠道开启后，把未指派的未完结售后单指派给当前未完结量最少的处理人。
     * - 只处理本店渠道订单对应、未结案且尚无指派的售后单，按申请时间先到先得。
     * - autoAssignMax>0 时，最空闲处理人也已达上限则本轮停止，避免压垮个人。
     * - 返回本轮实际指派单数，供定时任务日志。
     */
    async afterSalesAutoAssign(ctx) {
        var _a, _b, _c, _d, _e;
        const cf = ((_b = (_a = ctx.channel) === null || _a === void 0 ? void 0 : _a.customFields) !== null && _b !== void 0 ? _b : {});
        if (!cf.waimaiAfterSalesAutoAssignEnabled)
            return 0;
        const max = Math.max(0, Number((_c = cf.waimaiAfterSalesAutoAssignMax) !== null && _c !== void 0 ? _c : 0) || 0);
        const chId = Number(ctx.channelId);
        const raw = this.connection.rawConnection;
        // §100 值班排班：当前时段有值班人时优先指派给值班人，无人值班时预警（每天一次）
        const rosterRows = await raw.query('SELECT weekday, "startMin", "endMin", "userId" FROM campus_after_sales_duty WHERE "channelId" = $1', [chId]);
        const rosterList = Array.isArray(rosterRows) && Array.isArray(rosterRows[0]) ? rosterRows[0] : rosterRows;
        const roster = (Array.isArray(rosterList) ? rosterList : []).map(r => ({
            weekday: Number(r.weekday),
            startMin: Number(r.startMin),
            endMin: Number(r.endMin),
            userId: Number(r.userId),
        }));
        const duty = (0, after_sales_duty_1.dutyAssigneeAt)(roster, Date.now());
        if (roster.length && duty == null)
            await this.warnNoDuty(ctx, chId);
        const assignees = await this.afterSalesAssignees(ctx);
        if (!assignees.length)
            return 0;
        const loadRows = await raw.query(`SELECT l."assigneeUserId" AS uid, COUNT(*)::int AS n
               FROM campus_after_sales_assignee l
               JOIN after_sales_request a ON a.id = l."requestId"
              WHERE l."channelId" = $1 AND a.state NOT IN ('Refunded', 'Rejected', 'Closed')
              GROUP BY 1`, [chId]);
        const loadList = Array.isArray(loadRows) && Array.isArray(loadRows[0]) ? loadRows[0] : loadRows;
        const load = new Map();
        for (const r of Array.isArray(loadList) ? loadList : []) {
            load.set(Number(r.uid), Number(r.n) || 0);
        }
        const reqRows = await raw.query(`SELECT a.id FROM after_sales_request a
              WHERE a.state NOT IN ('Refunded', 'Rejected', 'Closed')
                AND EXISTS (SELECT 1 FROM "order" o
                            JOIN order_channels_channel oc ON oc."orderId" = o.id
                            WHERE o.id = a."orderId" AND oc."channelId" = $1)
                AND NOT EXISTS (SELECT 1 FROM campus_after_sales_assignee l
                                WHERE l."channelId" = $1 AND l."requestId" = a.id)
              ORDER BY a."createdAt" ASC
              LIMIT 50`, [chId]);
        const reqList = Array.isArray(reqRows) && Array.isArray(reqRows[0]) ? reqRows[0] : reqRows;
        let assigned = 0;
        for (const r of Array.isArray(reqList) ? reqList : []) {
            let best = null;
            let bestLoad = Number.POSITIVE_INFINITY;
            if (duty != null) {
                // 值班优先：未指派未结案单全部交给值班人
                best = duty;
                bestLoad = (_d = load.get(duty)) !== null && _d !== void 0 ? _d : 0;
            }
            else {
                for (const a of assignees) {
                    const uid = Number(a.id);
                    const n = (_e = load.get(uid)) !== null && _e !== void 0 ? _e : 0;
                    if (n < bestLoad) {
                        bestLoad = n;
                        best = uid;
                    }
                }
            }
            if (best == null)
                break;
            if (max > 0 && bestLoad >= max)
                break;
            await raw.query('INSERT INTO campus_after_sales_assignee ("channelId", "requestId", "assigneeUserId") '
                + 'VALUES ($1, $2, $3) '
                + 'ON CONFLICT ("channelId", "requestId") DO NOTHING', [chId, Number(r.id), best]);
            await this.recordAssignChange(chId, Number(r.id), null, best, duty != null ? '值班自动指派' : undefined);
            load.set(best, bestLoad + 1);
            assigned += 1;
        }
        return assigned;
    }
    /** 无人值班预警（§100）：值班表非空但当前时段无人，飞书群提醒，同一校园日只发一次 */
    async warnNoDuty(ctx, chId) {
        var _a, _b;
        const day = (0, campus_time_1.campusDayKey)(Date.now());
        const key = `${chId}:${day}`;
        if (this.dedupe) {
            // M5：跨实例共享（多实例各自排班任务都在跑，避免重复预警）
            if (await this.dedupe.seenOrMark(`merchant_duty_warn:${key}`, 24 * 3600000))
                return;
        }
        else {
            if (this.dutyWarnAt.has(key))
                return;
            this.dutyWarnAt.set(key, day);
            if (this.dutyWarnAt.size > 500) {
                for (const [k, d] of this.dutyWarnAt) {
                    if (d !== day)
                        this.dutyWarnAt.delete(k);
                }
            }
        }
        if (!this.feishu.enabled)
            return;
        const code = String((_b = (_a = ctx.channel) === null || _a === void 0 ? void 0 : _a.code) !== null && _b !== void 0 ? _b : '');
        this.feishu.broadcast('【售后值班预警】当前时段无人值班，售后单将按处理人负载自动分配，请及时安排值班', { channel: code })
            .catch(e => { var _a; return core_2.Logger.warn(`duty warn failed: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, 'CampusMerchantAfterSales'); });
    }
    /** 商家催办顾客（§84）：60 秒内同单一次，站内信经事件解耦投递 */
    async afterSalesRemind(ctx, id, note) {
        var _a, _b;
        await this.assertChannelAfterSales(ctx, id, ['Pending', 'Approved', 'Returning', 'Appealed']);
        const svc = this.getAfterSales();
        if (!svc)
            throw new core_2.UserInputError('售后插件未安装，暂不能处理售后申请');
        const key = Number(id);
        const extra = String(note !== null && note !== void 0 ? note : '').trim();
        if (extra.length > 200)
            throw new core_2.UserInputError('催办内容最多 200 字');
        if (this.dedupe) {
            if (await this.dedupe.seenOrMark(`merchant_remind:${key}`, 60000)) {
                throw new core_2.UserInputError('催办过于频繁，请 1 分钟后再试');
            }
        }
        else {
            const now = Date.now();
            if (now - ((_a = this.remindAt.get(key)) !== null && _a !== void 0 ? _a : 0) < 60000) {
                throw new core_2.UserInputError('催办过于频繁，请 1 分钟后再试');
            }
            this.remindAt.set(key, now);
            if (this.remindAt.size > 500) {
                for (const [k, t] of this.remindAt) {
                    if (now - t > 120000)
                        this.remindAt.delete(k);
                }
            }
        }
        try {
            await svc.remindCustomer(ctx, id, extra || undefined);
        }
        catch (e) {
            throw new core_2.UserInputError(`催办失败：${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`);
        }
        return this.afterSalesOne(ctx, id);
    }
    /** 退款流水（§84）：按退款时间倒序分页，日期为校园日（UTC+8），可省略不限 */
    async afterSalesRefunds(ctx, opts = {}) {
        var _a, _b, _c, _d, _e;
        const start = opts.from ? this.campusDayStart(opts.from) : null;
        const end = opts.to ? this.campusDayEnd(opts.to) : null;
        if (opts.from && !start)
            throw new core_2.UserInputError('开始日期格式无效，应为 YYYY-MM-DD');
        if (opts.to && !end)
            throw new core_2.UserInputError('结束日期格式无效，应为 YYYY-MM-DD');
        if (start && end && start.getTime() > end.getTime())
            throw new core_2.UserInputError('开始日期不能晚于结束日期');
        const skip = Math.max(0, Math.floor(Number((_a = opts.skip) !== null && _a !== void 0 ? _a : 0)) || 0);
        const take = Math.min(100, Math.max(1, Math.floor(Number((_b = opts.take) !== null && _b !== void 0 ? _b : 20)) || 20));
        const chId = Number(ctx.channelId);
        const raw = this.connection.rawConnection;
        const scope = 'EXISTS (SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId")';
        try {
            const rows = await raw.query(`SELECT a.id, a.type, a.reason, a."refundTransactionId",
                        COALESCE(a."actualRefundAmount", a."refundAmount")::int AS amount,
                        a."refundedAt", o.code AS "orderCode"
                   FROM after_sales_request a
                   LEFT JOIN "order" o ON o.id = a."orderId"
                  WHERE a.state = 'Refunded' AND ${scope}
                    AND ($2::timestamptz IS NULL OR a."refundedAt" >= $2)
                    AND ($3::timestamptz IS NULL OR a."refundedAt" < $3)
                  ORDER BY a."refundedAt" DESC NULLS LAST, a.id DESC
                  LIMIT $4 OFFSET $5`, [chId, start, end, take, skip]);
            const totalRows = await raw.query(`SELECT COUNT(*)::int AS n FROM after_sales_request a
                  WHERE a.state = 'Refunded' AND ${scope}
                    AND ($2::timestamptz IS NULL OR a."refundedAt" >= $2)
                    AND ($3::timestamptz IS NULL OR a."refundedAt" < $3)`, [chId, start, end]);
            return {
                items: (Array.isArray(rows) ? rows : []).map(r => {
                    var _a;
                    return ({
                        id: String(r.id),
                        orderCode: r.orderCode == null ? null : String(r.orderCode),
                        type: String(r.type),
                        reason: String((_a = r.reason) !== null && _a !== void 0 ? _a : ''),
                        amount: Number(r.amount) || 0,
                        refundedAt: r.refundedAt ? new Date(r.refundedAt) : null,
                        refundTransactionId: r.refundTransactionId == null ? null : String(r.refundTransactionId),
                    });
                }),
                total: Number((_d = (_c = totalRows === null || totalRows === void 0 ? void 0 : totalRows[0]) === null || _c === void 0 ? void 0 : _c.n) !== null && _d !== void 0 ? _d : 0),
            };
        }
        catch (e) {
            throw new core_2.UserInputError(`退款流水查询失败：${(_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e}`);
        }
    }
    /** 售后自动化任务列表（§85）：本店渠道，按到期时间倒序 */
    async afterSalesTasks(ctx, opts = {}) {
        var _a, _b, _c;
        const repo = this.connection.getRepository(ctx, after_sales_plugin_1.AfterSalesTimeoutTask);
        const skip = Math.max(0, Math.floor(Number((_a = opts.skip) !== null && _a !== void 0 ? _a : 0)) || 0);
        const take = Math.min(100, Math.max(1, Math.floor(Number((_b = opts.take) !== null && _b !== void 0 ? _b : 20)) || 20));
        const where = { channelId: Number(ctx.channelId) };
        const status = String((_c = opts.status) !== null && _c !== void 0 ? _c : '').trim();
        if (status) {
            if (!Object.values(after_sales_plugin_1.AfterSalesTimeoutStatus).includes(status)) {
                throw new core_2.UserInputError('任务状态无效');
            }
            where.status = status;
        }
        const [rows, total] = await repo.findAndCount({
            where,
            order: { dueAt: 'DESC', id: 'DESC' },
            skip,
            take,
        });
        return { items: rows.map(t => this.toTaskRow(t)), total };
    }
    /**
     * 立即执行超时任务（§85）：重置为 PENDING + 到期时间为当前，复用任务锁跑一次，
     * FAILED 任务借此补跑；已执行/已作废不允许重复执行。
     */
    async afterSalesRunTask(ctx, id) {
        var _a;
        const repo = this.connection.getRepository(ctx, after_sales_plugin_1.AfterSalesTimeoutTask);
        const task = await repo.findOne({ where: { id: id, channelId: ctx.channelId } });
        if (!task)
            throw new core_2.UserInputError('任务不存在或不属于当前店铺');
        if ([after_sales_plugin_1.AfterSalesTimeoutStatus.EXECUTED, after_sales_plugin_1.AfterSalesTimeoutStatus.CANCELLED].includes(task.status)) {
            throw new core_2.UserInputError('任务已结束，不能重复执行');
        }
        const job = this.getAfterSalesJob();
        if (!job)
            throw new core_2.UserInputError('售后插件未安装，暂不能执行任务');
        task.status = after_sales_plugin_1.AfterSalesTimeoutStatus.PENDING;
        task.dueAt = new Date();
        task.retryCount = 0;
        task.lastError = null;
        await repo.save(task);
        try {
            await job.runTaskNow(Number(task.id));
        }
        catch (e) {
            throw new core_2.UserInputError(`任务执行失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
        const fresh = await repo.findOne({ where: { id: task.id } });
        return this.toTaskRow(fresh !== null && fresh !== void 0 ? fresh : task);
    }
    /**
     * 售后明细 / 退款流水 / 升级工单 / 员工绩效导出（§85、§97、§89）：CSV 文本（UTF-8 BOM + 中文表头），单次上限 5000 行，
     * 供前端保存为 .csv；日期为校园日（UTC+8）。filter 支持状态/类型/关键词/处理人筛选。
     */
    async afterSalesExport(ctx, from, to, kind, filter) {
        var _a, _b, _c, _d, _e;
        const start = this.campusDayStart(from);
        const end = this.campusDayEnd(to);
        if (!start || !end)
            throw new core_2.UserInputError('日期格式无效，应为 YYYY-MM-DD');
        if (start.getTime() > end.getTime())
            throw new core_2.UserInputError('开始日期不能晚于结束日期');
        if (end.getTime() - start.getTime() > 366 * 86400000)
            throw new core_2.UserInputError('导出区间最长一年');
        const k = String(kind !== null && kind !== void 0 ? kind : '').trim();
        if (!['requests', 'refunds', 'escalations', 'staff'].includes(k))
            throw new core_2.UserInputError('导出类型无效');
        const f = filter !== null && filter !== void 0 ? filter : {};
        const state = String((_a = f.state) !== null && _a !== void 0 ? _a : '').trim();
        const type = String((_b = f.type) !== null && _b !== void 0 ? _b : '').trim();
        const keyword = String((_c = f.keyword) !== null && _c !== void 0 ? _c : '').trim();
        const assignee = String((_d = f.assigneeUserId) !== null && _d !== void 0 ? _d : '').trim();
        if (assignee && !Number.isFinite(Number(assignee)))
            throw new core_2.UserInputError('处理人参数无效');
        const chId = Number(ctx.channelId);
        const raw = this.connection.rawConnection;
        const scope = 'EXISTS (SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId")';
        // 追加筛选参数：基础参数占 $1-$3，扩展参数从 $4 起
        const buildConds = (stateCol) => {
            const conds = [];
            const params = [];
            const add = (clause, value) => {
                params.push(value);
                conds.push(clause(params.length + 3));
            };
            if (state)
                add(i => `${stateCol} = $${i}`, state);
            if (type)
                add(i => `a.type = $${i}`, type);
            if (keyword)
                add(i => `(o.code ILIKE $${i} OR a.reason ILIKE $${i} OR a."rejectReason" ILIKE $${i})`, `%${keyword}%`);
            if (assignee) {
                add(i => 'EXISTS (SELECT 1 FROM campus_after_sales_assignee l '
                    + `WHERE l."channelId" = $1 AND l."requestId" = a.id AND l."assigneeUserId" = $${i}::int)`, Number(assignee));
            }
            return { sql: conds.length ? ` AND ${conds.join(' AND ')}` : '', params };
        };
        try {
            // 员工处理绩效导出（§89）：复用 afterSalesStaffStats 的统计口径，不受状态/类型/关键词/处理人筛选影响
            if (k === 'staff') {
                const rows = await this.afterSalesStaffStats(ctx, from, to);
                const header = ['操作人ID', '操作人', '处理量', '完结数', '完结率%', '首响均时(分)', '完结均时(分)', '在途超时', '升级仲裁', '评价数', '评价均分'];
                const lines = rows.map(r => [
                    r.operatorUserId, r.operatorName, r.handled, r.resolved, r.resolveRate,
                    r.firstActionAvgMinutes, r.resolveAvgMinutes, r.overdueCount, r.escalatedCount,
                    r.reviewCount, r.reviewAvgScore,
                ]);
                return this.toCsv(header, lines);
            }
            if (k === 'requests') {
                const c = buildConds('a.state');
                const rows = await raw.query(`SELECT a.id, o.code AS "orderCode", a.type, a.state, a.reason, a."rejectReason",
                            a."createdAt", COALESCE(a."actualRefundAmount", a."refundAmount")::int AS amount,
                            a."refundedAt"
                       FROM after_sales_request a
                       LEFT JOIN "order" o ON o.id = a."orderId"
                      WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}${c.sql}
                      ORDER BY a."createdAt" DESC LIMIT 5000`, [chId, start, end, ...c.params]);
                const header = ['售后单号', '订单号', '类型', '状态', '申请原因', '驳回/关闭原因', '申请时间', '退款金额(元)', '退款时间'];
                const lines = (Array.isArray(rows) ? rows : []).map(r => [
                    r.id, r.orderCode, r.type, r.state, r.reason, r.rejectReason,
                    this.campusDateTime(r.createdAt), this.yuan(r.amount), this.campusDateTime(r.refundedAt),
                ]);
                return this.toCsv(header, lines);
            }
            if (k === 'escalations') {
                const c = buildConds('e.status');
                const rows = await raw.query(`SELECT e.id, e."requestId", o.code AS "orderCode", e.reason, e.priority, e.status,
                            e."createdAt", e."resolvedAt", e.resolution,
                            TRIM(COALESCE(ad."firstName", '') || COALESCE(ad."lastName", '')) AS operator
                       FROM campus_after_sales_escalation e
                       JOIN after_sales_request a ON a.id = e."requestId"
                       LEFT JOIN "order" o ON o.id = a."orderId"
                       LEFT JOIN administrator ad ON ad."userId" = e."createdBy"
                      WHERE e."channelId" = $1 AND e."createdAt" >= $2 AND e."createdAt" < $3 AND ${scope}${c.sql}
                      ORDER BY e."createdAt" DESC LIMIT 5000`, [chId, start, end, ...c.params]);
                const header = ['售后单号', '订单号', '升级原因', '优先级', '工单状态', '提交时间', '提交人', '关闭时间', '处理结论'];
                const lines = (Array.isArray(rows) ? rows : []).map(r => [
                    r.requestId, r.orderCode, r.reason, r.priority, r.status,
                    this.campusDateTime(r.createdAt), r.operator || null,
                    this.campusDateTime(r.resolvedAt), r.resolution,
                ]);
                return this.toCsv(header, lines);
            }
            const c = buildConds('a.state');
            const rows = await raw.query(`SELECT a.id, o.code AS "orderCode", a.type, a.reason, a."refundTransactionId",
                        COALESCE(a."actualRefundAmount", a."refundAmount")::int AS amount, a."refundedAt"
                   FROM after_sales_request a
                   LEFT JOIN "order" o ON o.id = a."orderId"
                  WHERE a.state = 'Refunded' AND a."refundedAt" >= $2 AND a."refundedAt" < $3 AND ${scope}${c.sql}
                  ORDER BY a."refundedAt" DESC LIMIT 5000`, [chId, start, end, ...c.params]);
            const header = ['售后单号', '订单号', '类型', '申请原因', '退款金额(元)', '退款时间', '退款流水号'];
            const lines = (Array.isArray(rows) ? rows : []).map(r => [
                r.id, r.orderCode, r.type, r.reason, this.yuan(r.amount),
                this.campusDateTime(r.refundedAt), r.refundTransactionId,
            ]);
            return this.toCsv(header, lines);
        }
        catch (e) {
            if (e instanceof core_2.UserInputError)
                throw e;
            throw new core_2.UserInputError(`导出失败：${(_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e}`);
        }
    }
    /** 商品维度售后分析（§98）：区间内按商品聚合下单件数、售后单数与退款额，售后率=售后单/下单件 */
    async afterSalesProductAnalysis(ctx, from, to) {
        const start = this.campusDayStart(from);
        const end = this.campusDayEnd(to);
        if (!start || !end)
            throw new core_2.UserInputError('日期格式无效，应为 YYYY-MM-DD');
        if (start.getTime() > end.getTime())
            throw new core_2.UserInputError('开始日期不能晚于结束日期');
        if (end.getTime() - start.getTime() > 366 * 86400000)
            throw new core_2.UserInputError('查询区间最长一年');
        const chId = Number(ctx.channelId);
        const rows = await this.connection.rawConnection.query(`WITH sold AS (
                SELECT pv."productId" AS pid, SUM(ol.quantity)::int AS sold
                  FROM order_line ol
                  JOIN "order" o ON o.id = ol."orderId"
                  JOIN product_variant pv ON pv.id = ol."productVariantId"
                 WHERE o."createdAt" >= $2 AND o."createdAt" < $3 AND o.state <> 'cancelled'
                   AND EXISTS (SELECT 1 FROM order_channels_channel oc
                                WHERE oc."orderId" = o.id AND oc."channelId" = $1)
                 GROUP BY pv."productId"
             ), reqs AS (
                SELECT pv."productId" AS pid,
                       COUNT(*)::int AS requests,
                       COUNT(*) FILTER (WHERE a.state = 'Refunded')::int AS refunded,
                       COALESCE(SUM(COALESCE(a."actualRefundAmount", a."refundAmount")), 0)::int AS amount
                  FROM after_sales_request a
                  JOIN "order" o ON o.id = a."orderId"
                  JOIN order_line ol ON ol.id = a."orderLineId"
                  JOIN product_variant pv ON pv.id = ol."productVariantId"
                 WHERE a."createdAt" >= $2 AND a."createdAt" < $3
                   AND EXISTS (SELECT 1 FROM order_channels_channel oc
                                WHERE oc."orderId" = o.id AND oc."channelId" = $1)
                 GROUP BY pv."productId"
             )
             SELECT p.id AS "productId", COALESCE(pt.name, '商品 #' || p.id) AS name,
                    COALESCE(s.sold, 0)::int AS "soldQuantity",
                    r.requests, r.refunded, r.amount
               FROM reqs r
               JOIN product p ON p.id = r.pid
               LEFT JOIN product_translation pt ON pt."baseId" = p.id AND pt."languageCode" = 'zh_Hans'
               LEFT JOIN sold s ON s.pid = p.id
              ORDER BY r.requests DESC, r.amount DESC
              LIMIT 30`, [chId, start, end]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const items = (Array.isArray(list) ? list : []).map(r => {
            var _a;
            const soldQuantity = Number(r.soldQuantity) || 0;
            const requestCount = Number(r.requests) || 0;
            return {
                productId: String(r.productId),
                productName: String((_a = r.name) !== null && _a !== void 0 ? _a : ''),
                soldQuantity,
                requestCount,
                refundCount: Number(r.refunded) || 0,
                refundAmount: Number(r.amount) || 0,
                afterSalesRate: soldQuantity > 0 ? Math.round((requestCount / soldQuantity) * 1000) / 10 : 0,
            };
        });
        return {
            items,
            totalRequests: items.reduce((s, x) => s + x.requestCount, 0),
            totalRefundAmount: items.reduce((s, x) => s + x.refundAmount, 0),
            totalSold: items.reduce((s, x) => s + x.soldQuantity, 0),
        };
    }
    /** 退货物流轨迹（§98）：运单信息 + 系统派生节点与商家登记节点合并时间线 */
    async afterSalesReturnLogistics(ctx, id) {
        var _a, _b, _c, _d, _e;
        const request = await this.assertChannelAfterSales(ctx, id, []);
        const raw = this.connection.rawConnection;
        const historyRows = await raw.query('SELECT "toState", "createdAt" FROM after_sales_state_history '
            + 'WHERE "requestId" = $1 AND "toState" IN (\'Approved\', \'Returning\', \'Received\', \'Closed\') '
            + 'ORDER BY "createdAt" ASC, id ASC', [Number(request.id)]);
        const manualRows = await raw.query('SELECT status, description, "occurredAt" FROM campus_after_sales_return_logistics '
            + 'WHERE "channelId" = $1 AND "requestId" = $2 ORDER BY "occurredAt" ASC, id ASC LIMIT 20', [Number(ctx.channelId), Number(request.id)]);
        const events = [];
        const list = (res) => (Array.isArray(res) && Array.isArray(res[0]) ? res[0] : Array.isArray(res) ? res : []);
        const seen = new Set();
        for (const h of list(historyRows)) {
            const to = String(h.toState);
            const event = to === 'Approved' ? { status: 'approved', description: '审核通过，等待顾客寄回', occurredAt: new Date(h.createdAt), source: 'system' }
                : to === 'Returning' ? { status: 'shipped', description: '顾客已寄出（等待揽收）', occurredAt: new Date(h.createdAt), source: 'system' }
                    : to === 'Received' ? { status: 'delivered', description: '商家已签收退货', occurredAt: new Date(h.createdAt), source: 'system' }
                        : to === 'Closed' ? { status: 'closed', description: '售后已关闭', occurredAt: new Date(h.createdAt), source: 'system' }
                            : null;
            if (event) {
                seen.add(event.status);
                events.push(event);
            }
        }
        for (const m of list(manualRows)) {
            // 商家登记的签收节点覆盖系统派生的同状态节点，避免重复
            if (String(m.status) === 'delivered')
                seen.delete('delivered');
            events.push({
                status: String(m.status),
                description: String((_a = m.description) !== null && _a !== void 0 ? _a : ''),
                occurredAt: new Date(m.occurredAt),
                source: 'merchant',
            });
        }
        const filtered = events
            .filter(e => e.status !== 'delivered' || !seen.has('delivered') || e.source === 'merchant')
            .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
        return {
            requestId: String(request.id),
            orderCode: String((_c = (_b = request.order) === null || _b === void 0 ? void 0 : _b.code) !== null && _c !== void 0 ? _c : ''),
            type: String(request.type),
            state: String(request.state),
            trackingNo: (_d = request.returnTrackingNo) !== null && _d !== void 0 ? _d : null,
            carrier: (_e = request.returnCarrier) !== null && _e !== void 0 ? _e : null,
            events: filtered,
        };
    }
    /** 登记退货物流节点（§98）：商家按快递扫描节点补录，status=picked_up/in_transit/delivered/exception */
    async afterSalesRecordReturnLogistics(ctx, id, status, description) {
        const request = await this.assertChannelAfterSales(ctx, id, []);
        const st = String(status !== null && status !== void 0 ? status : '').trim();
        if (!['picked_up', 'in_transit', 'delivered', 'exception'].includes(st)) {
            throw new core_2.UserInputError('物流状态无效');
        }
        const text = String(description !== null && description !== void 0 ? description : '').trim();
        if (text.length > 200)
            throw new core_2.UserInputError('物流说明最多 200 字');
        await this.connection.rawConnection.query('INSERT INTO campus_after_sales_return_logistics '
            + '("channelId", "requestId", status, description, "createdBy") VALUES ($1, $2, $3, $4, $5)', [Number(ctx.channelId), Number(request.id), st, text || null, ctx.activeUserId ? Number(ctx.activeUserId) : null]);
        return this.afterSalesReturnLogistics(ctx, id);
    }
    /** 售后自动分流规则列表（§98）：本店渠道，按优先级升序 */
    async afterSalesAutoRules(ctx) {
        const rows = await this.connection.rawConnection.query('SELECT id, name, priority, enabled, "matchType", "matchReason", "minAmount", "maxAmount", '
            + 'action, "rejectReason", "createdAt" FROM campus_after_sales_auto_rule '
            + 'WHERE "channelId" = $1 ORDER BY priority ASC, id ASC LIMIT 50', [Number(ctx.channelId)]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return (Array.isArray(list) ? list : []).map(r => this.toAutoRule(r));
    }
    /** 保存售后自动分流规则（§98）：id 为空=新增；action=approve/reject/escalate */
    async saveAfterSalesAutoRule(ctx, input) {
        var _a, _b, _c, _d, _e, _f, _g;
        const name = String((_a = input.name) !== null && _a !== void 0 ? _a : '').trim();
        if (!name)
            throw new core_2.UserInputError('请填写规则名称');
        if (name.length > 100)
            throw new core_2.UserInputError('规则名称最多 100 字');
        const action = String((_b = input.action) !== null && _b !== void 0 ? _b : '').trim();
        if (!['approve', 'reject', 'escalate'].includes(action))
            throw new core_2.UserInputError('动作无效');
        const matchType = String((_c = input.matchType) !== null && _c !== void 0 ? _c : '*').trim() || '*';
        if (!['*', 'refund_only', 'return_refund', 'exchange'].includes(matchType))
            throw new core_2.UserInputError('匹配类型无效');
        const matchReason = String((_d = input.matchReason) !== null && _d !== void 0 ? _d : '').trim().slice(0, 200) || null;
        const rejectReason = String((_e = input.rejectReason) !== null && _e !== void 0 ? _e : '').trim().slice(0, 200) || null;
        if (action === 'reject' && !rejectReason)
            throw new core_2.UserInputError('驳回动作需填写顾客可见原因');
        const priority = input.priority == null ? 0 : Math.floor(Number(input.priority));
        if (!Number.isFinite(priority) || priority < 0 || priority > 999)
            throw new core_2.UserInputError('优先级应为 0-999');
        const minAmount = input.minAmount == null ? null : Math.floor(Number(input.minAmount));
        const maxAmount = input.maxAmount == null ? null : Math.floor(Number(input.maxAmount));
        if (minAmount != null && (!Number.isFinite(minAmount) || minAmount < 0))
            throw new core_2.UserInputError('最小金额无效');
        if (maxAmount != null && (!Number.isFinite(maxAmount) || maxAmount < 0))
            throw new core_2.UserInputError('最大金额无效');
        if (minAmount != null && maxAmount != null && minAmount > maxAmount)
            throw new core_2.UserInputError('最小金额不能大于最大金额');
        const enabled = input.enabled == null ? true : Boolean(input.enabled);
        const raw = this.connection.rawConnection;
        const chId = Number(ctx.channelId);
        if (input.id != null) {
            const rows = await raw.query('UPDATE campus_after_sales_auto_rule SET name = $1, priority = $2, enabled = $3, "matchType" = $4, '
                + '"matchReason" = $5, "minAmount" = $6, "maxAmount" = $7, action = $8, "rejectReason" = $9, '
                + '"updatedAt" = now() WHERE id = $10 AND "channelId" = $11 RETURNING *', [name, priority, enabled, matchType, matchReason, minAmount, maxAmount, action, rejectReason, Number(input.id), chId]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            const r = list === null || list === void 0 ? void 0 : list[0];
            if (!r)
                throw new core_2.UserInputError('规则不存在或不属于当前店铺');
            return this.toAutoRule(r);
        }
        const countRows = await raw.query('SELECT COUNT(*)::int AS n FROM campus_after_sales_auto_rule WHERE "channelId" = $1', [chId]);
        const countList = Array.isArray(countRows) && Array.isArray(countRows[0]) ? countRows[0] : countRows;
        if (Number((_g = (_f = countList === null || countList === void 0 ? void 0 : countList[0]) === null || _f === void 0 ? void 0 : _f.n) !== null && _g !== void 0 ? _g : 0) >= 30)
            throw new core_2.UserInputError('分流规则最多 30 条');
        const rows = await raw.query('INSERT INTO campus_after_sales_auto_rule ("channelId", name, priority, enabled, "matchType", '
            + '"matchReason", "minAmount", "maxAmount", action, "rejectReason") '
            + 'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *', [chId, name, priority, enabled, matchType, matchReason, minAmount, maxAmount, action, rejectReason]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const r = list === null || list === void 0 ? void 0 : list[0];
        if (!r)
            throw new core_2.UserInputError('规则保存失败');
        return this.toAutoRule(r);
    }
    /** 删除售后自动分流规则（§98） */
    async deleteAfterSalesAutoRule(ctx, id) {
        const rows = await this.connection.rawConnection.query('DELETE FROM campus_after_sales_auto_rule WHERE id = $1 AND "channelId" = $2 RETURNING id', [Number(id), Number(ctx.channelId)]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return (Array.isArray(list) ? list : []).length > 0;
    }
    /**
     * 执行自动分流规则（§98）：扫描本店近 7 日未分流过的 Pending 单，按优先级首个命中规则执行
     * approve / reject / escalate，执行后写 autoRuleAppliedAt 防重复（失败也标记，避免每轮重试放大退款风险）。
     */
    async applyAfterSalesAutoRules(ctx, limit = 50) {
        var _a, _b, _c;
        const rules = (await this.afterSalesAutoRules(ctx)).filter(r => r.enabled);
        if (!rules.length)
            return 0;
        const chId = Number(ctx.channelId);
        const rows = await this.connection.rawConnection.query('SELECT a.id, a.type, a.reason, a."refundAmount" AS amount '
            + 'FROM after_sales_request a '
            + 'WHERE a.state = \'Pending\' AND a."autoRuleAppliedAt" IS NULL '
            + 'AND a."createdAt" >= now() - interval \'7 days\' '
            + 'AND EXISTS (SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId") '
            + 'ORDER BY a."createdAt" ASC LIMIT $2', [chId, Math.min(100, Math.max(1, Math.floor(limit) || 50))]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const svc = this.getAfterSales();
        if (!svc)
            return 0;
        let applied = 0;
        for (const r of (Array.isArray(list) ? list : [])) {
            const type = String(r.type);
            const reason = String((_a = r.reason) !== null && _a !== void 0 ? _a : '');
            const amount = Number(r.amount) || 0;
            const rule = rules.find(x => (x.matchType === '*' || x.matchType === type)
                && (!x.matchReason || reason.includes(x.matchReason))
                && (x.minAmount == null || amount >= x.minAmount)
                && (x.maxAmount == null || amount <= x.maxAmount));
            if (!rule)
                continue;
            try {
                if (rule.action === 'approve') {
                    // 大额退款二次复核（§99）对自动分流同样生效：命中阈值只登记复核，不直接退款
                    const gated = await this.refundReviewGate(ctx, [Number(r.id)]);
                    if (gated.has(Number(r.id))) {
                        await this.createRefundReview(ctx, Number(r.id), gated.get(Number(r.id)));
                    }
                    else {
                        await svc.approveRequest(ctx, Number(r.id));
                    }
                }
                else if (rule.action === 'reject') {
                    await svc.rejectRequest(ctx, Number(r.id), (_b = rule.rejectReason) !== null && _b !== void 0 ? _b : '不符合售后条件');
                }
                else {
                    await this.afterSalesEscalate(ctx, Number(r.id), `自动分流：${rule.name}`, 'normal');
                }
                applied++;
            }
            catch (e) {
                core_2.Logger.warn(`自动分流执行失败 request=${r.id} rule=${rule.id}: ${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`, 'CampusAfterSalesRule');
            }
            finally {
                await this.connection.rawConnection.query('UPDATE after_sales_request SET "autoRuleAppliedAt" = now(), "autoRuleId" = $2 WHERE id = $1', [Number(r.id), Number(rule.id)]).catch(() => null);
            }
        }
        return applied;
    }
    /** 高频售后顾客 Top N（§85）：区间内售后次数/退款额，附黑名单状态，手机号脱敏 */
    async afterSalesTopCustomers(ctx, from, to, limit) {
        var _a;
        const start = this.campusDayStart(from);
        const end = this.campusDayEnd(to);
        if (!start || !end)
            throw new core_2.UserInputError('日期格式无效，应为 YYYY-MM-DD');
        if (start.getTime() > end.getTime())
            throw new core_2.UserInputError('开始日期不能晚于结束日期');
        const take = Math.min(50, Math.max(1, Math.floor(Number(limit !== null && limit !== void 0 ? limit : 10)) || 10));
        const chId = Number(ctx.channelId);
        const scope = 'EXISTS (SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId")';
        try {
            const rows = await this.connection.rawConnection.query(`SELECT a."customerId", c."firstName", c."lastName", c."phoneNumber" AS phone,
                        COUNT(*)::int AS n,
                        COALESCE(SUM(COALESCE(a."actualRefundAmount", a."refundAmount")), 0)::int AS amount,
                        EXISTS (SELECT 1 FROM campus_blacklist b WHERE b."channelId" = $1 AND b.type = 'user'
                                AND b."customerId" = a."customerId" AND b.active = true) AS blacklisted
                   FROM after_sales_request a
                   LEFT JOIN customer c ON c.id = a."customerId"
                  WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}
                    AND a."customerId" IS NOT NULL
                  GROUP BY a."customerId", c."firstName", c."lastName", c."phoneNumber"
                  ORDER BY n DESC, amount DESC
                  LIMIT $4`, [chId, start, end, take]);
            return (Array.isArray(rows) ? rows : []).map(r => {
                var _a, _b;
                return ({
                    customerId: String(r.customerId),
                    name: `${String((_a = r.lastName) !== null && _a !== void 0 ? _a : '')}${String((_b = r.firstName) !== null && _b !== void 0 ? _b : '')}`.trim() || '顾客',
                    phone: this.maskPhone(r.phone),
                    count: Number(r.n) || 0,
                    refundAmount: Number(r.amount) || 0,
                    blacklisted: Boolean(r.blacklisted),
                });
            });
        }
        catch (e) {
            throw new core_2.UserInputError(`售后顾客分析失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
    }
    /** 一键拉黑高频售后顾客（§85）：仅限在本店有售后记录的顾客，已存在则不重复插入 */
    async blacklistAfterSalesCustomer(ctx, customerId, reason) {
        var _a;
        const cid = Number(customerId);
        if (!Number.isFinite(cid) || cid <= 0)
            throw new core_2.UserInputError('顾客参数无效');
        const why = (String(reason !== null && reason !== void 0 ? reason : '').trim() || '售后异常（商家手动拉黑）').slice(0, 200);
        const chId = Number(ctx.channelId);
        const raw = this.connection.rawConnection;
        try {
            const owned = await raw.query('SELECT 1 FROM after_sales_request a WHERE a."customerId" = $2 AND EXISTS ('
                + 'SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
                + 'AND oc."channelId" = $1 WHERE o.id = a."orderId") LIMIT 1', [chId, cid]);
            const hits = Array.isArray(owned) && Array.isArray(owned[0]) ? owned[0] : owned;
            if (!Array.isArray(hits) || !hits.length) {
                throw new core_2.UserInputError('该顾客在本店没有售后记录');
            }
            await raw.query(`INSERT INTO campus_blacklist ("channelId", type, "customerId", phone, reason, "createdBy", active)
                 SELECT $1, 'user', $2, NULL, $3, 'merchant', true
                  WHERE NOT EXISTS (
                        SELECT 1 FROM campus_blacklist b
                         WHERE b."channelId" = $1 AND b.type = 'user'
                           AND b."customerId" = $2 AND b.active = true
                    )`, [chId, cid, why]);
            return true;
        }
        catch (e) {
            if (e instanceof core_2.UserInputError)
                throw e;
            throw new core_2.UserInputError(`加入黑名单失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
    }
    /** 售后内部备注（§86）：仅本店商家可见，按时间正序 */
    async afterSalesNotes(ctx, id) {
        await this.assertRequestInChannel(ctx, id);
        const rows = await this.connection.rawConnection.query('SELECT id, content, "createdBy", "createdAt" FROM campus_after_sales_note '
            + 'WHERE "channelId" = $1 AND "requestId" = $2 ORDER BY "createdAt" ASC LIMIT 200', [Number(ctx.channelId), Number(id)]);
        return (Array.isArray(rows) ? rows : []).map(r => {
            var _a, _b;
            return ({
                id: String(r.id),
                content: String((_a = r.content) !== null && _a !== void 0 ? _a : ''),
                createdBy: String((_b = r.createdBy) !== null && _b !== void 0 ? _b : 'merchant'),
                createdAt: new Date(r.createdAt),
            });
        });
    }
    /** 新增内部备注（§86）：顾客端不可见，仅用于商家交接与留痕 */
    async addAfterSalesNote(ctx, id, content) {
        var _a, _b;
        await this.assertRequestInChannel(ctx, id);
        const text = String(content !== null && content !== void 0 ? content : '').trim();
        if (!text)
            throw new core_2.UserInputError('请填写备注内容');
        if (text.length > 500)
            throw new core_2.UserInputError('备注最多 500 字');
        const rows = await this.connection.rawConnection.query('INSERT INTO campus_after_sales_note ("channelId", "requestId", "content", "createdBy") '
            + `VALUES ($1, $2, $3, 'merchant') RETURNING id, content, "createdBy", "createdAt"`, [Number(ctx.channelId), Number(id), text]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const r = list === null || list === void 0 ? void 0 : list[0];
        if (!r)
            throw new core_2.UserInputError('备注保存失败');
        return {
            id: String(r.id),
            content: String((_a = r.content) !== null && _a !== void 0 ? _a : text),
            createdBy: String((_b = r.createdBy) !== null && _b !== void 0 ? _b : 'merchant'),
            createdAt: new Date(r.createdAt),
        };
    }
    /** 删除内部备注（§86）：仅本店备注可删 */
    async deleteAfterSalesNote(ctx, id, noteId) {
        await this.assertRequestInChannel(ctx, id);
        const rows = await this.connection.rawConnection.query('DELETE FROM campus_after_sales_note WHERE id = $1 AND "channelId" = $2 AND "requestId" = $3 RETURNING id', [Number(noteId), Number(ctx.channelId), Number(id)]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return Array.isArray(list) && list.length > 0;
    }
    /** 批量催办顾客（§86）：单批上限 20，逐单结果；仍受同单 60 秒冷却约束 */
    async afterSalesBatchRemind(ctx, ids, note) {
        var _a;
        const list = this.normalizeBatchIds(ids);
        if (list.length > 20)
            throw new core_2.UserInputError('单次最多催办 20 条');
        const results = [];
        for (const id of list) {
            try {
                const row = await this.afterSalesRemind(ctx, id, note);
                results.push({ id: String(id), success: true, state: String(row.state), message: '' });
            }
            catch (e) {
                results.push({ id: String(id), success: false, state: '', message: String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e) });
            }
        }
        return results;
    }
    /** 快捷回复模板列表（§87、§97）：本店渠道，支持按分类与关键词检索，排序权重小者靠前 */
    async afterSalesReplyTemplates(ctx, options) {
        var _a, _b;
        const conds = ['"channelId" = $1'];
        const params = [Number(ctx.channelId)];
        const category = String((_a = options === null || options === void 0 ? void 0 : options.category) !== null && _a !== void 0 ? _a : '').trim();
        if (category) {
            params.push(category);
            conds.push(`category = $${params.length}`);
        }
        const keyword = String((_b = options === null || options === void 0 ? void 0 : options.keyword) !== null && _b !== void 0 ? _b : '').trim();
        if (keyword) {
            params.push(`%${keyword}%`);
            conds.push(`(content ILIKE $${params.length} OR COALESCE(keywords, '') ILIKE $${params.length})`);
        }
        const rows = await this.connection.rawConnection.query(`SELECT id, content, "createdAt", category, keywords, "sortOrder" FROM campus_after_sales_reply_template `
            + `WHERE ${conds.join(' AND ')} ORDER BY "sortOrder" ASC, id ASC LIMIT 50`, params);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return (Array.isArray(list) ? list : []).map(r => {
            var _a;
            return ({
                id: String(r.id),
                content: String((_a = r.content) !== null && _a !== void 0 ? _a : ''),
                createdAt: new Date(r.createdAt),
                category: r.category ? String(r.category) : null,
                keywords: r.keywords ? String(r.keywords) : null,
                sortOrder: Number(r.sortOrder) || 0,
            });
        });
    }
    /** 新增 / 修改快捷回复模板（§87、§97）：单店上限 30 条，单条最多 200 字，可设分类/关键词/排序 */
    async saveAfterSalesReplyTemplate(ctx, id, content, category, keywords, sortOrder) {
        var _a, _b;
        const text = String(content !== null && content !== void 0 ? content : '').trim();
        if (!text)
            throw new core_2.UserInputError('请填写模板内容');
        if (text.length > 200)
            throw new core_2.UserInputError('模板最多 200 字');
        const cat = String(category !== null && category !== void 0 ? category : '').trim().slice(0, 50) || null;
        const kw = String(keywords !== null && keywords !== void 0 ? keywords : '').trim().slice(0, 200) || null;
        const order = sortOrder == null ? 0 : Math.floor(Number(sortOrder));
        if (!Number.isFinite(order) || order < 0 || order > 999)
            throw new core_2.UserInputError('排序权重应为 0-999');
        const raw = this.connection.rawConnection;
        const chId = Number(ctx.channelId);
        const pick = (r, fallback) => {
            var _a;
            return ({
                id: String(r.id),
                content: String((_a = r.content) !== null && _a !== void 0 ? _a : fallback),
                createdAt: new Date(r.createdAt),
                category: r.category ? String(r.category) : null,
                keywords: r.keywords ? String(r.keywords) : null,
                sortOrder: Number(r.sortOrder) || 0,
            });
        };
        if (id != null) {
            const rows = await raw.query('UPDATE campus_after_sales_reply_template SET content = $1, category = $2, keywords = $3, '
                + '"sortOrder" = $4, "updatedAt" = now() '
                + 'WHERE id = $5 AND "channelId" = $6 RETURNING id, content, "createdAt", category, keywords, "sortOrder"', [text, cat, kw, order, Number(id), chId]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            const r = list === null || list === void 0 ? void 0 : list[0];
            if (!r)
                throw new core_2.UserInputError('模板不存在或不属于当前店铺');
            return pick(r, text);
        }
        const countRows = await raw.query('SELECT COUNT(*)::int AS n FROM campus_after_sales_reply_template WHERE "channelId" = $1', [chId]);
        const countList = Array.isArray(countRows) && Array.isArray(countRows[0]) ? countRows[0] : countRows;
        if (Number((_b = (_a = countList === null || countList === void 0 ? void 0 : countList[0]) === null || _a === void 0 ? void 0 : _a.n) !== null && _b !== void 0 ? _b : 0) >= 30) {
            throw new core_2.UserInputError('快捷回复模板最多 30 条，请先删除不用的模板');
        }
        const rows = await raw.query('INSERT INTO campus_after_sales_reply_template ("channelId", content, category, keywords, "sortOrder") '
            + 'VALUES ($1, $2, $3, $4, $5) RETURNING id, content, "createdAt", category, keywords, "sortOrder"', [chId, text, cat, kw, order]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const r = list === null || list === void 0 ? void 0 : list[0];
        if (!r)
            throw new core_2.UserInputError('模板保存失败');
        return pick(r, text);
    }
    /** 删除快捷回复模板（§87） */
    async deleteAfterSalesReplyTemplate(ctx, id) {
        const rows = await this.connection.rawConnection.query('DELETE FROM campus_after_sales_reply_template WHERE id = $1 AND "channelId" = $2 RETURNING id', [Number(id), Number(ctx.channelId)]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return Array.isArray(list) && list.length > 0;
    }
    /** 手动为退款失败单排程重试（§87）：复用/复位任务到 PENDING，1 分钟后由兜底扫描执行 */
    async afterSalesScheduleRefundRetry(ctx, id) {
        await this.assertChannelAfterSales(ctx, id, ['RefundFailed']);
        const job = this.getAfterSalesJob();
        if (!job)
            throw new core_2.UserInputError('售后插件未安装，暂不能排程退款重试');
        const rules = await this.afterSalesRules(ctx);
        // 自动重试关闭时手动仍允许一轮兜底尝试
        const maxAttempt = rules.refundAutoRetry > 0 ? rules.refundAutoRetry : 3;
        const repo = this.connection.getRepository(ctx, after_sales_plugin_1.AfterSalesTimeoutTask);
        const where = {
            requestId: Number(id),
            channelId: Number(ctx.channelId),
            type: after_sales_plugin_1.AfterSalesTimeoutType.REFUND_RETRY,
            status: after_sales_plugin_1.AfterSalesTimeoutStatus.PENDING,
        };
        const existing = await repo.findOne({ where: where, order: { id: 'DESC' } });
        if (existing) {
            existing.attempt = 0;
            existing.maxAttempt = maxAttempt;
            existing.dueAt = new Date(Date.now() + 60000);
            existing.retryCount = 0;
            existing.lastError = null;
            await repo.save(existing);
            return this.toTaskRow(existing);
        }
        await job.scheduleTimeout(after_sales_plugin_1.AfterSalesTimeoutType.REFUND_RETRY, Number(id), Number(ctx.channelId), 60000, 'RefundFailed', maxAttempt);
        const fresh = await repo.findOne({ where: where, order: { id: 'DESC' } });
        if (!fresh)
            throw new core_2.UserInputError('退款重试任务登记失败');
        return this.toTaskRow(fresh);
    }
    /** 售后标签列表（§88）：本店渠道，附当前打标单数 */
    async afterSalesTags(ctx) {
        const rows = await this.connection.rawConnection.query('SELECT t.id, t.name, '
            + '(SELECT COUNT(*)::int FROM campus_after_sales_tag_link l '
            + 'WHERE l."channelId" = t."channelId" AND l."tagId" = t.id) AS "usedCount" '
            + 'FROM campus_after_sales_tag t WHERE t."channelId" = $1 ORDER BY t.id ASC', [Number(ctx.channelId)]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return (Array.isArray(list) ? list : []).map(r => {
            var _a;
            return ({
                id: String(r.id),
                name: String((_a = r.name) !== null && _a !== void 0 ? _a : ''),
                usedCount: Number(r.usedCount) || 0,
            });
        });
    }
    /** 新增 / 重命名售后标签（§88）：单店上限 20 个，名称最多 12 字 */
    async saveAfterSalesTag(ctx, id, name) {
        var _a, _b, _c, _d;
        const text = String(name !== null && name !== void 0 ? name : '').trim();
        if (!text)
            throw new core_2.UserInputError('请填写标签名称');
        if (text.length > 12)
            throw new core_2.UserInputError('标签名称最多 12 字');
        const raw = this.connection.rawConnection;
        const chId = Number(ctx.channelId);
        if (id != null) {
            const rows = await raw.query('UPDATE campus_after_sales_tag SET name = $1, "updatedAt" = now() '
                + 'WHERE id = $2 AND "channelId" = $3 RETURNING id, name', [text, Number(id), chId]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            const r = list === null || list === void 0 ? void 0 : list[0];
            if (!r)
                throw new core_2.UserInputError('标签不存在或不属于当前店铺');
            return { id: String(r.id), name: String((_a = r.name) !== null && _a !== void 0 ? _a : text), usedCount: 0 };
        }
        const countRows = await raw.query('SELECT COUNT(*)::int AS n FROM campus_after_sales_tag WHERE "channelId" = $1', [chId]);
        const countList = Array.isArray(countRows) && Array.isArray(countRows[0]) ? countRows[0] : countRows;
        if (Number((_c = (_b = countList === null || countList === void 0 ? void 0 : countList[0]) === null || _b === void 0 ? void 0 : _b.n) !== null && _c !== void 0 ? _c : 0) >= 20) {
            throw new core_2.UserInputError('售后标签最多 20 个，请先删除不用的标签');
        }
        const rows = await raw.query('INSERT INTO campus_after_sales_tag ("channelId", name) VALUES ($1, $2) RETURNING id, name', [chId, text]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const r = list === null || list === void 0 ? void 0 : list[0];
        if (!r)
            throw new core_2.UserInputError('标签保存失败');
        return { id: String(r.id), name: String((_d = r.name) !== null && _d !== void 0 ? _d : text), usedCount: 0 };
    }
    /** 删除售后标签（§88）：一并清除本店打标关联 */
    async deleteAfterSalesTag(ctx, id) {
        const raw = this.connection.rawConnection;
        const chId = Number(ctx.channelId);
        const rows = await raw.query('DELETE FROM campus_after_sales_tag WHERE id = $1 AND "channelId" = $2 RETURNING id', [Number(id), chId]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        if (!Array.isArray(list) || !list.length)
            return false;
        await raw.query('DELETE FROM campus_after_sales_tag_link WHERE "channelId" = $1 AND "tagId" = $2', [chId, Number(id)]);
        return true;
    }
    /** 设置售后单标签（§88）：整体替换，单次最多 5 个，返回标签名 */
    async setAfterSalesTags(ctx, id, tagIds) {
        var _a, _b, _c;
        await this.assertRequestInChannel(ctx, id);
        const chId = Number(ctx.channelId);
        const ids = Array.from(new Set((Array.isArray(tagIds) ? tagIds : [])
            .map(t => Number(t))
            .filter(n => Number.isFinite(n) && n > 0)));
        if (ids.length > 5)
            throw new core_2.UserInputError('单张售后单最多 5 个标签');
        if (ids.length) {
            const ownRows = await this.connection.rawConnection.query('SELECT COUNT(*)::int AS n FROM campus_after_sales_tag WHERE "channelId" = $1 AND id = ANY($2::int[])', [chId, ids]);
            const ownList = Array.isArray(ownRows) && Array.isArray(ownRows[0]) ? ownRows[0] : ownRows;
            if (Number((_b = (_a = ownList === null || ownList === void 0 ? void 0 : ownList[0]) === null || _a === void 0 ? void 0 : _a.n) !== null && _b !== void 0 ? _b : 0) !== ids.length) {
                throw new core_2.UserInputError('存在不属于当前店铺的标签');
            }
        }
        await this.connection.rawConnection.transaction(async (manager) => {
            await manager.query('DELETE FROM campus_after_sales_tag_link WHERE "channelId" = $1 AND "requestId" = $2', [chId, Number(id)]);
            if (ids.length) {
                await manager.query('INSERT INTO campus_after_sales_tag_link ("channelId", "requestId", "tagId") '
                    + 'SELECT $1, $2, unnest($3::int[]) ON CONFLICT DO NOTHING', [chId, Number(id), ids]);
            }
        });
        const map = await this.afterSalesTagNames(ctx, [Number(id)]);
        return (_c = map.get(Number(id))) !== null && _c !== void 0 ? _c : [];
    }
    /** 批量取某批售后单的标签名（§88）：表缺失时降级为空 */
    async afterSalesTagNames(ctx, ids) {
        var _a, _b, _c;
        const out = new Map();
        const list = (Array.isArray(ids) ? ids : []).filter(n => Number.isFinite(n) && n > 0);
        if (!list.length)
            return out;
        try {
            const rows = await this.connection.rawConnection.query('SELECT l."requestId", t.name FROM campus_after_sales_tag_link l '
                + 'JOIN campus_after_sales_tag t ON t.id = l."tagId" '
                + 'WHERE l."channelId" = $1 AND l."requestId" = ANY($2::int[]) ORDER BY t.id ASC', [Number(ctx.channelId), list]);
            for (const r of (_a = (Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows)) !== null && _a !== void 0 ? _a : []) {
                const key = Number(r.requestId);
                const names = (_b = out.get(key)) !== null && _b !== void 0 ? _b : [];
                names.push(String((_c = r.name) !== null && _c !== void 0 ? _c : ''));
                out.set(key, names);
            }
        }
        catch (_d) {
            return out;
        }
        return out;
    }
    /** 批量取某批售后单的处理人（§89）：表缺失时降级为空 */
    async afterSalesAssigneeMap(ctx, ids) {
        var _a;
        const out = new Map();
        const list = (Array.isArray(ids) ? ids : []).filter(n => Number.isFinite(n) && n > 0);
        if (!list.length)
            return out;
        try {
            const rows = await this.connection.rawConnection.query('SELECT l."requestId", l."assigneeUserId", ad."firstName", ad."lastName" '
                + 'FROM campus_after_sales_assignee l '
                + 'LEFT JOIN administrator ad ON ad."userId" = l."assigneeUserId" '
                + 'WHERE l."channelId" = $1 AND l."requestId" = ANY($2::int[])', [Number(ctx.channelId), list]);
            for (const r of (_a = (Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows)) !== null && _a !== void 0 ? _a : []) {
                const name = [r.firstName, r.lastName].filter(Boolean).join('') || null;
                out.set(Number(r.requestId), { userId: String(r.assigneeUserId), name });
            }
        }
        catch (_b) {
            return out;
        }
        return out;
    }
    /** 处理人候选（§89）：本店渠道内有角色权限的管理员 */
    async afterSalesAssignees(ctx) {
        try {
            const rows = await this.connection.rawConnection.query('SELECT DISTINCT ad."userId" AS id, ad."firstName", ad."lastName", u.identifier '
                + 'FROM administrator ad '
                + 'JOIN "user" u ON u.id = ad."userId" '
                + 'JOIN user_roles_role urr ON urr."userId" = ad."userId" '
                + 'JOIN role r ON r.id = urr."roleId" '
                + 'JOIN role_channels_channel rc ON rc."roleId" = r.id AND rc."channelId" = $1 '
                + 'WHERE ad."deletedAt" IS NULL '
                + 'ORDER BY ad."userId" ASC LIMIT 50', [Number(ctx.channelId)]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            return (Array.isArray(list) ? list : []).map(r => {
                var _a, _b;
                return ({
                    id: String(r.id),
                    name: [r.firstName, r.lastName].filter(Boolean).join('') || String((_a = r.identifier) !== null && _a !== void 0 ? _a : ''),
                    identifier: String((_b = r.identifier) !== null && _b !== void 0 ? _b : ''),
                });
            });
        }
        catch (_a) {
            return [];
        }
    }
    /** 指派处理人（§89）：传空=取消指派；处理人必须是本店渠道管理员 */
    async afterSalesAssign(ctx, id, userId) {
        var _a;
        await this.assertRequestInChannel(ctx, id);
        const chId = Number(ctx.channelId);
        const raw = this.connection.rawConnection;
        const prevRows = await raw.query('SELECT "assigneeUserId" FROM campus_after_sales_assignee WHERE "channelId" = $1 AND "requestId" = $2', [chId, Number(id)]);
        const prevList = Array.isArray(prevRows) && Array.isArray(prevRows[0]) ? prevRows[0] : prevRows;
        const fromId = ((_a = prevList === null || prevList === void 0 ? void 0 : prevList[0]) === null || _a === void 0 ? void 0 : _a.assigneeUserId) == null ? null : Number(prevList[0].assigneeUserId);
        if (userId == null) {
            await raw.query('DELETE FROM campus_after_sales_assignee WHERE "channelId" = $1 AND "requestId" = $2', [chId, Number(id)]);
            if (fromId != null)
                await this.recordAssignChange(chId, Number(id), fromId, null);
            if (fromId != null)
                await this.auditAfterSales(ctx, Number(id), 'unassign', `解除处理人 #${fromId}`);
            return this.afterSalesOne(ctx, id);
        }
        const uid = Number(userId);
        const owned = await raw.query('SELECT 1 FROM administrator ad '
            + 'JOIN user_roles_role urr ON urr."userId" = ad."userId" '
            + 'JOIN role r ON r.id = urr."roleId" '
            + 'JOIN role_channels_channel rc ON rc."roleId" = r.id AND rc."channelId" = $2 '
            + 'WHERE ad."userId" = $1 AND ad."deletedAt" IS NULL LIMIT 1', [uid, chId]);
        const hits = Array.isArray(owned) && Array.isArray(owned[0]) ? owned[0] : owned;
        if (!Array.isArray(hits) || !hits.length) {
            throw new core_2.UserInputError('处理人不存在或不属于当前店铺');
        }
        await raw.query('INSERT INTO campus_after_sales_assignee ("channelId", "requestId", "assigneeUserId") '
            + 'VALUES ($1, $2, $3) '
            + 'ON CONFLICT ("channelId", "requestId") DO UPDATE '
            + 'SET "assigneeUserId" = EXCLUDED."assigneeUserId", "updatedAt" = now()', [chId, Number(id), uid]);
        if (fromId !== uid)
            await this.recordAssignChange(chId, Number(id), fromId, uid);
        if (fromId !== uid)
            await this.auditAfterSales(ctx, Number(id), 'assign', `指派给处理人 #${uid}`);
        return this.afterSalesOne(ctx, id);
    }
    /**
     * 工单转交（§99）：把售后单转给另一位本店管理员，附转交原因并写指派历史，
     * 同时向店铺群推送协作通知（飞书未配置时静默跳过）。
     */
    async afterSalesTransfer(ctx, id, userId, reason) {
        var _a, _b, _c;
        await this.assertRequestInChannel(ctx, id);
        const why = String(reason !== null && reason !== void 0 ? reason : '').trim();
        if (!why)
            throw new core_2.UserInputError('请填写转交原因');
        if (why.length > 200)
            throw new core_2.UserInputError('转交原因最多 200 字');
        const chId = Number(ctx.channelId);
        const nid = Number(id);
        const uid = Number(userId);
        if (!Number.isFinite(uid) || uid <= 0)
            throw new core_2.UserInputError('接手人参数无效');
        const raw = this.connection.rawConnection;
        const prevRows = await raw.query('SELECT "assigneeUserId" FROM campus_after_sales_assignee WHERE "channelId" = $1 AND "requestId" = $2', [chId, nid]);
        const prevList = Array.isArray(prevRows) && Array.isArray(prevRows[0]) ? prevRows[0] : prevRows;
        const fromId = ((_a = prevList === null || prevList === void 0 ? void 0 : prevList[0]) === null || _a === void 0 ? void 0 : _a.assigneeUserId) == null ? null : Number(prevList[0].assigneeUserId);
        if (fromId === uid)
            throw new core_2.UserInputError('该售后单已由该处理人负责，无需转交');
        const owned = await raw.query('SELECT 1 FROM administrator ad '
            + 'JOIN user_roles_role urr ON urr."userId" = ad."userId" '
            + 'JOIN role r ON r.id = urr."roleId" '
            + 'JOIN role_channels_channel rc ON rc."roleId" = r.id AND rc."channelId" = $2 '
            + 'WHERE ad."userId" = $1 AND ad."deletedAt" IS NULL LIMIT 1', [uid, chId]);
        const hits = Array.isArray(owned) && Array.isArray(owned[0]) ? owned[0] : owned;
        if (!Array.isArray(hits) || !hits.length)
            throw new core_2.UserInputError('接手人不存在或不属于当前店铺');
        await raw.query('INSERT INTO campus_after_sales_assignee ("channelId", "requestId", "assigneeUserId") '
            + 'VALUES ($1, $2, $3) '
            + 'ON CONFLICT ("channelId", "requestId") DO UPDATE '
            + 'SET "assigneeUserId" = EXCLUDED."assigneeUserId", "updatedAt" = now()', [chId, nid, uid]);
        await this.recordAssignChange(chId, nid, fromId, uid, why);
        const toName = await this.adminDisplayName(uid);
        if (this.feishu.enabled) {
            const code = String((_c = (_b = ctx.channel) === null || _b === void 0 ? void 0 : _b.code) !== null && _c !== void 0 ? _c : '');
            this.feishu.broadcast(`【售后转交】售后单 #${nid} 转交给 ${toName || `操作人 #${uid}`}，原因：${why}`, { channel: code }).catch(e => { var _a; return core_2.Logger.warn(`transfer notify failed: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, 'CampusMerchantAfterSales'); });
        }
        await this.auditAfterSales(ctx, nid, 'transfer', `转交给 ${toName || `操作人 #${uid}`}，原因：${why}`);
        return this.afterSalesOne(ctx, id);
    }
    /** 管理员显示名（§99）：firstName + lastName，取不到回退为 null */
    async adminDisplayName(userId) {
        var _a;
        try {
            const rows = await this.connection.rawConnection.query('SELECT "firstName", "lastName", identifier FROM administrator WHERE "userId" = $1 LIMIT 1', [userId]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            const r = Array.isArray(list) ? list[0] : null;
            if (!r)
                return null;
            return [r.firstName, r.lastName].filter(Boolean).join('') || String((_a = r.identifier) !== null && _a !== void 0 ? _a : '') || null;
        }
        catch (_b) {
            return null;
        }
    }
    /**
     * 智能话术推荐（§99）：按售后类型 + 顾客申请原因匹配本店快捷回复模板，
     * 关键词命中优先、分类命中次之，返回得分最高的 3 条；全部未命中时按排序兜底。
     */
    async afterSalesSuggestedReplies(ctx, id) {
        var _a, _b, _c;
        const request = await this.assertChannelAfterSales(ctx, id, []);
        const templates = await this.afterSalesReplyTemplates(ctx);
        const type = String((_a = request.type) !== null && _a !== void 0 ? _a : '');
        const reason = String((_b = request.reason) !== null && _b !== void 0 ? _b : '');
        const typeWords = {
            refund_only: ['退款', '仅退款', '不退货'],
            return_refund: ['退货', '退回', '寄回', '退换'],
            exchange: ['换货', '补发', '换新'],
        };
        const typeLabels = {
            refund_only: '仅退款',
            return_refund: '退货退款',
            exchange: '换货',
        };
        const typeText = [type, ...((_c = typeWords[type]) !== null && _c !== void 0 ? _c : [])].join(' ');
        const scored = templates.map(t => {
            var _a;
            let score = 0;
            const kws = String((_a = t.keywords) !== null && _a !== void 0 ? _a : '').split(/[\s,，;；、]+/).filter(Boolean);
            for (const kw of kws) {
                if (reason.includes(kw))
                    score += 3;
                if (typeText.includes(kw))
                    score += 2;
            }
            const label = typeLabels[type];
            if (label && t.category && t.category.includes(label))
                score += 2;
            if (reason.length >= 2 && t.content.includes(reason))
                score += 2;
            return { id: t.id, content: t.content, score };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, 3);
    }
    /** 批量打标签（§89）：上限 50 单、5 个标签，逐单返回结果，失败不阻断整批 */
    async afterSalesBatchTag(ctx, ids, tagIds) {
        var _a, _b, _c;
        const chId = Number(ctx.channelId);
        const list = Array.from(new Set((Array.isArray(ids) ? ids : [])
            .map(n => Number(n))
            .filter(n => Number.isFinite(n) && n > 0)));
        if (!list.length)
            return [];
        if (list.length > 50)
            throw new core_2.UserInputError('单批最多 50 单');
        const tags = Array.from(new Set((Array.isArray(tagIds) ? tagIds : [])
            .map(n => Number(n))
            .filter(n => Number.isFinite(n) && n > 0)));
        if (tags.length > 5)
            throw new core_2.UserInputError('单张售后单最多 5 个标签');
        const raw = this.connection.rawConnection;
        if (tags.length) {
            const ownRows = await raw.query('SELECT COUNT(*)::int AS n FROM campus_after_sales_tag WHERE "channelId" = $1 AND id = ANY($2::int[])', [chId, tags]);
            const ownList = Array.isArray(ownRows) && Array.isArray(ownRows[0]) ? ownRows[0] : ownRows;
            if (Number((_b = (_a = ownList === null || ownList === void 0 ? void 0 : ownList[0]) === null || _a === void 0 ? void 0 : _a.n) !== null && _b !== void 0 ? _b : 0) !== tags.length) {
                throw new core_2.UserInputError('存在不属于当前店铺的标签');
            }
        }
        // 渠道归属：仅本店订单对应的售后单可打标
        const ownedRows = await raw.query('SELECT a.id, a.state FROM after_sales_request a '
            + 'JOIN "order" o ON o.id = a."orderId" '
            + 'JOIN order_channels_channel oc ON oc."orderId" = o.id AND oc."channelId" = $1 '
            + 'WHERE a.id = ANY($2::int[])', [chId, list]);
        const owned = Array.isArray(ownedRows) && Array.isArray(ownedRows[0]) ? ownedRows[0] : ownedRows;
        const ownedMap = new Map();
        for (const r of Array.isArray(owned) ? owned : []) {
            ownedMap.set(Number(r.id), String((_c = r.state) !== null && _c !== void 0 ? _c : ''));
        }
        const valid = list.filter(n => ownedMap.has(n));
        if (tags.length && valid.length) {
            await raw.transaction(async (manager) => {
                for (const tagId of tags) {
                    await manager.query('INSERT INTO campus_after_sales_tag_link ("channelId", "requestId", "tagId") '
                        + 'SELECT $1, unnest($2::int[]), $3 ON CONFLICT DO NOTHING', [chId, valid, tagId]);
                }
            });
        }
        return list.map(n => {
            var _a;
            return ownedMap.has(n)
                ? { id: String(n), success: true, state: (_a = ownedMap.get(n)) !== null && _a !== void 0 ? _a : '', message: '' }
                : { id: String(n), success: false, state: '', message: '售后单不存在或不属于当前店铺' };
        });
    }
    /** 解除本店拉黑（§89）：按顾客维度撤销 active 记录 */
    async unblacklistAfterSalesCustomer(ctx, customerId) {
        var _a;
        const cid = Number(customerId);
        if (!Number.isFinite(cid) || cid <= 0)
            throw new core_2.UserInputError('顾客参数无效');
        try {
            const rows = await this.connection.rawConnection.query(`UPDATE campus_blacklist SET active = false
                  WHERE "channelId" = $1 AND type = 'user' AND "customerId" = $2 AND active = true
                  RETURNING id`, [Number(ctx.channelId), cid]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            return Array.isArray(list) && list.length > 0;
        }
        catch (e) {
            throw new core_2.UserInputError(`解除黑名单失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
    }
    /** 本店拉黑顾客列表（§90）：仅 active 记录，按拉黑时间倒序 */
    async afterSalesBlacklist(ctx, opts = {}) {
        var _a, _b;
        const skip = Math.max(0, Math.floor(Number((_a = opts.skip) !== null && _a !== void 0 ? _a : 0)) || 0);
        const take = Math.min(100, Math.max(1, Math.floor(Number((_b = opts.take) !== null && _b !== void 0 ? _b : 50)) || 50));
        const rows = await this.connection.rawConnection.query('SELECT b.id, b."customerId", b.phone, b.reason, b."createdBy", b."createdAt", '
            + 'c."firstName", c."lastName", c."phoneNumber" '
            + 'FROM campus_blacklist b LEFT JOIN customer c ON c.id = b."customerId" '
            + 'WHERE b."channelId" = $1 AND b.active = true '
            + 'ORDER BY b."createdAt" DESC LIMIT $2 OFFSET $3', [Number(ctx.channelId), take, skip]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return (Array.isArray(list) ? list : []).map(r => {
            var _a, _b, _c;
            const name = [r.firstName, r.lastName].filter(Boolean).join('') || null;
            const rawPhone = (_b = (_a = r.phone) !== null && _a !== void 0 ? _a : r.phoneNumber) !== null && _b !== void 0 ? _b : null;
            return {
                id: String(r.id),
                customerId: r.customerId == null ? null : String(r.customerId),
                customerName: name,
                phone: rawPhone == null ? null : String(rawPhone).replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'),
                reason: r.reason == null ? null : String(r.reason),
                createdBy: String((_c = r.createdBy) !== null && _c !== void 0 ? _c : ''),
                createdAt: new Date(r.createdAt),
            };
        });
    }
    /** 批量指派处理人（§90）：userId 为空=批量取消，逐单返回结果 */
    async afterSalesBatchAssign(ctx, ids, userId) {
        var _a, _b;
        const chId = Number(ctx.channelId);
        const list = Array.from(new Set((Array.isArray(ids) ? ids : [])
            .map(n => Number(n))
            .filter(n => Number.isFinite(n) && n > 0)));
        if (!list.length)
            return [];
        if (list.length > 50)
            throw new core_2.UserInputError('单批最多 50 单');
        const raw = this.connection.rawConnection;
        let uid = null;
        if (userId != null) {
            uid = Number(userId);
            const owned = await raw.query('SELECT 1 FROM administrator ad '
                + 'JOIN user_roles_role urr ON urr."userId" = ad."userId" '
                + 'JOIN role r ON r.id = urr."roleId" '
                + 'JOIN role_channels_channel rc ON rc."roleId" = r.id AND rc."channelId" = $2 '
                + 'WHERE ad."userId" = $1 AND ad."deletedAt" IS NULL LIMIT 1', [uid, chId]);
            const hits = Array.isArray(owned) && Array.isArray(owned[0]) ? owned[0] : owned;
            if (!Array.isArray(hits) || !hits.length) {
                throw new core_2.UserInputError('处理人不存在或不属于当前店铺');
            }
        }
        const ownedRows = await raw.query('SELECT a.id, a.state FROM after_sales_request a '
            + 'JOIN "order" o ON o.id = a."orderId" '
            + 'JOIN order_channels_channel oc ON oc."orderId" = o.id AND oc."channelId" = $1 '
            + 'WHERE a.id = ANY($2::int[])', [chId, list]);
        const owned = Array.isArray(ownedRows) && Array.isArray(ownedRows[0]) ? ownedRows[0] : ownedRows;
        const ownedMap = new Map();
        for (const r of Array.isArray(owned) ? owned : []) {
            ownedMap.set(Number(r.id), String((_a = r.state) !== null && _a !== void 0 ? _a : ''));
        }
        const valid = list.filter(n => ownedMap.has(n));
        if (valid.length) {
            const prevRows = await raw.query('SELECT "requestId", "assigneeUserId" FROM campus_after_sales_assignee '
                + 'WHERE "channelId" = $1 AND "requestId" = ANY($2::int[])', [chId, valid]);
            const prevList = Array.isArray(prevRows) && Array.isArray(prevRows[0]) ? prevRows[0] : prevRows;
            const prevMap = new Map();
            for (const r of Array.isArray(prevList) ? prevList : []) {
                prevMap.set(Number(r.requestId), Number(r.assigneeUserId));
            }
            await raw.transaction(async (manager) => {
                await manager.query('DELETE FROM campus_after_sales_assignee WHERE "channelId" = $1 AND "requestId" = ANY($2::int[])', [chId, valid]);
                if (uid != null) {
                    await manager.query('INSERT INTO campus_after_sales_assignee ("channelId", "requestId", "assigneeUserId") '
                        + 'SELECT $1, unnest($2::int[]), $3 ON CONFLICT ("channelId", "requestId") DO NOTHING', [chId, valid, uid]);
                }
            });
            // 指派历史（§92）：仅记录实际发生变化的单
            for (const rid of valid) {
                const fromId = (_b = prevMap.get(rid)) !== null && _b !== void 0 ? _b : null;
                const toId = uid !== null && uid !== void 0 ? uid : null;
                if (fromId === toId)
                    continue;
                await this.recordAssignChange(chId, rid, fromId, toId);
            }
        }
        return list.map(n => {
            var _a;
            return ownedMap.has(n)
                ? { id: String(n), success: true, state: (_a = ownedMap.get(n)) !== null && _a !== void 0 ? _a : '', message: '' }
                : { id: String(n), success: false, state: '', message: '售后单不存在或不属于当前店铺' };
        });
    }
    /** 记录指派/转交变更（§92、§99）：写日志失败不阻断指派本身 */
    async recordAssignChange(channelId, requestId, fromUserId, toUserId, reason) {
        var _a;
        try {
            await this.connection.rawConnection.query('INSERT INTO campus_after_sales_assign_log ("channelId", "requestId", "fromUserId", "toUserId", reason) '
                + 'VALUES ($1, $2, $3, $4, $5)', [channelId, requestId, fromUserId, toUserId, reason ? String(reason).slice(0, 200) : null]);
        }
        catch (e) {
            core_2.Logger.warn(`record assign change failed: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, 'MerchantAdmin');
        }
    }
    /** 指派历史（§92）：按时间倒序，带双方姓名；§99 起含转交原因 */
    async afterSalesAssignLogs(requestId) {
        try {
            const rows = await this.connection.rawConnection.query('SELECT l."fromUserId", l."toUserId", l."createdAt", l.reason, '
                + 'f."firstName" AS ff, f."lastName" AS fl, '
                + 't."firstName" AS tf, t."lastName" AS tl '
                + 'FROM campus_after_sales_assign_log l '
                + 'LEFT JOIN administrator f ON f."userId" = l."fromUserId" '
                + 'LEFT JOIN administrator t ON t."userId" = l."toUserId" '
                + 'WHERE l."requestId" = $1 ORDER BY l."createdAt" DESC LIMIT 50', [requestId]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            return (Array.isArray(list) ? list : []).map(r => ({
                fromUserId: r.fromUserId == null ? null : String(r.fromUserId),
                fromName: [r.ff, r.fl].filter(Boolean).join('') || null,
                toUserId: r.toUserId == null ? null : String(r.toUserId),
                toName: [r.tf, r.tl].filter(Boolean).join('') || null,
                reason: r.reason == null ? null : String(r.reason),
                createdAt: new Date(r.createdAt),
            }));
        }
        catch (_a) {
            return [];
        }
    }
    /** 批量内部备注（§92）：上限 50 单，逐单结果；单条售后备注上限 200 条 */
    async afterSalesBatchNote(ctx, ids, content) {
        var _a;
        const chId = Number(ctx.channelId);
        const list = Array.from(new Set((Array.isArray(ids) ? ids : [])
            .map(n => Number(n))
            .filter(n => Number.isFinite(n) && n > 0)));
        if (!list.length)
            return [];
        if (list.length > 50)
            throw new core_2.UserInputError('单批最多 50 单');
        const text = String(content !== null && content !== void 0 ? content : '').trim();
        if (!text)
            throw new core_2.UserInputError('请填写备注内容');
        if (text.length > 500)
            throw new core_2.UserInputError('备注最多 500 字');
        const raw = this.connection.rawConnection;
        const ownedRows = await raw.query('SELECT a.id, a.state FROM after_sales_request a '
            + 'JOIN "order" o ON o.id = a."orderId" '
            + 'JOIN order_channels_channel oc ON oc."orderId" = o.id AND oc."channelId" = $1 '
            + 'WHERE a.id = ANY($2::int[])', [chId, list]);
        const owned = Array.isArray(ownedRows) && Array.isArray(ownedRows[0]) ? ownedRows[0] : ownedRows;
        const ownedMap = new Map();
        for (const r of Array.isArray(owned) ? owned : []) {
            ownedMap.set(Number(r.id), String((_a = r.state) !== null && _a !== void 0 ? _a : ''));
        }
        const valid = list.filter(n => ownedMap.has(n));
        const capped = new Set();
        if (valid.length) {
            const inserted = await raw.query('INSERT INTO campus_after_sales_note ("channelId", "requestId", "content", "createdBy") '
                + 'SELECT $1, rid, $3, \'merchant\' FROM unnest($2::int[]) AS rid '
                + 'WHERE (SELECT COUNT(*) FROM campus_after_sales_note n WHERE n."requestId" = rid) < 200 '
                + 'RETURNING "requestId"', [chId, valid, text]);
            const insList = Array.isArray(inserted) && Array.isArray(inserted[0]) ? inserted[0] : inserted;
            const done = new Set((Array.isArray(insList) ? insList : []).map((r) => Number(r.requestId)));
            for (const rid of valid) {
                if (!done.has(rid))
                    capped.add(rid);
            }
        }
        return list.map(n => {
            var _a, _b;
            if (!ownedMap.has(n)) {
                return { id: String(n), success: false, state: '', message: '售后单不存在或不属于当前店铺' };
            }
            if (capped.has(n)) {
                return { id: String(n), success: false, state: (_a = ownedMap.get(n)) !== null && _a !== void 0 ? _a : '', message: '该售后单备注已达 200 条上限' };
            }
            return { id: String(n), success: true, state: (_b = ownedMap.get(n)) !== null && _b !== void 0 ? _b : '', message: '' };
        });
    }
    /** 商品售后统计（§92）：区间内 Top 商品售后单量、退款额与售后率 */
    async afterSalesProductReport(ctx, from, to, limit) {
        var _a;
        const start = this.campusDayStart(from);
        const end = this.campusDayEnd(to);
        if (!start || !end)
            throw new core_2.UserInputError('日期格式无效，应为 YYYY-MM-DD');
        if (start.getTime() > end.getTime())
            throw new core_2.UserInputError('开始日期不能晚于结束日期');
        if (end.getTime() - start.getTime() > 366 * 86400000)
            throw new core_2.UserInputError('查询区间最长一年');
        const chId = Number(ctx.channelId);
        const raw = this.connection.rawConnection;
        const top = Math.min(50, Math.max(1, Math.floor(Number(limit !== null && limit !== void 0 ? limit : 10)) || 10));
        const scope = 'EXISTS (SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId")';
        try {
            const requestRows = await raw.query(`WITH rp AS (
                    SELECT DISTINCT a.id, a.state,
                           COALESCE(a."actualRefundAmount", a."refundAmount")::int AS amount,
                           p.id AS pid
                      FROM after_sales_request a
                      JOIN "order" o ON o.id = a."orderId"
                      JOIN order_line ol ON ol."orderId" = o.id
                      JOIN product_variant pv ON pv.id = ol."productVariantId"
                      JOIN product p ON p.id = pv."productId"
                     WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}
                )
                SELECT rp.pid AS "productId",
                       COALESCE(pt.name, '商品 #' || rp.pid) AS "productName",
                       COUNT(*)::int AS "requestCount",
                       COUNT(*) FILTER (WHERE rp.state = 'Refunded')::int AS "refundCount",
                       COALESCE(SUM(rp.amount) FILTER (WHERE rp.state = 'Refunded'), 0)::int AS "refundAmount"
                  FROM rp
                  LEFT JOIN product_translation pt ON pt."baseId" = rp.pid AND pt."languageCode" = 'zh_Hans'
                 GROUP BY rp.pid, pt.name
                 ORDER BY "requestCount" DESC, "refundAmount" DESC
                 LIMIT $4`, [chId, start, end, top]);
            const salesRows = await raw.query(`SELECT p.id AS pid, COUNT(DISTINCT o.id)::int AS n
                   FROM "order" o
                   JOIN order_line ol ON ol."orderId" = o.id
                   JOIN product_variant pv ON pv.id = ol."productVariantId"
                   JOIN product p ON p.id = pv."productId"
                  WHERE o."createdAt" >= $2 AND o."createdAt" < $3
                    AND o.state <> 'Cancelled'
                    AND EXISTS (SELECT 1 FROM order_channels_channel oc
                                WHERE oc."orderId" = o.id AND oc."channelId" = $1)
                  GROUP BY p.id`, [chId, start, end]);
            const sales = new Map();
            for (const r of (Array.isArray(salesRows) ? salesRows : [])) {
                sales.set(Number(r.pid), Number(r.n) || 0);
            }
            return (Array.isArray(requestRows) ? requestRows : []).map(r => {
                var _a, _b;
                const pid = Number(r.productId);
                const orders = (_a = sales.get(pid)) !== null && _a !== void 0 ? _a : 0;
                const requests = Number(r.requestCount) || 0;
                return {
                    productId: String(pid),
                    productName: String((_b = r.productName) !== null && _b !== void 0 ? _b : ''),
                    requestCount: requests,
                    refundCount: Number(r.refundCount) || 0,
                    refundAmount: Number(r.refundAmount) || 0,
                    requestRate: orders > 0 ? Math.round((requests / orders) * 100) : 0,
                };
            });
        }
        catch (e) {
            throw new core_2.UserInputError(`商品售后统计查询失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
    }
    /** 售后原因分布（§93）：区间内按原因聚合单量/退款，含占比与环比 */
    async afterSalesReasonReport(ctx, from, to, limit) {
        var _a, _b;
        const start = this.campusDayStart(from);
        const end = this.campusDayEnd(to);
        if (!start || !end)
            throw new core_2.UserInputError('日期格式无效，应为 YYYY-MM-DD');
        if (start.getTime() > end.getTime())
            throw new core_2.UserInputError('开始日期不能晚于结束日期');
        if (end.getTime() - start.getTime() > 366 * 86400000)
            throw new core_2.UserInputError('查询区间最长一年');
        const chId = Number(ctx.channelId);
        const take = Math.min(50, Math.max(1, Math.floor(Number(limit !== null && limit !== void 0 ? limit : 10)) || 10));
        const spanMs = end.getTime() - start.getTime();
        const prevStart = new Date(start.getTime() - spanMs);
        const prevEnd = new Date(start.getTime());
        const scope = 'EXISTS (SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId")';
        const reasonExpr = `COALESCE(NULLIF(TRIM(a.reason), ''), '未填写')`;
        try {
            const raw = this.connection.rawConnection;
            const curRows = await raw.query(`SELECT ${reasonExpr} AS reason, COUNT(*)::int AS n,
                        COUNT(*) FILTER (WHERE a.state = 'Refunded')::int AS refunded,
                        COALESCE(SUM(COALESCE(a."actualRefundAmount", a."refundAmount"))
                                 FILTER (WHERE a.state = 'Refunded'), 0)::int AS amount
                   FROM after_sales_request a
                  WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}
                  GROUP BY 1 ORDER BY n DESC, amount DESC`, [chId, start, end]);
            const prevRows = await raw.query(`SELECT ${reasonExpr} AS reason, COUNT(*)::int AS n
                   FROM after_sales_request a
                  WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}
                  GROUP BY 1`, [chId, prevStart, prevEnd]);
            const cur = Array.isArray(curRows) ? curRows : [];
            const prev = new Map();
            for (const r of Array.isArray(prevRows) ? prevRows : []) {
                prev.set(String((_a = r.reason) !== null && _a !== void 0 ? _a : '未填写'), Number(r.n) || 0);
            }
            const total = cur.reduce((s, r) => s + (Number(r.n) || 0), 0);
            return cur.slice(0, take).map(r => {
                var _a, _b;
                const reason = String((_a = r.reason) !== null && _a !== void 0 ? _a : '未填写');
                const n = Number(r.n) || 0;
                const p = (_b = prev.get(reason)) !== null && _b !== void 0 ? _b : 0;
                return {
                    reason,
                    requestCount: n,
                    refundCount: Number(r.refunded) || 0,
                    refundAmount: Number(r.amount) || 0,
                    share: total > 0 ? Math.round((n / total) * 100) : 0,
                    previousCount: p,
                    changeRate: p > 0 ? Math.round(((n - p) / p) * 100) : null,
                };
            });
        }
        catch (e) {
            throw new core_2.UserInputError(`售后原因分布查询失败：${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`);
        }
    }
    /** 顾客售后档案（§93）：本店维度聚合历史售后、退款与拉黑状态 */
    async afterSalesCustomerProfile(ctx, customerId) {
        var _a, _b, _c, _d;
        const cid = Number(customerId);
        if (!Number.isFinite(cid) || cid <= 0)
            throw new core_2.UserInputError('顾客参数无效');
        const chId = Number(ctx.channelId);
        const raw = this.connection.rawConnection;
        const scope = 'EXISTS (SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId")';
        try {
            const infoRows = await raw.query('SELECT c."firstName", c."lastName", c."phoneNumber" AS phone, '
                + 'EXISTS (SELECT 1 FROM campus_blacklist b WHERE b."channelId" = $2 AND b.type = \'user\' '
                + 'AND b."customerId" = c.id AND b.active = true) AS blacklisted '
                + 'FROM customer c WHERE c.id = $1', [cid, chId]);
            const info = (_a = (Array.isArray(infoRows) ? infoRows : [])[0]) !== null && _a !== void 0 ? _a : {};
            const aggRows = await raw.query(`SELECT COUNT(*)::int AS n,
                        COUNT(*) FILTER (WHERE a.state = 'Refunded')::int AS refunded,
                        COALESCE(SUM(COALESCE(a."actualRefundAmount", a."refundAmount"))
                                 FILTER (WHERE a.state = 'Refunded'), 0)::int AS amount,
                        MIN(a."createdAt") AS first_at, MAX(a."createdAt") AS last_at
                   FROM after_sales_request a
                  WHERE a."customerId" = $2 AND ${scope}`, [chId, cid]);
            const agg = (Array.isArray(aggRows) ? aggRows : [])[0];
            if (!agg || !(Number(agg.n) || 0))
                throw new core_2.UserInputError('该顾客在本店没有售后记录');
            const recentRows = await raw.query(`SELECT a.id, a.type, a.state, a."createdAt",
                        COALESCE(a."actualRefundAmount", a."refundAmount")::int AS amount,
                        o.code AS "orderCode"
                   FROM after_sales_request a
                   LEFT JOIN "order" o ON o.id = a."orderId"
                  WHERE a."customerId" = $2 AND ${scope}
                  ORDER BY a."createdAt" DESC LIMIT 10`, [chId, cid]);
            return {
                customerId: String(cid),
                name: `${String((_b = info.lastName) !== null && _b !== void 0 ? _b : '')}${String((_c = info.firstName) !== null && _c !== void 0 ? _c : '')}`.trim() || '顾客',
                phone: info.phone ? this.maskPhone(info.phone) : null,
                blacklisted: Boolean(info.blacklisted),
                requestCount: Number(agg.n) || 0,
                refundedCount: Number(agg.refunded) || 0,
                refundAmount: Number(agg.amount) || 0,
                firstAt: agg.first_at ? new Date(agg.first_at) : null,
                lastAt: agg.last_at ? new Date(agg.last_at) : null,
                recent: (Array.isArray(recentRows) ? recentRows : []).map(r => {
                    var _a, _b, _c;
                    return ({
                        id: String(r.id),
                        orderCode: String((_a = r.orderCode) !== null && _a !== void 0 ? _a : ''),
                        type: String((_b = r.type) !== null && _b !== void 0 ? _b : ''),
                        state: String((_c = r.state) !== null && _c !== void 0 ? _c : ''),
                        amount: Number(r.amount) || 0,
                        createdAt: new Date(r.createdAt),
                    });
                }),
            };
        }
        catch (e) {
            if (e instanceof core_2.UserInputError)
                throw e;
            throw new core_2.UserInputError(`顾客售后档案查询失败：${(_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : e}`);
        }
    }
    /** 售后处理凭证（§93）：门店留存/交接用纯文本凭条 */
    async afterSalesPrintSlip(ctx, id) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        await this.assertRequestInChannel(ctx, id);
        const chId = Number(ctx.channelId);
        const raw = this.connection.rawConnection;
        const rows = await raw.query('SELECT a.id, a.type, a.state, a.reason, a.description, a."rejectReason", '
            + 'a."refundAmount", a."actualRefundAmount", a."createdAt", a."refundedAt", '
            + 'a."orderId", o.code AS "orderCode", c."firstName", c."lastName" '
            + 'FROM after_sales_request a '
            + 'LEFT JOIN "order" o ON o.id = a."orderId" '
            + 'LEFT JOIN customer c ON c.id = a."customerId" '
            + 'WHERE a.id = $1', [Number(id)]);
        const row = (Array.isArray(rows) ? rows : [])[0];
        if (!row)
            throw new core_2.UserInputError('售后单不存在');
        const typeLabel = {
            refund_only: '仅退款',
            return_refund: '退货退款',
            exchange: '换货',
        };
        const assignees = await this.afterSalesAssigneeMap(ctx, [Number(id)]);
        const assignee = assignees.get(Number(id));
        const items = await this.afterSalesOrderItems(Number(row.orderId));
        const yuan = (cents) => `¥${((Number(cents) || 0) / 100).toFixed(2)}`;
        const fmt = (v) => {
            if (v == null || v === '')
                return '—';
            const d = new Date(v);
            if (Number.isNaN(d.getTime()))
                return '—';
            return new Date(d.getTime() + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 16);
        };
        const channelRows = await raw.query('SELECT code FROM channel WHERE id = $1', [chId]);
        const code = String((_b = (_a = (Array.isArray(channelRows) ? channelRows : [])[0]) === null || _a === void 0 ? void 0 : _a.code) !== null && _b !== void 0 ? _b : '');
        const lines = [
            '【售后处理凭证】',
            `店铺：${code || '—'}`,
            `售后单号：#${row.id}`,
            `订单号：${(_c = row.orderCode) !== null && _c !== void 0 ? _c : '—'}`,
            `申请时间：${fmt(row.createdAt)}`,
            `顾客：${`${String((_d = row.lastName) !== null && _d !== void 0 ? _d : '')}${String((_e = row.firstName) !== null && _e !== void 0 ? _e : '')}`.trim() || '—'}`,
            `类型：${(_f = typeLabel[String(row.type)]) !== null && _f !== void 0 ? _f : String((_g = row.type) !== null && _g !== void 0 ? _g : '—')}`,
            `原因：${(_h = row.reason) !== null && _h !== void 0 ? _h : '—'}`,
            `申请金额：${yuan(row.refundAmount)}`,
            `实际退款：${row.actualRefundAmount == null ? '—' : yuan(row.actualRefundAmount)}（${fmt(row.refundedAt)}）`,
            `状态：${(_j = row.state) !== null && _j !== void 0 ? _j : '—'}`,
            `处理人：${(_k = assignee === null || assignee === void 0 ? void 0 : assignee.name) !== null && _k !== void 0 ? _k : '未指派'}`,
        ];
        if (items.length) {
            lines.push(`商品：${items.map(i => `${i.name}×${i.quantity}`).join('；')}`);
        }
        if (row.description)
            lines.push(`顾客说明：${String(row.description).slice(0, 200)}`);
        if (row.rejectReason)
            lines.push(`驳回理由：${String(row.rejectReason).slice(0, 200)}`);
        lines.push('————————', `打印时间：${fmt(Date.now())}`);
        return lines.join('\n');
    }
    /** 批量打印售后凭证（§94）：多选一次生成多张凭条，单批上限 50，无效单跳过 */
    async afterSalesPrintSlips(ctx, ids) {
        const list = (Array.isArray(ids) ? ids : [])
            .map(n => Number(n))
            .filter(n => Number.isFinite(n) && n > 0);
        const uniq = Array.from(new Set(list)).slice(0, 50);
        if (!uniq.length)
            throw new core_2.UserInputError('请选择要打印的售后单');
        const out = [];
        for (const id of uniq) {
            try {
                out.push(await this.afterSalesPrintSlip(ctx, id));
            }
            catch (_a) {
                // 越权/已删除的单直接跳过，避免整批失败
            }
        }
        if (!out.length)
            throw new core_2.UserInputError('所选售后单均不可打印');
        return out;
    }
    /**
     * 线下退款登记（§94）：商家以现金/转账等方式线下退款后登记，直接置为 Refunded，
     * 不触发支付网关；同时写状态历史与内部备注留痕，并触达顾客。
     */
    async afterSalesOfflineRefund(ctx, id, amount, method, note) {
        var _a, _b, _c, _d, _e, _f, _g;
        const request = await this.assertChannelAfterSales(ctx, id, []);
        const state = String((_a = request.state) !== null && _a !== void 0 ? _a : '');
        if (['Refunded', 'Rejected', 'Closed'].includes(state)) {
            throw new core_2.UserInputError('该售后单已结束，不能登记线下退款');
        }
        const fen = Math.floor(Number(amount));
        if (!Number.isFinite(fen) || fen <= 0)
            throw new core_2.UserInputError('退款金额必须大于 0');
        const max = Number((_b = request.refundAmount) !== null && _b !== void 0 ? _b : 0);
        if (max > 0 && fen > max) {
            throw new core_2.UserInputError(`退款金额不能超过申请金额（最多 ¥${(max / 100).toFixed(2)}）`);
        }
        const methodText = String(method !== null && method !== void 0 ? method : '').trim();
        if (!methodText)
            throw new core_2.UserInputError('请填写退款方式（如现金、转账、微信）');
        if (methodText.length > 20)
            throw new core_2.UserInputError('退款方式最多 20 个字');
        const remark = String(note !== null && note !== void 0 ? note : '').trim();
        if (remark.length > 200)
            throw new core_2.UserInputError('退款凭证备注最多 200 字');
        const raw = this.connection.rawConnection;
        const uid = ctx.activeUserId ? Number(ctx.activeUserId) : null;
        const updRows = await raw.query('UPDATE after_sales_request SET state = \'Refunded\', "actualRefundAmount" = $1, "refundedAt" = now(), '
            + '"refundError" = NULL WHERE id = $2 AND state NOT IN (\'Refunded\', \'Rejected\', \'Closed\') '
            + 'RETURNING id, state, "actualRefundAmount", "refundedAt"', [fen, Number(id)]);
        const updated = Array.isArray(updRows) && Array.isArray(updRows[0]) ? updRows[0] : updRows;
        const upd = Array.isArray(updated) ? updated[0] : undefined;
        if (!upd)
            throw new core_2.UserInputError('售后单状态已变更，请刷新后重试');
        const auditNote = `线下退款登记：方式 ${methodText}，金额 ¥${(fen / 100).toFixed(2)}`
            + (remark ? `，备注：${remark}` : '');
        // 留痕失败不阻断退款登记（历史/备注表缺失时降级）
        await raw.query('INSERT INTO after_sales_state_history ("requestId", "fromState", "toState", "operatorUserId") '
            + 'VALUES ($1, $2, \'Refunded\', $3)', [Number(id), state, uid]).catch(() => undefined);
        await raw.query('INSERT INTO campus_after_sales_note ("channelId", "requestId", "content", "createdBy") '
            + 'VALUES ($1, $2, $3, \'merchant\')', [Number(ctx.channelId), Number(id), auditNote.slice(0, 500)]).catch(() => undefined);
        await this.auditAfterSales(ctx, Number(id), 'offlineRefund', `方式 ${methodText}，金额 ¥${(fen / 100).toFixed(2)}${remark ? `，备注：${remark}` : ''}`);
        try {
            this.notify.user(ctx, request.orderId, 'afterSales', `商家已线下退款 ¥${(fen / 100).toFixed(2)}（${methodText}）`);
        }
        catch (e) {
            core_2.Logger.warn(`offline refund notify failed: ${String((_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e)}`, 'CampusMerchantAfterSales');
        }
        return {
            id: String((_d = upd.id) !== null && _d !== void 0 ? _d : id),
            state: String((_e = upd.state) !== null && _e !== void 0 ? _e : 'Refunded'),
            actualRefundAmount: Number((_f = upd.actualRefundAmount) !== null && _f !== void 0 ? _f : fen),
            refundedAt: new Date((_g = upd.refundedAt) !== null && _g !== void 0 ? _g : Date.now()),
        };
    }
    /** 标记售后风险（§94）：争议/异常单，列表可按风险筛选 */
    async afterSalesRiskFlag(ctx, id, reason) {
        await this.assertRequestInChannel(ctx, id);
        const text = String(reason !== null && reason !== void 0 ? reason : '').trim() || '争议/异常';
        if (text.length > 200)
            throw new core_2.UserInputError('风险说明最多 200 字');
        await this.connection.rawConnection.query('INSERT INTO campus_after_sales_risk ("channelId", "requestId", reason, active) '
            + 'VALUES ($1, $2, $3, true) '
            + 'ON CONFLICT ("requestId") DO UPDATE SET reason = EXCLUDED.reason, active = true, "updatedAt" = now()', [Number(ctx.channelId), Number(id), text]);
        await this.auditAfterSales(ctx, Number(id), 'riskFlag', text);
        return this.afterSalesOne(ctx, id);
    }
    /** 解除售后风险标记（§94） */
    async afterSalesRiskClear(ctx, id) {
        await this.assertRequestInChannel(ctx, id);
        await this.connection.rawConnection.query('UPDATE campus_after_sales_risk SET active = false, "updatedAt" = now() '
            + 'WHERE "channelId" = $1 AND "requestId" = $2', [Number(ctx.channelId), Number(id)]);
        await this.auditAfterSales(ctx, Number(id), 'riskClear');
        return this.afterSalesOne(ctx, id);
    }
    /** 新增顾客回访记录（§94）：电话/线上沟通留痕，可预约下次跟进 */
    async afterSalesAddFollowUp(ctx, id, method, result, note, nextAt) {
        await this.assertRequestInChannel(ctx, id);
        const m = String(method !== null && method !== void 0 ? method : '').trim();
        if (!['phone', 'wechat', 'onsite', 'other'].includes(m))
            throw new core_2.UserInputError('回访方式无效');
        const r = String(result !== null && result !== void 0 ? result : '').trim();
        if (!['reached', 'unreached', 'refused', 'other'].includes(r))
            throw new core_2.UserInputError('回访结果无效');
        const text = String(note !== null && note !== void 0 ? note : '').trim();
        if (text.length > 300)
            throw new core_2.UserInputError('回访说明最多 300 字');
        let next = null;
        if (nextAt) {
            const d = new Date(String(nextAt));
            if (Number.isNaN(d.getTime()))
                throw new core_2.UserInputError('下次跟进时间格式无效');
            next = d;
        }
        await this.connection.rawConnection.query('INSERT INTO campus_after_sales_followup ("channelId", "requestId", "operatorUserId", method, result, note, "nextAt") '
            + 'VALUES ($1, $2, $3, $4, $5, $6, $7)', [Number(ctx.channelId), Number(id), ctx.activeUserId ? Number(ctx.activeUserId) : null, m, r, text || null, next]);
        return this.afterSalesFollowUps(Number(id));
    }
    /** 回访记录列表（§94，按时间倒序）：表缺失时降级为空 */
    async afterSalesFollowUps(requestId) {
        try {
            const rows = await this.connection.rawConnection.query('SELECT f.id, f.method, f.result, f.note, f."nextAt", f."createdAt", '
                + 'ad."firstName", ad."lastName" '
                + 'FROM campus_after_sales_followup f '
                + 'LEFT JOIN administrator ad ON ad."userId" = f."operatorUserId" '
                + 'WHERE f."requestId" = $1 ORDER BY f."createdAt" DESC LIMIT 50', [requestId]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            return (Array.isArray(list) ? list : []).map(r => {
                var _a, _b;
                return ({
                    id: String(r.id),
                    method: String((_a = r.method) !== null && _a !== void 0 ? _a : ''),
                    result: String((_b = r.result) !== null && _b !== void 0 ? _b : ''),
                    note: r.note == null ? null : String(r.note),
                    nextAt: r.nextAt ? new Date(r.nextAt) : null,
                    operatorName: [r.firstName, r.lastName].filter(Boolean).join('') || null,
                    createdAt: new Date(r.createdAt),
                });
            });
        }
        catch (_a) {
            return [];
        }
    }
    /** 风险原因映射（§94）：Key=requestId，仅返回 active=true 的标记 */
    async afterSalesRiskReasons(ctx, ids) {
        var _a;
        const out = new Map();
        const list = (Array.isArray(ids) ? ids : []).filter(n => Number.isFinite(n) && n > 0);
        if (!list.length)
            return out;
        try {
            const rows = await this.connection.rawConnection.query('SELECT "requestId", reason FROM campus_after_sales_risk '
                + 'WHERE "channelId" = $1 AND "requestId" = ANY($2::int[]) AND active = true', [Number(ctx.channelId), list]);
            const raw = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            for (const r of Array.isArray(raw) ? raw : []) {
                out.set(Number(r.requestId), String((_a = r.reason) !== null && _a !== void 0 ? _a : ''));
            }
        }
        catch (_b) {
            return out;
        }
        return out;
    }
    /** SLA 暂停状态映射（§95/§96）：Key=requestId，pausedMs 为已累计暂停毫秒，reason 为当前暂停原因 */
    async afterSalesSlaPauses(ids) {
        const out = new Map();
        const list = (Array.isArray(ids) ? ids : []).filter(n => Number.isFinite(n) && n > 0);
        if (!list.length)
            return out;
        try {
            const rows = await this.connection.rawConnection.query('SELECT id, ("slaPausedAt" IS NOT NULL) AS paused, COALESCE("slaPausedMs", 0) AS "pausedMs", '
                + '"slaPausedReason" AS reason '
                + 'FROM after_sales_request WHERE id = ANY($1::int[])', [list]);
            const raw = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            for (const r of Array.isArray(raw) ? raw : []) {
                out.set(Number(r.id), {
                    paused: Boolean(r.paused),
                    pausedMs: Number(r.pausedMs) || 0,
                    reason: r.reason == null ? null : String(r.reason),
                });
            }
        }
        catch (_a) {
            return out;
        }
        return out;
    }
    /** SLA 暂停记录（§96）：按暂停时间倒序；表缺失时降级为空 */
    async afterSalesSlaPauseLogs(requestId) {
        try {
            const rows = await this.connection.rawConnection.query('SELECT id, reason, "pausedAt", "resumedAt", COALESCE("pausedMs", 0) AS "pausedMs" '
                + 'FROM campus_after_sales_sla_pause WHERE "requestId" = $1 '
                + 'ORDER BY "pausedAt" DESC LIMIT 50', [requestId]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            return (Array.isArray(list) ? list : []).map(r => {
                var _a;
                return ({
                    id: String(r.id),
                    reason: String((_a = r.reason) !== null && _a !== void 0 ? _a : ''),
                    pausedAt: new Date(r.pausedAt),
                    resumedAt: r.resumedAt ? new Date(r.resumedAt) : null,
                    pausedMs: Number(r.pausedMs) || 0,
                });
            });
        }
        catch (_a) {
            return [];
        }
    }
    /** 平台仲裁升级记录（§96）：按时间倒序；表缺失时降级为空 */
    async afterSalesEscalations(requestId) {
        try {
            const rows = await this.connection.rawConnection.query('SELECT e.id, e."requestId", e.reason, e.priority, e.status, e."createdBy", '
                + 'e."createdAt", e."resolvedAt", e.resolution, ad."firstName", ad."lastName" '
                + 'FROM campus_after_sales_escalation e '
                + 'LEFT JOIN administrator ad ON ad."userId" = e."createdBy" '
                + 'WHERE e."requestId" = $1 ORDER BY e."createdAt" DESC LIMIT 20', [requestId]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            return (Array.isArray(list) ? list : []).map(r => {
                var _a, _b, _c;
                return ({
                    id: String(r.id),
                    requestId: String(r.requestId),
                    reason: String((_a = r.reason) !== null && _a !== void 0 ? _a : ''),
                    priority: String((_b = r.priority) !== null && _b !== void 0 ? _b : 'normal'),
                    status: String((_c = r.status) !== null && _c !== void 0 ? _c : 'Open'),
                    createdBy: r.createdBy == null ? null : String(r.createdBy),
                    creatorName: [r.firstName, r.lastName].filter(Boolean).join('') || null,
                    createdAt: new Date(r.createdAt),
                    resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
                    resolution: r.resolution == null ? null : String(r.resolution),
                });
            });
        }
        catch (_a) {
            return [];
        }
    }
    /** 已升级单映射（§96）：Key=requestId，存在未关闭工单为 true；表缺失时降级为空 */
    async afterSalesEscalatedMap(ctx, ids) {
        const out = new Map();
        const list = (Array.isArray(ids) ? ids : []).filter(n => Number.isFinite(n) && n > 0);
        if (!list.length)
            return out;
        try {
            const rows = await this.connection.rawConnection.query('SELECT DISTINCT "requestId" FROM campus_after_sales_escalation '
                + 'WHERE "channelId" = $1 AND "requestId" = ANY($2::int[]) AND status = \'Open\'', [Number(ctx.channelId), list]);
            const raw = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            for (const r of Array.isArray(raw) ? raw : [])
                out.set(Number(r.requestId), true);
        }
        catch (_a) {
            return out;
        }
        return out;
    }
    async afterSalesExportSelection(ctx, ids, kind) {
        var _a;
        const chId = Number(ctx.channelId);
        const list = Array.from(new Set((Array.isArray(ids) ? ids : [])
            .map(n => Number(n))
            .filter(n => Number.isFinite(n) && n > 0)));
        if (!list.length)
            throw new core_2.UserInputError('请选择要导出的售后单');
        if (list.length > 500)
            throw new core_2.UserInputError('单次最多导出 500 单');
        const k = String(kind !== null && kind !== void 0 ? kind : '').trim();
        if (k !== 'requests' && k !== 'refunds')
            throw new core_2.UserInputError('导出类型无效');
        const raw = this.connection.rawConnection;
        const scope = 'EXISTS (SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId")';
        try {
            if (k === 'requests') {
                const rows = await raw.query(`SELECT a.id, o.code AS "orderCode", a.type, a.state, a.reason, a."rejectReason",
                            a."createdAt", COALESCE(a."actualRefundAmount", a."refundAmount")::int AS amount,
                            a."refundedAt"
                       FROM after_sales_request a
                       LEFT JOIN "order" o ON o.id = a."orderId"
                      WHERE a.id = ANY($2::int[]) AND ${scope}
                      ORDER BY a."createdAt" DESC`, [chId, list]);
                const header = ['售后单号', '订单号', '类型', '状态', '申请原因', '驳回/关闭原因', '申请时间', '退款金额(元)', '退款时间'];
                const lines = (Array.isArray(rows) ? rows : []).map(r => [
                    r.id, r.orderCode, r.type, r.state, r.reason, r.rejectReason,
                    this.campusDateTime(r.createdAt), this.yuan(r.amount), this.campusDateTime(r.refundedAt),
                ]);
                return this.toCsv(header, lines);
            }
            const rows = await raw.query(`SELECT a.id, o.code AS "orderCode", a.type, a.reason, a."refundTransactionId",
                        COALESCE(a."actualRefundAmount", a."refundAmount")::int AS amount, a."refundedAt"
                   FROM after_sales_request a
                   LEFT JOIN "order" o ON o.id = a."orderId"
                  WHERE a.state = 'Refunded' AND a.id = ANY($2::int[]) AND ${scope}
                  ORDER BY a."refundedAt" DESC`, [chId, list]);
            const header = ['售后单号', '订单号', '类型', '申请原因', '退款金额(元)', '退款时间', '退款流水号'];
            const lines = (Array.isArray(rows) ? rows : []).map(r => [
                r.id, r.orderCode, r.type, r.reason, this.yuan(r.amount),
                this.campusDateTime(r.refundedAt), r.refundTransactionId,
            ]);
            return this.toCsv(header, lines);
        }
        catch (e) {
            if (e instanceof core_2.UserInputError)
                throw e;
            throw new core_2.UserInputError(`导出失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
    }
    /** 处理人负载（§91）：按处理人聚合未完结单，附超时/临期；userId=0 为未指派 */
    async afterSalesAssigneeLoad(ctx) {
        const chId = Number(ctx.channelId);
        const timeoutHours = this.afterSalesTimeoutHours(ctx);
        const rules = await this.afterSalesRules(ctx);
        const rows = await this.connection.rawConnection.query(`SELECT COALESCE(l."assigneeUserId", 0) AS uid,
                    MAX(COALESCE(ad."firstName", '') || COALESCE(ad."lastName", '')) AS name,
                    COUNT(*)::int AS open_count,
                    COUNT(*) FILTER (
                        WHERE a."slaPausedAt" IS NULL
                          AND COALESCE(a."slaDeadlineAt",
                                a."createdAt" + make_interval(hours => $2)
                                  + (COALESCE(a."slaPausedMs", 0) / 1000) * interval '1 second') <= now()
                    )::int AS overdue_count,
                    COUNT(*) FILTER (
                        WHERE $3::int > 0
                          AND a."slaPausedAt" IS NULL
                          AND COALESCE(a."slaDeadlineAt",
                                a."createdAt" + make_interval(hours => $2)
                                  + (COALESCE(a."slaPausedMs", 0) / 1000) * interval '1 second') > now()
                          AND COALESCE(a."slaDeadlineAt",
                                a."createdAt" + make_interval(hours => $2)
                                  + (COALESCE(a."slaPausedMs", 0) / 1000) * interval '1 second')
                              - now() <= make_interval(hours => $3::int)
                    )::int AS due_soon_count
               FROM after_sales_request a
               LEFT JOIN campus_after_sales_assignee l
                 ON l."requestId" = a.id AND l."channelId" = $1
               LEFT JOIN administrator ad ON ad."userId" = l."assigneeUserId"
              WHERE a.state NOT IN ('Refunded', 'Rejected', 'Closed')
                AND EXISTS (SELECT 1 FROM "order" o
                            JOIN order_channels_channel oc ON oc."orderId" = o.id
                            WHERE o.id = a."orderId" AND oc."channelId" = $1)
              GROUP BY 1
              ORDER BY open_count DESC`, [chId, timeoutHours, rules.dueSoonHours]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return (Array.isArray(list) ? list : []).map(r => {
            var _a;
            return ({
                assigneeUserId: String(r.uid),
                assigneeName: Number(r.uid) === 0 ? '未指派' : (String((_a = r.name) !== null && _a !== void 0 ? _a : '').trim() || `操作人 #${String(r.uid)}`),
                openCount: Number(r.open_count) || 0,
                overdueCount: Number(r.overdue_count) || 0,
                dueSoonCount: Number(r.due_soon_count) || 0,
            });
        });
    }
    /** 员工处理绩效（§89）：按操作人统计处理量、完结数与首次操作/完结耗时 */
    async afterSalesStaffStats(ctx, from, to) {
        const start = this.campusDayStart(from);
        const end = this.campusDayEnd(to);
        if (!start || !end)
            throw new core_2.UserInputError('日期格式无效，应为 YYYY-MM-DD');
        if (start.getTime() > end.getTime())
            throw new core_2.UserInputError('开始日期不能晚于结束日期');
        if (end.getTime() - start.getTime() > 366 * 86400000)
            throw new core_2.UserInputError('查询区间最长一年');
        const raw = this.connection.rawConnection;
        const chId = Number(ctx.channelId);
        const scope = 'EXISTS (SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId")';
        const countRows = await raw.query(`SELECT h."operatorUserId" AS uid,
                    MAX(COALESCE(ad."firstName", '') || COALESCE(ad."lastName", '')) AS name,
                    COUNT(DISTINCT h."requestId")::int AS handled,
                    COUNT(DISTINCT h."requestId") FILTER (WHERE h."toState" IN ('Refunded', 'Closed'))::int AS resolved
               FROM after_sales_state_history h
               JOIN after_sales_request a ON a.id = h."requestId"
               LEFT JOIN administrator ad ON ad."userId" = h."operatorUserId"
              WHERE h."operatorUserId" IS NOT NULL AND h."createdAt" >= $2 AND h."createdAt" < $3
                AND ${scope}
              GROUP BY h."operatorUserId"`, [chId, start, end]);
        const firstRows = await raw.query(`SELECT x.uid, AVG(x.minutes)::int AS avg FROM (
                SELECT DISTINCT ON (h."requestId") h."operatorUserId" AS uid,
                       EXTRACT(EPOCH FROM (h."createdAt" - a."createdAt")) / 60 AS minutes
                  FROM after_sales_state_history h
                  JOIN after_sales_request a ON a.id = h."requestId"
                 WHERE h."operatorUserId" IS NOT NULL AND h."createdAt" >= $2 AND h."createdAt" < $3
                   AND ${scope}
                 ORDER BY h."requestId", h."createdAt" ASC
             ) x GROUP BY x.uid`, [chId, start, end]);
        const resolveRows = await raw.query(`SELECT x.uid, AVG(x.minutes)::int AS avg FROM (
                SELECT DISTINCT ON (h."requestId") h."operatorUserId" AS uid,
                       EXTRACT(EPOCH FROM (h."createdAt" - a."createdAt")) / 60 AS minutes
                  FROM after_sales_state_history h
                  JOIN after_sales_request a ON a.id = h."requestId"
                 WHERE h."operatorUserId" IS NOT NULL AND h."createdAt" >= $2 AND h."createdAt" < $3
                   AND h."toState" IN ('Refunded', 'Closed') AND ${scope}
                 ORDER BY h."requestId", h."createdAt" ASC
             ) x GROUP BY x.uid`, [chId, start, end]);
        const firstMap = new Map();
        for (const r of (Array.isArray(firstRows) ? firstRows : [])) {
            firstMap.set(Number(r.uid), Number(r.avg) || 0);
        }
        const resolveMap = new Map();
        for (const r of (Array.isArray(resolveRows) ? resolveRows : [])) {
            resolveMap.set(Number(r.uid), Number(r.avg) || 0);
        }
        // §97：经手单中当前仍超时未处理的单数（暂停 SLA 的单不计）
        const timeoutHours = this.afterSalesTimeoutHours(ctx);
        const overdueRows = await raw.query(`SELECT x.uid, COUNT(DISTINCT x.rid)::int AS n FROM (
                SELECT h."operatorUserId" AS uid, a.id AS rid
                  FROM after_sales_state_history h
                  JOIN after_sales_request a ON a.id = h."requestId"
                 WHERE h."operatorUserId" IS NOT NULL AND h."createdAt" >= $3 AND h."createdAt" < $4
                   AND ${scope}
                   AND a.state = 'Pending' AND a."slaPausedAt" IS NULL
                   AND a."createdAt" + make_interval(hours => $2)
                       + (COALESCE(a."slaPausedMs", 0) / 1000) * interval '1 second' <= now()
             ) x GROUP BY x.uid`, [chId, timeoutHours, start, end]);
        // §97：经手单中已升级平台仲裁的单数
        const escalatedRows = await raw.query(`SELECT x.uid, COUNT(DISTINCT x.rid)::int AS n FROM (
                SELECT h."operatorUserId" AS uid, a.id AS rid
                  FROM after_sales_state_history h
                  JOIN after_sales_request a ON a.id = h."requestId"
                 WHERE h."operatorUserId" IS NOT NULL AND h."createdAt" >= $2 AND h."createdAt" < $3
                   AND ${scope}
                   AND EXISTS (SELECT 1 FROM campus_after_sales_escalation e WHERE e."requestId" = a.id)
             ) x GROUP BY x.uid`, [chId, start, end]);
        // §98：经手单收到的满意度评分（评价表缺失时降级为 0）
        let reviewRows = [];
        try {
            reviewRows = await raw.query(`SELECT x.uid, COUNT(*)::int AS n, AVG(x.score) AS avg FROM (
                    SELECT h."operatorUserId" AS uid, r.id AS rid, r.score
                      FROM after_sales_state_history h
                      JOIN campus_after_sales_review r ON r."requestId" = h."requestId"
                      JOIN after_sales_request a ON a.id = h."requestId"
                     WHERE h."operatorUserId" IS NOT NULL
                       AND r."createdAt" >= $2 AND r."createdAt" < $3
                       AND ${scope}
                 ) x GROUP BY x.uid`, [chId, start, end]);
        }
        catch (_a) {
            reviewRows = [];
        }
        const toMap = (rows) => {
            const m = new Map();
            for (const r of (Array.isArray(rows) ? rows : []))
                m.set(Number(r.uid), Number(r.n) || 0);
            return m;
        };
        const overdueMap = toMap(overdueRows);
        const escalatedMap = toMap(escalatedRows);
        const reviewCountMap = toMap(reviewRows);
        const reviewAvgMap = new Map();
        for (const r of (Array.isArray(reviewRows) ? reviewRows : [])) {
            reviewAvgMap.set(Number(r.uid), Math.round((Number(r.avg) || 0) * 10) / 10);
        }
        return (Array.isArray(countRows) ? countRows : [])
            .map(r => {
            var _a, _b, _c, _d, _e, _f, _g;
            const handled = Number(r.handled) || 0;
            const resolved = Number(r.resolved) || 0;
            return {
                operatorUserId: String(r.uid),
                operatorName: String((_a = r.name) !== null && _a !== void 0 ? _a : '').trim() || `操作人 #${String(r.uid)}`,
                handled,
                resolved,
                firstActionAvgMinutes: (_b = firstMap.get(Number(r.uid))) !== null && _b !== void 0 ? _b : 0,
                resolveAvgMinutes: (_c = resolveMap.get(Number(r.uid))) !== null && _c !== void 0 ? _c : 0,
                overdueCount: (_d = overdueMap.get(Number(r.uid))) !== null && _d !== void 0 ? _d : 0,
                escalatedCount: (_e = escalatedMap.get(Number(r.uid))) !== null && _e !== void 0 ? _e : 0,
                resolveRate: handled > 0 ? Math.round((resolved / handled) * 100) : 0,
                reviewCount: (_f = reviewCountMap.get(Number(r.uid))) !== null && _f !== void 0 ? _f : 0,
                reviewAvgScore: (_g = reviewAvgMap.get(Number(r.uid))) !== null && _g !== void 0 ? _g : 0,
            };
        })
            .sort((a, b) => b.handled - a.handled);
    }
    /** 售后单存在且属于本店渠道（备注等无状态限制场景复用） */
    async assertRequestInChannel(ctx, id) {
        const rows = await this.connection.rawConnection.query('SELECT 1 FROM after_sales_request a WHERE a.id = $2 AND EXISTS ('
            + 'SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId") LIMIT 1', [Number(ctx.channelId), Number(id)]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        if (!Array.isArray(list) || !list.length) {
            throw new core_2.UserInputError('售后单不存在或不属于当前店铺');
        }
    }
    /** 规则变更后重排未执行任务（§86）：按新时限重算到期时间，0 表示关闭则作废 */
    async rescheduleAfterSalesTasks(ctx, rules) {
        const taskRepo = this.connection.getRepository(ctx, after_sales_plugin_1.AfterSalesTimeoutTask);
        const tasks = await taskRepo.find({
            where: {
                channelId: Number(ctx.channelId),
                status: after_sales_plugin_1.AfterSalesTimeoutStatus.PENDING,
                type: (0, typeorm_1.In)([after_sales_plugin_1.AfterSalesTimeoutType.PENDING_REMIND, after_sales_plugin_1.AfterSalesTimeoutType.PENDING_AUTO_APPROVE]),
            },
        });
        if (!tasks.length)
            return;
        const reqIds = Array.from(new Set(tasks.map(t => Number(t.requestId))));
        const requests = await this.connection.getRepository(ctx, after_sales_plugin_1.AfterSalesRequest)
            .find({ where: { id: (0, typeorm_1.In)(reqIds) } });
        const byId = new Map(requests.map(r => [Number(r.id), r]));
        for (const task of tasks) {
            const req = byId.get(Number(task.requestId));
            if (!req)
                continue;
            const hours = task.type === after_sales_plugin_1.AfterSalesTimeoutType.PENDING_REMIND
                ? rules.timeoutHours
                : rules.autoApproveHours;
            if (hours <= 0) {
                task.status = after_sales_plugin_1.AfterSalesTimeoutStatus.CANCELLED;
            }
            else {
                task.dueAt = new Date(new Date(req.createdAt).getTime() + hours * 3600000);
            }
            await taskRepo.save(task);
        }
    }
    /**
     * 退款重试次数变更立即生效（§87）：
     * 自动重试关闭 → 作废本店待执行的退款重试任务；
     * 否则为 RefundFailed 单补排/复位任务（次数下调到已用次数以下则不再补排）。
     */
    async rescheduleRefundRetryTasks(ctx, rules) {
        const raw = this.connection.rawConnection;
        const chId = Number(ctx.channelId);
        if (rules.refundAutoRetry <= 0) {
            await raw.query(`UPDATE after_sales_timeout_task SET status = 'cancelled'
                  WHERE "channelId" = $1 AND type = 'refund_retry' AND status = 'pending'`, [chId]);
            return;
        }
        const job = this.getAfterSalesJob();
        if (!job)
            return;
        const rows = await raw.query(`SELECT a.id AS "requestId", t.id AS "taskId"
               FROM after_sales_request a
               JOIN "order" o ON o.id = a."orderId"
               JOIN order_channels_channel oc ON oc."orderId" = o.id AND oc."channelId" = $1
               LEFT JOIN LATERAL (SELECT t1.id FROM after_sales_timeout_task t1
                                   WHERE t1."requestId" = a.id AND t1.type = 'refund_retry'
                                   ORDER BY t1.id DESC LIMIT 1) t ON true
              WHERE a.state = 'RefundFailed'`, [chId]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const taskRepo = this.connection.getRepository(ctx, after_sales_plugin_1.AfterSalesTimeoutTask);
        for (const r of Array.isArray(list) ? list : []) {
            const maxAttempt = rules.refundAutoRetry;
            if (r.taskId != null) {
                const task = await taskRepo.findOne({ where: { id: Number(r.taskId) } });
                if (!task)
                    continue;
                task.maxAttempt = maxAttempt;
                if (Number(task.attempt) >= maxAttempt) {
                    // 次数下调后已用次数超出上限：旧任务保留审计，不再执行
                    if (task.status === after_sales_plugin_1.AfterSalesTimeoutStatus.PENDING) {
                        task.status = after_sales_plugin_1.AfterSalesTimeoutStatus.CANCELLED;
                        await taskRepo.save(task);
                    }
                    continue;
                }
                if (task.status !== after_sales_plugin_1.AfterSalesTimeoutStatus.PENDING) {
                    // 旧任务已结束（耗尽/失败），按剩余次数复位为待执行
                    task.status = after_sales_plugin_1.AfterSalesTimeoutStatus.PENDING;
                    task.retryCount = 0;
                    task.lastError = null;
                    task.dueAt = new Date(Date.now() + 30 * 60 * 1000);
                }
                await taskRepo.save(task);
                continue;
            }
            await job.scheduleTimeout(after_sales_plugin_1.AfterSalesTimeoutType.REFUND_RETRY, Number(r.requestId), chId, 30 * 60 * 1000, 'RefundFailed', maxAttempt);
        }
    }
    toTaskRow(t) {
        var _a, _b;
        return {
            id: String(t.id),
            type: String(t.type),
            requestId: Number(t.requestId),
            status: String(t.status),
            dueAt: t.dueAt,
            attempt: Number(t.attempt) || 0,
            maxAttempt: Number(t.maxAttempt) || 0,
            retryCount: Number(t.retryCount) || 0,
            lastError: (_a = t.lastError) !== null && _a !== void 0 ? _a : null,
            executedAt: (_b = t.executedAt) !== null && _b !== void 0 ? _b : null,
        };
    }
    getAfterSalesJob() {
        var _a, _b, _c;
        if (this.afterSalesJobSvc !== undefined)
            return (_a = this.afterSalesJobSvc) !== null && _a !== void 0 ? _a : null;
        try {
            this.afterSalesJobSvc = this.moduleRef ? new core_2.Injector(this.moduleRef).get(after_sales_plugin_1.AfterSalesTimeoutJob) : null;
        }
        catch (e) {
            this.afterSalesJobSvc = null;
            core_2.Logger.warn(`AfterSalesTimeoutJob 不可用，商家端任务执行降级: ${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`, 'CampusMerchant');
        }
        return (_c = this.afterSalesJobSvc) !== null && _c !== void 0 ? _c : null;
    }
    /** 金额分 → 元（两位小数），导出用 */
    yuan(fen) {
        const n = Number(fen);
        return Number.isFinite(n) ? (n / 100).toFixed(2) : '0.00';
    }
    /** 校园时间导出格式：YYYY-MM-DD HH:mm:ss（UTC+8） */
    campusDateTime(v) {
        if (v == null)
            return '';
        const d = v instanceof Date ? v : new Date(v);
        if (Number.isNaN(d.getTime()))
            return '';
        return d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
    }
    /** 手机号脱敏：保留前 3 后 4，长度不足时整体打码 */
    maskPhone(v) {
        const s = String(v !== null && v !== void 0 ? v : '');
        if (!s)
            return '';
        return s.length >= 8 ? `${s.slice(0, 3)}****${s.slice(-4)}` : '****';
    }
    toCsv(header, rows) {
        const cell = (v) => {
            let s = v == null ? '' : String(v);
            // CSV 公式注入防护：用户可控文本以 = + - @ 开头时 Excel 会当公式执行；
            // 数值列保持原样（负数金额不能加前缀破坏类型）
            if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s))
                s = `'${s}`;
            return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [header, ...rows].map(r => r.map(cell).join(','));
        // UTF-8 BOM：Excel 直接打开中文不乱码
        return '\uFEFF' + lines.join('\r\n');
    }
    /**
     * 售后报表（§83）：按校园日（UTC+8）统计区间内创建量、退款单数与金额、当前超时数、逐日趋势。
     * 渠道隔离沿用「订单渠道」口径；退款按 refundedAt 归集，避免跨区间错位。
     */
    async afterSalesReport(ctx, from, to) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7;
        const start = this.campusDayStart(from);
        const end = this.campusDayEnd(to);
        if (!start || !end)
            throw new core_2.UserInputError('日期格式无效，应为 YYYY-MM-DD');
        if (start.getTime() > end.getTime())
            throw new core_2.UserInputError('开始日期不能晚于结束日期');
        if (end.getTime() - start.getTime() > 366 * 86400000)
            throw new core_2.UserInputError('查询区间最长一年');
        const chId = Number(ctx.channelId);
        const raw = this.connection.rawConnection;
        const scope = 'EXISTS (SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId")';
        const timeoutHours = this.afterSalesTimeoutHours(ctx);
        try {
            const typeRows = await raw.query(`SELECT a.type AS type, COUNT(*)::int AS n FROM after_sales_request a
                  WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}
                  GROUP BY a.type`, [chId, start, end]);
            const stateRows = await raw.query(`SELECT a.state AS state, COUNT(*)::int AS n FROM after_sales_request a
                  WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}
                  GROUP BY a.state`, [chId, start, end]);
            const refundRows = await raw.query(`SELECT COUNT(*)::int AS n,
                        COALESCE(SUM(COALESCE(a."actualRefundAmount", a."refundAmount")), 0)::int AS amount
                   FROM after_sales_request a
                  WHERE a.state = 'Refunded' AND a."refundedAt" >= $2 AND a."refundedAt" < $3 AND ${scope}`, [chId, start, end]);
            const overdueRows = await raw.query(`SELECT COUNT(*)::int AS n FROM after_sales_request a
                  WHERE a.state = 'Pending' AND a."createdAt" >= $2 AND a."createdAt" < $3
                    AND a."slaPausedAt" IS NULL
                    AND COALESCE(a."slaDeadlineAt",
                          a."createdAt" + make_interval(hours => $4)
                            + (COALESCE(a."slaPausedMs", 0) / 1000) * interval '1 second') <= now()
                    AND ${scope}`, [chId, start, end, timeoutHours]);
            // 环比（§90）：上一周期 = 等长区间紧邻当前区间之前
            const spanMs = end.getTime() - start.getTime();
            const prevStart = new Date(start.getTime() - spanMs);
            const prevEnd = new Date(start.getTime());
            const prevTotalRows = await raw.query(`SELECT COUNT(*)::int AS n FROM after_sales_request a
                  WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}`, [chId, prevStart, prevEnd]);
            const prevRefundRows = await raw.query(`SELECT COUNT(*)::int AS n,
                        COALESCE(SUM(COALESCE(a."actualRefundAmount", a."refundAmount")), 0)::int AS amount
                   FROM after_sales_request a
                  WHERE a.state = 'Refunded' AND a."refundedAt" >= $2 AND a."refundedAt" < $3 AND ${scope}`, [chId, prevStart, prevEnd]);
            const prevOverdueRows = await raw.query(`SELECT COUNT(*)::int AS n FROM after_sales_request a
                  WHERE a.state = 'Pending' AND a."createdAt" >= $2 AND a."createdAt" < $3
                    AND a."slaPausedAt" IS NULL
                    AND COALESCE(a."slaDeadlineAt",
                          a."createdAt" + make_interval(hours => $4)
                            + (COALESCE(a."slaPausedMs", 0) / 1000) * interval '1 second') <= now()
                    AND ${scope}`, [chId, prevStart, prevEnd, timeoutHours]);
            const dayCreated = await raw.query(`SELECT to_char(a."createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS d,
                        COUNT(*)::int AS n
                   FROM after_sales_request a
                  WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}
                  GROUP BY 1`, [chId, start, end]);
            const dayRefunded = await raw.query(`SELECT to_char(a."refundedAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS d,
                        COUNT(*)::int AS n,
                        COALESCE(SUM(COALESCE(a."actualRefundAmount", a."refundAmount")), 0)::int AS amount
                   FROM after_sales_request a
                  WHERE a.state = 'Refunded' AND a."refundedAt" >= $2 AND a."refundedAt" < $3 AND ${scope}
                  GROUP BY 1`, [chId, start, end]);
            const reasonRows = await raw.query(`SELECT a.reason AS reason, COUNT(*)::int AS n FROM after_sales_request a
                  WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}
                    AND a.reason IS NOT NULL AND a.reason <> ''
                  GROUP BY a.reason ORDER BY n DESC LIMIT 5`, [chId, start, end]);
            const rejectRows = await raw.query(`SELECT a."rejectReason" AS reason, COUNT(*)::int AS n FROM after_sales_request a
                  WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}
                    AND a."rejectReason" IS NOT NULL AND a."rejectReason" <> ''
                  GROUP BY a."rejectReason" ORDER BY n DESC LIMIT 5`, [chId, start, end]);
            // SLA（§86）：首响=创建到商家首条留言；完结=创建到首次 Refunded/Closed
            const rules = await this.afterSalesRules(ctx);
            const firstRows = await raw.query(`SELECT AVG(EXTRACT(EPOCH FROM (fr."createdAt" - a."createdAt")) / 60)::int AS avg_min,
                        MAX(EXTRACT(EPOCH FROM (fr."createdAt" - a."createdAt")) / 60)::int AS max_min,
                        COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (fr."createdAt" - a."createdAt")) <= $4)::int AS hit,
                        COUNT(*)::int AS n
                   FROM after_sales_request a
                   JOIN LATERAL (SELECT MIN(m."createdAt") AS "createdAt" FROM after_sales_message m
                                  WHERE m."requestId" = a.id AND m."senderType" = 'admin') fr
                     ON fr."createdAt" IS NOT NULL
                  WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}`, [chId, start, end, rules.firstResponseTargetHours * 3600]);
            const resolveRows = await raw.query(`SELECT AVG(EXTRACT(EPOCH FROM (r."createdAt" - a."createdAt")) / 60)::int AS avg_min,
                        MAX(EXTRACT(EPOCH FROM (r."createdAt" - a."createdAt")) / 60)::int AS max_min,
                        COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (r."createdAt" - a."createdAt")) <= $4)::int AS hit,
                        COUNT(*)::int AS n
                   FROM after_sales_request a
                   JOIN LATERAL (SELECT MIN(h."createdAt") AS "createdAt" FROM after_sales_state_history h
                                  WHERE h."requestId" = a.id AND h."toState" IN ('Refunded', 'Closed')) r
                     ON r."createdAt" IS NOT NULL
                  WHERE a."createdAt" >= $2 AND a."createdAt" < $3 AND ${scope}`, [chId, start, end, rules.resolveTargetHours * 3600]);
            // 达标率只在配置了目标时计算；无样本或未配置返回 0
            const firstN = Number((_b = (_a = firstRows === null || firstRows === void 0 ? void 0 : firstRows[0]) === null || _a === void 0 ? void 0 : _a.n) !== null && _b !== void 0 ? _b : 0);
            const firstHit = Number((_d = (_c = firstRows === null || firstRows === void 0 ? void 0 : firstRows[0]) === null || _c === void 0 ? void 0 : _c.hit) !== null && _d !== void 0 ? _d : 0);
            const resolveN = Number((_f = (_e = resolveRows === null || resolveRows === void 0 ? void 0 : resolveRows[0]) === null || _e === void 0 ? void 0 : _e.n) !== null && _f !== void 0 ? _f : 0);
            const resolveHit = Number((_h = (_g = resolveRows === null || resolveRows === void 0 ? void 0 : resolveRows[0]) === null || _g === void 0 ? void 0 : _g.hit) !== null && _h !== void 0 ? _h : 0);
            const firstResponseOnTargetRate = rules.firstResponseTargetHours > 0 && firstN > 0
                ? Math.round((firstHit / firstN) * 100)
                : 0;
            const resolveOnTargetRate = rules.resolveTargetHours > 0 && resolveN > 0
                ? Math.round((resolveHit / resolveN) * 100)
                : 0;
            const byDay = new Map();
            for (const r of (Array.isArray(dayCreated) ? dayCreated : [])) {
                byDay.set(String(r.d), { count: Number(r.n) || 0, refunded: 0, refundAmount: 0 });
            }
            for (const r of (Array.isArray(dayRefunded) ? dayRefunded : [])) {
                const row = (_j = byDay.get(String(r.d))) !== null && _j !== void 0 ? _j : { count: 0, refunded: 0, refundAmount: 0 };
                row.refunded = Number(r.n) || 0;
                row.refundAmount = Number(r.amount) || 0;
                byDay.set(String(r.d), row);
            }
            const byType = (Array.isArray(typeRows) ? typeRows : [])
                .map(r => ({ type: String(r.type), count: Number(r.n) || 0 }));
            const byState = (Array.isArray(stateRows) ? stateRows : [])
                .map(r => ({ state: String(r.state), count: Number(r.n) || 0 }));
            return {
                from: String(from),
                to: String(to),
                total: byState.reduce((s, r) => s + r.count, 0),
                byType,
                byState,
                refunded: Number((_l = (_k = refundRows === null || refundRows === void 0 ? void 0 : refundRows[0]) === null || _k === void 0 ? void 0 : _k.n) !== null && _l !== void 0 ? _l : 0),
                refundAmount: Number((_o = (_m = refundRows === null || refundRows === void 0 ? void 0 : refundRows[0]) === null || _m === void 0 ? void 0 : _m.amount) !== null && _o !== void 0 ? _o : 0),
                overdue: Number((_q = (_p = overdueRows === null || overdueRows === void 0 ? void 0 : overdueRows[0]) === null || _p === void 0 ? void 0 : _p.n) !== null && _q !== void 0 ? _q : 0),
                byDay: Array.from(byDay.entries())
                    .sort(([a], [b]) => (a < b ? -1 : 1))
                    .map(([date, v]) => (Object.assign({ date }, v))),
                reasons: (Array.isArray(reasonRows) ? reasonRows : [])
                    .map(r => ({ reason: String(r.reason), count: Number(r.n) || 0 })),
                rejectReasons: (Array.isArray(rejectRows) ? rejectRows : [])
                    .map(r => ({ reason: String(r.reason), count: Number(r.n) || 0 })),
                firstResponseAvgMinutes: Number((_s = (_r = firstRows === null || firstRows === void 0 ? void 0 : firstRows[0]) === null || _r === void 0 ? void 0 : _r.avg_min) !== null && _s !== void 0 ? _s : 0),
                firstResponseMaxMinutes: Number((_u = (_t = firstRows === null || firstRows === void 0 ? void 0 : firstRows[0]) === null || _t === void 0 ? void 0 : _t.max_min) !== null && _u !== void 0 ? _u : 0),
                resolveAvgMinutes: Number((_w = (_v = resolveRows === null || resolveRows === void 0 ? void 0 : resolveRows[0]) === null || _v === void 0 ? void 0 : _v.avg_min) !== null && _w !== void 0 ? _w : 0),
                resolveMaxMinutes: Number((_y = (_x = resolveRows === null || resolveRows === void 0 ? void 0 : resolveRows[0]) === null || _x === void 0 ? void 0 : _x.max_min) !== null && _y !== void 0 ? _y : 0),
                firstResponseOnTargetRate,
                resolveOnTargetRate,
                firstResponseOverdue: rules.firstResponseTargetHours > 0 ? Math.max(firstN - firstHit, 0) : 0,
                resolveOverdue: rules.resolveTargetHours > 0 ? Math.max(resolveN - resolveHit, 0) : 0,
                previousTotal: Number((_0 = (_z = prevTotalRows === null || prevTotalRows === void 0 ? void 0 : prevTotalRows[0]) === null || _z === void 0 ? void 0 : _z.n) !== null && _0 !== void 0 ? _0 : 0),
                previousRefunded: Number((_2 = (_1 = prevRefundRows === null || prevRefundRows === void 0 ? void 0 : prevRefundRows[0]) === null || _1 === void 0 ? void 0 : _1.n) !== null && _2 !== void 0 ? _2 : 0),
                previousRefundAmount: Number((_4 = (_3 = prevRefundRows === null || prevRefundRows === void 0 ? void 0 : prevRefundRows[0]) === null || _3 === void 0 ? void 0 : _3.amount) !== null && _4 !== void 0 ? _4 : 0),
                previousOverdue: Number((_6 = (_5 = prevOverdueRows === null || prevOverdueRows === void 0 ? void 0 : prevOverdueRows[0]) === null || _5 === void 0 ? void 0 : _5.n) !== null && _6 !== void 0 ? _6 : 0),
            };
        }
        catch (e) {
            throw new core_2.UserInputError(`售后报表查询失败：${(_7 = e === null || e === void 0 ? void 0 : e.message) !== null && _7 !== void 0 ? _7 : e}`);
        }
    }
    /** 批量参数归一：去重、正整数、单批上限 50 */
    normalizeBatchIds(ids) {
        const arr = (Array.isArray(ids) ? ids : [])
            .map(n => Number(n))
            .filter(n => Number.isFinite(n) && n > 0);
        const uniq = Array.from(new Set(arr));
        if (!uniq.length)
            throw new core_2.UserInputError('请选择要处理的售后单');
        if (uniq.length > 50)
            throw new core_2.UserInputError('单次最多处理 50 条');
        return uniq;
    }
    /** 批量执行：插件批量方法不做渠道校验，必须先按本渠道过滤，防跨店操作 */
    async afterSalesBatch(ctx, ids, mode, reason) {
        var _a, _b, _c, _d;
        const svc = this.getAfterSales();
        if (!svc)
            throw new core_2.UserInputError('售后插件未安装，暂不能处理售后申请');
        const ownedRows = await this.connection.rawConnection.query('SELECT a.id FROM after_sales_request a WHERE a.id = ANY($1::int[]) AND EXISTS ('
            + 'SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $2 WHERE o.id = a."orderId")', [ids, Number(ctx.channelId)]);
        const owned = new Set((Array.isArray(ownedRows) ? ownedRows : []).map(r => Number(r.id)));
        const results = ids
            .filter(id => !owned.has(id))
            .map(id => ({ id: String(id), success: false, state: '', message: '售后单不存在或不属于当前店铺' }));
        if (owned.size) {
            let targets = Array.from(owned);
            // §99：大额退款先登记复核，不直接批量退款
            if (mode === 'approve') {
                const gated = await this.refundReviewGate(ctx, targets);
                if (gated.size) {
                    for (const [rid, amount] of gated) {
                        try {
                            await this.createRefundReview(ctx, rid, amount);
                            results.push({
                                id: String(rid),
                                success: true,
                                state: 'Pending',
                                message: '已提交大额退款复核，等待其他管理员确认',
                            });
                        }
                        catch (e) {
                            results.push({ id: String(rid), success: false, state: '', message: String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e) });
                        }
                    }
                    targets = targets.filter(id => !gated.has(id));
                }
            }
            if (targets.length) {
                try {
                    const pluginResults = mode === 'approve'
                        ? await svc.batchApprove(ctx, targets)
                        : await svc.batchReject(ctx, targets, reason);
                    for (const r of pluginResults) {
                        results.push({
                            id: String(r.id),
                            success: Boolean(r.success),
                            state: String((_b = r.state) !== null && _b !== void 0 ? _b : ''),
                            message: String((_c = r.message) !== null && _c !== void 0 ? _c : ''),
                        });
                    }
                }
                catch (e) {
                    throw new core_2.UserInputError(`批量处理失败：${(_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : e}`);
                }
            }
        }
        const order = new Map(ids.map((id, i) => [String(id), i]));
        return results.sort((a, b) => { var _a, _b; return ((_a = order.get(a.id)) !== null && _a !== void 0 ? _a : 0) - ((_b = order.get(b.id)) !== null && _b !== void 0 ? _b : 0); });
    }
    /** 校园日（UTC+8）起止：起含、止不含（to 的次日 00:00） */
    campusDayStart(v) {
        const s = String(v !== null && v !== void 0 ? v : '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
            return null;
        const d = new Date(`${s}T00:00:00+08:00`);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    campusDayEnd(v) {
        const s = String(v !== null && v !== void 0 ? v : '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
            return null;
        const d = new Date(`${s}T00:00:00+08:00`);
        if (Number.isNaN(d.getTime()))
            return null;
        return new Date(d.getTime() + 86400000);
    }
    /** 商家协商留言（§82）：仅待处理/顾客申诉单可回复，已退款、已驳回、已关闭一律只读 */
    async afterSalesReply(ctx, id, content, images) {
        var _a;
        const request = await this.assertChannelAfterSales(ctx, id, []);
        if (!AFTER_SALES_PENDING_STATES.includes(request.state)) {
            throw new core_2.UserInputError('该售后已结束，不能再回复');
        }
        const svc = this.getAfterSales();
        if (!svc)
            throw new core_2.UserInputError('售后插件未安装，暂不能留言');
        try {
            const msg = await svc.addMessage(ctx, id, 'admin', String(content !== null && content !== void 0 ? content : ''), images !== null && images !== void 0 ? images : null);
            // §97 顾客端进度推送：商家回复留言单独触达，dedupe 用留言 id（同一单多次回复各推一条）
            this.notify.user(ctx, request.orderId, 'afterSales', '商家已回复您的售后留言', undefined, `msg${msg.id}`);
            return {
                id: String(msg.id),
                senderType: String(msg.senderType),
                senderName: String(msg.senderName),
                content: String(msg.content),
                images: Array.isArray(msg.images) ? msg.images : [],
                createdAt: msg.createdAt,
            };
        }
        catch (e) {
            throw new core_2.UserInputError(`留言失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
    }
    /** 售后处理统计（§81）：入口红点 + 超时 + 今日处理量/退款额（今日按校园日 UTC+8 切分） */
    async afterSalesStats(ctx) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        const timeoutHours = this.afterSalesTimeoutHours(ctx);
        const now = Date.now();
        const dayStart = new Date((0, campus_time_1.startOfCampusDay)(now));
        const dayEnd = new Date((0, campus_time_1.startOfCampusDay)(now) + 24 * 3600000);
        const raw = this.connection.rawConnection;
        const chId = Number(ctx.channelId);
        // 渠道隔离：售后单回落到订单，再用订单-渠道关联表判定归属
        const scope = 'EXISTS (SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId" AND o."customFieldsHallstatus" IS NOT NULL)';
        // §95：SLA 截止 = 申请时间 + 时限 + 已累计暂停时长；暂停中的单不计超时/临期
        // §99：优先用营业时段感知的 slaDeadlineAt
        const deadlineExpr = 'COALESCE(a."slaDeadlineAt", a."createdAt" + make_interval(hours => $2) '
            + '+ (COALESCE(a."slaPausedMs", 0) / 1000) * interval \'1 second\')';
        const pendingRows = await raw.query(`SELECT COUNT(*) FILTER (WHERE a.state IN ('Pending', 'Appealed')) AS "pending",
                    COUNT(*) FILTER (
                        WHERE a.state = 'Pending' AND a."slaPausedAt" IS NULL AND ${deadlineExpr} <= now()
                    ) AS "overdue"
               FROM after_sales_request a WHERE ${scope}`, [chId, timeoutHours]);
        // 临期（§88）：未超时但剩余时间不足阈值；阈值 0=关闭
        const dueSoonHours = (await this.afterSalesRules(ctx)).dueSoonHours;
        let dueSoon = 0;
        if (dueSoonHours > 0) {
            const dueSoonRows = await raw.query(`SELECT COUNT(*) AS "n" FROM after_sales_request a
                  WHERE ${scope} AND a.state = 'Pending' AND a."slaPausedAt" IS NULL
                    AND ${deadlineExpr} > now()
                    AND ${deadlineExpr} - now() <= make_interval(hours => $3)`, [chId, timeoutHours, dueSoonHours]);
            dueSoon = Number((_b = (_a = dueSoonRows === null || dueSoonRows === void 0 ? void 0 : dueSoonRows[0]) === null || _a === void 0 ? void 0 : _a.n) !== null && _b !== void 0 ? _b : 0);
        }
        const handledRows = await raw.query(`SELECT COUNT(DISTINCT h."requestId") AS "n"
               FROM after_sales_state_history h
               JOIN after_sales_request a ON a.id = h."requestId"
              WHERE h."createdAt" >= $2 AND h."createdAt" < $3
                AND h."toState" IN ('Approved', 'Rejected', 'Refunded')
                AND ${scope}`, [chId, dayStart, dayEnd]);
        const refundRows = await raw.query(`SELECT COUNT(*) AS "n",
                    COALESCE(SUM(COALESCE(a."actualRefundAmount", a."refundAmount")), 0) AS "amount"
               FROM after_sales_request a
              WHERE a.state = 'Refunded' AND a."refundedAt" >= $2 AND a."refundedAt" < $3
                AND ${scope}`, [chId, dayStart, dayEnd]);
        // 待回复：每单最后一条留言来自顾客（与列表 unread 同口径）
        let pendingReply = 0;
        try {
            const replyRows = await raw.query(`SELECT COUNT(*) AS "n" FROM after_sales_request a
                  WHERE ${scope}
                    AND (SELECT m."senderType" FROM after_sales_message m
                          WHERE m."requestId" = a.id ORDER BY m."createdAt" DESC LIMIT 1) = 'customer'`, [chId]);
            pendingReply = Number((_d = (_c = replyRows === null || replyRows === void 0 ? void 0 : replyRows[0]) === null || _c === void 0 ? void 0 : _c.n) !== null && _d !== void 0 ? _d : 0);
        }
        catch (_q) {
            // 留言表缺失时视为无待回复
        }
        return {
            pending: Number((_f = (_e = pendingRows === null || pendingRows === void 0 ? void 0 : pendingRows[0]) === null || _e === void 0 ? void 0 : _e.pending) !== null && _f !== void 0 ? _f : 0),
            overdue: Number((_h = (_g = pendingRows === null || pendingRows === void 0 ? void 0 : pendingRows[0]) === null || _g === void 0 ? void 0 : _g.overdue) !== null && _h !== void 0 ? _h : 0),
            timeoutHours,
            todayHandled: Number((_k = (_j = handledRows === null || handledRows === void 0 ? void 0 : handledRows[0]) === null || _j === void 0 ? void 0 : _j.n) !== null && _k !== void 0 ? _k : 0),
            todayRefunded: Number((_m = (_l = refundRows === null || refundRows === void 0 ? void 0 : refundRows[0]) === null || _l === void 0 ? void 0 : _l.n) !== null && _m !== void 0 ? _m : 0),
            todayRefundAmount: Number((_p = (_o = refundRows === null || refundRows === void 0 ? void 0 : refundRows[0]) === null || _o === void 0 ? void 0 : _o.amount) !== null && _p !== void 0 ? _p : 0),
            pendingReply,
            dueSoon,
            dueSoonHours,
        };
    }
    /** 售后工作台摘要（§88）：一次返回各待办入口计数与最老待处理时长 */
    async afterSalesWorkbench(ctx) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const stats = await this.afterSalesStats(ctx);
        const raw = this.connection.rawConnection;
        const chId = Number(ctx.channelId);
        const scope = 'EXISTS (SELECT 1 FROM "order" o JOIN order_channels_channel oc ON oc."orderId" = o.id '
            + 'AND oc."channelId" = $1 WHERE o.id = a."orderId" AND o."customFieldsHallstatus" IS NOT NULL)';
        const rows = await raw.query(`SELECT COUNT(*) FILTER (WHERE a.state IN ('Pending', 'Appealed'))::int AS "toApprove",
                    COUNT(*) FILTER (WHERE a.state = 'Returning')::int AS "toReceive",
                    COUNT(*) FILTER (WHERE a.state = 'RefundFailed')::int AS "refundFailed",
                    COUNT(*) FILTER (
                        WHERE a.state IN ('Pending', 'Appealed') AND a."slaPausedAt" IS NOT NULL
                    )::int AS "slaPaused",
                    MIN(a."createdAt") FILTER (WHERE a.state IN ('Pending', 'Appealed')) AS "oldest"
               FROM after_sales_request a WHERE ${scope}`, [chId]);
        const r = (_b = (_a = (Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows)) === null || _a === void 0 ? void 0 : _a[0]) !== null && _b !== void 0 ? _b : {};
        const oldest = r.oldest == null ? null : new Date(r.oldest);
        // 回访到期未跟进（§95）：nextAt 已到且该单之后没有更新的回访记录
        let followUpDue = 0;
        try {
            const fuRows = await raw.query(`SELECT COUNT(*)::int AS "n" FROM after_sales_request a
                  WHERE ${scope}
                    AND EXISTS (SELECT 1 FROM campus_after_sales_followup fu
                                WHERE fu."channelId" = $1 AND fu."requestId" = a.id
                                  AND fu."nextAt" IS NOT NULL AND fu."nextAt" <= now()
                                  AND NOT EXISTS (SELECT 1 FROM campus_after_sales_followup fu2
                                                  WHERE fu2."requestId" = fu."requestId"
                                                    AND fu2."createdAt" > fu."createdAt"))`, [chId]);
            const list = Array.isArray(fuRows) && Array.isArray(fuRows[0]) ? fuRows[0] : fuRows;
            followUpDue = Number((_d = (_c = list === null || list === void 0 ? void 0 : list[0]) === null || _c === void 0 ? void 0 : _c.n) !== null && _d !== void 0 ? _d : 0);
        }
        catch (_l) {
            followUpDue = 0;
        }
        // 已升级平台仲裁且未关闭（§96）
        let escalated = 0;
        try {
            const escRows = await raw.query(`SELECT COUNT(*)::int AS "n" FROM campus_after_sales_escalation e
                  WHERE e."channelId" = $1 AND e.status = 'Open'`, [chId]);
            const list = Array.isArray(escRows) && Array.isArray(escRows[0]) ? escRows[0] : escRows;
            escalated = Number((_f = (_e = list === null || list === void 0 ? void 0 : list[0]) === null || _e === void 0 ? void 0 : _e.n) !== null && _f !== void 0 ? _f : 0);
        }
        catch (_m) {
            escalated = 0;
        }
        return {
            toApprove: Number((_g = r.toApprove) !== null && _g !== void 0 ? _g : 0),
            toReceive: Number((_h = r.toReceive) !== null && _h !== void 0 ? _h : 0),
            refundFailed: Number((_j = r.refundFailed) !== null && _j !== void 0 ? _j : 0),
            pendingReply: stats.pendingReply,
            overdue: stats.overdue,
            dueSoon: stats.dueSoon,
            slaPaused: Number((_k = r.slaPaused) !== null && _k !== void 0 ? _k : 0),
            followUpDue,
            escalated,
            oldestPendingAt: oldest,
            oldestPendingHours: oldest == null
                ? 0
                : Math.max(0, Math.floor((Date.now() - oldest.getTime()) / 3600000)),
        };
    }
    /** 申请时间区间：纯日期按校园日（UTC+8）切分，to 含当天；非法格式直接拒绝 */
    afterSalesRange(opts) {
        var _a, _b;
        const DAY_MS = 24 * 3600000;
        const parse = (input, endOfDay) => {
            const text = input.trim();
            if (!text)
                return null;
            if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
                const dayStart = (0, campus_time_1.startOfCampusDay)(new Date(text).getTime());
                if (Number.isNaN(dayStart))
                    throw new core_2.UserInputError('申请时间格式不合法（YYYY-MM-DD）');
                return endOfDay ? dayStart + DAY_MS : dayStart;
            }
            const t = new Date(text).getTime();
            if (Number.isNaN(t))
                throw new core_2.UserInputError('申请时间格式不合法');
            return t;
        };
        const fromT = parse(String((_a = opts.from) !== null && _a !== void 0 ? _a : ''), false);
        const toT = parse(String((_b = opts.to) !== null && _b !== void 0 ? _b : ''), true);
        if (fromT != null && toT != null && fromT >= toT)
            throw new core_2.UserInputError('结束时间必须晚于开始时间');
        return { from: fromT == null ? null : new Date(fromT), to: toT == null ? null : new Date(toT) };
    }
    /** 售后操作审计留痕（§100）：统一记录处理人/动作/详情，失败不阻断业务操作 */
    async auditAfterSales(ctx, requestId, action, detail) {
        var _a;
        try {
            const uid = ctx.activeUserId ? Number(ctx.activeUserId) : null;
            const name = uid ? await this.adminDisplayName(uid) : null;
            await this.connection.rawConnection.query('INSERT INTO campus_after_sales_audit_log ("channelId", "requestId", action, "actorUserId", "actorName", detail) '
                + 'VALUES ($1, $2, $3, $4, $5, $6)', [
                Number(ctx.channelId),
                requestId,
                String(action !== null && action !== void 0 ? action : '').slice(0, 32),
                uid,
                name ? name.slice(0, 100) : null,
                detail ? String(detail).slice(0, 500) : null,
            ]);
        }
        catch (e) {
            core_2.Logger.warn(`audit after-sales failed: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, 'CampusMerchantAfterSales');
        }
    }
    /** 售后操作审计检索（§100）：按时间/动作/处理人筛选，带订单号 */
    async afterSalesAuditLogs(ctx, opts = {}) {
        const rows = await this.queryAuditRows(ctx, opts, 200);
        return rows.map(r => this.toAuditRow(r));
    }
    /** 售后操作审计导出（§100）：CSV，最多 5000 条 */
    async afterSalesAuditExport(ctx, opts = {}) {
        const rows = await this.queryAuditRows(ctx, opts, 5000);
        const header = ['售后单号', '订单号', '操作', '处理人', '处理人ID', '详情', '操作时间'];
        const lines = rows.map(r => [
            r.requestId, r.orderCode, r.action, r.actorName, r.actorUserId, r.detail,
            this.campusDateTime(r.createdAt),
        ]);
        return this.toCsv(header, lines);
    }
    /** 审计查询（§100）：统一拼条件，导出与列表共用 */
    async queryAuditRows(ctx, opts, maxTake) {
        var _a, _b, _c, _d, _e;
        const chId = Number(ctx.channelId);
        const params = [chId];
        const conds = ['l."channelId" = $1'];
        const from = String((_a = opts.from) !== null && _a !== void 0 ? _a : '').trim();
        const to = String((_b = opts.to) !== null && _b !== void 0 ? _b : '').trim();
        if (from) {
            const start = this.campusDayStart(from);
            if (!start)
                throw new core_2.UserInputError('开始日期格式无效，应为 YYYY-MM-DD');
            params.push(start);
            conds.push(`l."createdAt" >= $${params.length}`);
        }
        if (to) {
            const end = this.campusDayEnd(to);
            if (!end)
                throw new core_2.UserInputError('结束日期格式无效，应为 YYYY-MM-DD');
            params.push(end);
            conds.push(`l."createdAt" < $${params.length}`);
        }
        const action = String((_c = opts.action) !== null && _c !== void 0 ? _c : '').trim();
        if (action) {
            params.push(action);
            conds.push(`l.action = $${params.length}`);
        }
        const actor = String((_d = opts.actorUserId) !== null && _d !== void 0 ? _d : '').trim();
        if (actor) {
            if (!Number.isFinite(Number(actor)))
                throw new core_2.UserInputError('处理人参数无效');
            params.push(Number(actor));
            conds.push(`l."actorUserId" = $${params.length}::int`);
        }
        const take = Math.min(maxTake, Math.max(1, Math.floor(Number(opts.take) || maxTake)));
        const skip = Math.max(0, Math.floor(Number(opts.skip) || 0));
        try {
            const rows = await this.connection.rawConnection.query(`SELECT l.id, l."requestId", l.action, l."actorUserId", l."actorName", l.detail, l."createdAt",
                        o.code AS "orderCode"
                   FROM campus_after_sales_audit_log l
                   LEFT JOIN after_sales_request a ON a.id = l."requestId"
                   LEFT JOIN "order" o ON o.id = a."orderId"
                  WHERE ${conds.join(' AND ')}
                  ORDER BY l."createdAt" DESC LIMIT ${take} OFFSET ${skip}`, params);
            return Array.isArray(rows) ? rows : [];
        }
        catch (e) {
            if (e instanceof core_2.UserInputError)
                throw e;
            throw new core_2.UserInputError(`审计日志查询失败：${(_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e}`);
        }
    }
    toAuditRow(r) {
        var _a;
        return {
            id: String(r.id),
            requestId: String(r.requestId),
            orderCode: r.orderCode == null ? null : String(r.orderCode),
            action: String((_a = r.action) !== null && _a !== void 0 ? _a : ''),
            actorUserId: r.actorUserId == null ? null : String(r.actorUserId),
            actorName: r.actorName == null ? null : String(r.actorName),
            detail: r.detail == null ? null : String(r.detail),
            createdAt: new Date(r.createdAt),
        };
    }
    /** 值班表（§100）：本店全部排班，带值班人姓名 */
    async afterSalesDutyRoster(ctx) {
        const rows = await this.connection.rawConnection.query(`SELECT d.weekday, d."startMin", d."endMin", d."userId",
                    TRIM(COALESCE(ad."firstName", '') || COALESCE(ad."lastName", '')) AS "userName"
               FROM campus_after_sales_duty d
               LEFT JOIN administrator ad ON ad."userId" = d."userId"
              WHERE d."channelId" = $1
              ORDER BY d.weekday, d."startMin", d."userId"`, [Number(ctx.channelId)]);
        const list = Array.isArray(rows) ? rows : [];
        return list.map(r => ({
            weekday: Number(r.weekday),
            startMin: Number(r.startMin),
            endMin: Number(r.endMin),
            userId: String(r.userId),
            userName: r.userName ? String(r.userName) : null,
        }));
    }
    /** 整体替换值班表（§100）：校验值班人均属本店，事务内先删后插 */
    async setAfterSalesDutyRoster(ctx, entries) {
        var _a;
        const chId = Number(ctx.channelId);
        const list = (0, after_sales_duty_1.normalizeDutyEntries)(entries);
        if (list.length > 50)
            throw new core_2.UserInputError('值班表最多 50 条');
        const uids = Array.from(new Set(list.map(e => e.userId)));
        if (uids.length) {
            const owned = await this.connection.rawConnection.query('SELECT DISTINCT ad."userId" FROM administrator ad '
                + 'JOIN user_roles_role urr ON urr."userId" = ad."userId" '
                + 'JOIN role r ON r.id = urr."roleId" '
                + 'JOIN role_channels_channel rc ON rc."roleId" = r.id AND rc."channelId" = $1 '
                + 'WHERE ad."userId" = ANY($2::int[]) AND ad."deletedAt" IS NULL', [chId, uids]);
            const ownedList = Array.isArray(owned) ? owned : [];
            const found = new Set(ownedList.map(r => Number(r.userId)));
            for (const uid of uids) {
                if (!found.has(uid))
                    throw new core_2.UserInputError(`值班人不存在或不属于当前店铺：${uid}`);
            }
        }
        const runner = this.connection.rawConnection.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        try {
            await runner.query('DELETE FROM campus_after_sales_duty WHERE "channelId" = $1', [chId]);
            for (const e of list) {
                await runner.query('INSERT INTO campus_after_sales_duty ("channelId", weekday, "startMin", "endMin", "userId") '
                    + 'VALUES ($1, $2, $3, $4, $5)', [chId, e.weekday, e.startMin, e.endMin, e.userId]);
            }
            await runner.commitTransaction();
        }
        catch (e) {
            await runner.rollbackTransaction().catch(() => undefined);
            throw new core_2.UserInputError(`保存值班表失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
        finally {
            await runner.release();
        }
        return this.afterSalesDutyRoster(ctx);
    }
    /** 补偿挽留方案列表（§100） */
    async afterSalesCompensationPlans(ctx) {
        const rows = await this.connection.rawConnection.query('SELECT id, name, "refundAmount", "couponTemplateId", note, enabled, "createdAt" '
            + 'FROM campus_after_sales_compensation_plan WHERE "channelId" = $1 ORDER BY "createdAt" DESC', [Number(ctx.channelId)]);
        const list = Array.isArray(rows) ? rows : [];
        return list.map(r => this.toCompensationPlan(r));
    }
    /** 保存补偿方案（§100）：id 为空新建，否则更新；退款金额单位分 */
    async saveAfterSalesCompensationPlan(ctx, input) {
        var _a, _b, _c, _d;
        const chId = Number(ctx.channelId);
        const name = String((_a = input === null || input === void 0 ? void 0 : input.name) !== null && _a !== void 0 ? _a : '').trim();
        if (!name)
            throw new core_2.UserInputError('请填写方案名称');
        if (name.length > 100)
            throw new core_2.UserInputError('方案名称最多 100 字');
        const amount = Math.floor(Number((_b = input === null || input === void 0 ? void 0 : input.refundAmount) !== null && _b !== void 0 ? _b : 0));
        if (!Number.isFinite(amount) || amount < 0)
            throw new core_2.UserInputError('退款金额不能为负');
        const tpl = String((_c = input === null || input === void 0 ? void 0 : input.couponTemplateId) !== null && _c !== void 0 ? _c : '').trim();
        if (tpl.length > 255)
            throw new core_2.UserInputError('优惠券模板 id 过长');
        const note = String((_d = input === null || input === void 0 ? void 0 : input.note) !== null && _d !== void 0 ? _d : '').trim();
        if (note.length > 200)
            throw new core_2.UserInputError('方案备注最多 200 字');
        const enabled = (input === null || input === void 0 ? void 0 : input.enabled) === undefined || (input === null || input === void 0 ? void 0 : input.enabled) === null ? true : Boolean(input.enabled);
        const raw = this.connection.rawConnection;
        const id = (input === null || input === void 0 ? void 0 : input.id) == null || String(input.id) === '' ? null : Number(input.id);
        if (id == null) {
            await raw.query('INSERT INTO campus_after_sales_compensation_plan '
                + '("channelId", name, "refundAmount", "couponTemplateId", note, enabled) '
                + 'VALUES ($1, $2, $3, $4, $5, $6)', [chId, name, amount, tpl || null, note || null, enabled]);
        }
        else {
            if (!Number.isFinite(id) || id <= 0)
                throw new core_2.UserInputError('方案 id 无效');
            const updRows = await raw.query('UPDATE campus_after_sales_compensation_plan SET name = $1, "refundAmount" = $2, '
                + '"couponTemplateId" = $3, note = $4, enabled = $5, "updatedAt" = now() '
                + 'WHERE id = $6 AND "channelId" = $7 RETURNING id', [name, amount, tpl || null, note || null, enabled, id, chId]);
            const updList = Array.isArray(updRows) && Array.isArray(updRows[0]) ? updRows[0] : updRows;
            if (!Array.isArray(updList) || !updList.length)
                throw new core_2.UserInputError('方案不存在或不属于当前店铺');
        }
        return this.afterSalesCompensationPlans(ctx);
    }
    /** 删除补偿方案（§100） */
    async deleteAfterSalesCompensationPlan(ctx, id) {
        await this.connection.rawConnection.query('DELETE FROM campus_after_sales_compensation_plan WHERE id = $1 AND "channelId" = $2', [Number(id), Number(ctx.channelId)]);
        return this.afterSalesCompensationPlans(ctx);
    }
    toCompensationPlan(r) {
        var _a;
        return {
            id: String(r.id),
            name: String((_a = r.name) !== null && _a !== void 0 ? _a : ''),
            refundAmount: Number(r.refundAmount) || 0,
            couponTemplateId: r.couponTemplateId == null ? null : String(r.couponTemplateId),
            note: r.note == null ? null : String(r.note),
            enabled: Boolean(r.enabled),
            createdAt: new Date(r.createdAt),
        };
    }
    /**
     * 一键发放补偿挽留（§100）：部分退款（可 0）+ 优惠券补偿，随后关闭售后单并通知顾客。
     * 退款失败直接抛错（不吞金额），发券失败降级为仅退款并回写原因。
     */
    async afterSalesApplyCompensation(ctx, id, planId) {
        var _a, _b, _c, _d;
        const request = await this.assertChannelAfterSales(ctx, id, AFTER_SALES_PENDING_STATES);
        const rows = await this.connection.rawConnection.query('SELECT id, name, "refundAmount", "couponTemplateId", enabled '
            + 'FROM campus_after_sales_compensation_plan WHERE id = $1 AND "channelId" = $2', [Number(planId), Number(ctx.channelId)]);
        const list = Array.isArray(rows) ? rows : [];
        const plan = list[0];
        if (!plan)
            throw new core_2.UserInputError('补偿方案不存在或不属于当前店铺');
        if (!plan.enabled)
            throw new core_2.UserInputError('该补偿方案已停用');
        const planName = String((_a = plan.name) !== null && _a !== void 0 ? _a : '');
        const amount = Math.max(0, Math.floor(Number(plan.refundAmount) || 0));
        const tpl = plan.couponTemplateId == null ? '' : String(plan.couponTemplateId).trim();
        const nid = Number(id);
        if (amount > 0) {
            await this.merchantRefund(ctx, request.orderId, amount, `补偿挽留：${planName}`);
        }
        let couponGranted = false;
        let message = '';
        if (tpl && request.customerId != null) {
            const coupon = this.getCouponService();
            if (!coupon) {
                message = '优惠券服务不可用，已仅执行退款';
            }
            else {
                try {
                    await coupon.grantCoupon(ctx, tpl, [Number(request.customerId)]);
                    couponGranted = true;
                }
                catch (e) {
                    message = `发券失败：${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`;
                    core_2.Logger.warn(`grant compensation coupon failed: ${message}`, 'CampusMerchantAfterSales');
                }
            }
        }
        const svc = this.getAfterSales();
        if (!svc)
            throw new core_2.UserInputError('售后插件未安装，暂不能关闭售后单');
        try {
            await svc.adminCancelRequest(ctx, id, `补偿挽留：${planName}`);
        }
        catch (e) {
            throw new core_2.UserInputError(`补偿已发放，但关闭售后单失败：${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`);
        }
        try {
            this.notify.user(ctx, request.orderId, 'afterSales', amount > 0
                ? `商家已补偿 ¥${(amount / 100).toFixed(2)}${couponGranted ? '，并发放优惠券' : ''}，售后单已关闭`
                : `${couponGranted ? '商家已发放补偿优惠券' : '商家已关闭售后单'}`);
        }
        catch (e) {
            core_2.Logger.warn(`compensation notify failed: ${String((_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : e)}`, 'CampusMerchantAfterSales');
        }
        await this.auditAfterSales(ctx, nid, 'compensate', `方案：${planName}，退款 ¥${(amount / 100).toFixed(2)}${couponGranted ? '，已发券' : ''}${message ? `（${message}）` : ''}`);
        return { ok: true, refundAmount: amount, couponGranted, message };
    }
    /** 渠道售后处理时限（小时）：afterSalesTimeoutHours，未配置按售后插件默认 48 */
    afterSalesTimeoutHours(ctx) {
        var _a, _b, _c;
        const cf = ((_b = (_a = ctx.channel) === null || _a === void 0 ? void 0 : _a.customFields) !== null && _b !== void 0 ? _b : {});
        const n = Number((_c = cf.afterSalesTimeoutHours) !== null && _c !== void 0 ? _c : 48);
        return Number.isFinite(n) && n >= 0 ? n : 48;
    }
    /**
     * 按当前营业时间/处理时限重算本渠道未完结售后单的 SLA 截止时间（§99）。
     * 规则或门店营业时间变更后立即生效，无需等定时任务下一轮。
     */
    async recomputeSlaDeadlines(ctx) {
        const chId = Number(ctx.channelId);
        const businessHours = await this.channelBusinessHours(ctx);
        const closureDates = await this.channelClosureDateKeys(ctx);
        const timeoutHours = this.afterSalesTimeoutHours(ctx);
        const raw = this.connection.rawConnection;
        const rows = await raw.query(`SELECT a.id, a."createdAt", COALESCE(a."slaPausedMs", 0) AS paused
               FROM after_sales_request a
              WHERE a.state IN ('Pending', 'Appealed')
                AND EXISTS (SELECT 1 FROM "order" o
                            JOIN order_channels_channel oc ON oc."orderId" = o.id
                            WHERE o.id = a."orderId" AND oc."channelId" = $1)`, [chId]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        for (const r of Array.isArray(list) ? list : []) {
            const deadline = (0, after_sales_sla_1.businessDeadline)(new Date(r.createdAt), timeoutHours, businessHours, Number(r.paused), closureDates);
            await raw.query('UPDATE after_sales_request SET "slaDeadlineAt" = to_timestamp($2 / 1000.0) WHERE id = $1', [Number(r.id), deadline]);
        }
    }
    /** 单条售后单的 SLA 截止时间即时重算（§99）：SLA 恢复/暂停后调用 */
    async refreshSlaDeadline(ctx, requestId) {
        const rows = await this.connection.rawConnection.query('SELECT "createdAt", COALESCE("slaPausedMs", 0) AS paused FROM after_sales_request WHERE id = $1', [requestId]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const r = Array.isArray(list) ? list[0] : null;
        if (!r)
            return;
        const deadline = (0, after_sales_sla_1.businessDeadline)(new Date(r.createdAt), this.afterSalesTimeoutHours(ctx), await this.channelBusinessHours(ctx), Number(r.paused), await this.channelClosureDateKeys(ctx));
        await this.connection.rawConnection.query('UPDATE after_sales_request SET "slaDeadlineAt" = to_timestamp($2 / 1000.0) WHERE id = $1', [requestId, deadline]);
    }
    /** 驳回售后（§81）：理由必填（顾客在 C 端可见），仅 Pending 可驳回 */
    async afterSalesReject(ctx, id, reason) {
        var _a;
        const text = String(reason !== null && reason !== void 0 ? reason : '').trim();
        if (!text)
            throw new core_2.UserInputError('请填写驳回理由（顾客可见）');
        if (text.length > 200)
            throw new core_2.UserInputError('驳回理由最多 200 字');
        await this.assertChannelAfterSales(ctx, id, ['Pending']);
        const svc = this.getAfterSales();
        if (!svc)
            throw new core_2.UserInputError('售后插件未安装，暂不能处理售后申请');
        try {
            await svc.rejectRequest(ctx, id, text);
        }
        catch (e) {
            throw new core_2.UserInputError(`驳回售后失败：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        }
        await this.auditAfterSales(ctx, Number(id), 'reject', `驳回理由：${text}`);
        return this.afterSalesOne(ctx, id);
    }
    /** 分流规则行映射（§98）：DB 原始行 → 接口结构 */
    toAutoRule(r) {
        var _a, _b, _c;
        return {
            id: String(r.id),
            name: String((_a = r.name) !== null && _a !== void 0 ? _a : ''),
            priority: Number(r.priority) || 0,
            enabled: Boolean(r.enabled),
            matchType: String((_b = r.matchType) !== null && _b !== void 0 ? _b : '*'),
            matchReason: r.matchReason == null ? null : String(r.matchReason),
            minAmount: r.minAmount == null ? null : Number(r.minAmount),
            maxAmount: r.maxAmount == null ? null : Number(r.maxAmount),
            action: String((_c = r.action) !== null && _c !== void 0 ? _c : ''),
            rejectReason: r.rejectReason == null ? null : String(r.rejectReason),
            createdAt: new Date(r.createdAt),
        };
    }
    /** 售后单必须属于当前店铺，且状态在允许集合内（空集合=不校验状态） */
    async assertChannelAfterSales(ctx, id, expects) {
        var _a, _b, _c, _d;
        const request = await this.connection.getRepository(ctx, after_sales_plugin_1.AfterSalesRequest).findOne({
            where: { id: id },
            relations: { order: { channels: true }, channels: true, customer: true },
        });
        const inChannel = ((_a = request === null || request === void 0 ? void 0 : request.channels) === null || _a === void 0 ? void 0 : _a.some(c => String(c.id) === String(ctx.channelId)))
            || ((_d = (_c = (_b = request === null || request === void 0 ? void 0 : request.order) === null || _b === void 0 ? void 0 : _b.channels) === null || _c === void 0 ? void 0 : _c.some) === null || _d === void 0 ? void 0 : _d.call(_c, (c) => String(c.id) === String(ctx.channelId)));
        if (!request || !inChannel)
            throw new core_2.UserInputError('售后单不存在或不属于当前店铺');
        if (expects.length && !expects.includes(request.state)) {
            throw new core_2.UserInputError('该售后申请已处理，不能重复操作');
        }
        return request;
    }
    async afterSalesOne(ctx, id) {
        const row = await this.connection.getRepository(ctx, after_sales_plugin_1.AfterSalesRequest).findOne({
            where: { id: id },
            relations: { order: true, customer: true },
        });
        if (!row)
            throw new core_2.UserInputError('售后单不存在');
        const counts = await this.afterSalesMessageCounts(ctx, [Number(row.id)]);
        const lastSender = await this.afterSalesLastSender([Number(row.id)]);
        const tagMap = await this.afterSalesTagNames(ctx, [Number(row.id)]);
        const assigneeMap = await this.afterSalesAssigneeMap(ctx, [Number(row.id)]);
        const riskMap = await this.afterSalesRiskReasons(ctx, [Number(row.id)]);
        const slaPauseMap = await this.afterSalesSlaPauses([Number(row.id)]);
        const escalatedMap = await this.afterSalesEscalatedMap(ctx, [Number(row.id)]);
        const reviewPending = await this.refundReviewPendingSet(ctx, [Number(row.id)]);
        const businessHours = await this.channelBusinessHours(ctx);
        const rules = await this.afterSalesRules(ctx);
        return this.toAfterSalesRow(row, counts, this.afterSalesTimeoutHours(ctx), Date.now(), lastSender, {
            tags: tagMap,
            dueSoonHours: rules.dueSoonHours,
            assignees: assigneeMap,
            risks: riskMap,
            slaPauses: slaPauseMap,
            escalated: escalatedMap,
            refundReviewPending: reviewPending,
            businessHours,
        });
    }
    /** 协商留言列表（正序，最多 100 条）：插件表缺失时降级为空，不影响详情可用 */
    async afterSalesMessageRows(requestId) {
        try {
            const rows = await this.connection.rawConnection.query('SELECT id, "senderType", "senderName", content, images, "createdAt" FROM after_sales_message '
                + 'WHERE "requestId" = $1 ORDER BY "createdAt" ASC LIMIT 100', [requestId]);
            return (Array.isArray(rows) ? rows : []).map(r => {
                var _a, _b, _c;
                // images 为 simple-json 列（多数驱动返回字符串），兼容对象直出
                let images = [];
                if (Array.isArray(r.images)) {
                    images = r.images;
                }
                else if (typeof r.images === 'string') {
                    try {
                        const parsed = JSON.parse(r.images);
                        if (Array.isArray(parsed))
                            images = parsed;
                    }
                    catch (_d) {
                        images = [];
                    }
                }
                return {
                    id: String(r.id),
                    senderType: String((_a = r.senderType) !== null && _a !== void 0 ? _a : ''),
                    senderName: String((_b = r.senderName) !== null && _b !== void 0 ? _b : ''),
                    content: String((_c = r.content) !== null && _c !== void 0 ? _c : ''),
                    images,
                    createdAt: new Date(r.createdAt),
                };
            });
        }
        catch (_a) {
            return [];
        }
    }
    /** 状态流转时间线（正序，最多 50 条）：历史表缺失时降级为空；§88 补充处理人 */
    async afterSalesHistoryRows(requestId) {
        try {
            const rows = await this.connection.rawConnection.query('SELECT h."fromState", h."toState", h."createdAt", h."operatorUserId", '
                + 'ad."firstName", ad."lastName" '
                + 'FROM after_sales_state_history h '
                + 'LEFT JOIN administrator ad ON ad."userId" = h."operatorUserId" '
                + 'WHERE h."requestId" = $1 ORDER BY h."createdAt" ASC LIMIT 50', [requestId]);
            return (Array.isArray(rows) ? rows : []).map(r => {
                var _a;
                return ({
                    fromState: r.fromState == null ? null : String(r.fromState),
                    toState: String((_a = r.toState) !== null && _a !== void 0 ? _a : ''),
                    createdAt: new Date(r.createdAt),
                    operatorUserId: r.operatorUserId == null ? null : String(r.operatorUserId),
                    operatorName: r.operatorUserId == null
                        ? null
                        : ([r.firstName, r.lastName].filter(Boolean).join('') || null),
                });
            });
        }
        catch (_a) {
            return [];
        }
    }
    /** 每单最新留言发送方（批量）：用于 unread 标记（最新为 customer 即待商家回复） */
    async afterSalesLastSender(ids) {
        var _a;
        const out = new Map();
        const list = ids.filter(n => Number.isFinite(n) && n > 0);
        if (!list.length)
            return out;
        try {
            const rows = await this.connection.rawConnection.query('SELECT DISTINCT ON ("requestId") "requestId", "senderType" FROM after_sales_message '
                + 'WHERE "requestId" = ANY($1::int[]) ORDER BY "requestId", "createdAt" DESC', [list]);
            for (const r of Array.isArray(rows) ? rows : []) {
                out.set(Number(r.requestId), String((_a = r.senderType) !== null && _a !== void 0 ? _a : ''));
            }
        }
        catch (_b) {
            return out;
        }
        return out;
    }
    /** 订单商品行（售后详情）：商品名优先取变体中文翻译，缺失回落商品翻译 */
    async afterSalesOrderItems(orderId) {
        if (!Number.isFinite(orderId) || orderId <= 0)
            return [];
        try {
            const rows = await this.connection.rawConnection.query('SELECT COALESCE(pvt.name, pt.name, \'商品\') AS name, '
                + 'ol."quantity"::int AS quantity, ol."unitPriceWithTax"::int AS "unitPrice" '
                + 'FROM order_line ol '
                + 'JOIN product_variant pv ON pv.id = ol."productVariantId" '
                + 'LEFT JOIN product_variant_translation pvt ON pvt."baseId" = pv.id AND pvt."languageCode" = \'zh_Hans\' '
                + 'LEFT JOIN product p ON p.id = pv."productId" '
                + 'LEFT JOIN product_translation pt ON pt."baseId" = p.id AND pt."languageCode" = \'zh_Hans\' '
                + 'WHERE ol."orderId" = $1 ORDER BY ol.id ASC', [orderId]);
            return (Array.isArray(rows) ? rows : []).map(r => {
                var _a;
                return ({
                    name: String((_a = r.name) !== null && _a !== void 0 ? _a : '商品'),
                    quantity: Number(r.quantity) || 0,
                    unitPrice: Number(r.unitPrice) || 0,
                });
            });
        }
        catch (_a) {
            return [];
        }
    }
    /** 协商留言条数（批量）：插件表缺失时降级为 0，不影响清单可用 */
    async afterSalesMessageCounts(ctx, ids) {
        const out = new Map();
        const list = ids.filter(n => Number.isFinite(n) && n > 0);
        if (!list.length)
            return out;
        try {
            const rows = await this.connection.rawConnection.query('SELECT "requestId", COUNT(*)::int AS n FROM after_sales_message '
                + 'WHERE "requestId" = ANY($1::int[]) GROUP BY "requestId"', [list]);
            for (const r of Array.isArray(rows) ? rows : [])
                out.set(Number(r.requestId), Number(r.n) || 0);
        }
        catch (_a) {
            return out;
        }
        return out;
    }
    toAfterSalesRow(row, counts, timeoutHours, now, lastSender, opts = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1;
        const customer = row.customer;
        const order = row.order;
        const dueSoonHours = Number((_a = opts.dueSoonHours) !== null && _a !== void 0 ? _a : 0);
        const sla = (_b = opts.slaPauses) === null || _b === void 0 ? void 0 : _b.get(Number(row.id));
        const slaPaused = Boolean(sla === null || sla === void 0 ? void 0 : sla.paused);
        // §95：暂停累计时长顺延截止时间；暂停中不再判超时/临期
        // §99：只统计门店营业时段，非营业时间不计入处理时长
        const deadline = (0, after_sales_sla_1.businessDeadline)(row.createdAt, timeoutHours, opts.businessHours, (_c = sla === null || sla === void 0 ? void 0 : sla.pausedMs) !== null && _c !== void 0 ? _c : 0);
        const assignee = (_d = opts.assignees) === null || _d === void 0 ? void 0 : _d.get(Number(row.id));
        return {
            id: String(row.id),
            orderId: String((_e = row.orderId) !== null && _e !== void 0 ? _e : ''),
            orderCode: (_f = order === null || order === void 0 ? void 0 : order.code) !== null && _f !== void 0 ? _f : '',
            state: String((_g = row.state) !== null && _g !== void 0 ? _g : ''),
            type: String((_h = row.type) !== null && _h !== void 0 ? _h : ''),
            reason: String((_j = row.reason) !== null && _j !== void 0 ? _j : ''),
            description: (_k = row.description) !== null && _k !== void 0 ? _k : null,
            refundAmount: Number((_l = row.refundAmount) !== null && _l !== void 0 ? _l : 0),
            rejectReason: (_m = row.rejectReason) !== null && _m !== void 0 ? _m : null,
            evidenceImages: Array.isArray(row.evidenceImages) ? row.evidenceImages : [],
            messageCount: (_o = counts.get(Number(row.id))) !== null && _o !== void 0 ? _o : 0,
            customerName: customer
                ? [customer.firstName, customer.lastName].filter(Boolean).join('') || null
                : null,
            createdAt: row.createdAt,
            refundedAt: (_p = row.refundedAt) !== null && _p !== void 0 ? _p : null,
            // 超时口径与售后插件 PENDING_REMIND 一致：仅 Pending 按申请时间计时；暂停中不判超时
            overdue: row.state === 'Pending' && !slaPaused && deadline <= now,
            // 未读=最后一条留言由顾客发出（商家回完即消失），无需额外已读表
            unread: lastSender.get(Number(row.id)) === 'customer',
            exchangeTrackingNo: (_q = row.exchangeTrackingNo) !== null && _q !== void 0 ? _q : null,
            exchangeCarrier: (_r = row.exchangeCarrier) !== null && _r !== void 0 ? _r : null,
            // 临期：仍在处理时限内，剩余不足阈值（已超时由 overdue 单独标识）
            dueSoon: row.state === 'Pending' && !slaPaused && dueSoonHours > 0
                && deadline > now && deadline - now <= dueSoonHours * 3600000,
            tags: (_t = (_s = opts.tags) === null || _s === void 0 ? void 0 : _s.get(Number(row.id))) !== null && _t !== void 0 ? _t : [],
            assigneeUserId: (_u = assignee === null || assignee === void 0 ? void 0 : assignee.userId) !== null && _u !== void 0 ? _u : null,
            assigneeName: (_v = assignee === null || assignee === void 0 ? void 0 : assignee.name) !== null && _v !== void 0 ? _v : null,
            riskReason: (_x = (_w = opts.risks) === null || _w === void 0 ? void 0 : _w.get(Number(row.id))) !== null && _x !== void 0 ? _x : null,
            slaPaused,
            slaPausedReason: slaPaused ? ((_y = sla === null || sla === void 0 ? void 0 : sla.reason) !== null && _y !== void 0 ? _y : null) : null,
            escalated: Boolean((_z = opts.escalated) === null || _z === void 0 ? void 0 : _z.get(Number(row.id))),
            refundReviewPending: Boolean((_0 = opts.refundReviewPending) === null || _0 === void 0 ? void 0 : _0.has(Number(row.id))),
            // §110：退款失败原因随列表回传，便于不点卡片就判断要不要重试
            refundError: (_1 = row.refundError) !== null && _1 !== void 0 ? _1 : null,
        };
    }
    /** 一键沽清：商品列表（本渠道），带售罄标记与规格数（搜索按名称模糊） */
    async products(ctx, search, skip, take) {
        var _a, _b;
        const q = String(search !== null && search !== void 0 ? search : '').trim();
        const safeSkip = Math.max(0, Number(skip !== null && skip !== void 0 ? skip : 0) || 0);
        const safeTake = Math.min(Math.max(Number(take !== null && take !== void 0 ? take : 50) || 50, 1), 200);
        const rows = await this.connection.rawConnection.query('SELECT p.id AS "productId", COALESCE(pt.name, \'商品 #\' || p.id) AS name, '
            + 'COALESCE(p."customFieldsWaimaisoldout", false) AS "soldOut", '
            + 'COALESCE(p."customFieldsWaimaimonthlysales", 0) AS "monthlySales", '
            + 'p."customFieldsWaimaipackingfee" AS "packingFee", '
            + 'p."customFieldsWaimaiaddongroups" AS "addonGroups", '
            + 'p."customFieldsWaimaicombo" AS "combo", '
            + 'p."customFieldsWaimaidailylimit" AS "dailyLimit", '
            + 'p."customFieldsWaimaiperuserlimit" AS "perUserLimit", '
            + '(SELECT COUNT(*)::int FROM product_variant pv WHERE pv."productId" = p.id AND pv."deletedAt" IS NULL) AS "variantCount" '
            + 'FROM product p '
            + 'JOIN product_channels_channel pc ON pc."productId" = p.id AND pc."channelId" = $1 '
            + 'LEFT JOIN LATERAL (SELECT name FROM product_translation pt WHERE pt."baseId" = p.id '
            + 'ORDER BY (pt."languageCode" = \'zh_Hans\') DESC LIMIT 1) pt ON true '
            + 'WHERE ($2 = \'\' OR pt.name ILIKE \'%\' || $2 || \'%\') '
            + 'ORDER BY p.id DESC LIMIT $3 OFFSET $4', [ctx.channelId, q, safeTake, safeSkip]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const countRows = await this.connection.rawConnection.query('SELECT COUNT(*)::int AS n FROM product p '
            + 'JOIN product_channels_channel pc ON pc."productId" = p.id AND pc."channelId" = $1 '
            + 'LEFT JOIN LATERAL (SELECT name FROM product_translation pt WHERE pt."baseId" = p.id '
            + 'ORDER BY (pt."languageCode" = \'zh_Hans\') DESC LIMIT 1) pt ON true '
            + 'WHERE ($2 = \'\' OR pt.name ILIKE \'%\' || $2 || \'%\')', [ctx.channelId, q]);
        const countList = Array.isArray(countRows) && Array.isArray(countRows[0]) ? countRows[0] : countRows;
        // 当日已售（§68）：仅商品列表这一页涉及的商品，限量商品才展示剩余
        const ids = (list !== null && list !== void 0 ? list : []).map((r) => Number(r.productId)).filter((n) => Number.isFinite(n));
        const soldMap = await (0, daily_limit_1.queryDailySold)(this.connection.rawConnection, Number(ctx.channelId), ids);
        return {
            items: (list !== null && list !== void 0 ? list : []).map((r) => {
                var _a, _b, _c, _d;
                return ({
                    productId: r.productId,
                    name: r.name,
                    soldOut: Boolean(r.soldOut),
                    monthlySales: Number((_a = r.monthlySales) !== null && _a !== void 0 ? _a : 0),
                    variantCount: Number((_b = r.variantCount) !== null && _b !== void 0 ? _b : 0),
                    packingFee: r.packingFee == null ? null : Number(r.packingFee),
                    // 加料组/套餐以 JSON 字符串回传，后台编辑 sheet 直接反序列化回填
                    addonGroups: r.addonGroups == null ? null : String(r.addonGroups),
                    combo: r.combo == null ? null : String(r.combo),
                    dailyLimit: (0, daily_limit_1.normalizeLimit)(r.dailyLimit),
                    perUserLimit: (0, daily_limit_1.normalizeLimit)(r.perUserLimit),
                    soldToday: (_c = soldMap.get(Number(r.productId))) !== null && _c !== void 0 ? _c : 0,
                    remaining: (0, daily_limit_1.remainingOf)((0, daily_limit_1.normalizeLimit)(r.dailyLimit), (_d = soldMap.get(Number(r.productId))) !== null && _d !== void 0 ? _d : 0),
                });
            }),
            total: Number((_b = (_a = countList === null || countList === void 0 ? void 0 : countList[0]) === null || _a === void 0 ? void 0 : _a.n) !== null && _b !== void 0 ? _b : 0),
        };
    }
    /** 沽清开关：售罄仍展示、不可加购；下单前置闸门二次校验 */
    async setProductSoldOut(ctx, productId, soldOut) {
        const inChannel = await this.connection.getRepository(ctx, core_2.Product).createQueryBuilder('product')
            .leftJoin('product.channels', 'channel')
            .where('product.id = :id', { id: productId })
            .andWhere('channel.id = :ch', { ch: ctx.channelId })
            .getOne();
        if (!inChannel)
            throw new core_2.UserInputError('商品不存在或不属于当前店铺');
        await this.connection.getRepository(ctx, core_2.Product).update(productId, {
            customFields: { waimaiSoldOut: Boolean(soldOut) },
        });
        // 手动开关即代表「非全店沽清批次」：清掉批次登记，次日自动恢复不再动它
        await this.clearSoldOutBatch(ctx, { productId: productId });
        return { ok: true, soldOut: Boolean(soldOut) };
    }
    /** 全店批量沽清 / 批量恢复：仅本渠道未删除商品，返回实际影响条数（打烊后一键恢复用） */
    async setAllProductsSoldOut(ctx, soldOut) {
        const flag = Boolean(soldOut);
        // 标识更新与批次登记必须同一事务：否则批次写入失败会留下「已沽清但次日不会被自动恢复」的商品
        const ids = await this.connection.rawConnection.transaction(async (manager) => {
            const rows = await manager.query('UPDATE product p SET "customFieldsWaimaisoldout" = $2 '
                + 'FROM product_channels_channel pc '
                + 'WHERE pc."productId" = p.id AND pc."channelId" = $1 '
                + 'AND p."deletedAt" IS NULL '
                + 'RETURNING p.id', [ctx.channelId, flag]);
            const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
            const changed = (Array.isArray(list) ? list : []).map((r) => Number(r.id));
            if (flag) {
                // 登记批次：仅供次日 04:00 自动恢复命中这些商品
                if (changed.length) {
                    await manager.query('INSERT INTO campus_soldout_batch ("channelId", "productId") '
                        + 'SELECT $1, unnest($2::int[]) '
                        + 'ON CONFLICT ("channelId", "productId") DO NOTHING', [ctx.channelId, changed]);
                }
            }
            else {
                await manager.query('DELETE FROM campus_soldout_batch WHERE "channelId" = $1', [ctx.channelId]);
            }
            return changed;
        });
        return { ok: true, soldOut: flag, count: ids.length };
    }
    /** 清除全店沽清批次登记（传 productId 只清该商品） */
    async clearSoldOutBatch(ctx, opts) {
        if (opts.productId != null) {
            await this.connection.rawConnection.query('DELETE FROM campus_soldout_batch WHERE "channelId" = $1 AND "productId" = $2', [ctx.channelId, opts.productId]);
            return;
        }
        await this.connection.rawConnection.query('DELETE FROM campus_soldout_batch WHERE "channelId" = $1', [ctx.channelId]);
    }
    /** 沽清自动恢复开关 + 待恢复件数（后台开关与文案用）；开关列由 §66 迁移补，不在 customFields 声明（避免 schema sync 并发加列失败） */
    async getSoldOutAutoRestore(ctx) {
        var _a;
        const rows = await this.connection.rawConnection.query('SELECT "customFieldsWaimaisoldoutautorestore" AS enabled FROM channel WHERE id = $1', [ctx.channelId]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        const enabled = Array.isArray(list) && list.length ? ((_a = list[0]) === null || _a === void 0 ? void 0 : _a.enabled) !== false : true;
        const pending = await this.countSoldOutBatch(ctx.channelId);
        return { enabled, pending };
    }
    async setSoldOutAutoRestore(ctx, enabled) {
        await this.connection.rawConnection.query('UPDATE channel SET "customFieldsWaimaisoldoutautorestore" = $2 WHERE id = $1', [ctx.channelId, Boolean(enabled)]);
        const pending = await this.countSoldOutBatch(ctx.channelId);
        return { enabled: Boolean(enabled), pending };
    }
    async countSoldOutBatch(channelId) {
        var _a, _b;
        const rows = await this.connection.rawConnection.query('SELECT COUNT(*)::int AS n FROM campus_soldout_batch WHERE "channelId" = $1', [channelId]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        return Number(Array.isArray(list) ? (_b = (_a = list[0]) === null || _a === void 0 ? void 0 : _a.n) !== null && _b !== void 0 ? _b : 0 : 0) || 0;
    }
    /** 商品级打包费（分/件）：null 清除回落店铺配置；仅本渠道商品可改 */
    async setProductPackingFee(ctx, productId, packingFee) {
        const inChannel = await this.connection.getRepository(ctx, core_2.Product).createQueryBuilder('product')
            .leftJoin('product.channels', 'channel')
            .where('product.id = :id', { id: productId })
            .andWhere('channel.id = :ch', { ch: ctx.channelId })
            .getOne();
        if (!inChannel)
            throw new core_2.UserInputError('商品不存在或不属于当前店铺');
        let value = null;
        if (packingFee != null) {
            const n = Number(packingFee);
            if (!Number.isFinite(n) || n < 0)
                throw new core_2.UserInputError('打包费必须为不小于 0 的数字（分/件）');
            if (n > 100000)
                throw new core_2.UserInputError('打包费单件超出允许上限（100000 分 = 1000 元）');
            value = Math.round(n);
        }
        await this.connection.getRepository(ctx, core_2.Product).update(productId, {
            customFields: { waimaiPackingFee: value },
        });
        return { ok: true, packingFee: value };
    }
    /** 每日限量 / 每人限购（§68）：null 或 0 = 不限；每人限购不得大于每日限量 */
    async setProductLimit(ctx, productId, dailyLimit, perUserLimit) {
        var _a;
        await this.assertProductInChannel(ctx, productId);
        const daily = (0, daily_limit_1.normalizeLimit)(dailyLimit);
        const perUser = (0, daily_limit_1.normalizeLimit)(perUserLimit);
        for (const v of [dailyLimit, perUserLimit]) {
            if (v != null && Number(v) > daily_limit_1.DAILY_LIMIT_MAX) {
                throw new core_2.UserInputError(`限量最多 ${daily_limit_1.DAILY_LIMIT_MAX} 份`);
            }
            if (v != null && Number(v) < 0) {
                throw new core_2.UserInputError('限量不能为负数');
            }
        }
        if (daily != null && perUser != null && perUser > daily) {
            throw new core_2.UserInputError('每人限购不能大于每日限量');
        }
        await this.connection.getRepository(ctx, core_2.Product).update(productId, {
            customFields: { waimaiDailyLimit: daily, waimaiPerUserLimit: perUser },
        });
        const soldMap = await (0, daily_limit_1.queryDailySold)(this.connection.rawConnection, Number(ctx.channelId), [Number(productId)]);
        const soldToday = (_a = soldMap.get(Number(productId))) !== null && _a !== void 0 ? _a : 0;
        return {
            ok: true,
            dailyLimit: daily,
            perUserLimit: perUser,
            soldToday,
            remaining: (0, daily_limit_1.remainingOf)(daily, soldToday),
        };
    }
    /** 商品加料组（P1-2）：空数组=清除；清洗后再序列化，脏数据不入库 */
    async setProductAddonGroups(ctx, productId, rawGroups) {
        var _a, _b, _c, _d;
        await this.assertProductInChannel(ctx, productId);
        const cleaned = (0, addon_fee_1.parseAddonGroups)(rawGroups);
        // 显式上限校验：解析器会静默截断，这里对「用户确实提交了超限内容」直接报错更友好
        const inputCount = Array.isArray(rawGroups) ? rawGroups.length : 0;
        if (inputCount > addon_fee_1.ADDON_MAX_GROUPS) {
            throw new core_2.UserInputError(`加料组最多 ${addon_fee_1.ADDON_MAX_GROUPS} 组`);
        }
        for (const g of Array.isArray(rawGroups) ? rawGroups : []) {
            const opts = Array.isArray(g === null || g === void 0 ? void 0 : g.options) ? g.options : [];
            if (opts.length > addon_fee_1.ADDON_MAX_OPTIONS_PER_GROUP) {
                throw new core_2.UserInputError(`「${(_a = g === null || g === void 0 ? void 0 : g.name) !== null && _a !== void 0 ? _a : '加料'}」最多 ${addon_fee_1.ADDON_MAX_OPTIONS_PER_GROUP} 个选项`);
            }
            for (const o of opts) {
                const n = Number((_b = o === null || o === void 0 ? void 0 : o.price) !== null && _b !== void 0 ? _b : 0);
                if (Number.isFinite(n) && n > addon_fee_1.ADDON_MAX_PRICE_FEN) {
                    throw new core_2.UserInputError('单个加料价格不能超过 1000 元');
                }
                if (Number.isFinite(n) && n < 0) {
                    throw new core_2.UserInputError('加料价格不能为负数');
                }
            }
            const min = Number((_c = g === null || g === void 0 ? void 0 : g.min) !== null && _c !== void 0 ? _c : 0);
            const max = Number((_d = g === null || g === void 0 ? void 0 : g.max) !== null && _d !== void 0 ? _d : 0);
            if (min > 0 && max > 0 && min > max) {
                throw new core_2.UserInputError('「最少选」不能大于「最多选」');
            }
        }
        const value = (0, addon_fee_1.serializeAddonGroups)(cleaned);
        await this.connection.getRepository(ctx, core_2.Product).update(productId, {
            customFields: { waimaiAddonGroups: value },
        });
        return { ok: true, addonGroups: value };
    }
    /** 商品套餐内容（P1-2）：传 null/空 items=清除（非套餐商品） */
    async setProductCombo(ctx, productId, rawCombo) {
        await this.assertProductInChannel(ctx, productId);
        const inputItems = Array.isArray(rawCombo === null || rawCombo === void 0 ? void 0 : rawCombo.items) ? rawCombo.items : [];
        if (inputItems.length > addon_fee_1.COMBO_MAX_ITEMS) {
            throw new core_2.UserInputError(`套餐内含商品最多 ${addon_fee_1.COMBO_MAX_ITEMS} 项`);
        }
        const value = (0, addon_fee_1.serializeCombo)((0, addon_fee_1.parseCombo)(rawCombo));
        await this.connection.getRepository(ctx, core_2.Product).update(productId, {
            customFields: { waimaiCombo: value },
        });
        return { ok: true, combo: value };
    }
    /** 商品必须属于当前店铺渠道（越权防护：商家只能改本店商品） */
    async assertProductInChannel(ctx, productId) {
        const inChannel = await this.connection.getRepository(ctx, core_2.Product).createQueryBuilder('product')
            .leftJoin('product.channels', 'channel')
            .where('product.id = :id', { id: productId })
            .andWhere('channel.id = :ch', { ch: ctx.channelId })
            .getOne();
        if (!inChannel)
            throw new core_2.UserInputError('商品不存在或不属于当前店铺');
    }
    async assertAnyChannelOrder(ctx, orderId) {
        var _a;
        const order = await this.connection.getRepository(ctx, core_2.Order).findOne({
            where: { id: orderId },
            relations: ['channels'],
        });
        const inChannel = (_a = order === null || order === void 0 ? void 0 : order.channels) === null || _a === void 0 ? void 0 : _a.some(c => String(c.id) === String(ctx.channelId));
        if (!order || !inChannel)
            throw new core_2.UserInputError('订单不存在或不属于当前店铺');
        return order;
    }
    async assertChannelOrder(ctx, orderId, expect) {
        return this.assertChannelOrderState(ctx, orderId, [expect]);
    }
    async assertChannelOrderState(ctx, orderId, expects) {
        var _a;
        const order = await this.connection.getRepository(ctx, core_2.Order).findOne({
            where: { id: orderId },
            relations: ['channels'],
        });
        const inChannel = (_a = order === null || order === void 0 ? void 0 : order.channels) === null || _a === void 0 ? void 0 : _a.some(c => String(c.id) === String(ctx.channelId));
        if (!order || !inChannel)
            throw new core_2.UserInputError('订单不存在或不属于当前店铺');
        const hs = order.customFields.hallStatus;
        if (!expects.includes(hs)) {
            throw new core_2.UserInputError('当前状态不允许该操作');
        }
        return order;
    }
    /** 组装商家视图 DTO：楼栋名批量查、骑手名批量查，不外泄 admin 内部字段 */
    async toDto(ctx, orders) {
        const buildingIds = new Set();
        const riderIds = new Set();
        for (const o of orders) {
            const cf = o.customFields;
            if (cf.buildingId)
                buildingIds.add(String(cf.buildingId));
            if (cf.deliveryStaffId)
                riderIds.add(Number(cf.deliveryStaffId));
        }
        const buildings = buildingIds.size
            ? await this.connection.getRepository(ctx, campus_building_entity_1.CampusBuilding).findByIds([...buildingIds])
            : [];
        const buildingNames = new Map(buildings.map(b => [String(b.id), b.name]));
        const customers = riderIds.size
            ? await this.connection.rawConnection.getRepository('Customer').findByIds([...riderIds])
            : [];
        const riderNames = new Map(customers.map(c => { var _a, _b; return [String(c.id), (_b = (_a = c.customFields) === null || _a === void 0 ? void 0 : _a.riderRealName) !== null && _b !== void 0 ? _b : '']; }));
        // 催单「已知晓」时间（§78）：一次批量查，避免逐单查库
        const ackMap = await this.urgeAckMap(ctx, orders.map(o => Number(o.id)));
        return orders.map(o => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
            const cf = o.customFields;
            const urgedAt = cf.urgedAt ? new Date(cf.urgedAt) : null;
            return {
                id: String(o.id),
                code: o.code,
                createdAt: o.createdAt,
                total: o.total,
                shipping: o.shipping,
                building: cf.buildingId ? (_a = buildingNames.get(String(cf.buildingId))) !== null && _a !== void 0 ? _a : '' : '',
                zone: (_b = cf.campusZone) !== null && _b !== void 0 ? _b : '',
                slotText: (_c = cf.deliverySlotText) !== null && _c !== void 0 ? _c : '',
                route: (_d = cf.fulfillmentRoute) !== null && _d !== void 0 ? _d : '',
                riderName: cf.deliveryStaffId ? (_e = riderNames.get(String(cf.deliveryStaffId))) !== null && _e !== void 0 ? _e : null : null,
                note: (_f = cf.note) !== null && _f !== void 0 ? _f : null,
                printedAt: (_g = cf.waimaiPrintedAt) !== null && _g !== void 0 ? _g : null,
                provider: cf.thirdPartyProvider || null,
                thirdPartyNo: cf.thirdPartyNo || null,
                handoverCode: cf.handoverCode || null,
                urged: isUrgePending(cf.urged, urgedAt, (_h = ackMap.get(String(o.id))) !== null && _h !== void 0 ? _h : null),
                urgedAt,
                // 脱敏口径与号码保护一致：11 位保留前 3 后 4，绝不外泄明文
                customerPhone: this.privacy.mask((_k = (_j = o.customer) === null || _j === void 0 ? void 0 : _j.phoneNumber) !== null && _k !== void 0 ? _k : null),
                lines: ((_l = o.lines) !== null && _l !== void 0 ? _l : []).map(l => {
                    var _a, _b;
                    return ({
                        name: (_b = (_a = l.productVariant) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '',
                        quantity: l.quantity,
                        price: l.unitPrice,
                    });
                }),
            };
        });
    }
};
exports.MerchantAdminService = MerchantAdminService;
exports.MerchantAdminService = MerchantAdminService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_2.TransactionalConnection,
        campus_config_service_1.CampusConfigService,
        hall_service_1.HallService,
        campus_notify_service_1.CampusNotifyService,
        third_party_delivery_service_1.ThirdPartyDeliveryService,
        core_2.OrderService,
        privacy_number_service_1.PrivacyNumberService,
        cloud_print_service_1.CloudPrintService,
        feishu_client_1.FeishuClient,
        core_1.ModuleRef,
        campus_dedupe_service_1.CampusDedupeService])
], MerchantAdminService);
/** 催单是否仍未处理（§78）：顾客置了 urged 且「已知晓」时间早于最近一次催单（顾客再催会重新变为待处理） */
function isUrgePending(urged, urgedAt, ackedAt) {
    if (urged !== true || !urgedAt)
        return false;
    return !ackedAt || ackedAt.getTime() < urgedAt.getTime();
}
//# sourceMappingURL=merchant-admin.service.js.map