/**
 * Permanent snapshot of every built-in tool's derived JSON input schema.
 *
 * Each tool declares a zod schema on its `@McpTool` decorator; the registry turns that into
 * the JSON Schema an MCP client actually sees via `~standard.jsonSchema.input()`. A zod upgrade
 * can silently change what that conversion produces. This spec pins the current output so any
 * such change fails CI loudly instead of shipping unnoticed.
 *
 * To regenerate the snapshot after an intentional schema change (e.g. adding a tool, or a zod
 * upgrade whose new output you've reviewed and accepted), run:
 *
 *     UPDATE_SCHEMA_SNAPSHOT=1 bunx vitest run src/tools/built-in/schema-snapshot.spec.ts
 *
 * then re-run the spec normally (without the env var) to confirm it passes, and diff the
 * snapshot file to review exactly what changed.
 */
import { McpTool, McpToolMetadata } from '@vendure/mcp-sdk';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import snapshot from './builtin-input-schemas.snapshot.json';
import { mcpBuiltInToolProviders } from './providers';

const snapshotPath = join(__dirname, 'builtin-input-schemas.snapshot.json');

function toJsonInputSchema(schema: unknown): Record<string, unknown> {
    const std = (
        schema as { ['~standard']?: { jsonSchema?: { input?: (o: object) => Record<string, unknown> } } }
    )?.['~standard'];
    if (std?.jsonSchema?.input) {
        const { $schema, ...json } = std.jsonSchema.input({ target: 'draft-2020-12' });
        return json;
    }
    return schema as Record<string, unknown>;
}

function metadataFor(provider: unknown): McpToolMetadata {
    const metadata = Reflect.getMetadata(McpTool.KEY, provider) as McpToolMetadata | undefined;
    if (!metadata) {
        throw new Error(`Missing @McpTool metadata on ${String(provider)}`);
    }
    return metadata;
}

const providers = mcpBuiltInToolProviders.filter(provider => typeof provider === 'function');
const entries = providers
    .map(provider => {
        const metadata = metadataFor(provider);
        return {
            key: `${metadata.toolset}:${metadata.name}`,
            schema: toJsonInputSchema(metadata.inputSchema),
        };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

if (process.env.UPDATE_SCHEMA_SNAPSHOT === '1') {
    const dump: Record<string, unknown> = {};
    for (const entry of entries) {
        dump[entry.key] = entry.schema;
    }
    writeFileSync(snapshotPath, `${JSON.stringify(dump, null, 2)}\n`);
}

describe('built-in tool input schema snapshot', () => {
    it('covers exactly the live set of built-in tools', () => {
        const liveKeys = entries.map(entry => entry.key).sort();
        const snapshotKeys = Object.keys(snapshot).sort();
        expect(
            snapshotKeys,
            'Snapshot keys do not match the live built-in tool set. Regenerate with: ' +
                'UPDATE_SCHEMA_SNAPSHOT=1 bunx vitest run src/tools/built-in/schema-snapshot.spec.ts',
        ).toEqual(liveKeys);
    });

    for (const entry of entries) {
        it(`matches the snapshot for ${entry.key}`, () => {
            expect(
                entry.schema,
                `${entry.key} input schema drifted from the snapshot. If this is an intentional ` +
                    'change, regenerate with: UPDATE_SCHEMA_SNAPSHOT=1 bunx vitest run src/tools/built-in/schema-snapshot.spec.ts',
            ).toEqual((snapshot as Record<string, unknown>)[entry.key]);
        });
    }
});
