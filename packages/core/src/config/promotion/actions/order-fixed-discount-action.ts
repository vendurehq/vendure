import { LanguageCode } from '@vendure/common/lib/generated-types';

import { PromotionOrderAction } from '../promotion-action';

export const orderFixedDiscount = new PromotionOrderAction({
    code: 'order_fixed_discount',
    args: {
        discount: {
            type: 'int',
            ui: {
                component: 'currency-form-input',
            },
        },
    },
    execute(ctx, order, args) {
        const upperBound = ctx.channel.pricesIncludeTax ? order.subTotalWithTax : order.subTotal;
        return -Math.min(args.discount, upperBound);
    },
    description: [{ languageCode: LanguageCode.en, value: 'Discount order by fixed amount' }],
});
