import { Injectable } from '@nestjs/common';
import { ID, Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool } from '@vendure/mcp-sdk';

import { McpPluginToolHandler } from '../../../types';
import { idProp, objectSchema } from '../schema-helpers';
import { productSummary } from '../serializers';

interface GetProductInput {
    id: ID;
}

// Class name is deliberately distinct from the shop `GetProductTool` (`get_product` exists in both
// toolsets). Declared, not aliased, so stack traces and jump-to-symbol self-disambiguate.
@McpTool({
    name: 'get_product',
    toolset: 'admin',
    description: 'Get a product by id.',
    keywords: [
        'look up a product record',
        'view a product in the back office',
        'inspect a single product by id',
        'pull up product details as staff',
        'open a catalog item for editing',
        'fetch admin product info',
    ],
    permissions: [Permission.ReadProduct],
    behavior: 'readonly',
    inputSchema: objectSchema({ id: idProp('Product ID.') }),
})
@Injectable()
export class AdminGetProductTool implements McpPluginToolHandler<GetProductInput> {
    constructor(private productService: ProductService) {}

    async execute(ctx: RequestContext, input: GetProductInput) {
        return {
            product: productSummary(
                await this.productService.findOne(ctx, input.id, ['featuredAsset', 'assets']),
            ),
        };
    }
}
