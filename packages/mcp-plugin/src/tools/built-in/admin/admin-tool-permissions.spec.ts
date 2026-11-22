import { Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_METADATA_KEY, Permission } from '@vendure/core';
import { describe, expect, it } from 'vitest';

// Core admin resolvers are not exported from the @vendure/core barrel, so we import them directly to
// reflect their live @Allow metadata. If a resolver's permissions drift, this test breaks loudly.
import { AssetResolver } from '../../../../../core/src/api/resolvers/admin/asset.resolver';
import { ChannelResolver } from '../../../../../core/src/api/resolvers/admin/channel.resolver';
import { CountryResolver } from '../../../../../core/src/api/resolvers/admin/country.resolver';
import { CustomerGroupResolver } from '../../../../../core/src/api/resolvers/admin/customer-group.resolver';
import { CustomerResolver } from '../../../../../core/src/api/resolvers/admin/customer.resolver';
import { OrderResolver } from '../../../../../core/src/api/resolvers/admin/order.resolver';
import { PaymentMethodResolver } from '../../../../../core/src/api/resolvers/admin/payment-method.resolver';
import { ProductResolver } from '../../../../../core/src/api/resolvers/admin/product.resolver';
import { RoleResolver } from '../../../../../core/src/api/resolvers/admin/role.resolver';
import { SettingsStoreAdminResolver } from '../../../../../core/src/api/resolvers/admin/settings-store.resolver';
import { ShippingMethodResolver } from '../../../../../core/src/api/resolvers/admin/shipping-method.resolver';
import { StockLocationResolver } from '../../../../../core/src/api/resolvers/admin/stock-location.resolver';
import { StoreReadinessResolver } from '../../../../../core/src/api/resolvers/admin/store-readiness.resolver';
import { TaxCategoryResolver } from '../../../../../core/src/api/resolvers/admin/tax-category.resolver';
import { TaxRateResolver } from '../../../../../core/src/api/resolvers/admin/tax-rate.resolver';
import { ZoneResolver } from '../../../../../core/src/api/resolvers/admin/zone.resolver';
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
    create_fulfillment: { resolver: OrderResolver, method: 'addFulfillmentToOrder' },
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
    get_channel: { resolver: ChannelResolver, method: 'channel' },
    create_channel: { resolver: ChannelResolver, method: 'createChannel' },
    update_channel: { resolver: ChannelResolver, method: 'updateChannel' },
    list_zones: { resolver: ZoneResolver, method: 'zones' },
    create_zone: { resolver: ZoneResolver, method: 'createZone' },
    // update_zone changes members with addMembersToZone and removeMembersFromZone, which carry the
    // same @Allow as updateZone.
    update_zone: { resolver: ZoneResolver, method: 'updateZone' },
    list_countries: { resolver: CountryResolver, method: 'countries' },
    enable_countries: { resolver: CountryResolver, method: 'updateCountry' },
    list_tax_categories: { resolver: TaxCategoryResolver, method: 'taxCategories' },
    create_tax_category: { resolver: TaxCategoryResolver, method: 'createTaxCategory' },
    update_tax_category: { resolver: TaxCategoryResolver, method: 'updateTaxCategory' },
    list_tax_rates: { resolver: TaxRateResolver, method: 'taxRates' },
    create_tax_rate: { resolver: TaxRateResolver, method: 'createTaxRate' },
    update_tax_rate: { resolver: TaxRateResolver, method: 'updateTaxRate' },
    list_shipping_methods: { resolver: ShippingMethodResolver, method: 'shippingMethods' },
    create_shipping_method: { resolver: ShippingMethodResolver, method: 'createShippingMethod' },
    update_shipping_method: { resolver: ShippingMethodResolver, method: 'updateShippingMethod' },
    // The checkers, calculators and fulfillment handlers queries share one @Allow.
    list_shipping_options: { resolver: ShippingMethodResolver, method: 'shippingCalculators' },
    list_payment_methods: { resolver: PaymentMethodResolver, method: 'paymentMethods' },
    create_payment_method: { resolver: PaymentMethodResolver, method: 'createPaymentMethod' },
    update_payment_method: { resolver: PaymentMethodResolver, method: 'updatePaymentMethod' },
    // The handlers and eligibility checkers queries share one @Allow.
    list_payment_options: { resolver: PaymentMethodResolver, method: 'paymentMethodHandlers' },
    list_stock_locations: { resolver: StockLocationResolver, method: 'stockLocations' },
    create_stock_location: { resolver: StockLocationResolver, method: 'createStockLocation' },
    update_stock_location: { resolver: StockLocationResolver, method: 'updateStockLocation' },
    list_roles: { resolver: RoleResolver, method: 'roles' },
    create_role: { resolver: RoleResolver, method: 'createRole' },
    update_role: { resolver: RoleResolver, method: 'updateRole' },
    // The settings store checks each field's own read and write permissions inside the call.
    get_setting: { resolver: SettingsStoreAdminResolver, method: 'getSettingsStoreValue' },
    set_setting: { resolver: SettingsStoreAdminResolver, method: 'setSettingsStoreValue' },
    check_store: { resolver: StoreReadinessResolver, method: 'storeReadiness' },
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
