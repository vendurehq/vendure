import { Injectable } from '@nestjs/common';
import { ChannelService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { channelFieldsSchema, withTaxCountryCodeForCore } from './channel-fields-schema';

const createChannelInput = z.strictObject({ input: channelFieldsSchema });

type CreateChannelToolInput = z.infer<typeof createChannelInput>;

@McpTool({
    name: 'create_channel',
    toolset: 'admin',
    description:
        'Create a channel with its code, token, languages, currencies, tax-inclusive pricing and default tax and shipping zones.',
    keywords: [
        'add a new storefront',
        'open a store for another country',
        'create a sales channel',
        'set up a second shop',
        'new market with its own currency',
        'add a channel for a region',
    ],
    permissions: [Permission.CreateChannel],
    behavior: 'mutating',
    inputSchema: createChannelInput,
})
@Injectable()
export class CreateChannelTool implements McpToolHandler<CreateChannelToolInput> {
    constructor(
        private readonly channelService: ChannelService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateChannelToolInput) {
        return this.serializer.channelOrError(
            await this.channelService.create(ctx, withTaxCountryCodeForCore(input.input)),
        );
    }
}
