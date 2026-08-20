/**
 * Helpers shared by the built-in tool spec files. Only spec files import them, and the package
 * build compiles solely what `src/index.ts` reaches, so this file never reaches the published
 * package.
 */
import { McpTool, McpToolMetadata } from '@vendure/mcp-sdk';

/**
 * The JSON Schema an MCP client sees for a tool's input. A Standard Schema, a zod schema for
 * example, carries a converter under `~standard`; anything else is already plain JSON Schema.
 */
export function toJsonInputSchema(schema: unknown): Record<string, unknown> {
    const std = (
        schema as { ['~standard']?: { jsonSchema?: { input?: (o: object) => Record<string, unknown> } } }
    )?.['~standard'];
    if (std?.jsonSchema?.input) {
        const { $schema, ...json } = std.jsonSchema.input({ target: 'draft-2020-12' });
        return json;
    }
    return schema as Record<string, unknown>;
}

/** The metadata a tool class carries from its `@McpTool` decorator. */
export function metadataFor(provider: unknown): McpToolMetadata {
    const metadata = Reflect.getMetadata(McpTool.KEY, provider) as McpToolMetadata | undefined;
    if (!metadata) {
        throw new Error(`Missing @McpTool metadata on ${String(provider)}`);
    }
    return metadata;
}
