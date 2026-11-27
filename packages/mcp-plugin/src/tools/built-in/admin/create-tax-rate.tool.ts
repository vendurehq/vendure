import { Injectable } from '@nestjs/common';
import { CountryService, Permission, RequestContext, TaxRateService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { resolveTaxRateTarget, taxRateFieldsSchema } from './tax-rate-fields-schema';

const createTaxRateInput = z.strictObject({ input: taxRateFieldsSchema });

type CreateTaxRateToolInput = z.infer<typeof createTaxRateInput>;

@McpTool({
    name: 'create_tax_rate',
    toolset: 'admin',
    description:
        'Create a tax rate for a tax category, applying to one country or to a zone. A country rate wins over a zone rate.',
    keywords: [
        'charge 20% VAT in the UK',
        'add sales tax for a region',
        'set the tax percentage for a country',
        'add a zone tax rate',
        'configure VAT',
        'new tax rate',
    ],
    permissions: [Permission.CreateSettings, Permission.CreateTaxRate],
    behavior: 'mutating',
    inputSchema: createTaxRateInput,
})
@Injectable()
export class CreateTaxRateTool implements McpToolHandler<CreateTaxRateToolInput> {
    constructor(
        private readonly taxRateService: TaxRateService,
        private readonly countryService: CountryService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateTaxRateToolInput) {
        const { target, taxCategoryId, enabled, ...fields } = input.input;
        const taxRate = await this.taxRateService.create(ctx, {
            ...fields,
            enabled: enabled ?? true,
            categoryId: taxCategoryId,
            ...(await resolveTaxRateTarget(ctx, this.countryService, target)),
        });
        return { taxRate: this.serializer.taxRate(taxRate) };
    }
}
