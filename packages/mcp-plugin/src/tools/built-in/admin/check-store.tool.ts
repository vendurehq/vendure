import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, StoreReadinessService } from '@vendure/core';
import { idSchema, MAX_ID_LIST_LENGTH, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

const checkStoreInput = z.strictObject({
    channelIds: z
        .array(idSchema)
        .max(MAX_ID_LIST_LENGTH)
        .describe('Check only these channels. Leave out to check every channel you can read.')
        .optional(),
});

type CheckStoreInput = z.infer<typeof checkStoreInput>;

@McpTool({
    name: 'check_store',
    toolset: 'admin',
    description:
        'Check whether each channel can take an order, and list the setup gaps that stop it: missing tax rates, ' +
        'prices, shipping, payment or stock locations. Each finding has a code, and fixes given as admin tool calls. ' +
        'It changes nothing.',
    keywords: [
        'is the store ready to sell',
        'what is missing before launch',
        'why can customers not check out',
        'store setup checklist',
        'find configuration problems',
        'can this channel take orders',
    ],
    permissions: [Permission.ReadSettings],
    behavior: 'readonly',
    inputSchema: checkStoreInput,
})
@Injectable()
export class CheckStoreTool implements McpToolHandler<CheckStoreInput> {
    constructor(private readonly storeReadinessService: StoreReadinessService) {}

    execute(ctx: RequestContext, input: CheckStoreInput) {
        return this.storeReadinessService.check(ctx, { channelIds: input.channelIds });
    }
}
