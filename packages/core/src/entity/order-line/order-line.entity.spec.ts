import { Adjustment, AdjustmentType } from '@vendure/common/lib/generated-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureConfigLoaded } from '../../config/config-helpers';

import { OrderLine } from './order-line.entity';

describe('OrderLine entity', () => {
    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    describe('discounts', () => {
        const promotionAdjustment: Adjustment = {
            adjustmentSource: 'PROMOTION:1',
            type: AdjustmentType.DISTRIBUTED_ORDER_PROMOTION,
            description: 'half price',
            amount: -500,
            data: {},
        };

        function createOrderLine(quantity: number, orderPlacedQuantity: number): OrderLine {
            return new OrderLine({
                quantity,
                orderPlacedQuantity,
                listPrice: 1000,
                listPriceIncludesTax: true,
                taxLines: [{ description: 'vat', taxRate: 20 }],
                adjustments: [promotionAdjustment],
            });
        }

        it('prorates the adjustment over the placed quantity', () => {
            const line = createOrderLine(2, 2);

            expect(line.discounts[0].amountWithTax).toBe(-500);
        });

        // #5097 — a line added by an OrderModification keeps an orderPlacedQuantity of 0, so
        // cancelling it left both quantities at 0 and the division produced NaN.
        it('is zero for a cancelled line which was added after the order was placed', () => {
            const line = createOrderLine(0, 0);

            expect(line.discounts[0].amount).toBe(0);
            expect(line.discounts[0].amountWithTax).toBe(0);
        });
    });
});
