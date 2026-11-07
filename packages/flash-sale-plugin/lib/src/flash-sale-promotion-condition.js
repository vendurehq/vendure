"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flashSaleDiscountCondition = void 0;
const core_1 = require("@vendure/core");
const flash_sale_activity_entity_1 = require("./flash-sale-activity.entity");
const flash_sale_runtime_1 = require("./flash-sale-runtime");
const platform_time_1 = require("./platform-time");
/**
 * 秒杀价条件：读 order.customFields.flashSaleActivityId，
 * 运行时查询活动并校验（active、窗口内、库存未售罄）后，
 * 返回 state `{ activityId, variantId, flashPrice }` 供 flash_sale_price 动作取价。
 *
 * 与阶段12/13 一致：活动配置运行时动态读取，无需在管理端按活动手工配 args。
 */
exports.flashSaleDiscountCondition = new core_1.PromotionCondition({
    code: 'flash_sale_discount',
    description: [
        { languageCode: core_1.LanguageCode.zh_Hans, value: '秒杀优惠' },
        { languageCode: core_1.LanguageCode.en, value: 'Flash Sale Discount' },
    ],
    args: {},
    async check(ctx, order) {
        var _a, _b;
        const activityId = (_a = order === null || order === void 0 ? void 0 : order.customFields) === null || _a === void 0 ? void 0 : _a.flashSaleActivityId;
        if (activityId == null)
            return false;
        const activity = await (0, flash_sale_runtime_1.getFlashSaleConnection)()
            .getRepository(ctx, flash_sale_activity_entity_1.FlashSaleActivity)
            .findOne({ where: { id: activityId } });
        if (!activity)
            return false;
        const nowMs = (0, platform_time_1.platformNowMs)();
        // 仅活动进行中且窗口内生效；非 active 或已结束不优惠
        if (activity.status !== 'active')
            return false;
        if (activity.startAt && nowMs < (0, platform_time_1.wallClockMs)(activity.startAt))
            return false;
        if (activity.endAt && nowMs > (0, platform_time_1.wallClockMs)(activity.endAt))
            return false;
        // 库存售罄不再优惠（存量已占满）
        if (activity.soldCount >= activity.totalStock)
            return false;
        // 订单须包含秒杀变体行，避免对非秒杀商品误打折
        const lines = (_b = order === null || order === void 0 ? void 0 : order.lines) !== null && _b !== void 0 ? _b : [];
        const hasVariant = lines.some((l) => (l === null || l === void 0 ? void 0 : l.productVariant) && String(l.productVariant.id) === String(activity.variantId));
        if (!hasVariant)
            return false;
        return {
            activityId: String(activity.id),
            variantId: String(activity.variantId),
            flashPrice: activity.flashPrice,
        };
    },
    priorityValue: 950,
});
//# sourceMappingURL=flash-sale-promotion-condition.js.map