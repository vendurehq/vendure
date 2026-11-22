import { Injectable } from '@nestjs/common';
import { ChannelService, EntityNotFoundError, Permission, RequestContext } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';

const deleteChannelInput = z.strictObject({
    id: idSchema.describe('Channel ID.'),
});

type DeleteChannelToolInput = z.infer<typeof deleteChannelInput>;

@McpTool({
    name: 'delete_channel',
    toolset: 'admin',
    description: 'Delete a channel, with the roles it owns. The default channel cannot be deleted.',
    keywords: [
        'remove a storefront',
        'close a sales channel',
        'delete a channel',
        'shut down a store',
        'drop a market',
        'remove a shop',
    ],
    permissions: [Permission.DeleteChannel],
    behavior: 'destructive',
    inputSchema: deleteChannelInput,
})
@Injectable()
export class DeleteChannelTool implements McpToolHandler<DeleteChannelToolInput> {
    constructor(private readonly channelService: ChannelService) {}

    async describe(ctx: RequestContext, input: DeleteChannelToolInput) {
        const channel = await this.channelService.findOne(ctx, input.id);
        if (!channel) {
            throw new EntityNotFoundError('Channel', input.id);
        }
        return `Delete channel "${channel.code}" (id ${channel.id}), and the roles it owns.`;
    }

    async execute(ctx: RequestContext, input: DeleteChannelToolInput) {
        return deletionResult(await this.channelService.delete(ctx, input.id), `Channel ${input.id}`);
    }
}
