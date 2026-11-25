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

    async function discountQuotedLine(
        discount: number,
        quote: { price: number; quantity: number; taxRate: number; pricesIncludeTax: boolean },
    ) {
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
            quotedLinePrice: quote.price,
            quotedQuantity: quote.quantity,
            quantity: quote.quantity,
            listPrice: Math.round(quote.price / quote.quantity),
            listPriceIncludesTax: true,
            taxLines: [{ description: 'VAT', taxRate: quote.taxRate }],
            adjustments: [],
        });
        const ctx = createRequestContext({ pricesIncludeTax: quote.pricesIncludeTax });
        const adjustment = await promotion.apply(ctx, { orderLine });
        return orderLine.getAdjustmentAmount(adjustment?.amount ?? 0, quote.pricesIncludeTax);
    }

    it('rounds an item discount on a quoted line on the line total', async () => {
        const quote = { price: 2470, quantity: 20, taxRate: 0, pricesIncludeTax: true };
        expect(await discountQuotedLine(100, quote)).toBe(-2470);
        expect(await discountQuotedLine(10, quote)).toBe(-247);
    });

    it('rounds an item discount on a quoted line after the tax basis conversion', async () => {
        const quote = { price: 99, quantity: 1, taxRate: 20, pricesIncludeTax: false };
        expect(await discountQuotedLine(100, quote)).toBe(-99);
    });
});
