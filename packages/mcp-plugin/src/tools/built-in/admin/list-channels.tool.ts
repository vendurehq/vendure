import { Injectable } from '@nestjs/common';
import { ChannelService, idsAreEqual, Permission, RequestContext } from '@vendure/core';
import { McpTool } from '@vendure/mcp-sdk';

import { McpPluginToolHandler } from '../../../types';
import { page } from '../order-helpers';
import { numberProp, objectSchema, optional } from '../schema-helpers';

interface ListChannelsInput extends Record<string, unknown> {
    limit?: number;
    offset?: number;
}

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
    inputSchema: objectSchema({
        limit: optional(numberProp('Maximum number of channels to return.')),
        offset: optional(numberProp('Number of channels to skip.')),
    }),
})
@Injectable()
export class ListChannelsTool implements McpPluginToolHandler<ListChannelsInput> {
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
