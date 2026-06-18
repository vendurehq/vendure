import { LanguageCode } from '@vendure/common/lib/generated-types';

import { PromotionCondition } from '../promotion-condition';

export const minimumOrderAmount = new PromotionCondition({
    description: [{ languageCode: LanguageCode.en, value: 'If order total is greater than { amount }' }],
    code: 'minimum_order_amount',
    args: {
        amount: {
            type: 'int',
            defaultValue: 100,
            ui: { component: 'currency-form-input' },
        },
        taxInclusive: { type: 'boolean', defaultValue: false },
    },
    check(ctx, order, args) {
        if (args.taxInclusive) {
            return order.subTotalWithTax >= args.amount;
        } else {
            return order.subTotal >= args.amount;
        }
    },
    priorityValue: 10,
});
