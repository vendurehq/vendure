import { Injectable } from '@nestjs/common';
import {
    EntityNotFoundError,
    Permission,
    ProductVariant,
    RequestContext,
    TaxCategory,
    TaxCategoryService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
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
        'delete a tax type',
        'clean up tax categories',
    ],
    permissions: [Permission.DeleteSettings, Permission.DeleteTaxCategory],
    behavior: 'destructive',
    inputSchema: deleteTaxCategoryInput,
})
@Injectable()
export class DeleteTaxCategoryTool implements McpToolHandler<DeleteTaxCategoryToolInput> {
    constructor(
        private readonly taxCategoryService: TaxCategoryService,
        private readonly connection: TransactionalConnection,
    ) {}

    async describe(ctx: RequestContext, input: DeleteTaxCategoryToolInput) {
        const taxCategory = await this.findUnusedCategory(ctx, input.id);
        return `Delete tax category "${taxCategory.name}" (id ${taxCategory.id}).`;
    }

    async execute(ctx: RequestContext, input: DeleteTaxCategoryToolInput) {
        await this.findUnusedCategory(ctx, input.id);
        return deletionResult(
            await this.taxCategoryService.delete(ctx, input.id),
            `Tax category ${input.id}`,
        );
    }

    /**
     * Core checks for tax rates itself, but only finds variants through a database error, so variants are
     * counted here, including deleted ones, which keep their tax category.
     */
    private async findUnusedCategory(
        ctx: RequestContext,
        id: DeleteTaxCategoryToolInput['id'],
    ): Promise<TaxCategory> {
        const taxCategory = await this.taxCategoryService.findOne(ctx, id);
        if (!taxCategory) {
            throw new EntityNotFoundError('TaxCategory', id);
        }
        const variants = await this.connection
            .getRepository(ctx, ProductVariant)
            .count({ where: { taxCategoryId: taxCategory.id } });
        if (variants > 0) {
            throw new UserInputError(
                `Tax category "${taxCategory.name}" is used by ${variants} product variant(s). ` +
                    'Move them to another tax category first.',
            );
        }
        return taxCategory;
    }
}
