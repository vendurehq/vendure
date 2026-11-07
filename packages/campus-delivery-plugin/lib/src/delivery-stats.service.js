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
exports.DeliveryStatsService = void 0;
exports.normalizeRange = normalizeRange;
exports.windowStartOf = windowStartOf;
exports.aggregateStats = aggregateStats;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const campus_fulfillment_config_entity_1 = require("./campus-fulfillment-config.entity");
const campus_time_1 = require("./campus-time");
const db_now_wall_1 = require("./db-now-wall");
const RANGE_MS = {
    '7d': 7 * 24 * 3600000,
    '30d': 30 * 24 * 3600000,
};
const DEFAULT_GRACE_MIN = 10;
const DEFAULT_CHANNEL_CODE = '__default_channel__';
function normalizeRange(v) {
    return v === 'today' || v === '30d' ? v : '7d';
}
/** 窗口起点：today=校园时区（UTC+8）0 点；7d/30d=滚动窗口 */
function windowStartOf(range, now) {
    if (range === 'today') {
        return (0, campus_time_1.startOfCampusDay)(now);
    }
    return now - RANGE_MS[range];
}
const round1 = (n) => Math.round(n * 10) / 10;
const minOf = (ms) => round1(ms / 60000);
const rateOf = (onTime, scored) => (scored > 0 ? round1((onTime / scored) * 100) : 0);
function dayKeyOf(d) {
    return (0, campus_time_1.campusDayKey)(d.getTime());
}
/** 纯函数聚合（单测注入时间/数据）。
 * 口径：单量=窗口内未取消订单；准点率=deliveredAt ≤ promisedAt + 各渠道 grace（有承诺且已送达才计分）；
 * 平均送达/在途段=assignedAt→deliveredAt；接单段=createdAt→assignedAt；
 * 赔付=窗口内 timeoutCompensatedAt 非空单，按 timeoutAttribution 归因分桶；
 * 店铺对比=按渠道分组（排除平台默认渠道）。 */
