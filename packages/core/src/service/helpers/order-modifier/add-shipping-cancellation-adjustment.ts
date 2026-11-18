import { AdjustmentType } from '@vendure/common/lib/generated-types';

import { ShippingLine } from '../../../entity/shipping-line/shipping-line.entity';

/**
 * Adds the adjustment which cancels the price of a ShippingLine, as `cancelOrder` does when
 * `cancelShipping` is set.
 */
export function addShippingCancellationAdjustment(shippingLine: ShippingLine) {
    shippingLine.adjustments.push({
        adjustmentSource: 'CANCEL_ORDER',
        type: AdjustmentType.OTHER,
        description: 'shipping cancellation',
        amount: shippingLine.listPriceIncludesTax
            ? -shippingLine.discountedPriceWithTax
            : -shippingLine.discountedPrice,
        data: {},
    });
}
