import { Injectable } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Permission } from '@vendure/common/lib/generated-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { McpTool, McpToolHandler, McpToolMetadata } from './mcp-tool.decorator';

@Injectable()
@McpTool({
    name: 'search_products',
    description: 'Search the product catalog',
    toolset: 'shop',
    behavior: 'readonly',
    permissions: [Permission.Public],
})
class SearchProductsTool implements McpToolHandler<{ term: string }, { items: unknown[] }> {
    execute(ctx: any, input: { term: string }) {
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

    it('McpToolHandler is a 2-arg contract (no executionContext in core)', () => {
        const tool = new SearchProductsTool();
        // execute accepts exactly (ctx, input); compile-time + runtime smoke
        expect(tool.execute({} as any, { term: 'x' })).toEqual({ items: [] });
    });
});
