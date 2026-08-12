import { Injectable } from '@nestjs/common';
import { Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const getProductInput = z.strictObject({
    id: z.union([z.string(), z.number()]).describe('Product ID.'),
});

type GetProductInput = z.infer<typeof getProductInput>;

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
    inputSchema: getProductInput,
})
@Injectable()
export class AdminGetProductTool implements McpToolHandler<GetProductInput> {
    constructor(
        private productService: ProductService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: GetProductInput) {
        return {
            product: this.serializer.product(
                await this.productService.findOne(ctx, input.id, ['featuredAsset', 'assets']),
            ),
        };
    }
}
