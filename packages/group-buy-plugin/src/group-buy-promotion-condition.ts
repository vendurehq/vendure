import { LanguageCode, PromotionCondition, RequestContext } from '@vendure/core';

import { GroupBuyDiscountConditionState } from './types';
import { GroupBuyActivity } from './group-buy-activity.entity';
import { getGroupBuyConnection } from './group-buy-runtime';
import { platformNowMs, wallClockMs } from './platform-time';

/**
 * 拼团价条件：读 order.customFields.groupBuyActivityId，
 * 运行时查询活动并校验（非 expired、窗口内、订单含拼团变体行）后，
 * 返回 state `{ activityId, variantId, groupPrice }` 供 group_buy_price 动作取价。
 */
export const groupBuyDiscountCondition = new PromotionCondition({
    code: 'group_buy_discount',
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '拼团优惠' },
        { languageCode: LanguageCode.en, value: 'Group Buy Discount' },
    ],
    args: {},
    async check(ctx: RequestContext, order: any): Promise<GroupBuyDiscountConditionState | false> {
        const activityId = order?.customFields?.groupBuyActivityId;
        if (activityId == null) return false;

        const activity = await getGroupBuyConnection()
            .getRepository(ctx, GroupBuyActivity)
            .findOne({ where: { id: activityId as any } });
        if (!activity) return false;

        const nowMs = platformNowMs();
        if (activity.status === 'expired') return false;
        if (activity.status !== 'active' && !activity.allowJoinAfterComplete) return false;
        if (activity.startAt && nowMs < wallClockMs(activity.startAt)) return false;
        if (activity.endAt && nowMs > wallClockMs(activity.endAt)) return false;

        // 订单须包含拼团变体行，避免对非拼团商品误打折
        const lines = order?.lines ?? [];
        const hasVariant = lines.some(
            (l: any) => l?.productVariant && String(l.productVariant.id) === String(activity.variantId),
        );
        if (!hasVariant) return false;

        return {
            activityId: String(activity.id),
            variantId: String(activity.variantId),
            groupPrice: activity.groupPrice,
        };
    },
    priorityValue: 900,
});
