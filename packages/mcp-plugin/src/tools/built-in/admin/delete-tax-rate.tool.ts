import { Injectable } from '@nestjs/common';
import { EntityNotFoundError, Permission, RequestContext, TaxRateService } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';

const deleteTaxRateInput = z.strictObject({
    id: idSchema.describe('Tax rate ID.'),
});

type DeleteTaxRateToolInput = z.infer<typeof deleteTaxRateInput>;

@McpTool({
    name: 'delete_tax_rate',
    toolset: 'admin',
    description: 'Delete a tax rate. Orders in its target then use the next rate that applies, or no tax.',
    keywords: [
        'remove a VAT rate',
        'delete a tax rate for a country',
        'delete a sales tax rate',
        'drop a tax rate',
        'remove a zone tax rate',
        'delete tax percentage',
    ],
    permissions: [Permission.DeleteSettings, Permission.DeleteTaxRate],
    behavior: 'destructive',
    inputSchema: deleteTaxRateInput,
})
@Injectable()
export class DeleteTaxRateTool implements McpToolHandler<DeleteTaxRateToolInput> {
    constructor(private readonly taxRateService: TaxRateService) {}

    async describe(ctx: RequestContext, input: DeleteTaxRateToolInput) {
        const taxRate = await this.taxRateService.findOne(ctx, input.id);
        if (!taxRate) {
            throw new EntityNotFoundError('TaxRate', input.id);
        }
        const target = taxRate.region ? taxRate.region.code : `zone "${taxRate.zone?.name ?? ''}"`;
        return `Delete tax rate "${taxRate.name}" (id ${taxRate.id}), ${taxRate.value}% for ${target}.`;
    }

    async execute(ctx: RequestContext, input: DeleteTaxRateToolInput) {
        return deletionResult(await this.taxRateService.delete(ctx, input.id), `Tax rate ${input.id}`);
    }
}
