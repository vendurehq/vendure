import { beforeAll, describe, expect, it } from 'vitest';

import { setConfig } from '../../config/config-helpers';
import { RoundPerUnitMoneyStrategy } from '../../config/entity/default-money-strategy';
import { productsPercentageDiscount } from '../../config/promotion/actions/product-percentage-discount-action';
import { createRequestContext } from '../../testing/order-test-utils';
import { OrderLine } from '../order-line/order-line.entity';
import { ProductVariant } from '../product-variant/product-variant.entity';

import { Promotion } from './promotion.entity';

describe('Promotion', () => {
    beforeAll(async () => {
        await setConfig({ entityOptions: { moneyStrategy: new RoundPerUnitMoneyStrategy() } });
    });

    async function discountQuotedLine(discount: number) {
        const promotion = new Promotion({
            id: 1,
            name: `${discount}% off`,
            actions: [
                {
                    code: productsPercentageDiscount.code,
                    args: [
                        { name: 'discount', value: String(discount) },
                        { name: 'productVariantIds', value: JSON.stringify([1]) },
                    ],
                },
            ],
            promotionActions: [productsPercentageDiscount],
        });
        const orderLine = new OrderLine({
            productVariant: new ProductVariant({ id: 1 }),
            quotedLinePrice: 2470,
            quotedQuantity: 20,
            quantity: 20,
            listPrice: 124,
            listPriceIncludesTax: true,
            taxLines: [],
            adjustments: [],
        });
        const ctx = createRequestContext({ pricesIncludeTax: true });
        return (await promotion.apply(ctx, { orderLine }))?.amount;
    }

    it('rounds an item discount on a quoted line on the line total', async () => {
        expect(await discountQuotedLine(100)).toBe(-2470);
        expect(await discountQuotedLine(10)).toBe(-247);
    });
});
