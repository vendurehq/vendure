import { Injectable } from '@nestjs/common';
import { CustomerService, OrderService, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

import { Errors } from '../errors';
import { StageEvent } from '../entities';
import { resolveChannelToken } from './channel-context';

/** 订单聚合（CT-04）：标准 Order 字段 + 跨境 customFields + StageEvent 时间轴。 */
@Injectable()
export class OnebridgeOrderSummaryService {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private customerService: CustomerService,
    ) {}

    async summary(ctx: RequestContext, orderCode: string, enforceOwnership: boolean): Promise<any> {
        resolveChannelToken(ctx);
        const order = await this.orderService.findOneByCode(ctx, orderCode, ['customer', 'lines', 'lines.productVariant']);
        if (!order) throw Errors.orderNotFound(orderCode);
        if (enforceOwnership) await this.assertOwnership(ctx, order);
        const customFields = order.customFields as Record<string, any>;
        return {
            code: order.code,
            state: order.state,
            totalWithTax: order.totalWithTax,
            currencyCode: order.currencyCode,
            businessLine: customFields?.businessLine ?? null,
            crossBorderStage: customFields?.crossBorderStage ?? null,
            rfqCode: customFields?.rfqCode ?? null,
            needType: customFields?.needType ?? null,
            krwAmount: customFields?.krwAmount ?? null,
            expectedEta: customFields?.expectedEta ?? null,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
            items: (order.lines ?? []).map((line: any) => {
                const variant = line.productVariant;
                const translated = variant?.translations?.find((t: any) => t.languageCode === ctx.languageCode);
                return {
                    id: line.id,
                    productVariantId: variant?.id ?? null,
                    name: translated?.name ?? variant?.sku ?? '',
                    spec: (variant?.customFields as any)?.spec ?? null,
                    qty: line.quantity,
                    price: line.linePriceWithTax,
                };
            }),
            timeline: await this.timeline(ctx, order.code),
        };
    }

    async timeline(ctx: RequestContext, orderCode: string): Promise<StageEvent[]> {
        return this.connection.getRepository(ctx, StageEvent).find({
            where: { ownerType: 'order', ownerCode: orderCode },
            order: { occurredAt: 'ASC' },
        });
    }

    /**
     * 物流轨迹（CT-09 orderTracks）：承运商单号/状态读 logistics-plugin 的 logistics_track；
     * 承运商轨迹接入前，trackInfo 复用 CT-10 业务时间轴，避免前端出现空轨道。
     * TODO(联调)：logistics_track.trackInfo 的承运商节点映射与 carrierName 字典待物流插件提供。
     */
    async orderTracks(ctx: RequestContext, orderCode: string, enforceOwnership = true): Promise<any> {
        resolveChannelToken(ctx);
        const order = await this.orderService.findOneByCode(ctx, orderCode, ['fulfillments', 'customer']);
        if (!order) throw Errors.orderNotFound(orderCode);
        if (enforceOwnership) await this.assertOwnership(ctx, order);
        const fulfillmentIds = ((order as any).fulfillments ?? []).map((f: any) => Number(f.id)).filter(Number.isFinite);
        const track = await this.latestLogisticsTrack(fulfillmentIds);
        return {
            orderCode,
            fulfillmentId: track?.fulfillmentId != null ? String(track.fulfillmentId) : null,
            trackingNo: track?.trackingNo ?? null,
            carrierCode: track?.carrierCode ?? null,
            carrierName: track?.carrierCode ?? null,
            status: track?.status ?? 'unknown',
            trackInfo: await this.timeline(ctx, orderCode),
            signedAt: track?.signedAt ?? null,
            lastSyncedAt: track?.lastSyncedAt ?? null,
            channelId: String(ctx.channelId),
        };
    }

    /** 读取最近一条物流轨迹；logistics-plugin 未安装/未建表时返回 null（不阻断联调） */
    private async latestLogisticsTrack(fulfillmentIds: number[]): Promise<any | null> {
        if (!fulfillmentIds.length) return null;
        const runner = this.connection.rawConnection.createQueryRunner();
        try {
            if (!(await runner.hasTable('logistics_track'))) return null;
            return await runner.manager
                .createQueryBuilder()
                .select([
                    't.id AS id',
                    't.fulfillmentId AS fulfillmentId',
                    't.trackingNo AS trackingNo',
                    't.carrierCode AS carrierCode',
                    't.status AS status',
                    't.signedAt AS signedAt',
                    't.lastSyncedAt AS lastSyncedAt',
                ])
                .from('logistics_track', 't')
                .where('t.fulfillmentId IN (:...ids)', { ids: fulfillmentIds })
                .orderBy('t.id', 'DESC')
                .limit(1)
                .getRawOne();
        } finally {
            await runner.release();
        }
    }

    private async assertOwnership(ctx: RequestContext, order: any): Promise<void> {
        if (!ctx.activeUserId) throw new UserInputError('Authentication required');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer || order.customer?.id !== customer.id) {
            throw Errors.orderNotFound(order.code);
        }
    }
}
