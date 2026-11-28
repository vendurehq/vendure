import { Adjustment, AdjustmentType } from '@vendure/common/lib/generated-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureConfigLoaded } from '../../config/config-helpers';

import { ShippingLine } from './shipping-line.entity';

describe('ShippingLine entity', () => {
    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    function adjustment(amount: number): Adjustment {
        return {
            adjustmentSource: 'PROMOTION:1',
            type: AdjustmentType.PROMOTION,
            description: 'shipping promotion',
            amount,
            data: {},
        };
    }

    function createShippingLine(listPrice: number) {
        return new ShippingLine({ listPrice, listPriceIncludesTax: false, adjustments: [], taxLines: [] });
    }

    describe('addAdjustment', () => {
        it('caps a discount at the remaining shipping price', () => {
            const line = createShippingLine(500);
            line.addAdjustment(adjustment(-300));
            line.addAdjustment(adjustment(-300));
            line.addAdjustment(adjustment(-300));

            expect(line.adjustments.map(a => a.amount)).toEqual([-300, -200]);
            expect(line.discountedPrice).toBe(0);
        });

        it('does not change a positive adjustment', () => {
            const line = createShippingLine(500);
            line.addAdjustment(adjustment(200));

            expect(line.adjustments.map(a => a.amount)).toEqual([200]);
        });

        it('does not turn a discount into a surcharge when the shipping price is negative', () => {
            const line = createShippingLine(-100);
            line.addAdjustment(adjustment(-50));
            line.addAdjustment(adjustment(20));

            expect(line.adjustments.map(a => a.amount)).toEqual([20]);
        });
    });
});
