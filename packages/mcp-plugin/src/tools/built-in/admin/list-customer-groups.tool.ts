import { Injectable } from '@nestjs/common';
import { CustomerGroupListOptions } from '@vendure/common/lib/generated-types';
import { CustomerGroup, CustomerGroupService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { listOptions, page, paginationFields } from '../list-helpers';
import { McpToolSerializerService } from '../serializer.service';

const listCustomerGroupsInput = z.strictObject({
    ...paginationFields('customer groups'),
});

type ListCustomerGroupsInput = z.infer<typeof listCustomerGroupsInput>;

// This tool exists because `add_customer_to_group` requires a `groupId` and no other tool returns one.
// Every required foreign-key input of a built-in tool needs a way to discover its value inside the
// toolset; an optional input does not earn a tool of its own.
@McpTool({
    name: 'list_customer_groups',
    toolset: 'admin',
    description: 'List customer groups. Group IDs are what add_customer_to_group takes.',
    keywords: [
        'show customer groups',
        'which segments exist',
        'find a group id',
        'customer segments',
        'list groups of buyers',
    ],
    permissions: [Permission.ReadCustomerGroup],
    behavior: 'readonly',
    inputSchema: listCustomerGroupsInput,
})
@Injectable()
export class ListCustomerGroupsTool implements McpToolHandler<ListCustomerGroupsInput> {
    constructor(
        private readonly customerGroupService: CustomerGroupService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListCustomerGroupsInput) {
        const result = await this.customerGroupService.findAll(
            ctx,
            listOptions<CustomerGroup>(input) as CustomerGroupListOptions,
        );
        return page(
            result.items.map(group => this.serializer.customerGroup(group)),
            result.totalItems,
            input,
        );
    }
}
