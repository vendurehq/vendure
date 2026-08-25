import { Injectable } from '@nestjs/common';
import { Customer, CustomerService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { dateFilter, listOptions, page, paginationFields, stringFilter } from '../list-helpers';
import { McpToolSerializerService } from '../serializer.service';

const listCustomersInput = z.strictObject({
    ...paginationFields('customers'),
    filter: z
        .strictObject({
            emailAddress: stringFilter.optional(),
            firstName: stringFilter.optional(),
            lastName: stringFilter.optional(),
            phoneNumber: stringFilter.optional(),
            postalCode: stringFilter
                .describe("Matches the postal code of any of the customer's addresses.")
                .optional(),
            createdAt: dateFilter.optional(),
        })
        .describe(
            'Conditions a customer must meet; all of them apply together. Example: ' +
                '{"emailAddress":{"eq":"jane@example.com"}} finds the customer with that email.',
        )
        .optional(),
});

type ListCustomersInput = z.infer<typeof listCustomersInput>;

@McpTool({
    name: 'list_customers',
    toolset: 'admin',
    description: 'List and filter customer records.',
    keywords: [
        'show all customers',
        'browse our clients',
        'customer directory',
        'list every buyer',
        'who are our customers',
        'pull the customer list',
        'find customer by email',
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
