import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { EntityHydrator, idsAreEqual, ShippingEligibilityChecker } from '@vendure/core';

let entityHydrator: EntityHydrator;

/**
 * @description
 * Shipping method is eligible if at least one OrderLine is associated with the Seller's Channel.
 */
export const multivendorShippingEligibilityChecker = new ShippingEligibilityChecker({
    code: 'multivendor-shipping-eligibility-checker',
    description: [{ languageCode: LanguageCode.en, value: 'Multivendor Shipping Eligibility Checker' }],
    args: {},
    init(injector) {
        entityHydrator = injector.get(EntityHydrator);
    },
    check: async (ctx, order, args, method) => {
        await entityHydrator.hydrate(ctx, method, { relations: ['channels'] });
        await entityHydrator.hydrate(ctx, order, { relations: ['lines.sellerChannel'] });
        const sellerChannel = method.channels.find(c => c.code !== DEFAULT_CHANNEL_CODE);
        if (!sellerChannel) {
            return false;
        }
        for (const line of order.lines) {
            if (line.sellerChannelId && idsAreEqual(line.sellerChannelId, sellerChannel.id)) {
                return true;
            }
        }
        return false;
    },
});
