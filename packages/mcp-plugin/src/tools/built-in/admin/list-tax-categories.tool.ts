import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, TaxCategory, TaxCategoryService } from '@vendure/core';
import { listOptions, McpTool, McpToolHandler, page, paginationFields } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const listTaxCategoriesInput = z.strictObject({
    ...paginationFields('tax categories'),
});

type ListTaxCategoriesInput = z.infer<typeof listTaxCategoriesInput>;

@McpTool({
    name: 'list_tax_categories',
    toolset: 'admin',
    description: 'List tax categories, such as "Standard" or "Reduced". Each product variant belongs to one.',
    keywords: [
        'what tax classes exist',
        'show VAT categories',
        'reduced rate category',
        'which tax category is the default',
        'list product tax types',
        'see tax categories',
    ],
    permissions: [Permission.ReadSettings, Permission.ReadTaxCategory],
    behavior: 'readonly',
    inputSchema: listTaxCategoriesInput,
})
@Injectable()
export class ListTaxCategoriesTool implements McpToolHandler<ListTaxCategoriesInput> {
    constructor(
        private readonly taxCategoryService: TaxCategoryService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListTaxCategoriesInput) {
        const result = await this.taxCategoryService.findAll(ctx, listOptions<TaxCategory>(input));
        return page(
            result.items.map(category => this.serializer.taxCategory(category)),
            result.totalItems,
            input,
        );
    }
}
