import { Injectable } from '@nestjs/common';
import { CustomerService, OrderService, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

import { Errors } from '../errors';
import { StageEvent } from '../entities';
import { resolveChannelToken } from './channel-context';
import { resolveCarrierName } from './carrier-dictionary';

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
        const order = await this.orderService.findOneByCode(ctx, orderCode, [
            'customer',
            'lines',
            'lines.productVariant',
            // A1：name 取变体/商品译名，必须显式加载 translations；否则 fallback 到 sku（L2201308）
            'lines.productVariant.translations',
            'lines.productVariant.product',
            'lines.productVariant.product.translations',
        ]);
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
                return {
                    id: line.id,
                    productVariantId: variant?.id ?? null,
                    name: this.resolveItemName(ctx, variant),
                    spec: this.resolveItemSpec(variant),
                    qty: line.quantity,
                    // price 保持「行小计含税」语义；unitPrice 为新增的单价含税字段
                    price: line.linePriceWithTax,
                    unitPrice: line.unitPriceWithTax,
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
            // B-16：承运商字典命中则给展示名，命不中保持 null（C 端按未知占位），不改 status 口径
            carrierName: resolveCarrierName(track?.carrierCode),
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

    /**
     * A1：行项名称优先取「变体译名 → 商品译名 → 商品 customFields.krName/cnName → SKU」。
     * 之前只读 variant.translations 且未 join，取不到就回落 sku（L2201308）。
     */
    private resolveItemName(ctx: RequestContext, variant: any): string {
        const product = variant?.product;
        const candidates: string[] = [
            this.pickTranslationName(variant?.translations, ctx.languageCode),
            this.pickTranslationName(product?.translations, ctx.languageCode),
            product?.customFields?.krName,
            product?.customFields?.cnName,
            this.pickTranslationName(variant?.translations),
            this.pickTranslationName(product?.translations),
            variant?.sku,
        ];
        return candidates.find(value => typeof value === 'string' && value.trim() !== '')?.trim() ?? '';
    }

    /** 指定语言优先；未指定时按 ko → en → 第一条，避免 channel 默认语言缺译时回落 sku */
    private pickTranslationName(translations: any[] | undefined, languageCode?: string): string | undefined {
        if (!Array.isArray(translations) || translations.length === 0) return undefined;
        if (languageCode) {
            const exact = translations.find(t => t.languageCode === languageCode);
            if (exact?.name) return exact.name;
        }
        const ko = translations.find(t => t.languageCode === 'ko');
        if (ko?.name) return ko.name;
        const en = translations.find(t => t.languageCode === 'en');
        if (en?.name) return en.name;
        return translations.find(t => t?.name)?.name;
    }

    /** A2：规格取商品 customFields.spec（种子缺值时回落变体的 accuracy/material 组合） */
    private resolveItemSpec(variant: any): string | null {
        const productCustomFields = (variant?.product?.customFields ?? {}) as Record<string, unknown>;
        const spec = typeof productCustomFields.spec === 'string' ? productCustomFields.spec.trim() : '';
        if (spec) return spec;
        const variantCustomFields = (variant?.customFields ?? {}) as Record<string, unknown>;
        const composed = [variantCustomFields.accuracy, variantCustomFields.material]
            .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
            .join(' / ');
        return composed || null;
    }

    private async assertOwnership(ctx: RequestContext, order: any): Promise<void> {
        if (!ctx.activeUserId) throw new UserInputError('Authentication required');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer || order.customer?.id !== customer.id) {
            throw Errors.orderNotFound(order.code);
        }
    }
}
