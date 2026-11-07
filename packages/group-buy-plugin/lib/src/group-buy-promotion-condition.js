"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupBuyDiscountCondition = void 0;
const core_1 = require("@vendure/core");
const group_buy_activity_entity_1 = require("./group-buy-activity.entity");
const group_buy_runtime_1 = require("./group-buy-runtime");
const platform_time_1 = require("./platform-time");
/**
 * 拼团价条件：读 order.customFields.groupBuyActivityId，
 * 运行时查询活动并校验（非 expired、窗口内、订单含拼团变体行）后，
 * 返回 state `{ activityId, variantId, groupPrice }` 供 group_buy_price 动作取价。
 */
exports.groupBuyDiscountCondition = new core_1.PromotionCondition({
    code: 'group_buy_discount',
    description: [
        { languageCode: core_1.LanguageCode.zh_Hans, value: '拼团优惠' },
        { languageCode: core_1.LanguageCode.en, value: 'Group Buy Discount' },
    ],
    args: {},
    async check(ctx, order) {
        var _a, _b;
        const activityId = (_a = order === null || order === void 0 ? void 0 : order.customFields) === null || _a === void 0 ? void 0 : _a.groupBuyActivityId;
        if (activityId == null)
            return false;
        const activity = await (0, group_buy_runtime_1.getGroupBuyConnection)()
            .getRepository(ctx, group_buy_activity_entity_1.GroupBuyActivity)
            .findOne({ where: { id: activityId } });
        if (!activity)
            return false;
        const nowMs = (0, platform_time_1.platformNowMs)();
        if (activity.status === 'expired')
            return false;
        if (activity.status !== 'active' && !activity.allowJoinAfterComplete)
            return false;
        if (activity.startAt && nowMs < (0, platform_time_1.wallClockMs)(activity.startAt))
            return false;
        if (activity.endAt && nowMs > (0, platform_time_1.wallClockMs)(activity.endAt))
            return false;
        // 订单须包含拼团变体行，避免对非拼团商品误打折
        const lines = (_b = order === null || order === void 0 ? void 0 : order.lines) !== null && _b !== void 0 ? _b : [];
        const hasVariant = lines.some((l) => (l === null || l === void 0 ? void 0 : l.productVariant) && String(l.productVariant.id) === String(activity.variantId));
        if (!hasVariant)
            return false;
        return {
            activityId: String(activity.id),
            variantId: String(activity.variantId),
            groupPrice: activity.groupPrice,
        };
    },
    priorityValue: 900,
});
//# sourceMappingURL=group-buy-promotion-condition.js.map