import { UserInputError } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { AddToCartTool } from './add-to-cart.tool';

/**
 * Any service the tool must not reach on this path. Touching it fails the test with a message
 * saying so, which is how "adds nothing" is proved without a database.
 */
const neverUsed = new Proxy(
    {},
    {
        get() {
            throw new Error('add_to_cart reached the cart instead of refusing');
        },
    },
) as any;

describe('AddToCartTool', () => {
    // The other four rows of the tool's input table are covered by the end-to-end suite, which
    // needs real products. A product with nothing purchasable cannot be built from the CSV
    // fixture, so it is covered here instead.
    it('refuses a productId for a product with no purchasable variants, without touching the cart', async () => {
        const productVariantService = {
            getVariantsByProductId: () => Promise.resolve({ items: [], totalItems: 0 }),
        } as any;
        const tool = new AddToCartTool(neverUsed, neverUsed, productVariantService, neverUsed);

        const error = await tool.execute({} as any, { productId: 7, quantity: 1 }).catch(e => e);

        // UserInputError specifically: its message reaches the caller unchanged, while other error
        // types are replaced with a generic one before the response leaves the server.
        expect(error).toBeInstanceOf(UserInputError);
        expect(error.message).toContain('Product 7 has no variants that can be bought.');
    });
});
