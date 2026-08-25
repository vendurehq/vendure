import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, StockLevelService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

const getStockLevelsInput = z.strictObject({
    variantId: idSchema.describe('Product variant ID.'),
});

type GetStockLevelsInput = z.infer<typeof getStockLevelsInput>;

@McpTool({
    name: 'get_stock_levels',
    toolset: 'admin',
    description: 'Get stock levels for a product variant.',
    keywords: [
        'check inventory',
        'how many are in stock',
        'current stock count',
        'available quantity on hand',
        'stock level for an item',
        'is this in stock',
    ],
    permissions: [Permission.ReadProduct],
    behavior: 'readonly',
    inputSchema: getStockLevelsInput,
})
@Injectable()
export class GetStockLevelsTool implements McpToolHandler<GetStockLevelsInput> {
    constructor(
        private stockLevelService: StockLevelService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: GetStockLevelsInput) {
        const levels = await this.stockLevelService.getStockLevelsForVariant(ctx, input.variantId);
        return { stockLevels: levels.map(level => this.serializer.stockLevel(level)) };
    }
}
