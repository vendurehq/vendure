import { Injectable } from '@nestjs/common';
import {
    CustomerGroupService,
    CustomerService,
    EntityNotFoundError,
    Permission,
    RequestContext,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

const addCustomerToGroupInput = z.strictObject({
    customerId: idSchema.describe('Customer ID.'),
    groupId: idSchema.describe('Customer group ID.'),
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
    behavior: 'mutating',
    inputSchema: addCustomerToGroupInput,
})
@Injectable()
export class AddCustomerToGroupTool implements McpToolHandler<AddCustomerToGroupInput> {
    constructor(
        private customerGroupService: CustomerGroupService,
        private customerService: CustomerService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: AddCustomerToGroupInput) {
        const customer = await this.customerService.findOne(ctx, input.customerId);
        if (!customer) {
            throw new EntityNotFoundError('Customer', input.customerId);
        }

        await this.customerGroupService.addCustomersToGroup(ctx, {
            customerGroupId: input.groupId,
            customerIds: [input.customerId],
        });

        const groups = await this.customerService.getCustomerGroups(ctx, customer.id);
        return {
            customerId: customer.id,
            groups: groups.map(group => this.serializer.customerGroup(group)),
        };
    }
}
