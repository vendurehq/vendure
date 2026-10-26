/**
 * @description
 * The ids of the navigation entries which sit directly in `NavMenuConfig.sections`.
 * These are the ids to pass as the `sections` of a {@link NavMenuTarget}, or to match on
 * when writing a `navSections` function.
 *
 * `insights` is a link rather than a section, but it occupies a top-level slot in
 * `sections` and is targeted the same way.
 *
 * `Insights` (`insights`), `Catalog` (`catalog`), `Sales` (`sales`),
 * `Customers` (`customers`), `Marketing` (`marketing`), `System` (`system`),
 * `Settings` (`settings`).
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export const BUILT_IN_NAV_SECTION_IDS = {
    Insights: 'insights',
    Catalog: 'catalog',
    Sales: 'sales',
    Customers: 'customers',
    Marketing: 'marketing',
    System: 'system',
    Settings: 'settings',
} as const;

/**
 * @description
 * The ids of the navigation items nested inside the built-in sections. These are the ids
 * to pass as the `items` of a {@link NavMenuTarget}.
 *
 * A section and an item may share an id, as the Customers section and the Customers
 * item do. This is why a {@link NavMenuTarget} names the two separately.
 *
 * Under `catalog`: `Products` (`products`), `ProductVariants` (`product-variants`),
 * `OptionGroups` (`option-groups`), `Facets` (`facets`), `Collections` (`collections`),
 * `Assets` (`assets`). Under `sales`: `Orders` (`orders`). Under `customers`:
 * `Customers` (`customers`), `CustomerGroups` (`customer-groups`). Under `marketing`:
 * `Promotions` (`promotions`). Under `system`: `JobQueue` (`job-queue`),
 * `ScheduledTasks` (`scheduled-tasks`), `SettingsStore` (`settings-store`),
 * `ApiKeys` (`api-keys`). Under `settings`: `Sellers` (`sellers`), `Channels` (`channels`),
 * `StockLocations` (`stock-locations`), `Administrators` (`administrators`),
 * `Roles` (`roles`), `ShippingMethods` (`shipping-methods`),
 * `PaymentMethods` (`payment-methods`), `TaxCategories` (`tax-categories`),
 * `TaxRates` (`tax-rates`), `Countries` (`countries`), `Zones` (`zones`),
 * `GlobalSettings` (`global-settings`).
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export const BUILT_IN_NAV_ITEM_IDS = {
    // catalog
    Products: 'products',
    ProductVariants: 'product-variants',
    OptionGroups: 'option-groups',
    Facets: 'facets',
    Collections: 'collections',
    Assets: 'assets',
    // sales
    Orders: 'orders',
    // customers
    Customers: 'customers',
    CustomerGroups: 'customer-groups',
    // marketing
    Promotions: 'promotions',
    // system
    JobQueue: 'job-queue',
    ScheduledTasks: 'scheduled-tasks',
    SettingsStore: 'settings-store',
    ApiKeys: 'api-keys',
    // settings
    Sellers: 'sellers',
    Channels: 'channels',
    StockLocations: 'stock-locations',
    Administrators: 'administrators',
    Roles: 'roles',
    ShippingMethods: 'shipping-methods',
    PaymentMethods: 'payment-methods',
    TaxCategories: 'tax-categories',
    TaxRates: 'tax-rates',
    Countries: 'countries',
    Zones: 'zones',
    GlobalSettings: 'global-settings',
} as const;

/**
 * @description
 * The id of a built-in top-level navigation entry.
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export type BuiltInNavSectionId = (typeof BUILT_IN_NAV_SECTION_IDS)[keyof typeof BUILT_IN_NAV_SECTION_IDS];

/**
 * @description
 * The id of a built-in navigation item.
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export type BuiltInNavItemId = (typeof BUILT_IN_NAV_ITEM_IDS)[keyof typeof BUILT_IN_NAV_ITEM_IDS];
