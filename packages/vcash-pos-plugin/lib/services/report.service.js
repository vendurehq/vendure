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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const core_1 = require("@vendure/core");
const typeorm_2 = require("typeorm");
const constants_1 = require("../constants");
const db_columns_1 = require("./db-columns");
/**
 * 报表查询服务（店长/老板维度，全店数据）。
 *
 * 四类报表：
 * 1. todayOverview - 今日概览（销售额、订单数、客单价、支付方式汇总、退款额）
 * 2. salesReport   - 日/区间报表（按天分组的销售额趋势）
 * 3. monthlyReport - 月度报表（月度汇总 + 上月环比）
 * 4. topProducts   - 商品销量 TOP（按数量或金额排序）
 *
 * 数据来源：Order + OrderLine + Payment（Vendure 原生表）
 * 金额单位：分（int），前端展示时除以 100
 * 多门店：ctx.channelId 自动过滤
 *
 * 性能说明：MVP 用 QueryBuilder + JS 端聚合，数据量大时可改为 raw SQL + DB 端 GROUP BY
 */
let ReportService = class ReportService {
    constructor(connection) {
        this.connection = connection;
    }
    /**
     * 今日概览。
     * @param ctx RequestContext（用于 channelId 过滤）
     * @returns 今日销售额、订单数、客单价、支付方式汇总、退款额
     */
    async todayOverview(ctx) {
        const channelId = this.parseChannelId(ctx.channelId);
        const { start, end } = this.getTodayRange();
        // 1. 查询今日所有销售订单（含 payments）
        const saleOrders = await this.queryOrdersByDateRange(channelId, start, end, constants_1.ORDER_TYPE.SALE);
        const refundOrders = await this.queryOrdersByDateRange(channelId, start, end, constants_1.ORDER_TYPE.REFUND);
        // 2. 金额汇总
        const totalAmount = saleOrders.reduce((s, o) => { var _a; return s + ((_a = o.total) !== null && _a !== void 0 ? _a : 0); }, 0);
        const orderCount = saleOrders.length;
        const avgOrderValue = orderCount > 0 ? Math.round(totalAmount / orderCount) : 0;
        const refundAmount = refundOrders.reduce((s, o) => { var _a; return s + Math.abs((_a = o.total) !== null && _a !== void 0 ? _a : 0); }, 0);
        // 3. 支付方式聚合
        const paymentsByMethod = this.aggregatePaymentsByMethod(saleOrders);
        return {
            date: this.formatDate(start),
            totalAmount,
            orderCount,
            avgOrderValue,
            refundAmount,
            refundCount: refundOrders.length,
            paymentsByMethod,
        };
    }
    /**
     * 日/区间报表（按天分组的销售额趋势）。
     * @param ctx RequestContext
     * @param startDate 起始日期（YYYY-MM-DD）
     * @param endDate 结束日期（YYYY-MM-DD，含当天）
     * @returns 按天分组的销售额、订单数、客单价
     */
    async salesReport(ctx, startDate, endDate) {
        var _a, _b, _c;
        const channelId = this.parseChannelId(ctx.channelId);
        const { start, end } = this.parseDateRange(startDate, endDate);
        const orders = await this.queryOrdersByDateRange(channelId, start, end, constants_1.ORDER_TYPE.SALE);
        // 按天分组
        const dailyMap = new Map();
        for (const order of orders) {
            const dateKey = this.formatDate(order.createdAt);
            const entry = (_a = dailyMap.get(dateKey)) !== null && _a !== void 0 ? _a : { totalAmount: 0, orderCount: 0 };
            entry.totalAmount += (_b = order.total) !== null && _b !== void 0 ? _b : 0;
            entry.orderCount += 1;
            dailyMap.set(dateKey, entry);
        }
        // 填充日期范围内的所有天（无数据的天补 0）
        // 注意：end 是次日 00:00（不含当天），所以用 cursor < end
        const daily = [];
        const cursor = new Date(start);
        while (cursor < end) {
            const dateKey = this.formatDate(cursor);
            const entry = (_c = dailyMap.get(dateKey)) !== null && _c !== void 0 ? _c : { totalAmount: 0, orderCount: 0 };
            daily.push({
                date: dateKey,
                totalAmount: entry.totalAmount,
                orderCount: entry.orderCount,
                avgOrderValue: entry.orderCount > 0 ? Math.round(entry.totalAmount / entry.orderCount) : 0,
            });
            cursor.setDate(cursor.getDate() + 1);
        }
        const totalAmount = daily.reduce((s, d) => s + d.totalAmount, 0);
        const totalOrders = daily.reduce((s, d) => s + d.orderCount, 0);
        return {
            startDate,
            endDate,
            totalAmount,
            totalOrders,
            avgOrderValue: totalOrders > 0 ? Math.round(totalAmount / totalOrders) : 0,
            daily,
        };
    }
    /**
     * 月度报表（月度汇总 + 上月环比）。
     * @param ctx RequestContext
     * @param year 年份（如 2026）
     * @param month 月份（1-12）
     * @returns 当月汇总 + 上月数据 + 环比变化率
     */
    async monthlyReport(ctx, year, month) {
        const channelId = this.parseChannelId(ctx.channelId);
        const { start: monthStart, end: monthEnd } = this.getMonthRange(year, month);
        const prevMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
        const { start: prevStart, end: prevEnd } = this.getMonthRange(prevMonth.year, prevMonth.month);
        const currentOrders = await this.queryOrdersByDateRange(channelId, monthStart, monthEnd, constants_1.ORDER_TYPE.SALE);
        const prevOrders = await this.queryOrdersByDateRange(channelId, prevStart, prevEnd, constants_1.ORDER_TYPE.SALE);
        const currentAmount = currentOrders.reduce((s, o) => { var _a; return s + ((_a = o.total) !== null && _a !== void 0 ? _a : 0); }, 0);
        const currentCount = currentOrders.length;
        const prevAmount = prevOrders.reduce((s, o) => { var _a; return s + ((_a = o.total) !== null && _a !== void 0 ? _a : 0); }, 0);
        const prevCount = prevOrders.length;
        // 环比变化率（百分比，保留 1 位小数）
        const amountChangeRate = prevAmount > 0 ? Math.round(((currentAmount - prevAmount) / prevAmount) * 1000) / 10 : 0;
        const countChangeRate = prevCount > 0 ? Math.round(((currentCount - prevCount) / prevCount) * 1000) / 10 : 0;
        return {
            year,
            month,
            totalAmount: currentAmount,
            orderCount: currentCount,
            avgOrderValue: currentCount > 0 ? Math.round(currentAmount / currentCount) : 0,
            prevMonth: {
                totalAmount: prevAmount,
                orderCount: prevCount,
            },
            amountChangeRate,
            countChangeRate,
        };
    }
    /**
     * 商品销量 TOP。
     * @param ctx RequestContext
     * @param startDate 起始日期
     * @param endDate 结束日期
     * @param limit 返回条数，默认 20
     * @param sortBy 排序方式：quantity（销量）或 amount（金额）
     * @returns 商品销量排行
     */
    async topProducts(ctx, startDate, endDate, limit = 20, sortBy = 'quantity') {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        const channelId = this.parseChannelId(ctx.channelId);
        const { start, end } = this.parseDateRange(startDate, endDate);
        // 查询区间内所有销售订单的 ID
        const orders = await this.queryOrdersByDateRange(channelId, start, end, constants_1.ORDER_TYPE.SALE);
        const orderIds = orders.map(o => o.id);
        if (orderIds.length === 0) {
            return { startDate, endDate, items: [] };
        }
        // 查询这些订单的 OrderLine（含 ProductVariant 和 Product 关系）
        const orderLines = await this.connection
            .getRepository(core_1.OrderLine)
            .createQueryBuilder('ol')
            .leftJoinAndSelect('ol.productVariant', 'pv')
            .leftJoinAndSelect('pv.product', 'p')
            .where('ol.orderId IN (:...orderIds)', { orderIds })
            .getMany();
        // 按 productVariant 聚合（key 用 string，兼容 Vendure ID 类型）
        const variantMap = new Map();
        for (const line of orderLines) {
            const variantId = String((_b = (_a = line.productVariant) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 0);
            const entry = (_c = variantMap.get(variantId)) !== null && _c !== void 0 ? _c : {
                variantId,
                variantName: (_e = (_d = line.productVariant) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : '',
                productName: (_h = (_g = (_f = line.productVariant) === null || _f === void 0 ? void 0 : _f.product) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : '',
                sku: (_k = (_j = line.productVariant) === null || _j === void 0 ? void 0 : _j.sku) !== null && _k !== void 0 ? _k : '',
                totalQuantity: 0,
                totalAmount: 0,
            };
            entry.totalQuantity += line.quantity;
            entry.totalAmount += (_m = (_l = line.proratedLinePrice) !== null && _l !== void 0 ? _l : line.linePrice) !== null && _m !== void 0 ? _m : 0;
            variantMap.set(variantId, entry);
        }
        // 排序 + 截取
        const items = Array.from(variantMap.values())
            .sort((a, b) => sortBy === 'quantity' ? b.totalQuantity - a.totalQuantity : b.totalAmount - a.totalAmount)
            .slice(0, limit);
        return { startDate, endDate, items };
    }
    // ===== 私有工具方法 =====
    /**
     * 将 Vendure ID（形如 'T_1'）转为纯数字字符串。
     */
    parseChannelId(channelId) {
        return String(channelId !== null && channelId !== void 0 ? channelId : '').replace('T_', '');
    }
    /**
     * 查询指定日期范围 + orderType 的订单（含 payments 关系）。
     *
     * Vendure Order 通过 channels 多对多关系关联 Channel（无 channelId 外键列），
     * 因此用 innerJoin channels 过滤。customFields 是 embedded entity，
     * 列名形如 customFields_orderType，用 PRAGMA 动态查找避免命名策略差异。
     */
    async queryOrdersByDateRange(channelId, start, end, orderType) {
        const numChannelId = parseInt(channelId, 10);
        // 查找 orderType custom field 的实际列名
        const orderTypeCol = await (0, db_columns_1.findDbColumn)(this.connection, 'order', 'orderType');
        if (!orderTypeCol) {
            // custom field 列不存在，返回空
            return [];
        }
        return this.connection
            .getRepository(core_1.Order)
            .createQueryBuilder('ord')
            .innerJoin('ord.channels', 'channel', 'channel.id = :channelId', { channelId: numChannelId })
            .leftJoinAndSelect('ord.payments', 'payment')
            .where(`ord."${orderTypeCol}" = :orderType`, { orderType })
            .andWhere('ord.createdAt >= :start', { start })
            .andWhere('ord.createdAt < :end', { end })
            .getMany();
    }
    /**
     * 聚合支付方式（按 Payment.method 分组，仅统计 Settled 状态）。
     */
    aggregatePaymentsByMethod(orders) {
        var _a, _b;
        const methodMap = new Map();
        for (const order of orders) {
            for (const payment of (_a = order.payments) !== null && _a !== void 0 ? _a : []) {
                if (payment.state !== 'Settled')
                    continue;
                const entry = (_b = methodMap.get(payment.method)) !== null && _b !== void 0 ? _b : { count: 0, amount: 0 };
                entry.count += 1;
                entry.amount += payment.amount;
                methodMap.set(payment.method, entry);
            }
        }
        return Array.from(methodMap.entries())
            .map(([method, data]) => ({ method, count: data.count, amount: data.amount }))
            .sort((a, b) => b.amount - a.amount);
    }
    /**
     * 获取今日 00:00:00 ~ 明日 00:00:00 的时间范围。
     */
    getTodayRange() {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
        return { start, end };
    }
    /**
     * 解析日期范围字符串（YYYY-MM-DD），返回 Date 对象。
     * endDate 含当天（结束时间为次日 00:00:00）。
     */
    parseDateRange(startDate, endDate) {
        const [sy, sm, sd] = startDate.split('-').map(Number);
        const [ey, em, ed] = endDate.split('-').map(Number);
        const start = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
        const end = new Date(ey, em - 1, ed + 1, 0, 0, 0, 0);
        return { start, end };
    }
    /**
     * 获取月份范围（该月 1 日 ~ 下月 1 日）。
     */
    getMonthRange(year, month) {
        const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
        const end = new Date(year, month, 1, 0, 0, 0, 0);
        return { start, end };
    }
    /**
     * 格式化日期为 YYYY-MM-DD。
     */
    formatDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
};
exports.ReportService = ReportService;
exports.ReportService = ReportService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], ReportService);
//# sourceMappingURL=report.service.js.map