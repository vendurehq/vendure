import { LanguageCode } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';

import { ShippingCalculator } from './shipping-calculator';

export enum TaxSetting {
    include = 'include',
    exclude = 'exclude',
    auto = 'auto',
}

export const defaultShippingCalculator = new ShippingCalculator({
    code: 'default-shipping-calculator',
    description: [{ languageCode: LanguageCode.en, value: 'Default Flat-Rate Shipping Calculator' }],
    args: {
        rate: {
            type: 'int',
            defaultValue: 0,
            ui: { component: 'currency-form-input' },
            label: [{ languageCode: LanguageCode.en, value: 'Shipping price' }],
        },
        includesTax: {
            type: 'string',
            defaultValue: TaxSetting.auto,
            ui: {
                component: 'select-form-input',
                options: [
                    {
                        label: [{ languageCode: LanguageCode.en, value: 'Includes tax' }],
                        value: TaxSetting.include,
                    },
                    {
                        label: [{ languageCode: LanguageCode.en, value: 'Excludes tax' }],
                        value: TaxSetting.exclude,
                    },
                    {
                        label: [{ languageCode: LanguageCode.en, value: 'Auto (based on Channel)' }],
                        value: TaxSetting.auto,
                    },
                ],
            },
            label: [{ languageCode: LanguageCode.en, value: 'Price includes tax' }],
        },
        taxRate: {
            type: 'float',
            defaultValue: 0,
            ui: { component: 'number-form-input', suffix: '%', min: 0 },
            label: [{ languageCode: LanguageCode.en, value: 'Tax rate' }],
        },
    },
    calculate: (ctx, order, args) => {
        return {
            price: args.rate,
            taxRate: args.taxRate,
            priceIncludesTax: getPriceIncludesTax(ctx, args.includesTax as any),
        };
    },
});

function getPriceIncludesTax(ctx: RequestContext, setting: TaxSetting): boolean {
    switch (setting) {
        case TaxSetting.auto:
            return ctx.channel.pricesIncludeTax;
        case TaxSetting.exclude:
            return false;
        case TaxSetting.include:
            return true;
    }
}
