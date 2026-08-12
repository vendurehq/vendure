import { Injectable } from '@nestjs/common';
import { CustomerService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { customerSummary } from '../serializers';

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
    constructor(private customerService: CustomerService) {}

    async execute(ctx: RequestContext) {
        const customer = ctx.activeUserId
            ? await this.customerService.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        return { customer: customerSummary(customer) };
    }
}
