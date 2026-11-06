import { Injectable } from '@nestjs/common';
import { CustomerService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const getMyAccountInput = z.strictObject({});

@McpTool({
    name: 'get_my_account',
    toolset: 'shop',
    description: 'Get the authenticated customer account.',
    keywords: [
        'my profile',
        'my account details',
        'who am I logged in as',
        'view my customer info',
        'my personal details',
        'show my account',
    ],
    permissions: [Permission.Authenticated],
    behavior: 'readonly',
    inputSchema: getMyAccountInput,
})
@Injectable()
export class GetMyAccountTool implements McpToolHandler<Record<string, never>> {
    constructor(
        private readonly customerService: CustomerService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext) {
        const customer = ctx.activeUserId
            ? await this.customerService.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        if (!customer) {
            return { customer: null };
        }

        const addresses = await this.customerService.findAddressesByCustomerId(ctx, customer.id);
        return { customer: this.serializer.customer(customer, addresses) };
    }
}
