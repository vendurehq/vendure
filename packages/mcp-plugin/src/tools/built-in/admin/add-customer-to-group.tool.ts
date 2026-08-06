import { Injectable } from '@nestjs/common';
import { CustomerGroupService, ID, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { idProp, objectSchema } from '../schema-helpers';

interface AddCustomerToGroupInput {
    customerId: ID;
    groupId: ID;
}

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
    inputSchema: objectSchema({
        customerId: idProp('Customer ID.'),
        groupId: idProp('Customer group ID.'),
    }),
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
