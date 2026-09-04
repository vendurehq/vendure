import { Injectable } from '@nestjs/common';
import {
    Channel,
    ChannelNotFoundError,
    ChannelService,
    EntityNotFoundError,
    ForbiddenError,
    idsAreEqual,
    InternalServerError,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { McpCallerInfo, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpOauthGrant } from '../../../entities/mcp-oauth-grant.entity';
import { McpToolSerializerService } from '../serializer.service';
import { shortText } from '../string-schemas';

import { userChannelIds } from './channel-access';

const setActiveChannelInput = z.strictObject({
    channelToken: shortText.describe('Channel token of the channel to activate.'),
});

type SetActiveChannelInput = z.infer<typeof setActiveChannelInput>;

@McpTool({
    name: 'set_active_channel',
    toolset: 'admin',
    description: 'Set the active channel for this MCP grant by channel token.',
    keywords: [
        'switch to another store',
        'change the active channel',
        'select which storefront to work in',
        'set my current channel',
        'switch channels',
        "change the store I'm managing",
    ],
    permissions: [Permission.Authenticated],
    // Every later write on this grant lands on the channel this picks, so it is confirmed first.
    behavior: 'destructive',
    inputSchema: setActiveChannelInput,
})
@Injectable()
export class SetActiveChannelTool implements McpToolHandler<SetActiveChannelInput> {
    constructor(
        private channelService: ChannelService,
        private connection: TransactionalConnection,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: SetActiveChannelInput, caller?: McpCallerInfo) {
        let channel: Channel;
        try {
            channel = await this.channelService.getChannelFromToken(ctx, input.channelToken);
        } catch (e) {
            if (!(e instanceof ChannelNotFoundError)) throw e;
            throw new UserInputError(
                `No channel with token "${input.channelToken}". Call list_channels for the tokens ` +
                    'you can use.',
            );
        }
        const accessibleIds = userChannelIds(ctx);
        if (!accessibleIds.some(id => idsAreEqual(id, channel.id))) {
            throw new ForbiddenError();
        }
        // Update only channelId so a concurrent token refresh cannot overwrite rotated hashes.
        if (!caller?.grant) {
            // An authenticated MCP caller always carries a grant; its absence means the caller info
            // was not wired up, so fail loudly rather than report a switch that never persisted.
            throw new InternalServerError('MCP set_active_channel requires an authenticated grant');
        }
        const result = await this.connection
            .getRepository(ctx, McpOauthGrant)
            .update({ id: caller.grant.id }, { channelId: channel.id });
        if (result.affected === 0) {
            throw new EntityNotFoundError('McpOauthGrant', caller.grant.id);
        }
        return { channel: this.serializer.channel(channel) };
    }
}
