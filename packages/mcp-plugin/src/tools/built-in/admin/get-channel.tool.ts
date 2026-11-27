import { Injectable } from '@nestjs/common';
import { ChannelService, Permission, RequestContext } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { userCanAccessChannel } from './channel-access';

const getChannelInput = z.strictObject({
    id: idSchema.describe('Channel ID.'),
});

type GetChannelInput = z.infer<typeof getChannelInput>;

@McpTool({
    name: 'get_channel',
    toolset: 'admin',
    description:
        'Get a channel by id, with its languages, currencies, tax-inclusive pricing and default tax and shipping zones.',
    keywords: [
        'show channel settings',
        'which currencies does this store use',
        'does this channel include tax in prices',
        'default tax zone of a channel',
        'inspect a storefront configuration',
        'channel languages and currencies',
    ],
    permissions: [Permission.ReadSettings, Permission.ReadChannel],
    behavior: 'readonly',
    inputSchema: getChannelInput,
})
@Injectable()
export class GetChannelTool implements McpToolHandler<GetChannelInput> {
    constructor(
        private readonly channelService: ChannelService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: GetChannelInput) {
        // A channel the caller holds no role in is reported as not found, as list_channels leaves it out.
        if (!userCanAccessChannel(ctx, input.id)) {
            return { channel: null };
        }
        const channel = await this.channelService.findOne(ctx, input.id);
        return { channel: channel ? this.serializer.channelDetails(channel) : null };
    }
}
