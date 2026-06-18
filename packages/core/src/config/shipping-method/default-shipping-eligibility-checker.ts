import { LanguageCode } from '@vendure/common/lib/generated-types';

import { ShippingEligibilityChecker } from './shipping-eligibility-checker';

export const defaultShippingEligibilityChecker = new ShippingEligibilityChecker({
    code: 'default-shipping-eligibility-checker',
    description: [{ languageCode: LanguageCode.en, value: 'Default Shipping Eligibility Checker' }],
    args: {
        orderMinimum: {
            type: 'int',
            defaultValue: 0,
            ui: { component: 'currency-form-input' },
            label: [{ languageCode: LanguageCode.en, value: 'Minimum order value' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Order is eligible only if its total is greater or equal to this value',
                },
            ],
        },
    },
    check: (ctx, order, args) => {
        return order.subTotalWithTax >= args.orderMinimum;
    },
});
