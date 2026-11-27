import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, StockLocationService } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { stockLocationFieldsSchema } from './stock-location-fields-schema';

const updateStockLocationInput = z.strictObject({
    id: idSchema.describe('Stock location ID.'),
    input: stockLocationFieldsSchema.partial(),
});

type UpdateStockLocationToolInput = z.infer<typeof updateStockLocationInput>;

@McpTool({
    name: 'update_stock_location',
    toolset: 'admin',
    description: 'Rename a stock location or change its description. Only the fields given change.',
    keywords: [
        'rename a warehouse',
        'edit a stock location',
        'change depot description',
        'update inventory location',
        'fix a warehouse name',
        'modify a stock location',
    ],
    permissions: [Permission.UpdateStockLocation],
    behavior: 'mutating',
    inputSchema: updateStockLocationInput,
})
@Injectable()
export class UpdateStockLocationTool implements McpToolHandler<UpdateStockLocationToolInput> {
    constructor(
        private readonly stockLocationService: StockLocationService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateStockLocationToolInput) {
        return {
            stockLocation: this.serializer.stockLocation(
                await this.stockLocationService.update(ctx, { ...input.input, id: input.id }),
            ),
        };
    }
}
