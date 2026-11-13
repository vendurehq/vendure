import { Injectable } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Permission } from '@vendure/common/lib/generated-types';
import type { RequestContext } from '@vendure/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { McpCallerInfo, McpTool, McpToolHandler, McpToolMetadata, McpToolSchema } from './mcp-tool.decorator';

@Injectable()
@McpTool({
    name: 'search_products',
    description: 'Search the product catalog',
    toolset: 'shop',
    behavior: 'readonly',
    permissions: [Permission.Public],
})
class SearchProductsTool implements McpToolHandler<{ term: string }, { items: unknown[] }> {
    execute(ctx: RequestContext, input: { term: string }, caller?: McpCallerInfo) {
        return { items: [] };
    }
}

describe('@McpTool contract', () => {
    let discoveryService: DiscoveryService;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [DiscoveryModule],
            providers: [SearchProductsTool],
        }).compile();
        discoveryService = moduleRef.get(DiscoveryService);
    });

    it('attaches McpToolMetadata retrievable via DiscoveryService.getMetadataByDecorator', () => {
        const providers = discoveryService.getProviders();
        const wrapper = providers.find(w => w.metatype === SearchProductsTool);
        expect(wrapper).toBeDefined();
        if (wrapper == null) {
            throw new Error('Expected the SearchProductsTool provider to be discovered');
        }
        const metadata: McpToolMetadata | undefined = discoveryService.getMetadataByDecorator(
            McpTool,
            wrapper,
        );
        expect(metadata).toBeDefined();
        if (metadata == null) {
            throw new Error('Expected McpToolMetadata to be attached to the provider');
        }
        expect(metadata.name).toBe('search_products');
        expect(metadata.toolset).toBe('shop');
        expect(metadata.behavior).toBe('readonly');
        expect(metadata.permissions).toEqual([Permission.Public]);
    });

    it('McpToolHandler.execute works with or without the optional caller info', () => {
        const tool = new SearchProductsTool();
        // The third argument (McpCallerInfo) is optional, so both call shapes are valid.
        expect(tool.execute({} as any, { term: 'x' })).toEqual({ items: [] });
        expect(tool.execute({} as any, { term: 'x' }, { clientIp: '127.0.0.1' })).toEqual({ items: [] });
    });
});

describe('Standard Schema metadata', () => {
    const standardInput = {
        '~standard': {
            version: 1 as const,
            vendor: 'spec',
            validate: (value: unknown) => ({ value }),
            jsonSchema: {
                input: () => ({ type: 'object', properties: {}, additionalProperties: false }),
                output: () => ({ type: 'object', properties: {}, additionalProperties: false }),
            },
        },
    };

    @Injectable()
    @McpTool({
        name: 'standard_schema_tool',
        description: 'declared with a Standard Schema object',
        toolset: 'shop',
        inputSchema: standardInput,
    })
    class StandardSchemaTool implements McpToolHandler {
        execute() {
            return {};
        }
    }

    let discoveryService: DiscoveryService;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [DiscoveryModule],
            providers: [StandardSchemaTool],
        }).compile();
        discoveryService = moduleRef.get(DiscoveryService);
    });

    it('carries a Standard Schema inputSchema through metadata unchanged', () => {
        const providers = discoveryService.getProviders();
        const wrapper = providers.find(w => w.metatype === StandardSchemaTool);
        expect(wrapper).toBeDefined();
        if (wrapper == null) {
            throw new Error('Expected the StandardSchemaTool provider to be discovered');
        }
        const metadata: McpToolMetadata | undefined = discoveryService.getMetadataByDecorator(
            McpTool,
            wrapper,
        );
        expect(metadata).toBeDefined();
        if (metadata == null) {
            throw new Error('Expected McpToolMetadata to be attached to the provider');
        }
        expect(metadata.inputSchema).toBe(standardInput);
    });
});

// Type-level: the union accepts both forms; a parse()-style object is rejected.
const _jsonForm: McpToolSchema = { type: 'object', properties: {} };
const _standardForm: McpToolSchema = {
    '~standard': {
        version: 1,
        vendor: 'spec',
        validate: (value: unknown) => ({ value }),
        jsonSchema: { input: () => ({}), output: () => ({}) },
    },
};
// @ts-expect-error a Zod-v3-style { parse() } object is not a valid schema
const _parseForm: McpToolSchema = { parse: (x: unknown) => x };
void _jsonForm;
void _standardForm;
void _parseForm;
