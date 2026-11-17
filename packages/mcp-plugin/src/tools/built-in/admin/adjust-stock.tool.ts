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
import {
    GRAPHQL_INT_MAX,
    GRAPHQL_INT_MIN,
    idSchema,
    int32Schema,
    McpTool,
    McpToolHandler,
} from '@vendure/mcp-sdk';
import { z } from 'zod';

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
    // UpdateStockLocation would be the wrong permission: it covers the StockLocation entity
    // itself, not the quantities held at a location, which this mutation actually changes.
    permissions: [Permission.UpdateProduct],
    behavior: 'destructive',
    inputSchema: adjustStockInput,
})
@Injectable()
export class AdjustStockTool implements McpToolHandler<AdjustStockInput> {
    constructor(
        private readonly productVariantService: ProductVariantService,
        private readonly stockLevelService: StockLevelService,
        private readonly stockLocationService: StockLocationService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: AdjustStockInput) {
        // The write sets an absolute stockOnHand, so the read must hold the row lock until the tool's
        // transaction commits. Otherwise a concurrent adjustment would be overwritten. See #5652
        // It comes before any other read: on MySQL and MariaDB the first plain read fixes the snapshot
        // which core's write later looks the row up in, so that snapshot must not predate the lock.
        let current = await this.findLockedStockLevel(ctx, input);
        // The locked stock read above and the write below are not limited to the active channel, so we
        // check the location here to avoid silently overwriting another channel's stock.
        const location = await this.stockLocationService.findOne(ctx, input.locationId);
        if (!location) {
            throw new UserInputError(
                `Stock location ${input.locationId} is not available in the active channel.`,
            );
        }
        if (!current) {
            // On Postgres a locked read which waited for another transaction does not return a row that
            // transaction inserted, so the first stock at a location would be read as 0. A second read
            // sees it. If there is still no row, core creates it with a stockOnHand of 0.
            current = await this.findLockedStockLevel(ctx, input);
        }
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

    private async findLockedStockLevel(ctx: RequestContext, input: AdjustStockInput) {
        const levels = await this.stockLevelService.getLockedStockLevelsForVariant(ctx, input.variantId);
        return levels.find(level => idsAreEqual(level.stockLocationId, input.locationId));
    }
}
