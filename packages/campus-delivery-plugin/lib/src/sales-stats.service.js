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
exports.SalesStatsService = void 0;
exports.normalizeSalesRange = normalizeSalesRange;
exports.salesWindowStart = salesWindowStart;
exports.customSalesWindow = customSalesWindow;
exports.salesPrevWindow = salesPrevWindow;
exports.medianOf = medianOf;
exports.aggregateSalesStats = aggregateSalesStats;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const campus_time_1 = require("./campus-time");
const DAY_MS = 24 * 3600000;
/** 自定义区间上限（天），防止一次导出/查询拉全量历史。 */
const MAX_CUSTOM_DAYS = 366;
/** 不计入销售的订单状态：草稿/未支付/已取消（只有已付款且未取消的单才算销售）。 */
const NON_SALES_STATES = ['Draft', 'AddingItems', 'ArrangingPayment', 'Cancelled'];
function normalizeSalesRange(v) {
    return v === 'today' || v === '30d' ? v : '7d';
}
/** 本窗口起点：today=校园时区今日 0 点；7d/30d=「近 N 个自然日」的 0 点（与日趋势补零区间对齐）。 */
function salesWindowStart(range, now) {
    if (range === 'today' || range === 'custom') {
        return (0, campus_time_1.startOfCampusDay)(now);
    }
    const days = range === '7d' ? 7 : 30;
    return (0, campus_time_1.startOfCampusDay)(now - (days - 1) * DAY_MS);
}
/** 自定义自然日区间：from 当天 0 点 ~ to 次日 0 点（含首尾两天）；上一窗口=紧邻等长区间。
 *  非法入参（缺参/格式错/结束早于开始/超上限）抛 UserInputError。 */
