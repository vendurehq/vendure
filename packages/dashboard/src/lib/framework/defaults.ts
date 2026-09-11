import { registerAlert } from '@/vdb/framework/alert/alert-extensions.js';
import { searchIndexBufferAlert } from '@/vdb/framework/alert/search-index-buffer-alert/search-index-buffer-alert.js';
import { setNavMenuConfig } from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import { BUILT_IN_NAV_ITEM_IDS, BUILT_IN_NAV_SECTION_IDS } from '@/vdb/framework/nav-menu/nav-menu-ids.js';
import { ChartLine, Percent, Settings2, ShoppingBag, Tags, Terminal, Users } from 'lucide-react';

import { LatestCustomersWidget } from './dashboard-widget/latest-customers-widget/index.js';
import { LatestOrdersWidget } from './dashboard-widget/latest-orders-widget/index.js';
import { LowStockWidget } from './dashboard-widget/low-stock-widget/index.js';
import { MetricsWidget } from './dashboard-widget/metrics-widget/index.js';
import { OrdersSummaryWidget } from './dashboard-widget/orders-summary/index.js';
import { TopProductsWidget } from './dashboard-widget/top-products-widget/index.js';
import { registerDashboardWidget } from './dashboard-widget/widget-extensions.js';

export function registerDefaults() {
    setNavMenuConfig({
        sections: [
            {
                id: BUILT_IN_NAV_SECTION_IDS.Insights,
                title: /* i18n*/ 'Insights',
                placement: 'top',
                icon: ChartLine,
                url: '/',
                shortcut: 'd',
                order: 100,
            },
            {
                id: BUILT_IN_NAV_SECTION_IDS.Catalog,
                title: /* i18n*/ 'Catalog',
                icon: Tags,
                placement: 'top',
                order: 200,
                items: [
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Products,
                        title: /* i18n*/ 'Products',
                        url: '/products',
                        shortcut: 'p',
                        order: 100,
                        requiresPermission: ['ReadProduct', 'ReadCatalog'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.ProductVariants,
                        title: /* i18n*/ 'Product Variants',
                        url: '/product-variants',
                        order: 200,
                        requiresPermission: ['ReadProduct', 'ReadCatalog'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.OptionGroups,
                        title: /* i18n*/ 'Option Groups',
                        url: '/option-groups',
                        order: 250,
                        requiresPermission: ['ReadProduct', 'ReadCatalog'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Facets,
                        title: /* i18n*/ 'Facets',
                        url: '/facets',
                        order: 300,
                        requiresPermission: ['ReadProduct', 'ReadCatalog'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Collections,
                        title: /* i18n*/ 'Collections',
                        url: '/collections',
                        order: 400,
                        requiresPermission: ['ReadCollection', 'ReadCatalog'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Assets,
                        title: /* i18n*/ 'Assets',
                        url: '/assets',
                        shortcut: 'a',
                        order: 500,
                        requiresPermission: ['ReadAsset', 'ReadCatalog'],
                    },
                ],
            },
            {
                id: BUILT_IN_NAV_SECTION_IDS.Sales,
                title: /* i18n*/ 'Sales',
                icon: ShoppingBag,
                placement: 'top',
                order: 300,
                items: [
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Orders,
                        title: /* i18n*/ 'Orders',
                        url: '/orders',
                        shortcut: 'o',
                        order: 100,
                        requiresPermission: ['ReadOrder'],
                    },
                ],
            },
            {
                id: BUILT_IN_NAV_SECTION_IDS.Customers,
                title: /* i18n*/ 'Customers',
                icon: Users,
                placement: 'top',
                order: 400,
                items: [
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Customers,
                        title: /* i18n*/ 'Customers',
                        url: '/customers',
                        shortcut: 'c',
                        order: 100,
                        requiresPermission: ['ReadCustomer'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.CustomerGroups,
                        title: /* i18n*/ 'Customer Groups',
                        url: '/customer-groups',
                        order: 200,
                        requiresPermission: ['ReadCustomerGroup'],
                    },
                ],
            },
            {
                id: BUILT_IN_NAV_SECTION_IDS.Marketing,
                title: /* i18n*/ 'Marketing',
                icon: Percent,
                placement: 'top',
                order: 500,
                items: [
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Promotions,
                        title: /* i18n*/ 'Promotions',
                        url: '/promotions',
                        shortcut: 'm',
                        order: 100,
                        requiresPermission: ['ReadPromotion'],
                    },
                ],
            },
            {
                id: BUILT_IN_NAV_SECTION_IDS.System,
                title: /* i18n*/ 'System',
                icon: Terminal,
                placement: 'bottom',
                order: 200,
                items: [
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.JobQueue,
                        title: /* i18n*/ 'Job Queue',
                        url: '/job-queue',
                        order: 100,
                        requiresPermission: ['ReadSystem'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.ScheduledTasks,
                        title: /* i18n*/ 'Scheduled Tasks',
                        url: '/scheduled-tasks',
                        order: 300,
                        requiresPermission: ['ReadSystem'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.SettingsStore,
                        title: /* i18n*/ 'Settings Store',
                        url: '/settings-store',
                        order: 400,
                        requiresPermission: ['ReadSystem'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.ApiKeys,
                        title: /* i18n*/ 'API Keys',
                        url: '/api-keys',
                        order: 550,
                        requiresPermission: ['ReadApiKey'],
                    },
                ],
            },
            {
                id: BUILT_IN_NAV_SECTION_IDS.Settings,
                title: /* i18n*/ 'Settings',
                icon: Settings2,
                placement: 'bottom',
                order: 100,
                items: [
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Sellers,
                        title: /* i18n*/ 'Sellers',
                        url: '/sellers',
                        order: 100,
                        requiresPermission: ['ReadSeller'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Channels,
                        title: /* i18n*/ 'Channels',
                        url: '/channels',
                        order: 200,
                        requiresPermission: ['ReadChannel'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.StockLocations,
                        title: /* i18n*/ 'Stock Locations',
                        url: '/stock-locations',
                        order: 300,
                        requiresPermission: ['ReadStockLocation'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Administrators,
                        title: /* i18n*/ 'Administrators',
                        url: '/administrators',
                        order: 400,
                        requiresPermission: ['ReadAdministrator'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Roles,
                        title: /* i18n*/ 'Roles',
                        url: '/roles',
                        order: 500,
                        requiresPermission: ['ReadAdministrator'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.ShippingMethods,
                        title: /* i18n*/ 'Shipping Methods',
                        url: '/shipping-methods',
                        order: 600,
                        requiresPermission: ['ReadShippingMethod'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.PaymentMethods,
                        title: /* i18n*/ 'Payment Methods',
                        url: '/payment-methods',
                        order: 700,
                        requiresPermission: ['ReadPaymentMethod'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.TaxCategories,
                        title: /* i18n*/ 'Tax Categories',
                        url: '/tax-categories',
                        order: 800,
                        requiresPermission: ['ReadTaxCategory'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.TaxRates,
                        title: /* i18n*/ 'Tax Rates',
                        url: '/tax-rates',
                        order: 900,
                        requiresPermission: ['ReadTaxRate'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Countries,
                        title: /* i18n*/ 'Countries',
                        url: '/countries',
                        order: 1000,
                        requiresPermission: ['ReadCountry'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.Zones,
                        title: /* i18n*/ 'Zones',
                        url: '/zones',
                        order: 1100,
                        requiresPermission: ['ReadZone'],
                    },
                    {
                        id: BUILT_IN_NAV_ITEM_IDS.GlobalSettings,
                        title: /* i18n*/ 'Global Settings',
                        url: '/global-settings',
                        shortcut: 's',
                        order: 1200,
                        requiresPermission: ['UpdateGlobalSettings'],
                    },
                ],
            },
        ],
    });

    registerDashboardWidget({
        id: 'metrics-widget',
        name: /* i18n*/ 'Metrics Widget',
        component: MetricsWidget,
        defaultSize: { w: 12, h: 6, x: 0, y: 0 },
        minSize: { w: 6, h: 4 },
        requiresPermissions: ['ReadOrder'],
        // Matches DATA_TYPES.OrderTotal in the metrics widget component.
        defaultConfig: { dataType: 'OrderTotal' },
    });

    registerDashboardWidget({
        id: 'latest-orders-widget',
        name: /* i18n*/ 'Latest Orders Widget',
        component: LatestOrdersWidget,
        defaultSize: { w: 6, h: 7, x: 0, y: 0 },
        requiresPermissions: ['ReadOrder'],
    });

    registerDashboardWidget({
        id: 'orders-summary-widget',
        name: /* i18n*/ 'Orders Summary Widget',
        component: OrdersSummaryWidget,
        defaultSize: { w: 6, h: 3, x: 6, y: 0 },
        requiresPermissions: ['ReadOrder'],
    });

    registerDashboardWidget({
        id: 'top-products-widget',
        name: /* i18n*/ 'Top Products Widget',
        component: TopProductsWidget,
        defaultSize: { w: 4, h: 6, x: 0, y: 0 },
        minSize: { w: 3, h: 4 },
        requiresPermissions: ['ReadOrder'],
        // Matches the TopProductsMetric union in the top products widget component.
        defaultConfig: { metric: 'quantity' },
    });

    registerDashboardWidget({
        id: 'low-stock-widget',
        name: /* i18n*/ 'Low Stock Widget',
        component: LowStockWidget,
        defaultSize: { w: 4, h: 6, x: 4, y: 0 },
        minSize: { w: 3, h: 4 },
        requiresPermissions: ['ReadCatalog', 'ReadProduct'],
        // Matches THRESHOLD_OPTIONS in the low stock widget component.
        defaultConfig: { threshold: 10 },
    });

    registerDashboardWidget({
        id: 'latest-customers-widget',
        name: /* i18n*/ 'Latest Customers Widget',
        component: LatestCustomersWidget,
        defaultSize: { w: 4, h: 6, x: 8, y: 0 },
        minSize: { w: 3, h: 4 },
        requiresPermissions: ['ReadCustomer'],
    });

    registerAlert(searchIndexBufferAlert);
}