function aggregateStats(args) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const { orders: rawOrders, graceByChannel, windowStart, now, range } = args;
    // 口径内聚：取消单不计任何指标（双保险，service 层 SQL 已过滤）
    const orders = rawOrders.filter(o => o.state !== 'Cancelled');
    const buckets = new Map();
    const stores = new Map();
    let assignSum = 0, assignN = 0, transitSum = 0, transitN = 0;
    let compensated = 0, scoredTotal = 0, onTimeTotal = 0;
    const attribution = { merchant: 0, rider: 0, platform: 0 };
    const bucketOf = (t) => {
        let key;
        if (range === 'today') {
            key = `${(0, campus_time_1.campusHour)(t)}`.padStart(2, '0') + ':00';
        }
        else {
            key = dayKeyOf(new Date(t));
        }
        let b = buckets.get(key);
        if (!b) {
            b = { orders: 0, onTime: 0, scored: 0 };
            buckets.set(key, b);
        }
        return b;
    };
    for (const o of orders) {
        const cf = ((_a = o.customFields) !== null && _a !== void 0 ? _a : {});
        const ch = (_c = ((_b = o.channels) !== null && _b !== void 0 ? _b : []).find(c => c.code !== DEFAULT_CHANNEL_CODE)) !== null && _c !== void 0 ? _c : ((_d = o.channels) !== null && _d !== void 0 ? _d : [])[0];
        const chId = ch ? Number(ch.id) : 0;
        const grace = ((_e = graceByChannel.get(chId)) !== null && _e !== void 0 ? _e : DEFAULT_GRACE_MIN) * 60000;
        // order.createdAt 是 DB now() 写入的 UTC 墙钟，按桶归档/接单时长前先还原成绝对时刻
        const createdAt = (0, db_now_wall_1.dbNowWallToInstant)(o.createdAt).getTime();
        bucketOf(createdAt).orders++;
        const chName = ((_f = ch === null || ch === void 0 ? void 0 : ch.customFields) === null || _f === void 0 ? void 0 : _f.shopName) || (ch === null || ch === void 0 ? void 0 : ch.code) || `channel-${chId}`;
        let store = stores.get(chId);
        if (!store) {
            store = { name: chName, orders: 0, onTime: 0, scored: 0 };
            stores.set(chId, store);
        }
        store.orders++;
        // 准点计分（仅既有承诺又有送达的单）
        if (cf.promisedAt && cf.deliveredAt) {
            const onTime = new Date(cf.deliveredAt).getTime() - new Date(cf.promisedAt).getTime() <= grace;
            scoredTotal++;
            onTimeTotal += onTime ? 1 : 0;
            const b = bucketOf(createdAt);
            b.scored++;
            b.onTime += onTime ? 1 : 0;
            store.scored++;
            store.onTime += onTime ? 1 : 0;
        }
        // 环节耗时
        if (cf.assignedAt && cf.deliveredAt) {
            transitSum += new Date(cf.deliveredAt).getTime() - new Date(cf.assignedAt).getTime();
            transitN++;
        }
        // 接单段排除预约单：预约单 assignedAt 在放量后写入，createdAt→assignedAt 跨数小时属正常，不代表接单效率
        if (cf.assignedAt && !cf.scheduledFor) {
            assignSum += new Date(cf.assignedAt).getTime() - createdAt;
            assignN++;
        }
        // 超时赔付归因
        if (cf.timeoutCompensatedAt) {
            compensated++;
            const a = cf.timeoutAttribution;
            if (a === 'merchant' || a === 'rider' || a === 'platform')
                attribution[a]++;
        }
    }
    // 趋势点：today 按小时（0 点→当前小时），滚动窗口按自然日
    const dailyTrend = [];
    if (range === 'today') {
        const endHour = (0, campus_time_1.campusHour)(now);
        for (let h = 0; h <= endHour; h++) {
            const key = `${h}`.padStart(2, '0') + ':00';
            const b = buckets.get(key);
            dailyTrend.push({ date: key, orders: (_g = b === null || b === void 0 ? void 0 : b.orders) !== null && _g !== void 0 ? _g : 0, onTimeRate: rateOf((_h = b === null || b === void 0 ? void 0 : b.onTime) !== null && _h !== void 0 ? _h : 0, (_j = b === null || b === void 0 ? void 0 : b.scored) !== null && _j !== void 0 ? _j : 0) });
        }
    }
    else {
        const dayCount = range === '7d' ? 7 : 30;
        const today0 = (0, campus_time_1.startOfCampusDay)(now);
        // UTC+8 无夏令时，逐日回退 24h 安全
        for (let i = dayCount - 1; i >= 0; i--) {
            const key = (0, campus_time_1.campusDayKey)(today0 - i * 24 * 3600000);
            const b = buckets.get(key);
            const label = key.slice(5); // MM-DD
            dailyTrend.push({ date: label, orders: (_k = b === null || b === void 0 ? void 0 : b.orders) !== null && _k !== void 0 ? _k : 0, onTimeRate: rateOf((_l = b === null || b === void 0 ? void 0 : b.onTime) !== null && _l !== void 0 ? _l : 0, (_m = b === null || b === void 0 ? void 0 : b.scored) !== null && _m !== void 0 ? _m : 0) });
        }
    }
    return {
        range,
        windowStart: new Date(windowStart),
        kpis: {
            totalOrders: orders.length,
            onTimeRate: rateOf(onTimeTotal, scoredTotal),
            avgDeliveryMinutes: transitN > 0 ? minOf(transitSum / transitN) : 0,
            timeoutCompensated: compensated,
        },
        dailyTrend,
        stages: [
            { key: 'assign', label: '接单', avgMinutes: assignN > 0 ? minOf(assignSum / assignN) : 0 },
            { key: 'transit', label: '在途', avgMinutes: transitN > 0 ? minOf(transitSum / transitN) : 0 },
        ],
        attribution,
        storeComparison: [...stores.entries()]
            .map(([channelId, s]) => ({
            channelId: String(channelId),
            channelName: s.name,
            orders: s.orders,
            onTimeRate: rateOf(s.onTime, s.scored),
        }))
            .sort((a, b) => b.orders - a.orders),
    };
}
let DeliveryStatsService = class DeliveryStatsService {
    constructor(connection) {
        this.connection = connection;
    }
    async stats(ctx, rangeInput) {
        const range = normalizeRange(rangeInput);
        const now = Date.now();
        const windowStart = windowStartOf(range, now);
        // 只计校园履约单（hallStatus 非空），避免把普通快递/自提订单计入配送 KPI
        // 租户隔离：店铺级看板非平台超管只看本渠道，否则 storeComparison 会暴露其他店铺单量
        const qb = this.connection
            .getRepository(ctx, core_1.Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.channels', 'channel')
            .where('order.createdAt >= :ws', { ws: new Date(windowStart) })
            .andWhere('order.state != :st', { st: 'Cancelled' })
            .andWhere('order.customFields.hallStatus IS NOT NULL');
        if (!ctx.userHasPermissions([core_1.Permission.SuperAdmin])) {
            qb.andWhere('channel.id = :ch', { ch: ctx.channelId });
        }
        const orders = (await qb.getMany());
        const configs = await this.connection.getRepository(ctx, campus_fulfillment_config_entity_1.CampusFulfillmentConfig).find();
        const graceByChannel = new Map(configs.map(c => [Number(c.channelId), c.timeoutGraceMinutes]));
        const payload = aggregateStats({ orders, graceByChannel, windowStart, now, range });
        core_1.Logger.info(`delivery stats range=${range} orders=${payload.kpis.totalOrders} onTime=${payload.kpis.onTimeRate}%`, 'CampusDeliveryStats');
        return payload;
    }
};
exports.DeliveryStatsService = DeliveryStatsService;
exports.DeliveryStatsService = DeliveryStatsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], DeliveryStatsService);
//# sourceMappingURL=delivery-stats.service.js.map