function customSalesWindow(fromInput, toInput) {
    const fromMs = new Date(fromInput).getTime();
    const toMs = new Date(toInput).getTime();
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
        throw new core_1.UserInputError('日期格式不合法（YYYY-MM-DD）');
    }
    const start = (0, campus_time_1.startOfCampusDay)(fromMs);
    const end = (0, campus_time_1.startOfCampusDay)(toMs) + DAY_MS;
    const days = Math.round((end - start) / DAY_MS);
    if (days <= 0) {
        throw new core_1.UserInputError('结束日期不能早于开始日期');
    }
    if (days > MAX_CUSTOM_DAYS) {
        throw new core_1.UserInputError(`自定义区间不能超过 ${MAX_CUSTOM_DAYS} 天`);
    }
    return { start, end, prevStart: start - (end - start), prevEnd: start };
}
/** 上一窗口：7d/30d=紧邻等长窗口；today=昨日同时长窗口（昨日 0 点 → 昨日同刻）。 */
function salesPrevWindow(range, windowStart, now) {
    if (range === 'today') {
        const prevStart = windowStart - DAY_MS;
        return { prevStart, prevEnd: prevStart + (now - windowStart) };
    }
    const span = range === 'custom' ? now - windowStart : range === '7d' ? 7 * DAY_MS : 30 * DAY_MS;
    return { prevStart: windowStart - span, prevEnd: windowStart };
}
const round1 = (n) => Math.round(n * 10) / 10;
/** 中位数（偶数取中间两数均值）；空集合返回 0。 */
function medianOf(values) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
/** 环比百分比：上期为 0 时返回 0（不做无穷大）。 */
function pctOf(cur, prev) {
    if (!prev)
        return 0;
    return round1(((cur - prev) / prev) * 100);
}
/** 商品名是翻译字段（ProductTranslation），优先中文，其次第一条翻译。 */
function productNameOf(product) {
    var _a, _b;
    if (product.name)
        return product.name;
    const translations = (_a = product.translations) !== null && _a !== void 0 ? _a : [];
    const hit = (_b = translations.find(t => t.languageCode === 'zh-Hans' || t.languageCode === 'zh')) !== null && _b !== void 0 ? _b : translations[0];
    return (hit === null || hit === void 0 ? void 0 : hit.name) || `#${product.id}`;
}
/** 规格所属分类（Collection），名称优先中文，其次第一条翻译。 */
function categoriesOf(collections) {
    return (collections !== null && collections !== void 0 ? collections : []).map(c => {
        var _a, _b;
        const translations = (_a = c.translations) !== null && _a !== void 0 ? _a : [];
        const hit = (_b = translations.find(t => t.languageCode === 'zh-Hans' || t.languageCode === 'zh')) !== null && _b !== void 0 ? _b : translations[0];
        return { id: String(c.id), name: (hit === null || hit === void 0 ? void 0 : hit.name) || `#${c.id}` };
    });
}
/** 有效销售单：已付款未取消 + 排除跑腿单（跑腿无商品，会污染菜品四象限与客单价）。 */
function isSalesOrder(o) {
    var _a;
    if (NON_SALES_STATES.includes(o.state))
        return false;
    if ((_a = o.customFields) === null || _a === void 0 ? void 0 : _a.errandKind)
        return false;
    return true;
}
function kpisOf(orders, firstOrderAt, windowStart) {
    var _a, _b;
    const gmvFen = orders.reduce((s, o) => { var _a; return s + ((_a = o.totalWithTax) !== null && _a !== void 0 ? _a : 0); }, 0);
    const custSet = new Set();
    const orderCount = new Map();
    for (const o of orders) {
        const cid = ((_a = o.customer) === null || _a === void 0 ? void 0 : _a.id) != null ? Number(o.customer.id) : NaN;
        if (!Number.isFinite(cid))
            continue;
        custSet.add(cid);
        orderCount.set(cid, ((_b = orderCount.get(cid)) !== null && _b !== void 0 ? _b : 0) + 1);
    }
    let newCustomers = 0;
    for (const cid of custSet) {
        const first = firstOrderAt.get(cid);
        if (first != null && first >= windowStart)
            newCustomers++;
    }
    let repeaters = 0;
    for (const n of orderCount.values())
        if (n >= 2)
            repeaters++;
    return {
        orders: orders.length,
        gmvFen,
        aovFen: orders.length ? Math.round(gmvFen / orders.length) : 0,
        customers: custSet.size,
        newCustomers,
        repurchaseRate: custSet.size ? round1((repeaters / custSet.size) * 100) : 0,
    };
}
/** 纯函数聚合（单测注入时间/数据）。
 * 口径：销售单=已付款未取消且非跑腿；GMV=订单 totalWithTax 汇总；
 * 四象限按「销量中位数 × 销售额中位数」分档（>= 中位为高）；新客=本窗口内首单。 */
