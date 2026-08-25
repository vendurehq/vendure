import { Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_METADATA_KEY, Permission } from '@vendure/core';
import { describe, expect, it } from 'vitest';

// Core admin resolvers are not exported from the @vendure/core barrel, so we import them directly to
// reflect their live @Allow metadata. If a resolver's permissions drift, this test breaks loudly.
import { AssetResolver } from '../../../../../core/src/api/resolvers/admin/asset.resolver';
import { ChannelResolver } from '../../../../../core/src/api/resolvers/admin/channel.resolver';
import { CustomerGroupResolver } from '../../../../../core/src/api/resolvers/admin/customer-group.resolver';
import { CustomerResolver } from '../../../../../core/src/api/resolvers/admin/customer.resolver';
import { OrderResolver } from '../../../../../core/src/api/resolvers/admin/order.resolver';
import { ProductResolver } from '../../../../../core/src/api/resolvers/admin/product.resolver';
import { metadataFor } from '../spec-helpers';

import { adminToolProviders } from './index';

interface ResolverOperation {
    resolver: Type<any>;
    method: string;
}

// Only this tool -> core operation map is written by hand. The permission values themselves are read
// off the resolver @Allow metadata below, so they can never go stale.
const TOOL_OPERATION_MAP: Record<string, ResolverOperation> = {
    list_orders: { resolver: OrderResolver, method: 'orders' },
    get_order: { resolver: OrderResolver, method: 'order' },
    update_order_state: { resolver: OrderResolver, method: 'transitionOrderToState' },
    cancel_order: { resolver: OrderResolver, method: 'cancelOrder' },
    refund_order: { resolver: OrderResolver, method: 'refundOrder' },
    add_note_to_order: { resolver: OrderResolver, method: 'addNoteToOrder' },
    list_customers: { resolver: CustomerResolver, method: 'customers' },
    get_customer: { resolver: CustomerResolver, method: 'customer' },
    create_customer: { resolver: CustomerResolver, method: 'createCustomer' },
    update_customer: { resolver: CustomerResolver, method: 'updateCustomer' },
    add_customer_to_group: { resolver: CustomerGroupResolver, method: 'addCustomersToGroup' },
    list_customer_groups: { resolver: CustomerGroupResolver, method: 'customerGroups' },
    list_products: { resolver: ProductResolver, method: 'products' },
    get_product: { resolver: ProductResolver, method: 'product' },
    create_product: { resolver: ProductResolver, method: 'createProduct' },
    update_product: { resolver: ProductResolver, method: 'updateProduct' },
    create_variant: { resolver: ProductResolver, method: 'createProductVariants' },
    update_variant: { resolver: ProductResolver, method: 'updateProductVariants' },
    upload_asset: { resolver: AssetResolver, method: 'createAssets' },
    // Reading a variant's stock is gated by the productVariant read query (the stockLevels field
    // resolver itself carries no @Allow).
    get_stock_levels: { resolver: ProductResolver, method: 'productVariant' },
    adjust_stock: { resolver: ProductResolver, method: 'updateProductVariants' },
    list_channels: { resolver: ChannelResolver, method: 'channels' },
};

// Tools with no matching core resolver operation, deliberately guarded by [Authenticated] alone.
// set_active_channel only rewrites the caller's own grant row, which core has no operation for,
// and the channel it switches to is checked against the caller's own accessible channels.
const AUTHENTICATED_EXCEPTIONS = ['set_active_channel'];

const reflector = new Reflector();

function resolverPermissions({ resolver, method }: ResolverOperation): Permission[] {
    const handler = resolver.prototype[method];
    if (typeof handler !== 'function') {
        throw new Error(`${resolver.name}.${method} is not a resolver method`);
    }
    return reflector.get<Permission[]>(PERMISSIONS_METADATA_KEY, handler) ?? [];
}

describe('admin tool permission parity', () => {
    const adminTools = adminToolProviders.map(provider => metadataFor(provider as Type<any>));

    it('maps exactly the registered admin tools (mapped operations + documented exceptions)', () => {
        const registered = adminTools.map(tool => tool.name).sort();
        const expected = [...Object.keys(TOOL_OPERATION_MAP), ...AUTHENTICATED_EXCEPTIONS].sort();
        expect(registered).toEqual(expected);
    });

    it.each(Object.keys(TOOL_OPERATION_MAP))(
        '%s declared permissions are a subset of the core resolver @Allow set',
        name => {
            const tool = adminTools.find(candidate => candidate.name === name);
            if (!tool) {
                throw new Error(`${name} is not a registered admin tool`);
            }
            const allowed = resolverPermissions(TOOL_OPERATION_MAP[name]);
            expect(allowed.length, `${name}: resolver has no @Allow to compare against`).toBeGreaterThan(0);
            const declared = tool.permissions ?? [Permission.Public];
            for (const permission of declared) {
                expect(
                    allowed,
                    `${name} declares "${permission}" which the core resolver does not grant`,
                ).toContain(permission);
            }
        },
    );

    it.each(AUTHENTICATED_EXCEPTIONS)('%s is a documented [Authenticated] exception', name => {
        const tool = adminTools.find(candidate => candidate.name === name);
        if (!tool) {
            throw new Error(`${name} is not a registered admin tool`);
        }
        expect(tool.permissions).toEqual([Permission.Authenticated]);
    });
});
