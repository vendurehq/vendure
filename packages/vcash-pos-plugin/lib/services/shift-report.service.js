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
exports.ShiftReportService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const core_1 = require("@vendure/core");
const typeorm_2 = require("typeorm");
const pos_session_entity_1 = require("../entities/pos-session.entity");
const constants_1 = require("../constants");
const refund_service_1 = require("./refund.service");
const db_columns_1 = require("./db-columns");
/**
 * 交班对账服务：
 * - 聚合班次内所有 Order（通过 Order.customFields.posSessionId 关联）
 * - 按 orderType 分组统计（sale/refund/hold）
 * - 按 Payment.method 聚合支付明细（count + amount）
 * - 现金对账：expectedCash = openingFloat + Σ(cash payment amount)
 *   若 closingCash 与 expectedCash 差额 > 1 分则产生 warning
 *
 * 关键实现细节（Vendure 3.6.4）：
 * 1. Custom fields 是 embedded entity，列名形如 `customFields_posSessionId`
 *    不能用 `customFieldsJson ->> '$.posSessionId'` 的 JSON 查询
 * 2. Payment.amount 用 @Money 装饰器，单位为分（int）
 * 3. Order.total 为计算字段（subTotal + shipping），需 select 实体后访问 getter
 * 4. 退货 Order 的 total 为负数，统计 refundAmount 取 Math.abs
 */
