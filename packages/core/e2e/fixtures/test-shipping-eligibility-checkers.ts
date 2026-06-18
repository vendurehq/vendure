import { LanguageCode } from '@vendure/common/lib/generated-types';
import { EntityHydrator, ShippingEligibilityChecker } from '@vendure/core';

export const countryCodeShippingEligibilityChecker = new ShippingEligibilityChecker({
    code: 'country-code-shipping-eligibility-checker',
    description: [{ languageCode: LanguageCode.en, value: 'Country Shipping Eligibility Checker' }],
    args: {
        countryCode: {
            type: 'string',
        },
    },
    check: (ctx, order, args) => {
        return order.shippingAddress?.countryCode === args.countryCode;
    },
});

let entityHydrator: EntityHydrator;

/**
 * @description
 * This checker does nothing except for hydrating the Order in order to test
 * an edge-case which would cause inconsistencies when modifying the Order in which
 * the OrderService would e.g. remove an OrderLine, but then this step would re-add it
 * because the removal had not yet been persisted by the time the `applyPriceAdjustments()`
 * step was run (during which this checker will run).
 *
 * See https://github.com/vendurehq/vendure/issues/2548
 */
export const hydratingShippingEligibilityChecker = new ShippingEligibilityChecker({
    code: 'hydrating-shipping-eligibility-checker',
    description: [{ languageCode: LanguageCode.en, value: 'Hydrating Shipping Eligibility Checker' }],
    args: {},
    init(injector) {
        entityHydrator = injector.get(EntityHydrator);
    },
    check: async (ctx, order) => {
        await entityHydrator.hydrate(ctx, order, { relations: ['lines.sellerChannel'] });
        return true;
    },
});
