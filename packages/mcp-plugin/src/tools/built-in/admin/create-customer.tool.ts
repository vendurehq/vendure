import { Injectable } from '@nestjs/common';
import { CreateCustomerInput } from '@vendure/common/lib/generated-types';
import { CustomerService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { jsonObjectProp, objectSchema, optional, stringProp } from '../schema-helpers';
import { customerSummaryResult } from '../serializers';

interface CreateCustomerToolInput {
    input: CreateCustomerInput;
}

const customerInputSchema = objectSchema({
    firstName: stringProp('Customer first name.'),
    lastName: stringProp('Customer last name.'),
    emailAddress: { ...stringProp('Customer email address.'), format: 'email' },
    phoneNumber: optional(stringProp('Customer phone number.')),
    title: optional(stringProp('Customer title, e.g. "Mr" or "Ms".')),
    customFields: optional(jsonObjectProp('Customer custom fields.')),
});

@McpTool({
    name: 'create_customer',
    toolset: 'admin',
    description: 'Create a new customer record with their name, email address and an optional phone number.',
    keywords: [
        'add a new customer',
        'register a buyer',
        'set up a client account',
        'onboard a new customer',
        'create a shopper record',
        'make a customer account',
    ],
    permissions: [Permission.CreateCustomer],
    inputSchema: objectSchema({
        input: customerInputSchema,
    }),
})
@Injectable()
export class CreateCustomerTool implements McpToolHandler<CreateCustomerToolInput> {
    constructor(private customerService: CustomerService) {}

    async execute(ctx: RequestContext, input: CreateCustomerToolInput) {
        return {
            customer: customerSummaryResult(await this.customerService.create(ctx, input.input)),
        };
    }
}
