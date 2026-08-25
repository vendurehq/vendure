import { describe, expect, it } from 'vitest';

import { McpToolSchemaService } from './mcp-tool-schema.service';

describe('McpToolSchemaService', () => {
    it('prepares the author and wire schemas without mutating the author schema', async () => {
        const authorSchema = {
            type: 'object' as const,
            properties: { note: { type: 'string' } },
            additionalProperties: false,
        };
        const service = new McpToolSchemaService();

        const prepared = service.prepareToolSchemas({
            toolName: 'touch_cart',
            pluginSource: 'TestPlugin',
            inputSchema: authorSchema,
            injectedFields: { confirm: false, sessionToken: true },
        });

        expect(prepared.jsonInputSchema).toBe(authorSchema);
        expect(prepared.jsonInputSchema.properties?.sessionToken).toBeUndefined();
        expect(prepared.wireJsonSchema.properties?.sessionToken).toMatchObject({ type: 'string' });

        const validation = await service.validate(prepared.compiledInputSchema, {
            note: 'hello',
            sessionToken: 'cart-token',
        });
        expect(validation).toEqual({
            ok: true,
            value: { note: 'hello', sessionToken: 'cart-token' },
        });
    });

    it('rejects a registry-owned field declared by the tool author', () => {
        const service = new McpToolSchemaService();
        expect(() =>
            service.prepareToolSchemas({
                toolName: 'touch_cart',
                pluginSource: 'TestPlugin',
                inputSchema: {
                    type: 'object',
                    properties: { sessionToken: { type: 'string' } },
                },
                injectedFields: { confirm: false, sessionToken: true },
            }),
        ).toThrow(/must not declare "sessionToken"/);
    });
});
