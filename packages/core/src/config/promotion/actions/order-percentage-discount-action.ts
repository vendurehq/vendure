import { LanguageCode } from '@vendure/common/lib/generated-types';

import { PromotionOrderAction } from '../promotion-action';

export const orderPercentageDiscount = new PromotionOrderAction({
    code: 'order_percentage_discount',
    args: {
        discount: {
            type: 'float',
            ui: {
                component: 'number-form-input',
                suffix: '%',
                min: 0,
            },
        },
    },
    execute(ctx, order, args) {
        const orderTotal = ctx.channel.pricesIncludeTax ? order.subTotalWithTax : order.subTotal;
        return -orderTotal * (args.discount / 100);
    },
    description: [{ languageCode: LanguageCode.en, value: 'Discount order by { discount }%' }],
});
