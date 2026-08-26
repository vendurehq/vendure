import { Injectable } from '@nestjs/common';
import {
    idsAreEqual,
    Permission,
    ProductVariantService,
    RequestContext,
    StockLevelService,
    StockLocationService,
    UserInputError,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { GRAPHQL_INT_MAX, GRAPHQL_INT_MIN, int32Schema } from '../int32-schema';
import { McpToolSerializerService } from '../serializer.service';

const adjustStockInput = z.strictObject({
    variantId: idSchema.describe('Product variant ID.'),
    locationId: idSchema.describe('Stock location ID.'),
    delta: int32Schema.describe('Amount to add (positive) or remove (negative) from stock on hand.'),
});

type AdjustStockInput = z.infer<typeof adjustStockInput>;

@McpTool({
    name: 'adjust_stock',
    toolset: 'admin',
    description: 'Adjust stock on hand for a variant and stock location.',
    keywords: [
        'restock this item',
        'update the inventory count',
        'add or remove stock',
        'correct the stock level',
        'increase stock on hand',
        'fix inventory quantity',
    ],
    // Stock is adjusted through the core updateProductVariants mutation, which requires
    // UpdateCatalog/UpdateProduct. UpdateStockLocation would be the wrong permission here: it
    // covers the StockLocation entity itself, not the quantities held at a location.
    permissions: [Permission.UpdateProduct],
    behavior: 'destructive',
    inputSchema: adjustStockInput,
})
@Injectable()
export class AdjustStockTool implements McpToolHandler<AdjustStockInput> {
    constructor(
        private productVariantService: ProductVariantService,
        private stockLevelService: StockLevelService,
        private stockLocationService: StockLocationService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: AdjustStockInput) {
        // The stock level read below only sees locations in the active channel, but core's write path
        // sees every location. Without this check a location from another channel reads as no stock at
        // all, and the delta would be written as the whole new quantity, replacing the stock held there.
        const location = await this.stockLocationService.findOne(ctx, input.locationId);
        if (!location) {
            throw new UserInputError(
                `Stock location ${input.locationId} is not available in the active channel.`,
            );
        }
        const levels = await this.stockLevelService.getStockLevelsForVariant(ctx, input.variantId);
        const current = levels.find(level => idsAreEqual(level.stockLocationId, input.locationId));
        const stockOnHand = (current?.stockOnHand ?? 0) + input.delta;
        if (stockOnHand < GRAPHQL_INT_MIN || stockOnHand > GRAPHQL_INT_MAX) {
            throw new UserInputError(
                `A delta of ${input.delta} would set stock on hand to ${stockOnHand}, outside ` +
                    `${GRAPHQL_INT_MIN} to ${GRAPHQL_INT_MAX}.`,
            );
        }
        await this.productVariantService.update(ctx, [
            {
                id: input.variantId,
                stockLevels: [
                    {
                        stockLocationId: input.locationId,
                        stockOnHand,
                    },
                ],
            },
        ]);
        const updated = await this.stockLevelService.getStockLevelsForVariant(ctx, input.variantId);
        return { stockLevels: updated.map(level => this.serializer.stockLevel(level)) };
    }
}