let ShiftReportService = class ShiftReportService {
    constructor(connection, refundService) {
        this.connection = connection;
        this.refundService = refundService;
    }
    /**
     * 生成班次对账单。
     * @param sessionId 班次 ID
     * @param closingCash 实交现金（分），可选；传入则进行现金对账
     */
    async generateSummary(sessionId, closingCash) {
        var _a, _b, _c, _d, _e, _f;
        // 1. 查询班次内所有 Order（含 payments 关系）
        //    使用 raw SQL 查找实际列名后查询，避免 TypeORM 命名策略差异
        const orders = await this.queryOrdersBySession(sessionId);
        // 2. 按 orderType 分组
        const normalOrders = orders.filter(o => { var _a; return ((_a = o.customFields) === null || _a === void 0 ? void 0 : _a.orderType) === constants_1.ORDER_TYPE.SALE; });
        const refundOrders = orders.filter(o => { var _a; return ((_a = o.customFields) === null || _a === void 0 ? void 0 : _a.orderType) === constants_1.ORDER_TYPE.REFUND; });
        const heldOrders = orders.filter(o => { var _a; return ((_a = o.customFields) === null || _a === void 0 ? void 0 : _a.orderType) === constants_1.ORDER_TYPE.HOLD; });
        // 3. 金额汇总（Order.total 为 getter，单位分）
        const totalAmount = normalOrders.reduce((s, o) => { var _a; return s + ((_a = o.total) !== null && _a !== void 0 ? _a : 0); }, 0);
        const refundOrderAmount = refundOrders.reduce((s, o) => { var _a; return s + Math.abs((_a = o.total) !== null && _a !== void 0 ? _a : 0); }, 0);
        // 3b. 查询班次内原生 Refund（Vendure refundOrder 机制，非退货 Order）
        const nativeRefunds = await this.refundService.findRefundsBySession(sessionId);
        const nativeRefundAmount = nativeRefunds
            .filter(r => r.state === 'Settled')
            .reduce((s, r) => { var _a; return s + Math.abs((_a = r.total) !== null && _a !== void 0 ? _a : 0); }, 0);
        const refundAmount = refundOrderAmount + nativeRefundAmount;
        // 4. 支付方式聚合：遍历所有 Order 的 payments，按 method 分组
        //    只统计 state='Settled' 的支付（避免 Created/Error 干扰）
        const methodMap = new Map();
        for (const order of orders) {
            for (const payment of (_a = order.payments) !== null && _a !== void 0 ? _a : []) {
                if (payment.state !== 'Settled')
                    continue;
                const entry = (_b = methodMap.get(payment.method)) !== null && _b !== void 0 ? _b : {
                    count: 0,
                    amount: 0,
                };
                entry.count += 1;
                entry.amount += payment.amount;
                methodMap.set(payment.method, entry);
            }
        }
        // 4b. 退款冲减支付方式统计（原生 Refund 的负金额冲减对应 method）
        for (const refund of nativeRefunds) {
            if (refund.state !== 'Settled')
                continue;
            const method = refund.method || ((_c = refund.payment) === null || _c === void 0 ? void 0 : _c.method) || 'unknown';
            const entry = (_d = methodMap.get(method)) !== null && _d !== void 0 ? _d : { count: 0, amount: 0 };
            entry.amount -= Math.abs((_e = refund.total) !== null && _e !== void 0 ? _e : 0);
            methodMap.set(method, entry);
        }
        const paymentsByMethod = Array.from(methodMap.entries()).map(([method, v]) => (Object.assign({ method }, v)));
        // 5. 现金对账
        const warnings = [];
        if (closingCash !== undefined) {
            const session = await this.connection
                .getRepository(pos_session_entity_1.PosSession)
                .findOne({ where: { id: sessionId } });
            const openingFloat = (_f = session === null || session === void 0 ? void 0 : session.openingFloat) !== null && _f !== void 0 ? _f : 0;
            const expectedCash = await this.calculateExpectedCash(orders, openingFloat, nativeRefunds, sessionId);
            const diff = closingCash - expectedCash;
            if (Math.abs(diff) > 1) {
                const sign = diff > 0 ? '长' : '短';
                warnings.push(`现金${sign}款 ${Math.abs(diff).toFixed(2)} 分（应交 ${expectedCash}，实交 ${closingCash}）`);
            }
        }
        return {
            orders: {
                totalCount: orders.length,
                totalAmount,
                normalCount: normalOrders.length,
                refundCount: refundOrders.length + nativeRefunds.length,
                refundAmount,
                heldCount: heldOrders.length,
            },
            paymentsByMethod,
            warnings,
        };
    }
    /**
     * 计算应收现金 = openingFloat + Σ(method='cash' 且 state='Settled' 的 payment.amount)。
     * 退货 Order 的 cash payment 金额为负，会自动冲减。
     * 原生 Refund 中 method='cash' 且 state='Settled' 的退款也需冲减。
     */
    async calculateExpectedCash(orders, openingFloat, nativeRefunds, sessionId) {
        var _a, _b, _c;
        let cashFromPayments = 0;
        for (const order of orders) {
            for (const payment of (_a = order.payments) !== null && _a !== void 0 ? _a : []) {
                if (payment.state !== 'Settled')
                    continue;
                if (payment.method === 'cash') {
                    cashFromPayments += payment.amount;
                }
            }
        }
        // 原生现金退款冲减
        for (const refund of nativeRefunds) {
            if (refund.state !== 'Settled')
                continue;
            const method = refund.method || ((_b = refund.payment) === null || _b === void 0 ? void 0 : _b.method) || '';
            if (method === 'cash') {
                cashFromPayments -= Math.abs((_c = refund.total) !== null && _c !== void 0 ? _c : 0);
            }
        }
        return openingFloat + cashFromPayments;
    }
    /**
     * 查询班次内所有 Order（含 payments 关系）。
     *
     * TypeORM 对 embedded custom field 列名的解析在不同测试环境下不稳定
     * （dot notation 'ord.customFields.posSessionId' 在部分环境下被错误解析为
     * 'customFieldsPossessionid'）。此处用 PRAGMA 动态查找实际列名后查询。
     */
    async queryOrdersBySession(sessionId) {
        // 1. 动态查找 order 表中 posSessionId 的实际列名（SQLite/PostgreSQL 通用）
        const colName = await (0, db_columns_1.findDbColumn)(this.connection, 'order', 'posSessionId');
        if (!colName) {
            // 列不存在（schema 未同步 custom field），返回空数组
            return [];
        }
        // 2. 用实际列名查询 Order（含 payments 关系）
        return this.connection
            .getRepository(core_1.Order)
            .createQueryBuilder('ord')
            .leftJoinAndSelect('ord.payments', 'payment')
            .where(`ord."${colName}" = :sid`, { sid: sessionId })
            .getMany();
    }
};
exports.ShiftReportService = ShiftReportService;
exports.ShiftReportService = ShiftReportService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __param(1, (0, common_1.Inject)(refund_service_1.RefundService)),
    __metadata("design:paramtypes", [typeorm_2.Connection,
        refund_service_1.RefundService])
], ShiftReportService);
//# sourceMappingURL=shift-report.service.js.map