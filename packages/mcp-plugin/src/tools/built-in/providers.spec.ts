import { fromJsonSchema, JsonSchemaType } from '@modelcontextprotocol/server';
import { Permission } from '@vendure/core';
import { McpTool, McpToolMetadata } from '@vendure/mcp-sdk';
import { describe, expect, it } from 'vitest';

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

const allowedOpenObjectPaths = new Set([
    'set_billing_address.address.customFields',
    'set_shipping_address.address.customFields',
    'place_order.paymentMetadata',
    // Admin: customFields are genuine open bags on the create/update input objects.
    'create_customer.input.customFields',
    'update_customer.input.customFields',
    'create_product.input.customFields',
    'update_product.input.customFields',
    'create_variant.input.customFields',
    'update_variant.input.customFields',
]);

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

function assertStrictObjectSchemas(schema: unknown, path: string): void {
    if (!schema || typeof schema !== 'object') {
        return;
    }
    const value = schema as Record<string, unknown>;
    if (value.type === 'object') {
        const isOpen =
            value.additionalProperties === true ||
            (typeof value.additionalProperties === 'object' &&
                value.additionalProperties !== null &&
                Object.keys(value.additionalProperties).length === 0);
        if (allowedOpenObjectPaths.has(path)) {
            expect(isOpen, path).toBe(true);
        } else {
            expect(value.additionalProperties, path).toBe(false);
        }
    }
    if (value.properties && typeof value.properties === 'object') {
        for (const [name, property] of Object.entries(value.properties)) {
            assertStrictObjectSchemas(property, `${path}.${name}`);
        }
    }
    if (value.items) {
        assertStrictObjectSchemas(value.items, `${path}[]`);
    }
    for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
        if (Array.isArray(value[keyword])) {
            value[keyword].forEach((branch, index) =>
                assertStrictObjectSchemas(branch, `${path}.${keyword}[${index}]`),
            );
        }
    }
}

describe('built-in shop tool providers', () => {
    const providers = mcpBuiltInToolProviders.filter(provider => typeof provider === 'function');
    const shopProviders = providers.filter(provider => metadataFor(provider).toolset === 'shop');

    it('registers exactly the 19 natural shop tools', () => {
        expect(shopProviders.map(provider => metadataFor(provider).name).sort()).toEqual(shopToolNames);
    });

    it('declares schemas that compile and close every fixed object', () => {
        for (const provider of providers) {
            const metadata = metadataFor(provider);
            expect(metadata.inputSchema, `${metadata.name} must declare inputSchema`).toBeDefined();
            const jsonInputSchema = toJsonInputSchema(metadata.inputSchema);
            try {
                fromJsonSchema(jsonInputSchema as unknown as JsonSchemaType);
            } catch (error) {
                throw new Error(
                    `${metadata.name} inputSchema failed to compile: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
            assertStrictObjectSchemas(jsonInputSchema, metadata.name);
        }
    });

    it('declares collision-safe class names', () => {
        expect(
            shopProviders
                .map(provider => (provider as { name: string }).name)
                .filter(name => name.startsWith('Shop'))
                .sort(),
        ).toEqual([
            'ShopGetCollectionTool',
            'ShopGetOrderTool',
            'ShopGetProductTool',
            'ShopListCollectionsTool',
        ]);
    });

    it('declares permissions and behavior for account, order, and checkout tools', () => {
        const byName = new Map(
            shopProviders.map(provider => [metadataFor(provider).name, metadataFor(provider)]),
        );

        expect(byName.get('get_my_account')?.permissions).toEqual([Permission.Authenticated]);
        expect(byName.get('list_my_orders')?.permissions).toEqual([Permission.Authenticated]);
        expect(byName.get('get_order')?.permissions).toEqual([Permission.Public]);
        expect(byName.get('get_order')?.behavior).toBe('readonly');
        expect(byName.get('place_order')).toMatchObject({
            permissions: [Permission.Public],
            behavior: 'destructive',
        });
    });

    it('warns that search_products matches literal text, so a plural finds nothing', () => {
        const description = metadataFor(
            shopProviders.find(provider => metadataFor(provider).name === 'search_products'),
        ).description;

        expect(description).toContain('single word');
        expect(description).toContain('singular');
    });
});
