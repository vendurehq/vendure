import { Injectable } from '@nestjs/common';
import { Permission, Product, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpCatalogQueryService } from '../catalog-query.service';
import {
    booleanFilter,
    dateFilter,
    listOptions,
    page,
    paginationFields,
    stringFilter,
} from '../list-helpers';
import { McpToolSerializerService } from '../serializer.service';

const listProductsInput = z.strictObject({
    ...paginationFields('products'),
    filter: z
        .strictObject({
            name: stringFilter.optional(),
            slug: stringFilter.optional(),
            sku: stringFilter
                .describe(
                    "Matches any of the product's variant SKUs. The result lists products, not " +
                        'variants, so it does not show which variant matched.',
                )
                .optional(),
            enabled: booleanFilter.optional(),
            updatedAt: dateFilter.optional(),
        })
        .describe(
            'Conditions a product must meet; all of them apply together. Example: ' +
                '{"sku":{"contains":"L2201"}} finds the product a variant SKU belongs to.',
        )
        .optional(),
});

type ListProductsInput = z.infer<typeof listProductsInput>;

@McpTool({
    name: 'list_products',
    toolset: 'admin',
    description: "List and filter catalog products. Use get_product for a product's variant IDs.",
    keywords: [
        'show the whole catalog',
        'list every product',
        'browse all items we sell',
        'full product list',
        'see the inventory of products',
        'catalog listing for staff',
        'find product by sku',
    ],
    permissions: [Permission.ReadProduct],
    behavior: 'readonly',
    inputSchema: listProductsInput,
})
@Injectable()
export class ListProductsTool implements McpToolHandler<ListProductsInput> {
    constructor(
        private readonly productService: ProductService,
        private readonly catalog: McpCatalogQueryService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListProductsInput) {
        const result = await this.productService.findAll(ctx, listOptions<Product>(input), ['featuredAsset']);
        // Staff see the whole catalog, so the price range counts disabled variants too.
        const variantsByProduct = await this.catalog.variantsByProductId(
            ctx,
            result.items.map(product => product.id),
            { includeDisabled: true },
        );
        return page(
            result.items.map(product =>
                this.serializer.productListItem(product, variantsByProduct.get(String(product.id)) ?? []),
            ),
            result.totalItems,
            input,
        );
    }
}
