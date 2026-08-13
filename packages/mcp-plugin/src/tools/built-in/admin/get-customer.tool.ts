import { Injectable } from '@nestjs/common';
import { CustomerService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

const getCustomerInput = z.strictObject({
    id: idSchema.describe('Customer ID.'),
});

type GetCustomerInput = z.infer<typeof getCustomerInput>;

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
    inputSchema: getCustomerInput,
})
@Injectable()
export class GetCustomerTool implements McpToolHandler<GetCustomerInput> {
    constructor(
        private customerService: CustomerService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: GetCustomerInput) {
        return {
            customer: this.serializer.customer(await this.customerService.findOne(ctx, input.id, ['user'])),
        };
    }
}
