import { Injectable } from '@nestjs/common';
import { ChannelService, Permission, RequestContext } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { channelFieldsSchema, withTaxCountryCodeForCore } from './channel-fields-schema';

const updateChannelInput = z.strictObject({
    id: idSchema.describe('Channel ID.'),
    input: channelFieldsSchema.partial(),
});

type UpdateChannelToolInput = z.infer<typeof updateChannelInput>;

@McpTool({
    name: 'update_channel',
    toolset: 'admin',
    description:
        "Update a channel's languages, currencies, tax-inclusive pricing, tax country or default tax and shipping zones. Only the fields given change.",
    keywords: [
        'add a currency to the store',
        'change the default tax zone',
        'set the tax country of the prices',
        'switch to tax-inclusive prices',
        'set the default shipping zone',
        'add a language to a channel',
        'edit channel settings',
    ],
    permissions: [Permission.UpdateChannel],
    behavior: 'mutating',
    inputSchema: updateChannelInput,
})
@Injectable()
export class UpdateChannelTool implements McpToolHandler<UpdateChannelToolInput> {
    constructor(
        private readonly channelService: ChannelService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateChannelToolInput) {
        return this.serializer.channelOrError(
            await this.channelService.update(ctx, {
                ...withTaxCountryCodeForCore(input.input),
                id: input.id,
            }),
        );
    }
}
