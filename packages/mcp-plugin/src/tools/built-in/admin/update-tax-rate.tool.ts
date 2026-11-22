import { Injectable } from '@nestjs/common';
import { CountryService, Permission, RequestContext, TaxRateService } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { resolveTaxRateTarget, taxRateFieldsSchema } from './tax-rate-fields-schema';

const updateTaxRateInput = z.strictObject({
    id: idSchema.describe('Tax rate ID.'),
    input: taxRateFieldsSchema.partial(),
});

type UpdateTaxRateToolInput = z.infer<typeof updateTaxRateInput>;

@McpTool({
    name: 'update_tax_rate',
    toolset: 'admin',
    description:
        "Change a tax rate's percentage, name, category, target or enabled state. Only the fields given change. A new target replaces the old one.",
    keywords: [
        'change the VAT percentage',
        'disable a tax rate',
        'move a rate to another zone',
        'update sales tax',
        'raise the tax rate',
        'edit a tax rate',
    ],
    permissions: [Permission.UpdateSettings, Permission.UpdateTaxRate],
    behavior: 'mutating',
    inputSchema: updateTaxRateInput,
})
@Injectable()
export class UpdateTaxRateTool implements McpToolHandler<UpdateTaxRateToolInput> {
    constructor(
        private readonly taxRateService: TaxRateService,
        private readonly countryService: CountryService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateTaxRateToolInput) {
        const { target, taxCategoryId, ...fields } = input.input;
        const taxRate = await this.taxRateService.update(ctx, {
            ...fields,
            id: input.id,
            ...(taxCategoryId !== undefined ? { categoryId: taxCategoryId } : {}),
            ...(target ? await resolveTaxRateTarget(ctx, this.countryService, target) : {}),
        });
        return { taxRate: this.serializer.taxRate(taxRate) };
    }
}
