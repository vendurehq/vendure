import { Injectable } from '@nestjs/common';
import { CustomerService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { objectSchema } from '../schema-helpers';
import { customerSummary } from '../serializers';

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
    inputSchema: objectSchema({}),
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
