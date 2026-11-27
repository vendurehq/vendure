import { describe, expect, it } from 'vitest';

import { ShippingLine } from '../../../entity/shipping-line/shipping-line.entity';

import { shippingSelectionsKept } from './shipping-calculator';

describe('shippingSelectionsKept()', () => {
    const pricedLine = (id: string, shippingMethodId: string, shippingOptionCode: string | null = null) =>
        new ShippingLine({ id, shippingMethodId, shippingOptionCode });

    it('is true when each ShippingLine still holds its selection', () => {
        expect(
            shippingSelectionsKept(
                [{ shippingMethodId: 'A', shippingOptionCode: 'express' }],
                [{ id: 'SL1', hasOrderLines: true }],
                [pricedLine('SL1', 'A', 'express')],
            ),
        ).toBe(true);
    });

    it('is false when the ShippingLine fell back to another option', () => {
        expect(
            shippingSelectionsKept(
                [{ shippingMethodId: 'A', shippingOptionCode: 'express' }],
                [{ id: 'SL1', hasOrderLines: true }],
                [pricedLine('SL1', 'A', 'economy')],
            ),
        ).toBe(false);
    });

    // A repeated ShippingMethod must be matched by its own ShippingLine, not by any line with that method
    it('is false when one of two lines with the same ShippingMethod fell back to another method', () => {
        expect(
            shippingSelectionsKept(
                [{ shippingMethodId: 'A' }, { shippingMethodId: 'A' }],
                [
                    { id: 'SL1', hasOrderLines: true },
                    { id: 'SL2', hasOrderLines: true },
                ],
                [pricedLine('SL1', 'A'), pricedLine('SL2', 'B')],
            ),
        ).toBe(false);
    });

    it('is false when a ShippingLine with OrderLines was removed', () => {
        expect(
            shippingSelectionsKept([{ shippingMethodId: 'A' }], [{ id: 'SL1', hasOrderLines: true }], []),
        ).toBe(false);
    });

    it('ignores a ShippingLine without OrderLines, which the recalculation removes', () => {
        expect(
            shippingSelectionsKept(
                [{ shippingMethodId: 'A' }, { shippingMethodId: 'B' }],
                [
                    { id: 'SL1', hasOrderLines: true },
                    { id: 'SL2', hasOrderLines: false },
                ],
                [pricedLine('SL1', 'A')],
            ),
        ).toBe(true);
    });
});
