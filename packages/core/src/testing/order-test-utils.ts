import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Omit } from '@vendure/common/lib/omit';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../api/common/request-context';
import { Surcharge } from '../entity';
import { Channel } from '../entity/channel/channel.entity';
import { Order } from '../entity/order/order.entity';
import { OrderLine } from '../entity/order-line/order-line.entity';
import { ProductVariant } from '../entity/product-variant/product-variant.entity';
import { TaxCategory } from '../entity/tax-category/tax-category.entity';
import { TaxRate } from '../entity/tax-rate/tax-rate.entity';
import { Zone } from '../entity/zone/zone.entity';

export type SimpleLine = { productVariantId: ID; quantity: number; lineId: ID; customFields?: any };

export function createOrderFromLines(simpleLines: SimpleLine[]): Order {
    const lines = simpleLines.map(
        ({ productVariantId, quantity, lineId, customFields }) =>
            new OrderLine({
                id: lineId,
                productVariant: new ProductVariant({ id: productVariantId }),
                quantity,
                ...(customFields ? { customFields } : {}),
            }),
    );

    return new Order({
        lines,
    });
}

export function createRequestContext(options: { pricesIncludeTax: boolean }): RequestContext {
    const channel = new Channel({
        defaultTaxZone: zoneDefault,
        pricesIncludeTax: options.pricesIncludeTax,
    });
    const ctx = new RequestContext({
        apiType: 'admin',
        channel,
        authorizedAsOwnerOnly: false,
        languageCode: LanguageCode.en,
        isAuthorized: true,
        session: {} as any,
    });
    return ctx;
}

export const taxCategoryStandard = new TaxCategory({
    id: 'taxCategoryStandard',
    name: 'Standard Tax',
});
export const taxCategoryReduced = new TaxCategory({
    id: 'taxCategoryReduced',
    name: 'Reduced Tax',
});
export const taxCategoryZero = new TaxCategory({
    id: 'taxCategoryZero',
    name: 'Zero Tax',
});
export const zoneDefault = new Zone({
    id: 'zoneDefault',
    name: 'Default Zone',
});
export const zoneOther = new Zone({
    id: 'zoneOther',
    name: 'Other Zone',
});
export const zoneWithNoTaxRate = new Zone({
    id: 'zoneWithNoTaxRate',
    name: 'Zone for which no TaxRate is configured',
});
export const taxRateDefaultStandard = new TaxRate({
    id: 'taxRateDefaultStandard',
    name: 'Default Standard',
    value: 20,
    enabled: true,
    zone: zoneDefault,
    zoneId: zoneDefault.id,
    category: taxCategoryStandard,
    categoryId: taxCategoryStandard.id,
});
export const taxRateDefaultReduced = new TaxRate({
    id: 'taxRateDefaultReduced',
    name: 'Default Reduced',
    value: 10,
    enabled: true,
    zone: zoneDefault,
    zoneId: zoneDefault.id,
    category: taxCategoryReduced,
    categoryId: taxCategoryReduced.id,
});
export const taxRateDefaultZero = new TaxRate({
    id: 'taxRateDefaultZero',
    name: 'Default Zero Tax',
    value: 0,
    enabled: true,
    zone: zoneDefault,
    zoneId: zoneDefault.id,
    category: taxCategoryZero,
    categoryId: taxCategoryZero.id,
});
export const taxRateOtherStandard = new TaxRate({
    id: 'taxRateOtherStandard',
    name: 'Other Standard',
    value: 15,
    enabled: true,
    zone: zoneOther,
    zoneId: zoneOther.id,
    category: taxCategoryStandard,
    categoryId: taxCategoryStandard.id,
});
export const taxRateOtherReduced = new TaxRate({
    id: 'taxRateOtherReduced',
    name: 'Other Reduced',
    value: 5,
    enabled: true,
    zone: zoneOther,
    zoneId: zoneOther.id,
    category: taxCategoryReduced,
    categoryId: taxCategoryReduced.id,
});

export class MockTaxRateService {
    private activeTaxRates = [
        taxRateDefaultStandard,
        taxRateDefaultReduced,
        taxRateDefaultZero,
        taxRateOtherStandard,
        taxRateOtherReduced,
    ];

    initTaxRates() {
        /* noop */
    }

    async getApplicableTaxRate(
        ctx: RequestContext,
        zone: Zone | ID,
        taxCategory: TaxCategory | ID,
    ): Promise<TaxRate> {
        const rate = this.activeTaxRates.find(r => r.test(zone, taxCategory));
        return rate || taxRateDefaultStandard;
    }
}

export function createOrder(
    orderConfig: Partial<Omit<Order, 'lines' | 'surcharges'>> & {
        ctx: RequestContext;
        lines: Array<{
            listPrice: number;
            taxCategory: TaxCategory;
            quantity: number;
        }>;
        surcharges?: Surcharge[];
    },
): Order {
    const lines = orderConfig.lines.map(
        ({ listPrice, taxCategory, quantity }) =>
            new OrderLine({
                taxCategory,
                taxCategoryId: taxCategory.id,
                quantity,
                orderPlacedQuantity: 0,
                listPrice,
                listPriceIncludesTax: orderConfig.ctx.channel.pricesIncludeTax,
                taxLines: [],
                adjustments: [],
            }),
    );

    return new Order({
        couponCodes: [],
        lines,
        shippingLines: [],
        surcharges: orderConfig.surcharges || [],
        modifications: [],
    });
}
