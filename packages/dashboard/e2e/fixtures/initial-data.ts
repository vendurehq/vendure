import { LanguageCode } from '@vendure/common/lib/generated-types';
import { InitialData } from '@vendure/core/dist/data-import/index';

export const initialData: InitialData = {
    defaultLanguage: LanguageCode.en,
    defaultZone: 'Europe',
    taxRates: [
        { name: 'Standard Tax', percentage: 20 },
        { name: 'Reduced Tax', percentage: 10 },
        { name: 'Zero Tax', percentage: 0 },
    ],
    shippingMethods: [
        { name: 'Standard Shipping', price: 500 },
        { name: 'Express Shipping', price: 1000 },
    ],
    paymentMethods: [],
    countries: [
        { name: 'Australia', code: 'AU', zone: 'Oceania' },
        { name: 'Austria', code: 'AT', zone: 'Europe' },
        { name: 'Canada', code: 'CA', zone: 'Americas' },
        { name: 'China', code: 'CN', zone: 'Asia' },
        { name: 'South Africa', code: 'ZA', zone: 'Africa' },
        { name: 'United Kingdom', code: 'GB', zone: 'Europe' },
        { name: 'United States of America', code: 'US', zone: 'Americas' },
    ],
    collections: [
        {
            name: 'Plants',
            filters: [
                { code: 'facet-value-filter', args: { facetValueNames: ['plants'], containsAny: false } },
            ],
        },
    ],
};
