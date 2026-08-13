import { Injectable } from '@nestjs/common';
import { Permission, Product, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { listOptions, page, paginationFields } from '../list-helpers';
import { McpToolSerializerService } from '../serializer.service';

const listProductsInput = z.strictObject({
    ...paginationFields('products'),
});

type ListProductsInput = z.infer<typeof listProductsInput>;

@McpTool({
    name: 'list_products',
    toolset: 'admin',
    description: 'List the products in the catalog, with pagination.',
    keywords: [
        'show the whole catalog',
        'list every product',
        'browse all items we sell',
        'full product list',
        'see the inventory of products',
        'catalog listing for staff',
    ],
    permissions: [Permission.ReadProduct],
    behavior: 'readonly',
    inputSchema: listProductsInput,
})
@Injectable()
export class ListProductsTool implements McpToolHandler<ListProductsInput> {
    constructor(
        private productService: ProductService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListProductsInput) {
        const result = await this.productService.findAll(ctx, listOptions<Product>(input), ['featuredAsset']);
        return page(
            result.items.map(product => this.serializer.product(product)),
            result.totalItems,
            input,
        );
    }
}
