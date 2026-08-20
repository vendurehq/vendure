import { Injectable } from '@nestjs/common';
import { ChannelService, idsAreEqual, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { page, paginationFields, slicePage } from '../list-helpers';
import { McpToolSerializerService } from '../serializer.service';

import { userChannelIds } from './channel-access';

const listChannelsInput = z.strictObject({
    ...paginationFields('channels'),
});

type ListChannelsInput = z.infer<typeof listChannelsInput>;

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
    constructor(
        private channelService: ChannelService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListChannelsInput) {
        const accessibleIds = userChannelIds(ctx);
        const result = await this.channelService.findAll(ctx);
        const accessible = result.items.filter(channel =>
            accessibleIds.some(id => idsAreEqual(id, channel.id)),
        );
        const items = slicePage(accessible, input).map(channel => this.serializer.channel(channel));
        return page(items, accessible.length, input);
    }
}
