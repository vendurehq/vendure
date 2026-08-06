import { Injectable } from '@nestjs/common';
import { Customer, CustomerService, Permission, RequestContext } from '@vendure/core';
import { McpTool } from '@vendure/mcp-sdk';

import { McpPluginToolHandler } from '../../../types';
import { listOptions, page } from '../order-helpers';
import { numberProp, objectSchema, optional } from '../schema-helpers';
import { customerSummary } from '../serializers';

interface ListCustomersInput extends Record<string, unknown> {
    limit?: number;
    offset?: number;
}

@McpTool({
    name: 'list_customers',
    toolset: 'admin',
    description: 'List customer records, with pagination.',
    keywords: [
        'show all customers',
        'browse our clients',
        'customer directory',
        'list every buyer',
        'who are our customers',
        'pull the customer list',
    ],
    permissions: [Permission.ReadCustomer],
    behavior: 'readonly',
    inputSchema: objectSchema({
        limit: optional(numberProp('Maximum number of customers to return.')),
        offset: optional(numberProp('Number of customers to skip.')),
    }),
})
@Injectable()
export class ListCustomersTool implements McpPluginToolHandler<ListCustomersInput> {
    constructor(private customerService: CustomerService) {}

    async execute(ctx: RequestContext, input: ListCustomersInput) {
        const result = await this.customerService.findAll(ctx, listOptions<Customer>(input), ['user']);
        return page(
            result.items.map(customer => customerSummary(customer)),
            result.totalItems,
            input,
        );
    }
}
