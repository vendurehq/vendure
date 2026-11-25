import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ensureConfigLoaded } from '../../../config/config-helpers';
import { OrderItemPriceCalculationStrategy } from '../../../config/order/order-item-price-calculation-strategy';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { Order } from '../../../entity/order/order.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { createRequestContext } from '../../../testing/order-test-utils';

import { setOrderLinePrices } from './set-order-line-price';

describe('setOrderLinePrices()', () => {
    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    function entry(quantity: number) {
        const variant = new ProductVariant({ listPrice: 124, listPriceIncludesTax: false });
        return { line: new OrderLine({ quantity, adjustments: [], taxLines: [] }), variant };
    }

    // OSS-1507: an ERP prices the whole document in one request
    it('quotes every line it reprices in a single call', async () => {
        const calculateLinePrices = vi.fn((ctx, order, lines: Array<{ quantity: number }>) =>
            lines.map(({ quantity }) =>
                quantity === 20 ? { price: 2470, priceIncludesTax: false } : undefined,
            ),
        );
        const calculateUnitPrice = vi.fn(() => ({ price: 500, priceIncludesTax: false }));
        const strategy: OrderItemPriceCalculationStrategy = { calculateUnitPrice, calculateLinePrices };
        const entries = [entry(20), entry(3), entry(20)];

        await setOrderLinePrices(
            createRequestContext({ pricesIncludeTax: false }),
            strategy,
            new Order(),
            entries,
        );

        expect(calculateLinePrices).toHaveBeenCalledTimes(1);
        expect(calculateLinePrices.mock.calls[0][2]).toHaveLength(3);
        expect(entries.map(({ line }) => line.quotedLinePrice)).toEqual([2470, null, 2470]);
        expect(entries.map(({ line }) => line.listPrice)).toEqual([124, 500, 124]);
        expect(calculateUnitPrice).toHaveBeenCalledTimes(1);
    });

    it('rejects a result that does not have one entry per line', async () => {
        const strategy: OrderItemPriceCalculationStrategy = {
            calculateUnitPrice: () => ({ price: 500, priceIncludesTax: false }),
            calculateLinePrices: () => [{ price: 2470, priceIncludesTax: false }],
        };

        await expect(
            setOrderLinePrices(createRequestContext({ pricesIncludeTax: false }), strategy, new Order(), [
                entry(20),
                entry(3),
            ]),
        ).rejects.toThrow('one result, or undefined, for each line');
    });

    it('does not quote a fully cancelled line again', async () => {
        const calculateLinePrices = vi.fn(() => []);
        const strategy: OrderItemPriceCalculationStrategy = {
            calculateUnitPrice: () => ({ price: 500, priceIncludesTax: false }),
            calculateLinePrices,
        };
        const cancelled = entry(0);
        cancelled.line.quotedLinePrice = 2470;
        cancelled.line.quotedQuantity = 20;

        await setOrderLinePrices(createRequestContext({ pricesIncludeTax: false }), strategy, new Order(), [
            cancelled,
        ]);

        expect(calculateLinePrices).not.toHaveBeenCalled();
        expect(cancelled.line.quotedLinePrice).toBe(2470);
    });
});
