import { Injectable } from '@nestjs/common';
import { EntityNotFoundError, Permission, RequestContext, TaxCategoryService } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';

const deleteTaxCategoryInput = z.strictObject({
    id: idSchema.describe('Tax category ID.'),
});

type DeleteTaxCategoryToolInput = z.infer<typeof deleteTaxCategoryInput>;

@McpTool({
    name: 'delete_tax_category',
    toolset: 'admin',
    description:
        'Delete a tax category. A category that tax rates or product variants still use is not deleted.',
    keywords: [
        'remove a tax class',
        'delete a VAT category',
        'drop a tax category',
        'delete reduced rate class',
        'remove tax type',
        'clean up tax categories',
    ],
    permissions: [Permission.DeleteSettings, Permission.DeleteTaxCategory],
    behavior: 'destructive',
    inputSchema: deleteTaxCategoryInput,
})
@Injectable()
export class DeleteTaxCategoryTool implements McpToolHandler<DeleteTaxCategoryToolInput> {
    constructor(private readonly taxCategoryService: TaxCategoryService) {}

    async describe(ctx: RequestContext, input: DeleteTaxCategoryToolInput) {
        const taxCategory = await this.taxCategoryService.findOne(ctx, input.id);
        if (!taxCategory) {
            throw new EntityNotFoundError('TaxCategory', input.id);
        }
        return `Delete tax category "${taxCategory.name}" (id ${taxCategory.id}).`;
    }

    async execute(ctx: RequestContext, input: DeleteTaxCategoryToolInput) {
        return deletionResult(
            await this.taxCategoryService.delete(ctx, input.id),
            `Tax category ${input.id}`,
        );
    }
}
