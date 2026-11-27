import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, TaxCategoryService } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { taxCategoryFieldsSchema } from './tax-category-fields-schema';

const updateTaxCategoryInput = z.strictObject({
    id: idSchema.describe('Tax category ID.'),
    input: taxCategoryFieldsSchema.partial(),
});

type UpdateTaxCategoryToolInput = z.infer<typeof updateTaxCategoryInput>;

@McpTool({
    name: 'update_tax_category',
    toolset: 'admin',
    description: 'Rename a tax category or make it the default. Only the fields given change.',
    keywords: [
        'rename a tax class',
        'change the default tax category',
        'edit a VAT category',
        'make standard the default',
        'update tax category name',
        'fix a tax category',
    ],
    permissions: [Permission.UpdateSettings, Permission.UpdateTaxCategory],
    behavior: 'mutating',
    inputSchema: updateTaxCategoryInput,
})
@Injectable()
export class UpdateTaxCategoryTool implements McpToolHandler<UpdateTaxCategoryToolInput> {
    constructor(
        private readonly taxCategoryService: TaxCategoryService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateTaxCategoryToolInput) {
        const taxCategory = await this.taxCategoryService.update(ctx, { ...input.input, id: input.id });
        return { taxCategory: this.serializer.taxCategory(taxCategory) };
    }
}
