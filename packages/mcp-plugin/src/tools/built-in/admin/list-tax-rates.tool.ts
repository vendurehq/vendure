import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, TaxRate, TaxRateService } from '@vendure/core';
import { listOptions, McpTool, McpToolHandler, page, paginationFields } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const listTaxRatesInput = z.strictObject({
    ...paginationFields('tax rates'),
});

type ListTaxRatesInput = z.infer<typeof listTaxRatesInput>;

@McpTool({
    name: 'list_tax_rates',
    toolset: 'admin',
    description:
        'List tax rates with their percentage, tax category and target, which is either one country or a zone.',
    keywords: [
        'what VAT do we charge',
        'show sales tax percentages',
        'tax rate for Germany',
        'which zones have tax rates',
        'list all tax rates',
        'how much tax per country',
    ],
    permissions: [Permission.ReadSettings, Permission.ReadTaxRate],
    behavior: 'readonly',
    inputSchema: listTaxRatesInput,
})
@Injectable()
export class ListTaxRatesTool implements McpToolHandler<ListTaxRatesInput> {
    constructor(
        private readonly taxRateService: TaxRateService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListTaxRatesInput) {
        const result = await this.taxRateService.findAll(ctx, listOptions<TaxRate>(input), [
            'category',
            'zone',
            'region',
            'customerGroup',
        ]);
        return page(
            result.items.map(rate => this.serializer.taxRate(rate)),
            result.totalItems,
            input,
        );
    }
}
