import { LanguageCode } from '@vendure/common/lib/generated-types';

import { PromotionShippingAction } from '../promotion-action';

export const freeShipping = new PromotionShippingAction({
    code: 'free_shipping',
    args: {},
    execute(ctx, shippingLine, order, args) {
        // Discount only what is left of the shipping price after any shipping
        // Promotions which have already been applied, so that combining this
        // action with other shipping discounts cannot make shipping negative.
        const remainingPrice = shippingLine.listPriceIncludesTax
            ? shippingLine.discountedPriceWithTax
            : shippingLine.discountedPrice;
        return -Math.max(0, remainingPrice);
    },
    description: [{ languageCode: LanguageCode.en, value: 'Free shipping' }],
});
