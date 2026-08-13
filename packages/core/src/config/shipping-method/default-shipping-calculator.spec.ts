import { ConfigArg } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';
import { ShippingMethod } from '../../entity/shipping-method/shipping-method.entity';
import { createRequestContext } from '../../testing/order-test-utils';

import { defaultShippingCalculator, TaxSetting } from './default-shipping-calculator';

/**
 * Unit tests for the `default-shipping-calculator`.
 *
 * The calculator echoes the configured `rate`/`taxRate` and resolves
 * `priceIncludesTax` from the `includesTax` argument. Test cases are derived by
 * equivalence partitioning over the three `TaxSetting` values, with the `auto`
 * partition split into its two sub-cases (channel prices include tax or not) to
 * cover both branches of `ctx.channel.pricesIncludeTax`.
 */

/** Build the serialized `ConfigArg[]` the way the framework passes them to `calculate()`. */
function buildArgs(input: { rate: number; includesTax: TaxSetting; taxRate: number }): ConfigArg[] {
    return [
        { name: 'rate', value: String(input.rate) },
        { name: 'includesTax', value: input.includesTax },
        { name: 'taxRate', value: String(input.taxRate) },
    ] as ConfigArg[];
}

function calculate(ctx: RequestContext, args: ConfigArg[]) {
    // The `order` and `method` arguments are unused by this calculator.
    return defaultShippingCalculator.calculate(
        ctx,
        undefined as unknown as Order,
        args,
        undefined as unknown as ShippingMethod,
    );
}

describe('defaultShippingCalculator', () => {
    it('echoes the configured rate and taxRate', () => {
        const ctx = createRequestContext({ pricesIncludeTax: false });
        const result = calculate(ctx, buildArgs({ rate: 500, includesTax: TaxSetting.exclude, taxRate: 20 }));

        expect(result.price).toBe(500);
        expect(result.taxRate).toBe(20);
    });

    describe('includesTax resolution (equivalence partitioning over TaxSetting)', () => {
        it('returns priceIncludesTax = true when includesTax is "include"', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const result = calculate(
                ctx,
                buildArgs({ rate: 500, includesTax: TaxSetting.include, taxRate: 0 }),
            );

            expect(result.priceIncludesTax).toBe(true);
        });

        it('returns priceIncludesTax = false when includesTax is "exclude"', () => {
            const ctx = createRequestContext({ pricesIncludeTax: true });
            const result = calculate(
                ctx,
                buildArgs({ rate: 500, includesTax: TaxSetting.exclude, taxRate: 0 }),
            );

            expect(result.priceIncludesTax).toBe(false);
        });

        it('follows the channel when includesTax is "auto" and channel prices include tax', () => {
            const ctx = createRequestContext({ pricesIncludeTax: true });
            const result = calculate(ctx, buildArgs({ rate: 500, includesTax: TaxSetting.auto, taxRate: 0 }));

            expect(result.priceIncludesTax).toBe(true);
        });

        it('follows the channel when includesTax is "auto" and channel prices exclude tax', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const result = calculate(ctx, buildArgs({ rate: 500, includesTax: TaxSetting.auto, taxRate: 0 }));

            expect(result.priceIncludesTax).toBe(false);
        });
    });
});
