import { Injectable } from '@nestjs/common';
import {
    Customer,
    Permission,
    PluginCommonModule,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    VendurePlugin,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

@Injectable()
@McpTool({
    name: 'shop_ping',
    description: 'Shop readonly ping — reports the resolved session and channel.',
    toolset: 'shop',
    behavior: 'readonly',
    permissions: [Permission.Public],
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false },
})
export class ShopPingTool implements McpToolHandler {
    execute(ctx: RequestContext, input: { text?: string }) {
        return {
            text: input?.text ?? 'pong',
            sessionId: ctx.session?.id ?? null,
            sessionToken: ctx.session?.token ?? null,
            channelId: ctx.channelId ?? null,
            languageCode: ctx.languageCode,
        };
    }
}

@Injectable()
@McpTool({
    name: 'shop_echo',
    description: 'Echoes the provided text back.',
    toolset: 'shop',
    behavior: 'readonly',
    permissions: [Permission.Public],
    inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
    },
})
export class ShopEchoTool implements McpToolHandler {
    execute(_ctx: RequestContext, input: { text: string }) {
        return { echoed: input.text };
    }
}

@Injectable()
@McpTool({
    name: 'shop_cart_write',
    description: 'Represents a write to the active cart for session transport tests.',
    toolset: 'shop',
    behavior: 'mutating',
    usesActiveOrder: true,
    permissions: [Permission.Public],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
})
export class ShopCartWriteTool implements McpToolHandler {
    execute(ctx: RequestContext) {
        return { sessionId: ctx.session?.id ?? null };
    }
}

@Injectable()
@McpTool({
    name: 'shop_boom',
    description: 'Always throws — used to verify in-tool errors flatten to isError.',
    toolset: 'shop',
    behavior: 'mutating',
    permissions: [Permission.Public],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
})
export class ShopBoomTool implements McpToolHandler {
    execute(): never {
        throw new Error('boom');
    }
}

@Injectable()
@McpTool({
    name: 'shop_bad_input',
    description: 'Always throws UserInputError — used to verify caller-safe errors pass through.',
    toolset: 'shop',
    behavior: 'mutating',
    permissions: [Permission.Public],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
})
export class ShopBadInputTool implements McpToolHandler {
    execute(): never {
        throw new UserInputError('bad-input-from-caller');
    }
}

@Injectable()
@McpTool({
    name: 'shop_write_then_boom',
    description: 'Saves a customer and then throws — used to verify a failed call writes nothing.',
    toolset: 'shop',
    behavior: 'mutating',
    permissions: [Permission.Public],
    inputSchema: {
        type: 'object',
        properties: { emailAddress: { type: 'string' } },
        required: ['emailAddress'],
        additionalProperties: false,
    },
})
export class ShopWriteThenBoomTool implements McpToolHandler {
    constructor(private readonly connection: TransactionalConnection) {}

    async execute(ctx: RequestContext, input: { emailAddress: string }): Promise<never> {
        await this.connection.getRepository(ctx, Customer).save(
            new Customer({
                emailAddress: input.emailAddress,
                firstName: 'Rolled',
                lastName: 'Back',
            }),
        );
        throw new Error('boom after write');
    }
}

@Injectable()
@McpTool({
    name: 'shop_delete',
    description: 'Deletes a thing. Destructive — requires confirmation.',
    toolset: 'shop',
    behavior: 'destructive',
    permissions: [Permission.Public],
    inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
    },
})
export class ShopDeleteTool implements McpToolHandler {
    execute(_ctx: RequestContext, input: { id: string }) {
        return { deleted: input.id };
    }
}

@Injectable()
@McpTool({
    name: 'admin_list',
    description: 'Admin readonly list.',
    toolset: 'admin',
    behavior: 'readonly',
    permissions: [Permission.ReadCatalog],
})
export class AdminListTool implements McpToolHandler {
    execute() {
        return { items: [] };
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        ShopPingTool,
        ShopEchoTool,
        ShopCartWriteTool,
        ShopBoomTool,
        ShopBadInputTool,
        ShopWriteThenBoomTool,
        ShopDeleteTool,
        AdminListTool,
    ],
})
export class McpTestToolsPlugin {}
