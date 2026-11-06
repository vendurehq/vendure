import { fromJsonSchema, JsonSchemaType } from '@modelcontextprotocol/server';
import { Permission } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { mcpBuiltInToolProviders } from './providers';
import { metadataFor, toJsonInputSchema } from './spec-helpers';

type StandardInputSchema = {
    ['~standard']: {
        validate: (
            input: unknown,
        ) => Promise<{ issues?: readonly unknown[] }> | { issues?: readonly unknown[] };
    };
};

const allowedOpenObjectPaths = new Set([
    'set_checkout_details.shippingAddress.customFields',
    'set_checkout_details.billingAddress.customFields',
    'place_order.paymentMetadata',
    // The admin create/update inputs deliberately accept any keys under customFields, because each
    // project defines its own custom fields.
    'create_customer.input.customFields',
    'update_customer.input.customFields',
    'create_product.input.customFields',
    'update_product.input.customFields',
    'create_variant.input.customFields',
    'update_variant.input.customFields',
]);

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

    async function accepts(toolName: string, input: unknown): Promise<boolean> {
        const provider = providers.find(candidate => metadataFor(candidate).name === toolName);
        if (!provider) {
            throw new Error(`Unknown built-in tool: ${toolName}`);
        }
        const schema = metadataFor(provider).inputSchema as StandardInputSchema;
        return !(await schema['~standard'].validate(input)).issues;
    }

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
        const classNames = providers.map(provider => (provider as { name: string }).name);
        expect(new Set(classNames).size).toBe(classNames.length);
    });

    it('accepts string and number entity IDs but refuses other types', async () => {
        expect(await accepts('add_to_cart', { variantId: '1', quantity: 1 })).toBe(true);
        expect(await accepts('add_to_cart', { variantId: 1, quantity: 1 })).toBe(true);
        expect(await accepts('add_to_cart', { variantId: true, quantity: 1 })).toBe(false);
    });

    it('caps shared entity ID lists before they reach a mutation', async () => {
        const input = (count: number) => ({ id: '1', input: { assetIds: Array(count).fill('1') } });
        expect(await accepts('update_product', input(100))).toBe(true);
        expect(await accepts('update_product', input(101))).toBe(false);
    });

    it('enforces the storage limits of shared short and long text fields', async () => {
        expect(await accepts('get_product', { slug: 'a'.repeat(255) })).toBe(true);
        expect(await accepts('get_product', { slug: 'a'.repeat(256) })).toBe(false);
        expect(await accepts('add_note_to_order', { id: '1', note: 'a'.repeat(10000) })).toBe(true);
        expect(await accepts('add_note_to_order', { id: '1', note: 'a'.repeat(10001) })).toBe(false);
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

    it('marks only tools that use the active order', () => {
        const activeOrderTools = shopProviders
            .filter(provider => metadataFor(provider).usesActiveOrder)
            .map(provider => metadataFor(provider).name)
            .sort();

        expect(activeOrderTools).toEqual(
            [
                'add_to_cart',
                'apply_coupon_code',
                'get_cart',
                'get_eligible_payment_methods',
                'get_eligible_shipping_methods',
                'place_order',
                'remove_coupon_code',
                'remove_from_cart',
                'set_checkout_details',
                'set_shipping_method',
                'update_cart_line',
            ].sort(),
        );
    });
});
