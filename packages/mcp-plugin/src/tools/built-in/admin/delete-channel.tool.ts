import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    Channel,
    ChannelService,
    EntityNotFoundError,
    idsAreEqual,
    Permission,
    RequestContext,
    UserInputError,
} from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { userCanAccessChannel } from './channel-access';
import { deletionResult } from './deletion-result';

const deleteChannelInput = z.strictObject({
    id: idSchema.describe('Channel ID.'),
});

type DeleteChannelToolInput = z.infer<typeof deleteChannelInput>;

@McpTool({
    name: 'delete_channel',
    toolset: 'admin',
    description:
        'Delete a channel, with the roles it owns. The default channel and the active channel cannot be deleted. ' +
        'MCP grants whose active channel it is are revoked on their next call, and admin sessions in it are signed out.',
    keywords: [
        'delete a channel',
        'remove a storefront for good',
        'delete a sales channel',
        'permanently remove a shop',
        'delete a market',
        'drop a channel',
    ],
    permissions: [Permission.DeleteChannel],
    behavior: 'destructive',
    inputSchema: deleteChannelInput,
})
@Injectable()
export class DeleteChannelTool implements McpToolHandler<DeleteChannelToolInput> {
    constructor(private readonly channelService: ChannelService) {}

    async describe(ctx: RequestContext, input: DeleteChannelToolInput) {
        const channel = await this.findDeletableChannel(ctx, input.id);
        return (
            `Delete channel "${channel.code}" (id ${channel.id}), and the roles it owns. ` +
            'MCP grants whose active channel it is are revoked on their next call, and admin sessions in it are signed out.'
        );
    }

    async execute(ctx: RequestContext, input: DeleteChannelToolInput) {
        await this.findDeletableChannel(ctx, input.id);
        return deletionResult(await this.channelService.delete(ctx, input.id), `Channel ${input.id}`);
    }

    /**
     * A channel the caller holds no role in is reported as not found, as get_channel does. Deleting the
     * active channel would end the caller's own connection, so it is refused.
     */
    private async findDeletableChannel(
        ctx: RequestContext,
        id: DeleteChannelToolInput['id'],
    ): Promise<Channel> {
        const channel = userCanAccessChannel(ctx, id)
            ? await this.channelService.findOne(ctx, id)
            : undefined;
        if (!channel) {
            throw new EntityNotFoundError('Channel', id);
        }
        if (channel.code === DEFAULT_CHANNEL_CODE) {
            throw new UserInputError('The default channel cannot be deleted.');
        }
        if (idsAreEqual(channel.id, ctx.channelId)) {
            throw new UserInputError(
                `Channel "${channel.code}" is the active channel. Switch to another channel with set_active_channel first.`,
            );
        }
        return channel;
    }
}
