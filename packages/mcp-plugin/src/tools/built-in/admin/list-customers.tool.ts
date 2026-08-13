import { Injectable } from '@nestjs/common';
import { Customer, CustomerService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { listOptions, page, paginationFields } from '../list-helpers';
import { McpToolSerializerService } from '../serializer.service';

const listCustomersInput = z.strictObject({
    ...paginationFields('customers'),
});

type ListCustomersInput = z.infer<typeof listCustomersInput>;

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
    constructor(
        private customerService: CustomerService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListCustomersInput) {
        const result = await this.customerService.findAll(ctx, listOptions<Customer>(input), ['user']);
        return page(
            result.items.map(customer => this.serializer.customer(customer)),
            result.totalItems,
            input,
        );
    }
}
