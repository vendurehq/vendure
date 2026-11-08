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
exports.ReconciliationService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const typeorm_1 = require("typeorm");
const reconciliation_entity_1 = require("./reconciliation.entity");
const diff_rules_1 = require("./diff-rules");
const loggerCtx = 'ReconciliationService';
// TypeORM DataSource.query 对 PostgreSQL 返回的是「行对象数组」（不是 [rows] 嵌套）；兼容查询器结构化返回形态
const rowsOf = (out) => {
    if (Array.isArray(out))
        return out;
    if (Array.isArray(out === null || out === void 0 ? void 0 : out.rows))
        return out.rows;
    return [];
};
let ReconciliationService = class ReconciliationService {
    constructor(connection) {
        this.connection = connection;
    }
    /** 幂等跑批：同日已有 done 批次则返回 null */
    async runBatch(ctx, date, trigger) {
        var _a, _b, _c;
        const batchRepo = this.connection.getRepository(ctx, reconciliation_entity_1.ReconciliationBatch);
        const existing = await batchRepo.findOne({
            where: { tenantChannelId: ctx.channelId, date },
        });
        if ((existing === null || existing === void 0 ? void 0 : existing.status) === 'done') {
            return null;
        }
        const batch = existing !== null && existing !== void 0 ? existing : (await batchRepo.save(new reconciliation_entity_1.ReconciliationBatch({
            tenantChannelId: ctx.channelId,
            date,
            status: 'running',
            trigger,
            startedAt: new Date(),
        })));
        const orderRepo = this.connection.getRepository(ctx, 'Order');
        // 当前租户渠道下订单（Order 通过 channels 多对多归属渠道）；取前 500 单，显式 ORDER BY id
        // 避免超过 500 条时静默截断成「任意子集」（无排序时 PostgreSQL 返回顺序不保证稳定）
        const orders = await orderRepo.find({
            where: { channels: { id: ctx.channelId } },
            relations: { lines: true, fulfillments: true },
            order: { id: 'ASC' },
            take: 500,
        });
        // D1 三证：发货单 ∪ 自提核销 ∪ 校园配送实际送达；均取自订单/独立插件，不再依赖 delivery_record 死表
        const lineRepo = this.connection.getRepository(ctx, reconciliation_entity_1.ReconciliationOrderLine);
        let d1 = 0, d2 = 0, d3 = 0, d4 = 0;
        for (const order of orders) {
            const data = await this.collectOrderData(ctx, order);
            const diffs = (0, diff_rules_1.diffOrder)({
                order: {
                    id: String(order.id),
                    totalWithTax: (_a = order.totalWithTax) !== null && _a !== void 0 ? _a : 0,
                    state: (_b = order.state) !== null && _b !== void 0 ? _b : '',
                    customFields: (_c = order.customFields) !== null && _c !== void 0 ? _c : {},
                },
                deliveryRecords: data.deliveryRecords,
                ledgerOuts: data.ledgerOuts,
                hasShipment: data.hasShipment,
                pickupCollected: data.pickupCollected,
                campusDelivered: data.campusDelivered,
                paidSettled: data.paidSettled,
                settledRefunds: data.settledRefunds,
                mirrorDiff: data.mirrorDiff,
                cancelled: order.state === 'Cancelled',
            });
            if (diffs.length) {
                await lineRepo.save(new reconciliation_entity_1.ReconciliationOrderLine({
                    batchId: batch.id,
                    orderId: order.id,
                    diffTypes: JSON.stringify(diffs),
                    status: 'pending',
                }));
                d1 += diffs.includes('D1') ? 1 : 0;
                d2 += diffs.includes('D2') ? 1 : 0;
                d3 += diffs.includes('D3') ? 1 : 0;
                d4 += diffs.includes('D4') ? 1 : 0;
            }
        }
        batch.status = 'done';
        batch.d1Count = d1;
        batch.d2Count = d2;
        batch.d3Count = d3;
        batch.d4Count = d4;
        batch.orderTotal = orders.length;
        batch.finishedAt = new Date();
        await batchRepo.save(batch);
        core_1.Logger.info(`对账批次完成: ${date} 订单=${orders.length} D1=${d1} D2=${d2} D3=${d3} D4=${d4}`, loggerCtx);
        return batch;
    }
    /** 采集一单四流数据（数据源：Order / OrderStockLedger / DeliveryRecord / Fulfillment / pickup_redemption / Payment+Refund） */
    async collectOrderData(ctx, order) {
        var _a, _b;
        const lineIds = ((_a = order.lines) !== null && _a !== void 0 ? _a : []).map((l) => l.id);
        const outs = [];
        const mirrors = [];
        if (lineIds.length) {
            const ledgerRepo = this.connection.getRepository(ctx, 'OrderStockLedger');
            const ledgers = await ledgerRepo.find({ where: { orderLineId: (0, typeorm_1.In)(lineIds) } });
            outs.push(...ledgers.filter((l) => l.bizType === 'order' && l.direction === 'out'));
            mirrors.push(...ledgers.filter((l) => l.bizType === 'mirror'));
        }
        const deliveryRepo = this.connection.getRepository(ctx, 'DeliveryRecord');
        const records = await deliveryRepo.find({ where: { orderId: order.id } });
        const totals = await this.paymentTotals(order.id);
        return {
            deliveryRecords: records.map((r) => ({ mode: r.mode, sourceLocationId: r.sourceLocationId, status: r.status })),
            ledgerOuts: outs.map((l) => ({ sourceLocationId: l.stockLocationId, quantity: l.quantity })),
            // D1 三证补充：发货单（Vendure fulfillment）+ 自提核销 + 校园配送实际送达状态
            hasShipment: Array.isArray(order.fulfillments) ? order.fulfillments.length > 0 : false,
            pickupCollected: await this.pickupCollected(order.id),
            campusDelivered: ((_b = order.customFields) === null || _b === void 0 ? void 0 : _b.deliveryStatus) === 'delivered',
            // D3 实收口径：已结算支付 − 已结算退款（不再取 MerchantSettlementLedger）
            paidSettled: totals.paidSettled,
            settledRefunds: totals.settledRefunds,
            mirrorDiff: mirrors.reduce((sum, m) => sum + (m.direction === 'in' ? m.quantity : -m.quantity), 0),
        };
    }
    /** 自提核销证据：pickup_redemption 属独立插件，表不存在/查询失败按「无证据」处理 */
    async pickupCollected(orderId) {
        var _a;
        try {
            const rows = rowsOf(await this.connection.rawConnection.query(`SELECT collected FROM pickup_redemption WHERE "orderId" = $1 LIMIT 1`, [orderId]));
            return ((_a = rows[0]) === null || _a === void 0 ? void 0 : _a.collected) === true;
        }
        catch (_b) {
            return false;
        }
    }
    /** 实收支付与已结算退款（分）：只认 state='Settled'，Authorized/Pending 不计入也不判差异 */
    async paymentTotals(orderId) {
        var _a, _b, _c, _d, _e;
        try {
            const rows = rowsOf(await this.connection.rawConnection.query(`SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.state = 'Settled'), 0) AS paid,
                        COALESCE((SELECT SUM(r.total) FROM refund r
                                   JOIN payment p2 ON r."paymentId" = p2.id
                                  WHERE p2."orderId" = $1 AND r.state = 'Settled'), 0) AS refunded
                   FROM payment p
                  WHERE p."orderId" = $1`, [orderId]));
            return {
                paidSettled: Number((_b = (_a = rows[0]) === null || _a === void 0 ? void 0 : _a.paid) !== null && _b !== void 0 ? _b : 0),
                settledRefunds: Number((_d = (_c = rows[0]) === null || _c === void 0 ? void 0 : _c.refunded) !== null && _d !== void 0 ? _d : 0),
            };
        }
        catch (e) {
            core_1.Logger.warn(`对账 D3 实收金额查询失败 order=${orderId}，按 0 处理：${String((_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e)}`, loggerCtx);
            return { paidSettled: 0, settledRefunds: 0 };
        }
    }
    /** 重跑单条：重新判定后置 closed */
    async rerunOrder(ctx, lineId) {
        var _a, _b, _c;
        const lineRepo = this.connection.getRepository(ctx, reconciliation_entity_1.ReconciliationOrderLine);
        const line = await lineRepo.findOne({ where: { id: lineId } });
        if (!line) {
            throw new Error(`对账行不存在: ${lineId}`);
        }
        const orderRepo = this.connection.getRepository(ctx, 'Order');
        const order = await orderRepo.findOne({
            where: { id: line.orderId },
            relations: { lines: true, fulfillments: true },
        });
        if (!order) {
            throw new Error(`订单不存在: ${line.orderId}`);
        }
        const data = await this.collectOrderData(ctx, order);
        const diffs = (0, diff_rules_1.diffOrder)({
            order: {
                id: String(order.id),
                totalWithTax: (_a = order.totalWithTax) !== null && _a !== void 0 ? _a : 0,
                state: (_b = order.state) !== null && _b !== void 0 ? _b : '',
                customFields: (_c = order.customFields) !== null && _c !== void 0 ? _c : {},
            },
            deliveryRecords: data.deliveryRecords,
            ledgerOuts: data.ledgerOuts,
            hasShipment: data.hasShipment,
            pickupCollected: data.pickupCollected,
            campusDelivered: data.campusDelivered,
            paidSettled: data.paidSettled,
            settledRefunds: data.settledRefunds,
            mirrorDiff: data.mirrorDiff,
            cancelled: order.state === 'Cancelled',
        });
        line.diffTypes = JSON.stringify(diffs);
        line.status = diffs.length ? 'pending' : 'closed';
        if (!diffs.length) {
            line.fixedAt = new Date();
        }
        return lineRepo.save(line);
    }
    async listBatches(ctx) {
        return this.connection.getRepository(ctx, reconciliation_entity_1.ReconciliationBatch).find({
            where: { tenantChannelId: ctx.channelId },
            order: { createdAt: 'DESC' },
            take: 60,
        });
    }
    async listLines(ctx, batchId) {
        return this.connection.getRepository(ctx, reconciliation_entity_1.ReconciliationOrderLine).find({
            where: { batchId: batchId },
            order: { createdAt: 'ASC' },
        });
    }
};
exports.ReconciliationService = ReconciliationService;
exports.ReconciliationService = ReconciliationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], ReconciliationService);
//# sourceMappingURL=reconciliation.service.js.map