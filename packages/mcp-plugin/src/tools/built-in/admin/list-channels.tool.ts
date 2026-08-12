import { Injectable } from '@nestjs/common';
import { ChannelService, idsAreEqual, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { page } from '../order-helpers';

const listChannelsInput = z.strictObject({
    limit: z.number().describe('Maximum number of channels to return.').optional(),
    offset: z.number().describe('Number of channels to skip.').optional(),
});

type ListChannelsInput = z.infer<typeof listChannelsInput> & Record<string, unknown>;

@McpTool({
    name: 'list_channels',
    toolset: 'admin',
    description: 'List channels available to the current administrator.',
    keywords: [
        'show sales channels',
        'list our storefronts',
        'which channels can I access',
        'available stores',
        'see all channels',
        'multi-store channel list',
    ],
    permissions: [Permission.ReadSettings, Permission.ReadChannel],
    behavior: 'readonly',
    inputSchema: listChannelsInput,
})
@Injectable()
export class ListChannelsTool implements McpToolHandler<ListChannelsInput> {
    constructor(private channelService: ChannelService) {}

    async execute(ctx: RequestContext, input: ListChannelsInput) {
        const accessibleIds = ctx.session?.user?.channelPermissions.map(entry => entry.id) ?? [];
        const result = await this.channelService.findAll(ctx);
        const accessible = result.items.filter(channel =>
            accessibleIds.some(id => idsAreEqual(id, channel.id)),
        );
        const offset = input.offset ?? 0;
        const limit = input.limit ?? 25;
        const items = accessible
            .slice(offset, offset + limit)
            .map(channel => ({ id: channel.id, code: channel.code, token: channel.token }));
        return page(items, accessible.length, input);
    }
}
