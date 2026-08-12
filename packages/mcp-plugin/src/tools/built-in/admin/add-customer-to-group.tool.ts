import { Injectable } from '@nestjs/common';
import { CustomerGroupService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

const addCustomerToGroupInput = z.strictObject({
    customerId: z.union([z.string(), z.number()]).describe('Customer ID.'),
    groupId: z.union([z.string(), z.number()]).describe('Customer group ID.'),
});

type AddCustomerToGroupInput = z.infer<typeof addCustomerToGroupInput>;

@McpTool({
    name: 'add_customer_to_group',
    toolset: 'admin',
    description: 'Add a customer to a customer group.',
    keywords: [
        'assign a customer to a segment',
        'put a buyer in a group',
        'tag this customer',
        'add customer to a list',
        'categorize a client',
        'give customer group membership',
    ],
    permissions: [Permission.UpdateCustomerGroup],
    inputSchema: addCustomerToGroupInput,
})
@Injectable()
export class AddCustomerToGroupTool implements McpToolHandler<AddCustomerToGroupInput> {
    constructor(private customerGroupService: CustomerGroupService) {}

    async execute(ctx: RequestContext, input: AddCustomerToGroupInput) {
        return {
            group: await this.customerGroupService.addCustomersToGroup(ctx, {
                customerGroupId: input.groupId,
                customerIds: [input.customerId],
            }),
        };
    }
}
