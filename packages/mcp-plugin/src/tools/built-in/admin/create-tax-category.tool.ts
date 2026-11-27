import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, TaxCategoryService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { taxCategoryFieldsSchema } from './tax-category-fields-schema';

const createTaxCategoryInput = z.strictObject({ input: taxCategoryFieldsSchema });

type CreateTaxCategoryToolInput = z.infer<typeof createTaxCategoryInput>;

@McpTool({
    name: 'create_tax_category',
    toolset: 'admin',
    description: 'Create a tax category. Tax rates then set its percentage per zone or country.',
    keywords: [
        'add a reduced VAT class',
        'new tax class for food',
        'create a zero-rated category',
        'add a tax type',
        'set up a tax category',
        'make a category for exempt goods',
    ],
    permissions: [Permission.CreateSettings, Permission.CreateTaxCategory],
    behavior: 'mutating',
    inputSchema: createTaxCategoryInput,
})
@Injectable()
export class CreateTaxCategoryTool implements McpToolHandler<CreateTaxCategoryToolInput> {
    constructor(
        private readonly taxCategoryService: TaxCategoryService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateTaxCategoryToolInput) {
        return {
            taxCategory: this.serializer.taxCategory(await this.taxCategoryService.create(ctx, input.input)),
        };
    }
}
