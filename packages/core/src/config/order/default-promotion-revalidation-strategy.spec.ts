import { ModifyOrderInput } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { Order } from '../../entity/order/order.entity';

import { DefaultPromotionRevalidationStrategy } from './default-promotion-revalidation-strategy';

describe('DefaultPromotionRevalidationStrategy', () => {
    const ctx = {} as any;
    const order = {} as Order;
    const strategy = new DefaultPromotionRevalidationStrategy();

    function inputWith(options: ModifyOrderInput['options']): ModifyOrderInput {
        return { orderId: 'T_1', dryRun: false, options } as ModifyOrderInput;
    }

    it('re-validates when the input has no options', () => {
        expect(strategy.shouldRevalidatePromotions(ctx, order, inputWith(undefined))).toBe(true);
    });

    it('re-validates when freezePromotions is false', () => {
        expect(strategy.shouldRevalidatePromotions(ctx, order, inputWith({ freezePromotions: false }))).toBe(
            true,
        );
    });

    it('does not re-validate when freezePromotions is true', () => {
        expect(strategy.shouldRevalidatePromotions(ctx, order, inputWith({ freezePromotions: true }))).toBe(
            false,
        );
    });
});
