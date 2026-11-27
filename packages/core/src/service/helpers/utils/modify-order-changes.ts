import { ModifyOrderInput } from '@vendure/common/lib/generated-types';

import { Order } from '../../../entity/order/order.entity';

import { couponCodesMatch } from './coupon-codes-match';

/**
 * Whether a modification changes the OrderLines, the coupon codes or the shipping methods. The
 * `couponCodes` of the input is the complete new list, and clients usually send it even when it
 * is unchanged, so it only counts when it differs from the Order's.
 */
export function changesLinesCouponsOrShipping(order: Order, input: ModifyOrderInput): boolean {
    return (
        !!input.addItems?.length ||
        !!input.adjustOrderLines?.length ||
        !!input.shippingMethodIds?.length ||
        !!input.shippingMethods?.length ||
        changesCouponCodes(order, input)
    );
}

/**
 * Whether the `couponCodes` of a modification differ from the Order's current coupon codes,
 * compared case-insensitively and regardless of order.
 */
export function changesCouponCodes(order: Pick<Order, 'couponCodes'>, input: ModifyOrderInput): boolean {
    if (input.couponCodes == null) {
        return false;
    }
    const current = order.couponCodes ?? [];
    const next = input.couponCodes;
    return (
        next.some(code => !current.some(existing => couponCodesMatch(existing, code))) ||
        current.some(existing => !next.some(code => couponCodesMatch(existing, code)))
    );
}
