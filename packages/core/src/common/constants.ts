import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { CrudPermissionDefinition, PermissionDefinition, PermissionMetadata } from './permission-definition';

/**
 * This value should be rarely used - only in those contexts where we have no access to the
 * VendureConfig to ensure at least a valid LanguageCode is available.
 */
export const DEFAULT_LANGUAGE_CODE = LanguageCode.en;
export const TRANSACTION_MANAGER_KEY = Symbol('TRANSACTION_MANAGER');
export const REQUEST_CONTEXT_KEY = 'vendureRequestContext';
export const REQUEST_CONTEXT_MAP_KEY = 'vendureRequestContextMap';
export const DEFAULT_PERMISSIONS: PermissionDefinition[] = [
    new PermissionDefinition({
        name: 'Authenticated',
        description: 'Authenticated means simply that the user is logged in',
        assignable: true,
        internal: true,
    }),
    new PermissionDefinition({
        name: 'SuperAdmin',
        description: 'SuperAdmin has unrestricted access to all operations',
        assignable: true,
        internal: true,
    }),
    new PermissionDefinition({
        name: 'Owner',
        description: "Owner means the user owns this entity, e.g. a Customer's own Order",
        assignable: false,
        internal: true,
    }),
    new PermissionDefinition({
        name: 'Public',
        description: 'Public means any unauthenticated user may perform the operation',
        assignable: false,
        internal: true,
    }),
    new PermissionDefinition({
        name: 'UpdateGlobalSettings',
        description: 'Grants permission to update GlobalSettings',
        assignable: true,
        internal: false,
    }),
    new CrudPermissionDefinition(
        'Catalog',
        operation => `Grants permission to ${operation} Products, Facets, Assets, Collections`,
    ),
    new CrudPermissionDefinition(
        'Settings',
        operation =>
            `Grants permission to ${operation} PaymentMethods, ShippingMethods, TaxCategories, TaxRates, Zones, Countries, System & GlobalSettings`,
    ),
    new CrudPermissionDefinition('Administrator'),
    new CrudPermissionDefinition('ApiKey'),
    new CrudPermissionDefinition('Asset'),
    new CrudPermissionDefinition('Channel'),
    new CrudPermissionDefinition('Collection'),
    new CrudPermissionDefinition('Country'),
    new CrudPermissionDefinition('Customer'),
    new CrudPermissionDefinition('CustomerGroup'),
    new CrudPermissionDefinition('Facet'),
    new CrudPermissionDefinition('Order'),
    new CrudPermissionDefinition('PaymentMethod'),
    new CrudPermissionDefinition('Product'),
    new CrudPermissionDefinition('Promotion'),
    new CrudPermissionDefinition('ShippingMethod'),
    new CrudPermissionDefinition('Tag'),
    new CrudPermissionDefinition('TaxCategory'),
    new CrudPermissionDefinition('TaxRate'),
    new CrudPermissionDefinition('Seller'),
    new CrudPermissionDefinition('StockLocation'),
    new CrudPermissionDefinition('System'),
    new CrudPermissionDefinition('Zone'),
];

export function getAllPermissionsMetadata(customPermissions: PermissionDefinition[]): PermissionMetadata[] {
    const allPermissions = [...DEFAULT_PERMISSIONS, ...customPermissions];
    return allPermissions.reduce((all, def) => [...all, ...def.getMetadata()], [] as PermissionMetadata[]);
}

export const CacheKey = {
    GlobalSettings: 'GlobalSettings',
    AllZones: 'AllZones',
    ActiveTaxZone: (channelId: ID) => `ActiveTaxZone:${channelId}`,
    ActiveTaxZone_PPA: (channelId: ID) => `ActiveTaxZone_PPA:${channelId}`,
    CollectionVariantCounts: 'CollectionService.getProductVariantCounts',
    ExhaustedPromotions: (channelId: ID, customerId: ID | undefined) =>
        `ExhaustedPromotions:${channelId}:${customerId ?? 'guest'}`,
};
