import { Injectable } from '@nestjs/common';
import { ID, Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import { In } from 'typeorm';
import { ReconciliationBatch, ReconciliationOrderLine } from './reconciliation.entity';
import { diffOrder, DiffType } from './diff-rules';

const loggerCtx = 'ReconciliationService';

// TypeORM DataSource.query 对 PostgreSQL 返回的是「行对象数组」（不是 [rows] 嵌套）；兼容查询器结构化返回形态
const rowsOf = (out: any): any[] => {
    if (Array.isArray(out)) return out;
    if (Array.isArray(out?.rows)) return out.rows;
    return [];
};

@Injectable()
export class ReconciliationService {
    constructor(private connection: TransactionalConnection) {}

    /** 幂等跑批：同日已有 done 批次则返回 null */
    async runBatch(
        ctx: RequestContext,
        date: string,
        trigger: 'manual' | 'cron',
    ): Promise<ReconciliationBatch | null> {
        const batchRepo = this.connection.getRepository(ctx, ReconciliationBatch);
        const existing = await batchRepo.findOne({
            where: { tenantChannelId: ctx.channelId as any, date },
        });
        if (existing?.status === 'done') {
            return null;
        }
        const batch = existing ?? (await batchRepo.save(new ReconciliationBatch({
            tenantChannelId: ctx.channelId as any,
            date,
            status: 'running',
            trigger,
            startedAt: new Date(),
        })));

        const orderRepo = this.connection.getRepository(ctx, 'Order' as any);
        // 当前租户渠道下订单（Order 通过 channels 多对多归属渠道）；取前 500 单，显式 ORDER BY id
        // 避免超过 500 条时静默截断成「任意子集」（无排序时 PostgreSQL 返回顺序不保证稳定）
        const orders = await orderRepo.find({
            where: { channels: { id: ctx.channelId as any } } as any,
            relations: { lines: true, fulfillments: true } as any,
            order: { id: 'ASC' } as any,
            take: 500,
        });

        // D1 三证：发货单 ∪ 自提核销 ∪ 校园配送实际送达；均取自订单/独立插件，不再依赖 delivery_record 死表
        const lineRepo = this.connection.getRepository(ctx, ReconciliationOrderLine);
        let d1 = 0, d2 = 0, d3 = 0, d4 = 0;
        for (const order of orders) {
            const data = await this.collectOrderData(ctx, order as any);
            const diffs = diffOrder({
                order: {
                    id: String(order.id),
                    totalWithTax: (order as any).totalWithTax ?? 0,
                    state: (order as any).state ?? '',
                    customFields: (order as any).customFields ?? {},
                },
                deliveryRecords: data.deliveryRecords,
                ledgerOuts: data.ledgerOuts,
                hasShipment: data.hasShipment,
                pickupCollected: data.pickupCollected,
                campusDelivered: data.campusDelivered,
                paidSettled: data.paidSettled,
                settledRefunds: data.settledRefunds,
                mirrorDiff: data.mirrorDiff,
                cancelled: (order as any).state === 'Cancelled',
            });
            if (diffs.length) {
                await lineRepo.save(new ReconciliationOrderLine({
                    batchId: batch.id,
                    orderId: order.id as any,
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
        Logger.info(`对账批次完成: ${date} 订单=${orders.length} D1=${d1} D2=${d2} D3=${d3} D4=${d4}`, loggerCtx);
        return batch;
    }

    /** 采集一单四流数据（数据源：Order / OrderStockLedger / DeliveryRecord / Fulfillment / pickup_redemption / Payment+Refund） */
    private async collectOrderData(ctx: RequestContext, order: any) {
        const lineIds: number[] = (order.lines ?? []).map((l: any) => l.id);
        const outs: any[] = [];
        const mirrors: any[] = [];
        if (lineIds.length) {
            const ledgerRepo = this.connection.getRepository(ctx, 'OrderStockLedger' as any);
            const ledgers = await ledgerRepo.find({ where: { orderLineId: In(lineIds) } });
            outs.push(...ledgers.filter((l: any) => l.bizType === 'order' && l.direction === 'out'));
            mirrors.push(...ledgers.filter((l: any) => l.bizType === 'mirror'));
        }
        const deliveryRepo = this.connection.getRepository(ctx, 'DeliveryRecord' as any);
        const records = await deliveryRepo.find({ where: { orderId: order.id as any } });
        const totals = await this.paymentTotals(order.id);
        return {
            deliveryRecords: records.map((r: any) => ({ mode: r.mode, sourceLocationId: r.sourceLocationId, status: r.status })),
            ledgerOuts: outs.map((l: any) => ({ sourceLocationId: l.stockLocationId, quantity: l.quantity })),
            // D1 三证补充：发货单（Vendure fulfillment）+ 自提核销 + 校园配送实际送达状态
            hasShipment: Array.isArray(order.fulfillments) ? order.fulfillments.length > 0 : false,
            pickupCollected: await this.pickupCollected(order.id),
            campusDelivered: (order.customFields as any)?.deliveryStatus === 'delivered',
            // D3 实收口径：已结算支付 − 已结算退款（不再取 MerchantSettlementLedger）
            paidSettled: totals.paidSettled,
            settledRefunds: totals.settledRefunds,
            mirrorDiff: mirrors.reduce((sum: number, m: any) => sum + (m.direction === 'in' ? m.quantity : -m.quantity), 0),
        };
    }

    /** 自提核销证据：pickup_redemption 属独立插件，表不存在/查询失败按「无证据」处理 */
    private async pickupCollected(orderId: any): Promise<boolean> {
        try {
            const rows = rowsOf(await this.connection.rawConnection.query(
                `SELECT collected FROM pickup_redemption WHERE "orderId" = $1 LIMIT 1`,
                [orderId],
            ));
            return rows[0]?.collected === true;
        } catch {
            return false;
        }
    }

    /** 实收支付与已结算退款（分）：只认 state='Settled'，Authorized/Pending 不计入也不判差异 */
    private async paymentTotals(orderId: any): Promise<{ paidSettled: number; settledRefunds: number }> {
        try {
            const rows = rowsOf(await this.connection.rawConnection.query(
                `SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.state = 'Settled'), 0) AS paid,
                        COALESCE((SELECT SUM(r.total) FROM refund r
                                   JOIN payment p2 ON r."paymentId" = p2.id
                                  WHERE p2."orderId" = $1 AND r.state = 'Settled'), 0) AS refunded
                   FROM payment p
                  WHERE p."orderId" = $1`,
                [orderId],
            ));
            return {
                paidSettled: Number(rows[0]?.paid ?? 0),
                settledRefunds: Number(rows[0]?.refunded ?? 0),
            };
        } catch (e: any) {
            Logger.warn(`对账 D3 实收金额查询失败 order=${orderId}，按 0 处理：${String(e?.message ?? e)}`, loggerCtx);
            return { paidSettled: 0, settledRefunds: 0 };
        }
    }

    /** 重跑单条：重新判定后置 closed */
    async rerunOrder(ctx: RequestContext, lineId: ID): Promise<ReconciliationOrderLine> {
        const lineRepo = this.connection.getRepository(ctx, ReconciliationOrderLine);
        const line = await lineRepo.findOne({ where: { id: lineId as any } });
        if (!line) {
            throw new Error(`对账行不存在: ${lineId}`);
        }
        const orderRepo = this.connection.getRepository(ctx, 'Order' as any);
        const order = await orderRepo.findOne({
            where: { id: line.orderId as any },
            relations: { lines: true, fulfillments: true } as any,
        });
        if (!order) {
            throw new Error(`订单不存在: ${line.orderId}`);
        }
        const data = await this.collectOrderData(ctx, order as any);
        const diffs = diffOrder({
            order: {
                id: String(order.id),
                totalWithTax: (order as any).totalWithTax ?? 0,
                state: (order as any).state ?? '',
                customFields: (order as any).customFields ?? {},
            },
            deliveryRecords: data.deliveryRecords,
            ledgerOuts: data.ledgerOuts,
            hasShipment: data.hasShipment,
            pickupCollected: data.pickupCollected,
            campusDelivered: data.campusDelivered,
            paidSettled: data.paidSettled,
            settledRefunds: data.settledRefunds,
            mirrorDiff: data.mirrorDiff,
            cancelled: (order as any).state === 'Cancelled',
        });
        line.diffTypes = JSON.stringify(diffs);
        line.status = diffs.length ? 'pending' : 'closed';
        if (!diffs.length) {
            line.fixedAt = new Date();
        }
        return lineRepo.save(line);
    }

    async listBatches(ctx: RequestContext): Promise<ReconciliationBatch[]> {
        return this.connection.getRepository(ctx, ReconciliationBatch).find({
            where: { tenantChannelId: ctx.channelId as any },
            order: { createdAt: 'DESC' } as any,
            take: 60,
        });
    }

    async listLines(ctx: RequestContext, batchId: ID): Promise<ReconciliationOrderLine[]> {
        return this.connection.getRepository(ctx, ReconciliationOrderLine).find({
            where: { batchId: batchId as any },
            order: { createdAt: 'ASC' } as any,
        });
    }
}
