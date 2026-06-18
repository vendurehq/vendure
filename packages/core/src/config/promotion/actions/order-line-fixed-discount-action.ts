import { LanguageCode } from '@vendure/common/lib/generated-types';

import { PromotionLineAction } from '../promotion-action';

export const orderLineFixedDiscount = new PromotionLineAction({
    code: 'order_line_fixed_discount',
    args: {
        discount: {
            type: 'int',
            ui: {
                component: 'currency-form-input',
            },
        },
    },
    execute(ctx, orderLine, args) {
        return -args.discount;
    },
    description: [{ languageCode: LanguageCode.en, value: 'Discount orderLine by fixed amount' }],
});
