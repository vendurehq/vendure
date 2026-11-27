import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, StockLocation, StockLocationService } from '@vendure/core';
import { listOptions, McpTool, McpToolHandler, page, paginationFields } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const listStockLocationsInput = z.strictObject({
    ...paginationFields('stock locations'),
});

type ListStockLocationsInput = z.infer<typeof listStockLocationsInput>;

@McpTool({
    name: 'list_stock_locations',
    toolset: 'admin',
    description:
        'List the stock locations of the active channel. Their IDs are what adjust_stock and get_stock_levels refer to.',
    keywords: [
        'where is stock kept',
        'show warehouses',
        'list inventory locations',
        'which depots do we have',
        'see stock locations',
        'fulfillment centres',
    ],
    permissions: [Permission.ReadCatalog, Permission.ReadStockLocation],
    behavior: 'readonly',
    inputSchema: listStockLocationsInput,
})
@Injectable()
export class ListStockLocationsTool implements McpToolHandler<ListStockLocationsInput> {
    constructor(
        private readonly stockLocationService: StockLocationService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListStockLocationsInput) {
        const result = await this.stockLocationService.findAll(ctx, listOptions<StockLocation>(input));
        return page(
            result.items.map(location => this.serializer.stockLocation(location)),
            result.totalItems,
            input,
        );
    }
}