function aggregateSalesStats(args) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const { orders: raw, firstOrderAt, windowStart, prevStart, prevEnd, now, range } = args;
    const windowEnd = (_a = args.windowEnd) !== null && _a !== void 0 ? _a : Number.MAX_SAFE_INTEGER;
    const curOrders = raw.filter(o => {
        const t = toMs(o.createdAt);
        return isSalesOrder(o) && t >= windowStart && t < windowEnd;
    });
    const prevOrders = raw.filter(o => {
        const t = toMs(o.createdAt);
        return isSalesOrder(o) && t >= prevStart && t < prevEnd;
    });
    const kpis = kpisOf(curOrders, firstOrderAt, windowStart);
    const prev = kpisOf(prevOrders, firstOrderAt, prevStart);
    // 时段热力：24 小时（今日只到当前小时，未来小时给 0）
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, gmvFen: 0 }));
    for (const o of curOrders) {
        const h = (0, campus_time_1.campusHour)(toMs(o.createdAt));
        hours[h].orders++;
        hours[h].gmvFen += (_b = o.totalWithTax) !== null && _b !== void 0 ? _b : 0;
    }
    // 日趋势：按自然日逐日补零；today 用时段热力即可，返回空数组
    const dailyTrend = [];
    if (range !== 'today') {
        const map = new Map();
        for (const o of curOrders) {
            const key = (0, campus_time_1.campusDayKey)(toMs(o.createdAt));
            const b = (_c = map.get(key)) !== null && _c !== void 0 ? _c : { orders: 0, gmvFen: 0 };
            b.orders++;
            b.gmvFen += (_d = o.totalWithTax) !== null && _d !== void 0 ? _d : 0;
            map.set(key, b);
        }
        const firstDay = (0, campus_time_1.startOfCampusDay)(windowStart);
        const lastDay = (0, campus_time_1.startOfCampusDay)(Math.min(windowEnd, now + 1) - 1);
        const dayCount = Math.min(MAX_CUSTOM_DAYS, Math.round((lastDay - firstDay) / DAY_MS) + 1);
        for (let i = 0; i < dayCount; i++) {
            const key = (0, campus_time_1.campusDayKey)(firstDay + i * DAY_MS);
            const b = map.get(key);
            dailyTrend.push({ date: key.slice(5), orders: (_e = b === null || b === void 0 ? void 0 : b.orders) !== null && _e !== void 0 ? _e : 0, gmvFen: (_f = b === null || b === void 0 ? void 0 : b.gmvFen) !== null && _f !== void 0 ? _f : 0 });
        }
    }
    // 菜品聚合（按商品，非规格）
    const byProduct = new Map();
    for (const o of curOrders) {
        for (const line of (_g = o.lines) !== null && _g !== void 0 ? _g : []) {
            const product = (_h = line.productVariant) === null || _h === void 0 ? void 0 : _h.product;
            if (!product)
                continue;
            const pid = String(product.id);
            const b = (_j = byProduct.get(pid)) !== null && _j !== void 0 ? _j : { name: productNameOf(product), quantity: 0, gmvFen: 0, categories: [] };
            for (const c of categoriesOf((_k = line.productVariant) === null || _k === void 0 ? void 0 : _k.collections)) {
                if (!b.categories.some(x => x.id === c.id))
                    b.categories.push(c);
            }
            b.quantity += (_l = line.quantity) !== null && _l !== void 0 ? _l : 0;
            b.gmvFen += (_m = line.linePriceWithTax) !== null && _m !== void 0 ? _m : 0;
            byProduct.set(pid, b);
        }
    }
    const productList = [...byProduct.entries()].map(([productId, b]) => (Object.assign({ productId }, b)));
    const medianQuantity = medianOf(productList.map(p => p.quantity));
    const medianGmvFen = medianOf(productList.map(p => p.gmvFen));
    const products = productList
        .map(p => (Object.assign(Object.assign({}, p), { quadrant: (p.quantity >= medianQuantity
            ? p.gmvFen >= medianGmvFen ? 'star' : 'traffic'
            : p.gmvFen >= medianGmvFen ? 'premium' : 'slow') })))
        .sort((a, b) => b.gmvFen - a.gmvFen || b.quantity - a.quantity)
        .slice(0, 50);
    // 复购分群：窗口内下单次数 1 / 2-4 / 5+
    const orderCount = new Map();
    for (const o of curOrders) {
        const cid = ((_o = o.customer) === null || _o === void 0 ? void 0 : _o.id) != null ? Number(o.customer.id) : NaN;
        if (!Number.isFinite(cid))
            continue;
        orderCount.set(cid, ((_p = orderCount.get(cid)) !== null && _p !== void 0 ? _p : 0) + 1);
    }
    const cohorts = { once: 0, twiceToFour: 0, loyal: 0 };
    for (const n of orderCount.values()) {
        if (n === 1)
            cohorts.once++;
        else if (n <= 4)
            cohorts.twiceToFour++;
        else
            cohorts.loyal++;
    }
    return {
        range,
        windowStart: new Date(windowStart),
        kpis,
        prev,
        compare: {
            ordersPct: pctOf(kpis.orders, prev.orders),
            gmvPct: pctOf(kpis.gmvFen, prev.gmvFen),
            aovPct: pctOf(kpis.aovFen, prev.aovFen),
            repurchaseRatePct: pctOf(kpis.repurchaseRate, prev.repurchaseRate),
        },
        hourlyHeat: hours,
        dailyTrend,
        products,
        cohorts,
        medianQuantity,
        medianGmvFen,
    };
}
let SalesStatsService = class SalesStatsService {
    constructor(connection) {
        this.connection = connection;
    }
    async stats(ctx, rangeInput, fromInput, toInput) {
        const now = Date.now();
        let range;
        let windowStart;
        let windowEnd = Number.MAX_SAFE_INTEGER;
        let prevStart;
        let prevEnd;
        let customEnd = null;
        if (fromInput || toInput) {
            if (!fromInput || !toInput) {
                throw new core_1.UserInputError('自定义区间需同时传 from 与 to');
            }
            const w = customSalesWindow(fromInput, toInput);
            range = 'custom';
            windowStart = w.start;
            windowEnd = w.end;
            customEnd = w.end;
            prevStart = w.prevStart;
            prevEnd = w.prevEnd;
        }
        else {
            range = normalizeSalesRange(rangeInput);
            windowStart = salesWindowStart(range, now);
            ({ prevStart, prevEnd } = salesPrevWindow(range, windowStart, now));
        }
        const queryFrom = Math.min(prevStart, windowStart);
        // 租户隔离：平台超管看全部；店铺级只看本渠道（与 campusDeliveryStats 一致）
        const qb = this.connection
            .getRepository(ctx, core_1.Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.channels', 'channel')
            .leftJoinAndSelect('order.customer', 'customer')
            .leftJoinAndSelect('order.lines', 'line')
            .leftJoinAndSelect('line.productVariant', 'variant')
            .leftJoinAndSelect('variant.product', 'product')
            .leftJoinAndSelect('product.translations', 'productTrans')
            .leftJoinAndSelect('variant.collections', 'collection')
            .leftJoinAndSelect('collection.translations', 'collectionTrans')
            .where('order.createdAt >= :from', { from: new Date(queryFrom) })
            .andWhere('order.state NOT IN (:...states)', { states: NON_SALES_STATES })
            .andWhere('(order.customFields.errandKind IS NULL)');
        if (customEnd != null) {
            qb.andWhere('order.createdAt < :to', { to: new Date(customEnd) });
        }
        if (!ctx.userHasPermissions([core_1.Permission.SuperAdmin])) {
            qb.andWhere('channel.id = :ch', { ch: ctx.channelId });
        }
        const orders = (await qb.getMany());
        // 新客判定需要客户历史首单时间：只对窗口内出现过的客户回查一次
        const curCustomerIds = [
            ...new Set(orders
                .filter(o => toMs(o.createdAt) >= windowStart)
                .map(o => { var _a; return (((_a = o.customer) === null || _a === void 0 ? void 0 : _a.id) != null ? Number(o.customer.id) : NaN); })
                .filter(Number.isFinite)),
        ];
        const firstOrderAt = await this.firstOrderAt(ctx, curCustomerIds);
        core_1.Logger.debug(`campusSalesStats ${range}: ${orders.length} orders, ${curCustomerIds.length} customers (channel ${ctx.channelId})`);
        return aggregateSalesStats({ orders, firstOrderAt, windowStart, prevStart, prevEnd, now, range, windowEnd });
    }
    /** 客户全历史首单时间（分 → 用于新客判定）。空集合直接返回。 */
    async firstOrderAt(ctx, customerIds) {
        const map = new Map();
        if (!customerIds.length)
            return map;
        const rows = await this.connection
            .getRepository(ctx, core_1.Order)
            .createQueryBuilder('order')
            .select('order.customerId', 'customerId')
            .addSelect('MIN(order.createdAt)', 'firstAt')
            .where('order.customerId IN (:...ids)', { ids: customerIds })
            .andWhere('order.state NOT IN (:...states)', { states: NON_SALES_STATES })
            .groupBy('order.customerId')
            .getRawMany();
        for (const r of rows) {
            map.set(Number(r.customerId), new Date(r.firstAt).getTime());
        }
        return map;
    }
};
exports.SalesStatsService = SalesStatsService;
exports.SalesStatsService = SalesStatsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], SalesStatsService);
/** 原始行的时间列可能是 pg 返回的 Date，也可能是 ::text 序列化后的字符串；统一取 epoch 毫秒。 */
function toMs(v) {
    return v instanceof Date ? v.getTime() : new Date(v).getTime();
}
//# sourceMappingURL=sales-stats.service.js.map