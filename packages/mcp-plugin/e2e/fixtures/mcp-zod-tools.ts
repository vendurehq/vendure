import { Injectable } from '@nestjs/common';
import { Permission, PluginCommonModule, RequestContext, VendurePlugin } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

const zodEchoInput = z.object({
    text: z.string().min(1).describe('Text to echo back.'),
    times: z.number().int().min(1).max(5).default(1).describe('How many times to repeat the text.'),
});

@Injectable()
@McpTool({
    name: 'admin_zod_echo',
    toolset: 'admin',
    description: 'Echoes text. Fixture proving Standard Schema (zod v4) interop.',
    permissions: [Permission.Authenticated],
    behavior: 'readonly',
    inputSchema: zodEchoInput,
})
export class AdminZodEchoTool implements McpToolHandler<z.infer<typeof zodEchoInput>> {
    execute(ctx: RequestContext, input: z.infer<typeof zodEchoInput>) {
        return { echoed: input.text.repeat(input.times), times: input.times };
    }
}

const zodDeleteInput = z.strictObject({
    id: z.string().min(1).describe('ID of the record to delete.'),
});

@Injectable()
@McpTool({
    name: 'admin_zod_delete',
    toolset: 'admin',
    description:
        'Pretends to delete a record. Fixture proving the destructive confirm flow with a strict zod schema.',
    permissions: [Permission.Authenticated],
    behavior: 'destructive',
    inputSchema: zodDeleteInput,
})
export class AdminZodDeleteTool implements McpToolHandler<z.infer<typeof zodDeleteInput>> {
    execute(ctx: RequestContext, input: z.infer<typeof zodDeleteInput>) {
        return { deleted: input.id };
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [AdminZodEchoTool, AdminZodDeleteTool],
})
export class McpZodToolsPlugin {}
