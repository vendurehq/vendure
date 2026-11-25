import { Adjustment, AdjustmentType } from '@vendure/common/lib/generated-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureConfigLoaded } from '../../config/config-helpers';
import { getLineRefundAmount } from '../../service/helpers/utils/get-line-refund-amount';

import { OrderLine } from './order-line.entity';

describe('OrderLine entity', () => {
    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    const distributedOrderPromotionAdjustment: Adjustment = {
        adjustmentSource: 'PROMOTION:1',
        type: AdjustmentType.DISTRIBUTED_ORDER_PROMOTION,
        description: 'half price',
        amount: -500,
        data: {},
    };

    const itemPromotionAdjustment: Adjustment = {
        adjustmentSource: 'PROMOTION:2',
        type: AdjustmentType.PROMOTION,
        description: '40% off',
        amount: -400,
        data: {},
    };

    it('keeps a cent-denominated quote when the unit price is between cents', () => {
        const line = new OrderLine({
            quotedLinePrice: 2470,
            quotedQuantity: 20,
            quantity: 20,
            listPrice: 124,
            listPriceIncludesTax: true,
            taxLines: [],
            adjustments: [],
        });
        expect(line.unitPriceWithTax).toBe(124);
        expect(line.linePriceWithTax).toBe(2470);
    });

    it('refunds the difference between the paid and retained quantities at a rounding tie', () => {
        const line = new OrderLine({
            quotedLinePrice: 19190,
            cancellationLines: [{ quantity: 1, price: 959, priceWithTax: 959, createdAt: new Date(0) }],
            quotedQuantity: 20,
            quantity: 20,
            listPrice: 960,
            listPriceIncludesTax: true,
            taxLines: [],
            adjustments: [],
        });
        line.setQuantityRescalingAdjustments(19);
        expect(line.linePriceWithTax).toBe(18231);
        expect(getLineRefundAmount(line, 1, 0)).toBe(959);
        expect(getLineRefundAmount(line, 19, 1)).toBe(18231);
    });

    it('applies tax and discounts to the remaining quoted units', () => {
        const line = new OrderLine({
            quotedLinePrice: 19190,
            quotedQuantity: 20,
            quantity: 20,
            orderPlacedQuantity: 20,
            listPrice: 960,
            listPriceIncludesTax: false,
            taxLines: [{ description: 'VAT', taxRate: 20 }],
            adjustments: [{ ...itemPromotionAdjustment, amount: -1919 }],
        });
        expect(line.linePriceWithTax).toBe(23028);
        expect(line.discountedLinePrice).toBe(17271);
        expect(line.proratedLinePriceWithTax).toBe(20725);
        expect(line.getRefundPriceParts()).toEqual([{ priceWithTax: 20725, quantity: 20 }]);
        line.setQuantityRescalingAdjustments(7);
        line.setQuantityRescalingAdjustments(0);
        expect(line.proratedLinePriceWithTax).toBe(0);
        expect(line.getRefundPriceParts()).toEqual([]);
    });

    it('does not report a negative total when a full quoted discount is rescaled', () => {
        const line = new OrderLine({
            quotedLinePrice: 101,
            quotedQuantity: 20,
            quantity: 20,
            listPrice: 5,
            listPriceIncludesTax: false,
            taxLines: [{ description: 'VAT', taxRate: 20 }],
            adjustments: [{ ...itemPromotionAdjustment, amount: -101 }],
        });
        line.setQuantityRescalingAdjustments(11);
        expect(line.discountedLinePrice).toBe(0);
        expect(line.discountedLinePriceWithTax).toBe(0);
    });

    describe('discounts', () => {
        function createOrderLine(
            quantity: number,
            orderPlacedQuantity: number,
            adjustments: Adjustment[] = [distributedOrderPromotionAdjustment],
        ): OrderLine {
            return new OrderLine({
                quantity,
                orderPlacedQuantity,
                listPrice: 1000,
                listPriceIncludesTax: true,
                taxLines: [{ description: 'vat', taxRate: 20 }],
                adjustments,
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

        // #5127 — a PROMOTION adjustment's stored amount is already scaled to the current
        // quantity, unlike DISTRIBUTED_ORDER_PROMOTION, so it must not be divided again by
        // orderPlacedQuantity.
        it('does not re-divide a PROMOTION adjustment by orderPlacedQuantity', () => {
            const line = createOrderLine(2, 20, [itemPromotionAdjustment]);

            expect(line.discounts[0].amountWithTax).toBe(-400);
        });

        it('applies each adjustment type on its own basis when both are present', () => {
            const line = createOrderLine(2, 20, [
                distributedOrderPromotionAdjustment,
                itemPromotionAdjustment,
            ]);

            const distributed = line.discounts.find(d => d.adjustmentSource === 'PROMOTION:1');
            const item = line.discounts.find(d => d.adjustmentSource === 'PROMOTION:2');
            expect(distributed?.amountWithTax).toBe(-50);
            expect(item?.amountWithTax).toBe(-400);
        });

        it('is zero, not NaN, for a PROMOTION adjustment on a fully-cancelled line', () => {
            const line = createOrderLine(0, 20, [itemPromotionAdjustment]);

            expect(line.discounts[0].amount).toBe(0);
            expect(line.discounts[0].amountWithTax).toBe(0);
        });
    });

    describe('setQuantityRescalingAdjustments()', () => {
        function createOrderLine(quantity: number, adjustments: Adjustment[]): OrderLine {
            return new OrderLine({
                quantity,
                orderPlacedQuantity: quantity,
                listPrice: 2975,
                listPriceIncludesTax: true,
                taxLines: [{ description: 'vat', taxRate: 20 }],
                adjustments,
            });
        }

        it('scales PROMOTION adjustments to the new quantity', () => {
            const line = createOrderLine(20, [
                { ...itemPromotionAdjustment, amount: -29750 },
                { ...distributedOrderPromotionAdjustment, amount: -500 },
            ]);

            line.setQuantityRescalingAdjustments(2);

            expect(line.quantity).toBe(2);
            expect(line.adjustments.find(a => a.type === AdjustmentType.PROMOTION)?.amount).toBe(-2975);
            expect(
                line.adjustments.find(a => a.type === AdjustmentType.DISTRIBUTED_ORDER_PROMOTION)?.amount,
            ).toBe(-500);
        });

        // A fully cancelled line reads as zero-discount either way, so zeroing the stored amounts
        // would only destroy the record of the discount that had applied.
        it('leaves the adjustments intact when the line is fully cancelled', () => {
            const line = createOrderLine(20, [{ ...itemPromotionAdjustment, amount: -29750 }]);

            line.setQuantityRescalingAdjustments(0);

            expect(line.quantity).toBe(0);
            expect(line.adjustments[0].amount).toBe(-29750);
        });
    });

    // OSS-1507: absolute tax amounts from a TaxLineCalculationStrategy
    describe('absolute tax amounts', () => {
        function lineWithTaxAmount(listPriceIncludesTax: boolean) {
            return new OrderLine({
                quantity: 3,
                orderPlacedQuantity: 3,
                listPrice: listPriceIncludesTax ? 1200 : 1000,
                listPriceIncludesTax,
                // The rate alone would give 600 (net) or 600 (gross) of tax.
                taxLines: [
                    {
                        description: 'VAT',
                        taxRate: 20,
                        amount: listPriceIncludesTax ? 599 : 605,
                        taxBase: 3600 - (listPriceIncludesTax ? 0 : 600),
                    } as any,
                ],
                adjustments: [],
            });
        }

        it('adds the amount to a net line total instead of deriving the tax from the rate', () => {
            const line = lineWithTaxAmount(false);
            expect(line.proratedLinePrice).toBe(3000);
            expect(line.proratedLinePriceWithTax).toBe(3605);
            expect(line.proratedLineTax).toBe(605);
            expect(line.linePriceWithTax).toBe(3605);
            expect(line.unitPriceWithTax).toBe(1202);
            expect(line.taxRate).toBe(20);
        });

        it('subtracts the amount from a gross line total', () => {
            const line = lineWithTaxAmount(true);
            expect(line.proratedLinePriceWithTax).toBe(3600);
            expect(line.proratedLinePrice).toBe(3001);
            expect(line.proratedLineTax).toBe(599);
        });

        it('gives the remaining units their share of the amount after a partial cancellation', () => {
            const line = lineWithTaxAmount(false);
            line.setQuantityRescalingAdjustments(2);
            expect(line.proratedLinePrice).toBe(2000);
            // 605 * 2000 / 3000 = 403.33
            expect(line.proratedLineTax).toBe(403);
        });

        it('converts discounts with the share of the amount', () => {
            const line = lineWithTaxAmount(false);
            line.adjustments = [{ ...itemPromotionAdjustment, amount: -300 }];
            expect(line.discounts[0].amount).toBe(-300);
            // -300 * (1 + 605 / 3000) = -360.5
            expect(line.discounts[0].amountWithTax).toBe(-360);
        });

        it('rewrites the stored amount for the remaining units after a partial cancellation', () => {
            const line = lineWithTaxAmount(false);
            line.setQuantityRescalingAdjustments(2);
            expect(line.taxLines[0]).toMatchObject({ amount: 403, taxBase: 2000 });
            expect(line.proratedLineTax).toBe(403);
        });

        it('refunds units of a line with a tax amount so that the refunds add up to what was paid', () => {
            // 3 units at 1,299.00 net with 779.41 tax cost 4,676.41, but 3 × the unit price with
            // tax of 1,558.80 is 4,676.40.
            const line = new OrderLine({
                quantity: 3,
                orderPlacedQuantity: 3,
                listPrice: 129900,
                listPriceIncludesTax: false,
                taxLines: [{ description: 'VAT', taxRate: 20, amount: 77941, taxBase: 389700 } as any],
                adjustments: [],
                cancellationLines: [],
            });
            expect(line.proratedLinePriceWithTax).toBe(467641);
            const refunds = [0, 1, 2].map(refunded => getLineRefundAmount(line, 1, refunded));
            expect(refunds.reduce((sum, refund) => sum + refund, 0)).toBe(467641);
        });

        // An `amount` key stored by a custom strategy before v3.9 has no `taxBase`.
        it('derives the tax from the rate when an amount has no recorded taxable total', () => {
            const line = new OrderLine({
                quantity: 1,
                listPrice: 398975,
                listPriceIncludesTax: false,
                taxLines: [{ description: 'VAT', taxRate: 5, amount: 19950 }],
                adjustments: [],
            });
            expect(line.proratedLineTax).toBe(19949);
        });

        it('derives the tax from the rate when the tax lines have no amount', () => {
            const line = new OrderLine({
                quantity: 3,
                listPrice: 1000,
                listPriceIncludesTax: false,
                taxLines: [{ description: 'VAT', taxRate: 20 }],
                adjustments: [],
            });
            expect(line.proratedLinePriceWithTax).toBe(3600);
        });
    });
});
