import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, StockLocationService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { stockLocationFieldsSchema } from './stock-location-fields-schema';

const createStockLocationInput = z.strictObject({ input: stockLocationFieldsSchema });

type CreateStockLocationToolInput = z.infer<typeof createStockLocationInput>;

@McpTool({
    name: 'create_stock_location',
    toolset: 'admin',
    description: 'Create a stock location, such as a warehouse, in the active channel.',
    keywords: [
        'add a warehouse',
        'new inventory location',
        'open a second depot',
        'create a stock location',
        'add a fulfillment centre',
        'track stock in another place',
    ],
    permissions: [Permission.CreateStockLocation],
    behavior: 'mutating',
    inputSchema: createStockLocationInput,
})
@Injectable()
export class CreateStockLocationTool implements McpToolHandler<CreateStockLocationToolInput> {
    constructor(
        private readonly stockLocationService: StockLocationService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateStockLocationToolInput) {
        return {
            stockLocation: this.serializer.stockLocation(
                await this.stockLocationService.create(ctx, input.input),
            ),
        };
    }
}
