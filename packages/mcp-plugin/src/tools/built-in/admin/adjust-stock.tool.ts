import { Injectable } from '@nestjs/common';
import {
    idsAreEqual,
    Permission,
    ProductVariantService,
    RequestContext,
    StockLevelService,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

const adjustStockInput = z.strictObject({
    variantId: idSchema.describe('Product variant ID.'),
    locationId: idSchema.describe('Stock location ID.'),
    delta: z.number().describe('Amount to add (positive) or remove (negative) from stock on hand.'),
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
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: AdjustStockInput) {
        const levels = await this.stockLevelService.getStockLevelsForVariant(ctx, input.variantId);
        const current = levels.find(level => idsAreEqual(level.stockLocationId, input.locationId));
        await this.productVariantService.update(ctx, [
            {
                id: input.variantId,
                stockLevels: [
                    {
                        stockLocationId: input.locationId,
                        stockOnHand: (current?.stockOnHand ?? 0) + input.delta,
                    },
                ],
            },
        ]);
        const updated = await this.stockLevelService.getStockLevelsForVariant(ctx, input.variantId);
        return { stockLevels: updated.map(level => this.serializer.stockLevel(level)) };
    }
}
