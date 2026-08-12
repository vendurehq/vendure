import { Injectable } from '@nestjs/common';
import { Customer, CustomerService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { listOptions, page } from '../order-helpers';
import { customerSummary } from '../serializers';

const listCustomersInput = z.strictObject({
    limit: z.number().describe('Maximum number of customers to return.').optional(),
    offset: z.number().describe('Number of customers to skip.').optional(),
});

type ListCustomersInput = z.infer<typeof listCustomersInput> & Record<string, unknown>;

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
    inputSchema: listCustomersInput,
})
@Injectable()
export class ListCustomersTool implements McpToolHandler<ListCustomersInput> {
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
