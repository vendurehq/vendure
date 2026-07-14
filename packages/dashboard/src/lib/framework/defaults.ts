import { registerAlert } from '@/vdb/framework/alert/alert-extensions.js';
import { searchIndexBufferAlert } from '@/vdb/framework/alert/search-index-buffer-alert/search-index-buffer-alert.js';
import { setNavMenuConfig } from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import { ChartLine, Percent, Settings2, ShoppingBag, Tags, Terminal, Users } from 'lucide-react';

import { LatestOrdersWidget } from './dashboard-widget/latest-orders-widget/index.js';
import { MetricsWidget } from './dashboard-widget/metrics-widget/index.js';
import { OrdersSummaryWidget } from './dashboard-widget/orders-summary/index.js';
import { registerDashboardWidget } from './dashboard-widget/widget-extensions.js';

export function registerDefaults() {
    setNavMenuConfig({
        sections: [
            {
                id: 'insights',
                title: /* i18n*/ 'Insights',
                placement: 'top',
                icon: ChartLine,
                url: '/',
                order: 100,
            },
            {
                id: 'catalog',
                title: /* i18n*/ 'Catalog',
                icon: Tags,
                placement: 'top',
                order: 200,
                items: [
                    {
                        id: 'products',
                        title: /* i18n*/ 'Products',
                        url: '/products',
                        order: 100,
                        requiresPermission: ['ReadProduct', 'ReadCatalog'],
                    },
                    {
                        id: 'product-variants',
                        title: /* i18n*/ 'Product Variants',
                        url: '/product-variants',
                        order: 200,
                        requiresPermission: ['ReadProduct', 'ReadCatalog'],
                    },
                    {
                        id: 'option-groups',
                        title: /* i18n*/ 'Option Groups',
                        url: '/option-groups',
                        order: 250,
                        requiresPermission: ['ReadProduct', 'ReadCatalog'],
                    },
                    {
                        id: 'facets',
                        title: /* i18n*/ 'Facets',
                        url: '/facets',
                        order: 300,
                        requiresPermission: ['ReadProduct', 'ReadCatalog'],
                    },
                    {
                        id: 'collections',
                        title: /* i18n*/ 'Collections',
                        url: '/collections',
                        order: 400,
                        requiresPermission: ['ReadCollection', 'ReadCatalog'],
                    },
                    {
                        id: 'assets',
                        title: /* i18n*/ 'Assets',
                        url: '/assets',
                        order: 500,
                        requiresPermission: ['ReadAsset', 'ReadCatalog'],
                    },
                ],
            },
            {
                id: 'sales',
                title: /* i18n*/ 'Sales',
                icon: ShoppingBag,
                placement: 'top',
                order: 300,
                items: [
                    {
                        id: 'orders',
                        title: /* i18n*/ 'Orders',
                        url: '/orders',
                        order: 100,
                        requiresPermission: ['ReadOrder'],
                    },
                ],
            },
            {
                id: 'customers',
                title: /* i18n*/ 'Customers',
                icon: Users,
                placement: 'top',
                order: 400,
                items: [
                    {
                        id: 'customers',
                        title: /* i18n*/ 'Customers',
                        url: '/customers',
                        order: 100,
                        requiresPermission: ['ReadCustomer'],
                    },
                    {
                        id: 'customer-groups',
                        title: /* i18n*/ 'Customer Groups',
                        url: '/customer-groups',
                        order: 200,
                        requiresPermission: ['ReadCustomerGroup'],
                    },
                ],
            },
            {
                id: 'marketing',
                title: /* i18n*/ 'Marketing',
                icon: Percent,
                placement: 'top',
                order: 500,
                items: [
                    {
                        id: 'promotions',
                        title: /* i18n*/ 'Promotions',
                        url: '/promotions',
                        order: 100,
                        requiresPermission: ['ReadPromotion'],
                    },
                ],
            },
            {
                id: 'system',
                title: /* i18n*/ 'System',
                icon: Terminal,
                placement: 'bottom',
                order: 200,
                items: [
                    {
                        id: 'job-queue',
                        title: /* i18n*/ 'Job Queue',
                        url: '/job-queue',
                        order: 100,
                        requiresPermission: ['ReadSystem'],
                    },
                    {
                        id: 'scheduled-tasks',
                        title: /* i18n*/ 'Scheduled Tasks',
                        url: '/scheduled-tasks',
                        order: 300,
                        requiresPermission: ['ReadSystem'],
                    },
                    {
                        id: 'settings-store',
                        title: /* i18n*/ 'Settings Store',
                        url: '/settings-store',
                        order: 400,
                        requiresPermission: ['ReadSystem'],
                    },
                    {
                        id: 'api-keys',
                        title: /* i18n*/ 'API Keys',
                        url: '/api-keys',
                        order: 550,
                        requiresPermission: ['ReadApiKey'],
                    },
                ],
            },
            {
                id: 'settings',
                title: /* i18n*/ 'Settings',
                icon: Settings2,
                placement: 'bottom',
                order: 100,
                items: [
                    {
                        id: 'sellers',
                        title: /* i18n*/ 'Sellers',
                        url: '/sellers',
                        order: 100,
                        requiresPermission: ['ReadSeller'],
                    },
                    {
                        id: 'channels',
                        title: /* i18n*/ 'Channels',
                        url: '/channels',
                        order: 200,
                        requiresPermission: ['ReadChannel'],
                    },
                    {
                        id: 'stock-locations',
                        title: /* i18n*/ 'Stock Locations',
                        url: '/stock-locations',
                        order: 300,
                        requiresPermission: ['ReadStockLocation'],
                    },
                    {
                        id: 'administrators',
                        title: /* i18n*/ 'Administrators',
                        url: '/administrators',
                        order: 400,
                        requiresPermission: ['ReadAdministrator'],
                    },
                    {
                        id: 'roles',
                        title: /* i18n*/ 'Roles',
                        url: '/roles',
                        order: 500,
                        requiresPermission: ['ReadAdministrator'],
                    },
                    {
                        id: 'shipping-methods',
                        title: /* i18n*/ 'Shipping Methods',
                        url: '/shipping-methods',
                        order: 600,
                        requiresPermission: ['ReadShippingMethod'],
                    },
                    {
                        id: 'payment-methods',
                        title: /* i18n*/ 'Payment Methods',
                        url: '/payment-methods',
                        order: 700,
                        requiresPermission: ['ReadPaymentMethod'],
                    },
                    {
                        id: 'tax-categories',
                        title: /* i18n*/ 'Tax Categories',
                        url: '/tax-categories',
                        order: 800,
                        requiresPermission: ['ReadTaxCategory'],
                    },
                    {
                        id: 'tax-rates',
                        title: /* i18n*/ 'Tax Rates',
                        url: '/tax-rates',
                        order: 900,
                        requiresPermission: ['ReadTaxRate'],
                    },
                    {
                        id: 'countries',
                        title: /* i18n*/ 'Countries',
                        url: '/countries',
                        order: 1000,
                        requiresPermission: ['ReadCountry'],
                    },
                    {
                        id: 'zones',
                        title: /* i18n*/ 'Zones',
                        url: '/zones',
                        order: 1100,
                        requiresPermission: ['ReadZone'],
                    },
                    {
                        id: 'global-settings',
                        title: /* i18n*/ 'Global Settings',
                        url: '/global-settings',
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

    registerAlert(searchIndexBufferAlert);
}
