import { LanguageCode, PromotionCondition, RequestContext } from '@vendure/core';

import { FlashSaleActivity } from './flash-sale-activity.entity';
import { getFlashSaleConnection } from './flash-sale-runtime';
import { platformNowMs, wallClockMs } from './platform-time';

/**
 * 秒杀价条件：读 order.customFields.flashSaleActivityId，
 * 运行时查询活动并校验（active、窗口内、库存未售罄）后，
 * 返回 state `{ activityId, variantId, flashPrice }` 供 flash_sale_price 动作取价。
 *
 * 与阶段12/13 一致：活动配置运行时动态读取，无需在管理端按活动手工配 args。
 */
export const flashSaleDiscountCondition = new PromotionCondition({
    code: 'flash_sale_discount',
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '秒杀优惠' },
        { languageCode: LanguageCode.en, value: 'Flash Sale Discount' },
    ],
    args: {},
    async check(ctx: RequestContext, order: any) {
        const activityId = order?.customFields?.flashSaleActivityId;
        if (activityId == null) return false;

        const activity = await getFlashSaleConnection()
            .getRepository(ctx, FlashSaleActivity)
            .findOne({ where: { id: activityId as any } });
        if (!activity) return false;

        const nowMs = platformNowMs();
        // 仅活动进行中且窗口内生效；非 active 或已结束不优惠
        if (activity.status !== 'active') return false;
        if (activity.startAt && nowMs < wallClockMs(activity.startAt)) return false;
        if (activity.endAt && nowMs > wallClockMs(activity.endAt)) return false;
        // 库存售罄不再优惠（存量已占满）
        if (activity.soldCount >= activity.totalStock) return false;

        // 订单须包含秒杀变体行，避免对非秒杀商品误打折
        const lines = order?.lines ?? [];
        const hasVariant = lines.some(
            (l: any) => l?.productVariant && String(l.productVariant.id) === String(activity.variantId),
        );
        if (!hasVariant) return false;

        return {
            activityId: String(activity.id),
            variantId: String(activity.variantId),
            flashPrice: activity.flashPrice,
        };
    },
    priorityValue: 950,
});