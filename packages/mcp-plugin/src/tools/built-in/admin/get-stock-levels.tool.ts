import { Injectable } from '@nestjs/common';
import { ID, Permission, RequestContext, StockLevelService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { idProp, objectSchema } from '../schema-helpers';

interface GetStockLevelsInput {
    variantId: ID;
}

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
    inputSchema: objectSchema({ variantId: idProp('Product variant ID.') }),
})
@Injectable()
export class GetStockLevelsTool implements McpToolHandler<GetStockLevelsInput> {
    constructor(private stockLevelService: StockLevelService) {}

    async execute(ctx: RequestContext, input: GetStockLevelsInput) {
        return {
            stockLevels: await this.stockLevelService.getStockLevelsForVariant(ctx, input.variantId),
        };
    }
}
