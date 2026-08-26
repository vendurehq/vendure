import { Injectable } from '@nestjs/common';
import {
    ID,
    OrderService,
    Permission,
    ProductVariantService,
    RequestContext,
    UserInputError,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';
import { idSchema } from '../id-schema';
import { int32Schema } from '../int32-schema';
import { McpToolSerializerService } from '../serializer.service';

const addToCartInput = z.strictObject({
    variantId: idSchema
        .describe(
            'Product variant ID, taken from the variants listed by get_product. Give this or productId, not both.',
        )
        .optional(),
    productId: idSchema
        .describe(
            'Product ID, as returned by search_products or get_product. Never pass a variant ID here. ' +
                'Use this only when the product has a single variant; if it has several, the call is ' +
                'refused and the variants are listed so you can pass one as variantId instead.',
        )
        .optional(),
    quantity: int32Schema.min(1).describe('Quantity, a whole number of at least 1.'),
});

type AddToCartInput = z.infer<typeof addToCartInput>;

@McpTool({
    name: 'add_to_cart',
    toolset: 'shop',
    description:
        'Add a product variant to the active cart. Pass exactly one of variantId or productId. ' +
        'Product IDs and variant IDs are different things and are not interchangeable.',
    keywords: [
        'put in my basket',
        'I want to buy this',
        'add this item to my bag',
        'grab this product',
        'start an order with this',
        'put this in my shopping bag',
    ],
    permissions: [Permission.Public],
    behavior: 'mutating',
    usesActiveOrder: true,
    inputSchema: addToCartInput,
})
@Injectable()
export class AddToCartTool implements McpToolHandler<AddToCartInput> {
    constructor(
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
        private productVariantService: ProductVariantService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: AddToCartInput) {
        // Product IDs and variant IDs come from separate counting sequences that overlap, so a
        // product ID passed as a variant ID usually finds a real but unrelated variant: the wrong
        // item is added and nothing looks wrong. Making the caller say which kind of ID it is
        // holding is what stops that.
        //
        // These refusals are thrown rather than returned. Anything this method returns is treated
        // as a success, so throwing is the only way to report a failure. UserInputError is one of
        // the few error types whose message reaches the caller unchanged; other types are replaced
        // with a generic message before the response leaves the server.
        const exactlyOneIdMessage = 'Pass exactly one of variantId or productId.';
        if (input.variantId != null && input.productId != null) {
            throw new UserInputError(exactlyOneIdMessage);
        }

        let variantId: ID;
        if (input.productId != null) {
            const variants = await this.productVariantService.getVariantsByProductId(
                ctx,
                input.productId,
                {},
                [],
            );
            if (variants.items.length === 0) {
                throw new UserInputError(
                    `Product ${String(input.productId)} has no variants that can be bought.`,
                );
            }
            if (variants.items.length > 1) {
                throw new UserInputError(
                    // totalItems, not items.length: the lookup is capped at the store's shop list
                    // limit, so a product with more variants than that would otherwise be reported
                    // as having exactly the cap.
                    `Product ${String(input.productId)} has ${variants.totalItems} variants. ` +
                        'Nothing was added. Call add_to_cart again with one of these as variantId: ' +
                        variants.items
                            .map(variant => `${String(variant.id)} (${variant.name}, ${variant.sku})`)
                            .join('; '),
                );
            }
            variantId = variants.items[0].id;
        } else if (input.variantId != null) {
            variantId = input.variantId;
        } else {
            throw new UserInputError(exactlyOneIdMessage);
        }

        const order = await this.activeOrder.findOrCreate(ctx);
        return this.serializer.orderOrError(
            await this.orderService.addItemToOrder(order.ctx, order.id, variantId, input.quantity),
        );
    }
}
