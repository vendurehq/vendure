import { Injectable } from '@nestjs/common';
import {
    ID,
    idsAreEqual,
    Permission,
    ProductVariantService,
    RequestContext,
    StockLevelService,
} from '@vendure/core';
import { McpTool } from '@vendure/mcp-sdk';

import { McpPluginToolHandler } from '../../../types';
import { idProp, numberProp, objectSchema } from '../schema-helpers';

interface AdjustStockInput {
    variantId: ID;
    locationId: ID;
    delta: number;
}

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
    // Parity fix: stock is adjusted via the core updateProductVariants mutation, gated by
    // UpdateCatalog/UpdateProduct — UpdateStockLocation governs the StockLocation entity, not quantities.
    permissions: [Permission.UpdateProduct],
    behavior: 'destructive',
    inputSchema: objectSchema({
        variantId: idProp('Product variant ID.'),
        locationId: idProp('Stock location ID.'),
        delta: numberProp('Amount to add (positive) or remove (negative) from stock on hand.'),
    }),
})
@Injectable()
export class AdjustStockTool implements McpPluginToolHandler<AdjustStockInput> {
    constructor(
        private productVariantService: ProductVariantService,
        private stockLevelService: StockLevelService,
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
        return {
            stockLevels: await this.stockLevelService.getStockLevelsForVariant(ctx, input.variantId),
        };
    }
}
