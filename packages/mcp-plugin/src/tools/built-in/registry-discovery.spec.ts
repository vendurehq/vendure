import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
    ActiveOrderService,
    AssetService,
    ChannelService,
    CollectionService,
    ConfigService,
    CustomerGroupService,
    CustomerService,
    OrderService,
    ProductService,
    ProductVariantService,
    SettingsStoreService,
    StockLevelService,
    TransactionalConnection,
} from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { MCP_PLUGIN_OPTIONS } from '../../constants';
import { McpToolCallLogService } from '../../logging/mcp-tool-call-log.service';
import { McpRateLimiterService } from '../../rate-limit/mcp-rate-limiter.service';
import { McpToolRegistryService } from '../../registry/mcp-tool-registry.service';
import { resolveMcpPluginOptions } from '../../resolve-options';

import { McpActiveOrderService } from './active-order.service';
import { adminToolProviders } from './admin';
import { mcpBuiltInToolProviders } from './providers';
import { McpToolSerializerService } from './serializer.service';
import { shopToolProviders } from './shop';
import { metadataFor } from './spec-helpers';

const shopToolNames = shopToolProviders.map(provider => metadataFor(provider).name).sort();

const adminToolNames = adminToolProviders.map(provider => metadataFor(provider).name).sort();

describe('built-in registry discovery', () => {
    async function bootRegistry() {
        const moduleRef = await Test.createTestingModule({
            imports: [DiscoveryModule],
            providers: [
                ...mcpBuiltInToolProviders,
                McpToolRegistryService,
                McpActiveOrderService,
                McpToolSerializerService,
                { provide: ActiveOrderService, useValue: {} },
                { provide: AssetService, useValue: {} },
                { provide: ChannelService, useValue: {} },
                { provide: CollectionService, useValue: {} },
                { provide: ConfigService, useValue: {} },
                { provide: CustomerGroupService, useValue: {} },
                { provide: CustomerService, useValue: {} },
                { provide: OrderService, useValue: {} },
                { provide: ProductService, useValue: {} },
                { provide: ProductVariantService, useValue: {} },
                { provide: SettingsStoreService, useValue: { get: vi.fn(), set: vi.fn() } },
                { provide: StockLevelService, useValue: {} },
                { provide: TransactionalConnection, useValue: {} },
                { provide: McpRateLimiterService, useValue: {} },
                { provide: McpToolCallLogService, useValue: {} },
                { provide: MCP_PLUGIN_OPTIONS, useValue: resolveMcpPluginOptions({}) },
            ],
        }).compile();
        await moduleRef.init();
        return moduleRef;
    }

    it('bootstraps Nest providers and discovers exactly the declared shop tools', async () => {
        const moduleRef = await bootRegistry();
        try {
            const registry = moduleRef.get(McpToolRegistryService);
            expect(
                registry
                    .getRegistrySnapshot()
                    .filter(tool => tool.toolset === 'shop')
                    .map(tool => tool.name)
                    .sort(),
            ).toEqual(shopToolNames);
        } finally {
            await moduleRef.close();
        }
    });

    it('bootstraps Nest providers and discovers exactly the declared admin tools', async () => {
        const moduleRef = await bootRegistry();
        try {
            const registry = moduleRef.get(McpToolRegistryService);
            expect(
                registry
                    .getRegistrySnapshot()
                    .filter(tool => tool.toolset === 'admin')
                    .map(tool => tool.name)
                    .sort(),
            ).toEqual(adminToolNames.slice().sort());
        } finally {
            await moduleRef.close();
        }
    });
});
