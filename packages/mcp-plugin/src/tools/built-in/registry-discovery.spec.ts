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

import { mcpBuiltInToolProviders } from './providers';

const shopToolNames = [
    'add_to_cart',
    'apply_coupon_code',
    'get_cart',
    'get_collection',
    'get_eligible_payment_methods',
    'get_eligible_shipping_methods',
    'get_my_account',
    'get_order',
    'get_product',
    'list_collections',
    'list_my_orders',
    'place_order',
    'remove_coupon_code',
    'remove_from_cart',
    'search_products',
    'set_billing_address',
    'set_shipping_address',
    'set_shipping_method',
    'update_cart_line',
];

const adminToolNames = [
    'add_customer_to_group',
    'add_note_to_order',
    'adjust_stock',
    'cancel_order',
    'create_customer',
    'create_product',
    'create_variant',
    'get_customer',
    'get_order',
    'get_product',
    'get_stock_levels',
    'list_channels',
    'list_customers',
    'list_orders',
    'list_products',
    'refund_order',
    'set_active_channel',
    'update_customer',
    'update_order_state',
    'update_product',
    'update_product_assets',
    'update_variant',
    'upload_asset',
];

describe('built-in registry discovery', () => {
    async function bootRegistry() {
        const moduleRef = await Test.createTestingModule({
            imports: [DiscoveryModule],
            providers: [
                ...mcpBuiltInToolProviders,
                McpToolRegistryService,
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

    it('bootstraps Nest providers and discovers exactly the 19 shop tools', async () => {
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

    it('bootstraps Nest providers and discovers exactly the 23 admin tools', async () => {
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
