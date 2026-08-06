import { Injectable } from '@nestjs/common';
import { CustomerService, ID, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { idProp, objectSchema } from '../schema-helpers';
import { customerSummary } from '../serializers';

interface GetCustomerInput {
    id: ID;
}

@McpTool({
    name: 'get_customer',
    toolset: 'admin',
    description: 'Get a customer by id.',
    keywords: [
        'look up a customer record',
        "view a client's profile",
        'pull up customer details',
        'find a buyer by id',
        'inspect a customer account',
        'open a single customer',
    ],
    permissions: [Permission.ReadCustomer],
    behavior: 'readonly',
    inputSchema: objectSchema({ id: idProp('Customer ID.') }),
})
@Injectable()
export class GetCustomerTool implements McpToolHandler<GetCustomerInput> {
    constructor(private customerService: CustomerService) {}

    async execute(ctx: RequestContext, input: GetCustomerInput) {
        return { customer: customerSummary(await this.customerService.findOne(ctx, input.id, ['user'])) };
    }
}
