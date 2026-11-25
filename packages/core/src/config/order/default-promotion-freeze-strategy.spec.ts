import { ModifyOrderInput } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { Order } from '../../entity/order/order.entity';
import { changesCouponCodes } from '../../service/helpers/utils/modify-order-changes';

import { DefaultPromotionFreezeStrategy } from './default-promotion-freeze-strategy';

describe('DefaultPromotionFreezeStrategy', () => {
    const ctx = {} as any;
    const order = { couponCodes: ['SUMMER'] } as Order;
    const strategy = new DefaultPromotionFreezeStrategy();

    function input(partial: Partial<ModifyOrderInput>): ModifyOrderInput {
        return { orderId: 'T_1', dryRun: false, ...partial };
    }

    it('freezes an address change', () => {
        expect(
            strategy.shouldFreezePromotions(ctx, order, input({ updateShippingAddress: { city: 'Leeds' } })),
        ).toBe(true);
    });

    it('freezes surcharges, notes and unchanged coupon codes', () => {
        expect(
            strategy.shouldFreezePromotions(
                ctx,
                order,
                input({
                    surcharges: [{ description: 'Gift wrap', price: 500, priceIncludesTax: true }],
                    note: 'Customer called',
                    couponCodes: ['summer'],
                }),
            ),
        ).toBe(true);
    });

    it('re-tests when items are added', () => {
        expect(
            strategy.shouldFreezePromotions(
                ctx,
                order,
                input({ addItems: [{ productVariantId: 'T_1', quantity: 1 }] }),
            ),
        ).toBe(false);
    });

    it('re-tests when OrderLines are adjusted', () => {
        expect(
            strategy.shouldFreezePromotions(
                ctx,
                order,
                input({ adjustOrderLines: [{ orderLineId: 'T_1', quantity: 3 }] }),
            ),
        ).toBe(false);
    });

    it('re-tests when shipping methods are selected', () => {
        expect(strategy.shouldFreezePromotions(ctx, order, input({ shippingMethodIds: ['T_2'] }))).toBe(
            false,
        );
        expect(
            strategy.shouldFreezePromotions(
                ctx,
                order,
                input({ shippingMethods: [{ shippingMethodId: 'T_2' }] as any }),
            ),
        ).toBe(false);
    });

    it('re-tests when the coupon codes change', () => {
        expect(
            strategy.shouldFreezePromotions(ctx, order, input({ couponCodes: ['SUMMER', 'WINTER'] })),
        ).toBe(false);
        expect(strategy.shouldFreezePromotions(ctx, order, input({ couponCodes: [] }))).toBe(false);
    });

    it('follows an explicit freezePromotions option', () => {
        expect(
            strategy.shouldFreezePromotions(
                ctx,
                order,
                input({ updateShippingAddress: { city: 'Leeds' }, options: { freezePromotions: false } }),
            ),
        ).toBe(false);
        expect(
            strategy.shouldFreezePromotions(
                ctx,
                order,
                input({
                    adjustOrderLines: [{ orderLineId: 'T_1', quantity: 3 }],
                    options: { freezePromotions: true },
                }),
            ),
        ).toBe(true);
    });
});

describe('changesCouponCodes()', () => {
    const order = { couponCodes: ['SUMMER', 'Gift'] };
    const input = (couponCodes?: string[]) => ({ orderId: 'T_1', dryRun: true, couponCodes }) as any;

    it('is false when no coupon codes are given', () => {
        expect(changesCouponCodes(order, input(undefined))).toBe(false);
    });

    it('ignores case and order', () => {
        expect(changesCouponCodes(order, input(['gift', 'summer']))).toBe(false);
    });

    it('detects an added or a removed code', () => {
        expect(changesCouponCodes(order, input(['SUMMER', 'GIFT', 'NEW']))).toBe(true);
        expect(changesCouponCodes(order, input(['SUMMER']))).toBe(true);
    });
});
