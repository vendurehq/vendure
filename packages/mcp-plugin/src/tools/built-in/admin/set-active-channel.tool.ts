import { Injectable } from '@nestjs/common';
import {
    ChannelService,
    ForbiddenError,
    idsAreEqual,
    InternalServerError,
    Permission,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { McpCallerInfo, McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { McpOauthGrant } from '../../../entities/mcp-oauth-grant.entity';
import { objectSchema, stringProp } from '../schema-helpers';

interface SetActiveChannelInput {
    channelToken: string;
}

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
    inputSchema: objectSchema({
        channelToken: stringProp('Channel token of the channel to activate.'),
    }),
})
@Injectable()
export class SetActiveChannelTool implements McpToolHandler<SetActiveChannelInput> {
    constructor(
        private channelService: ChannelService,
        private connection: TransactionalConnection,
    ) {}

    async execute(ctx: RequestContext, input: SetActiveChannelInput, caller?: McpCallerInfo) {
        const channel = await this.channelService.getChannelFromToken(ctx, input.channelToken);
        const accessibleIds = ctx.session?.user?.channelPermissions.map(entry => entry.id) ?? [];
        if (!accessibleIds.some(id => idsAreEqual(id, channel.id))) {
            throw new ForbiddenError();
        }
        // Persist the choice on the one merged grant row. Subsequent requests re-authenticate against
        // this grant, so its channelId becomes the active channel for later calls.
        if (!caller?.grant) {
            // An authenticated MCP caller always carries a grant; its absence means the caller info
            // was not wired up, so fail loudly rather than report a switch that never persisted.
            throw new InternalServerError('MCP set_active_channel requires an authenticated grant');
        }
        const grant = await this.connection.getEntityOrThrow(ctx, McpOauthGrant, caller.grant.id);
        grant.channelId = channel.id;
        await this.connection.getRepository(ctx, McpOauthGrant).save(grant);
        return { channel: { id: channel.id, code: channel.code, token: channel.token } };
    }
}
