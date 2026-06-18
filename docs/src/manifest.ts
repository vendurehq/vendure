import type { DocsPackageManifestInput, FileInfo } from '@vendure-io/docs-provider';
import { createNestedNavigationFromFolder, resolveManifest } from '@vendure-io/docs-provider';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(packageRoot);
const lernaJson = JSON.parse(readFileSync(join(repoRoot, 'lerna.json'), 'utf-8'));

const file = (relativePath: string) => join(packageRoot, relativePath);
const folder = (relativePath: string) => join(packageRoot, relativePath);

const manifestInput: DocsPackageManifestInput = {
    id: 'core',
    name: 'Vendure Core Documentation',
    version: lernaJson.version,
    vendureVersion: 'v3',
    basePath: packageRoot,
    navigation: [
        // Learn Sidebar
        {
            title: 'Getting Started',
            slug: 'getting-started',
            children: [
                {
                    title: 'Installation',
                    slug: 'installation',
                    file: file('docs/guides/getting-started/installation/index.mdx'),
                },
                {
                    title: 'Introducing GraphQL',
                    slug: 'graphql-intro',
                    file: file('docs/guides/getting-started/graphql-intro/index.mdx'),
                },
                {
                    title: 'Try the API',
                    slug: 'try-the-api',
                    file: file('docs/guides/getting-started/try-the-api/index.mdx'),
                },
            ],
        },
        {
            title: 'Core Concepts',
            slug: 'core-concepts',
            file: file('docs/guides/core-concepts/index.mdx'),
            children: [
                // Merchandising
                {
                    title: 'Pricing',
                    slug: 'pricing',
                    file: file('docs/guides/core-concepts/pricing/index.mdx'),
                },
                {
                    title: 'Products',
                    slug: 'products',
                    file: file('docs/guides/core-concepts/products/index.mdx'),
                },
                {
                    title: 'Promotions',
                    slug: 'promotions',
                    file: file('docs/guides/core-concepts/promotions/index.mdx'),
                },
                {
                    title: 'Assets',
                    slug: 'images-assets',
                    file: file('docs/guides/core-concepts/images-assets/index.mdx'),
                },
                // Product Discovery
                {
                    title: 'Search',
                    slug: 'search',
                    file: file('docs/guides/core-concepts/search/index.mdx'),
                },
                {
                    title: 'Facets & Filters',
                    slug: 'facets-filters',
                    file: file('docs/guides/core-concepts/facets-filters/index.mdx'),
                },
                {
                    title: 'Collections',
                    slug: 'collections',
                    file: file('docs/guides/core-concepts/collections/index.mdx'),
                },
                // Cart & Purchase
                {
                    title: 'Cart',
                    slug: 'cart',
                    file: file('docs/guides/core-concepts/cart/index.mdx'),
                },
                {
                    title: 'Payment',
                    slug: 'payment',
                    file: file('docs/guides/core-concepts/payment/index.mdx'),
                },
                {
                    title: 'Customers',
                    slug: 'customers',
                    file: file('docs/guides/core-concepts/customers/index.mdx'),
                },
                // Order Management
                {
                    title: 'Orders',
                    slug: 'orders',
                    file: file('docs/guides/core-concepts/orders/index.mdx'),
                },
                {
                    title: 'Fulfillment',
                    slug: 'fulfillment',
                    file: file('docs/guides/core-concepts/fulfillment/index.mdx'),
                },
                {
                    title: 'Inventory',
                    slug: 'stock-control',
                    file: file('docs/guides/core-concepts/stock-control/index.mdx'),
                },
                // Internationalization
                {
                    title: 'Currency',
                    slug: 'money',
                    file: file('docs/guides/core-concepts/money/index.mdx'),
                },
                {
                    title: 'Zones',
                    slug: 'zones',
                    file: file('docs/guides/core-concepts/zones/index.mdx'),
                },
                {
                    title: 'Language',
                    slug: 'language',
                    file: file('docs/guides/core-concepts/language/index.mdx'),
                },
                {
                    title: 'Taxes',
                    slug: 'taxes',
                    file: file('docs/guides/core-concepts/taxes/index.mdx'),
                },
                // User Access
                {
                    title: 'User Management',
                    slug: 'user-management',
                    file: file('docs/guides/core-concepts/user-management/index.mdx'),
                },
                {
                    title: 'Roles',
                    slug: 'roles',
                    file: file('docs/guides/core-concepts/roles/index.mdx'),
                },
                {
                    title: 'Permissions',
                    slug: 'permissions',
                    file: file('docs/guides/core-concepts/permissions/index.mdx'),
                },
                // System Integration
                {
                    title: 'Job Queue',
                    slug: 'job-queue',
                    file: file('docs/guides/core-concepts/job-queue/index.mdx'),
                },
                {
                    title: 'Healthchecks',
                    slug: 'healthchecks',
                    file: file('docs/guides/core-concepts/healthchecks/index.mdx'),
                },
                // Overview pages (not on homepage grid but retained)
                {
                    title: 'Auth',
                    slug: 'auth',
                    file: file('docs/guides/core-concepts/auth/index.mdx'),
                },
                {
                    title: 'Channels',
                    slug: 'channels',
                    file: file('docs/guides/core-concepts/channels/index.mdx'),
                },
                {
                    title: 'Email',
                    slug: 'email',
                    file: file('docs/guides/core-concepts/email/index.mdx'),
                },
                {
                    title: 'Shipping',
                    slug: 'shipping',
                    file: file('docs/guides/core-concepts/shipping/index.mdx'),
                },
            ],
        },
        {
            title: 'Developer Guide',
            slug: 'developer-guide',
            children: [
                // Overview section
                {
                    title: 'Overview',
                    slug: 'overview',
                    file: file('docs/guides/developer-guide/overview/index.mdx'),
                },
                {
                    title: 'The API Layer',
                    slug: 'the-api-layer',
                    file: file('docs/guides/developer-guide/the-api-layer/index.mdx'),
                },
                {
                    title: 'The Service Layer',
                    slug: 'the-service-layer',
                    file: file('docs/guides/developer-guide/the-service-layer/index.mdx'),
                },
                // Fundamentals section
                {
                    title: 'CLI',
                    slug: 'cli',
                    file: file('docs/guides/developer-guide/cli/index.mdx'),
                },
                {
                    title: 'Configuration',
                    slug: 'configuration',
                    file: file('docs/guides/developer-guide/configuration/index.mdx'),
                },
                {
                    title: 'Custom Fields',
                    slug: 'custom-fields',
                    file: file('docs/guides/developer-guide/custom-fields/index.mdx'),
                },
                {
                    title: 'Error Handling',
                    slug: 'error-handling',
                    file: file('docs/guides/developer-guide/error-handling/index.mdx'),
                },
                {
                    title: 'Events',
                    slug: 'events',
                    file: file('docs/guides/developer-guide/events/index.mdx'),
                },
                {
                    title: 'Migrations',
                    slug: 'migrations',
                    file: file('docs/guides/developer-guide/migrations/index.mdx'),
                },
                {
                    title: 'Plugins',
                    slug: 'plugins',
                    file: file('docs/guides/developer-guide/plugins/index.mdx'),
                },
                {
                    title: 'Security',
                    slug: 'security',
                    file: file('docs/guides/developer-guide/security/index.mdx'),
                },
                {
                    title: 'API Keys',
                    slug: 'api-keys',
                    file: file('docs/guides/developer-guide/api-keys/index.mdx'),
                },
                {
                    title: 'Strategies & Configurable Operations',
                    slug: 'strategies-configurable-operations',
                    file: file('docs/guides/developer-guide/strategies-configurable-operations/index.mdx'),
                },
                {
                    title: 'Testing',
                    slug: 'testing',
                    file: file('docs/guides/developer-guide/testing/index.mdx'),
                },
                {
                    title: 'Updating',
                    slug: 'updating',
                    file: file('docs/guides/developer-guide/updating/index.mdx'),
                },
                {
                    title: 'Worker & Job Queue',
                    slug: 'worker-job-queue',
                    file: file('docs/guides/developer-guide/worker-job-queue/index.mdx'),
                },
                {
                    title: 'Settings Store',
                    slug: 'settings-store',
                    file: file('docs/guides/developer-guide/settings-store/index.mdx'),
                },
                // Extend section
                {
                    title: 'REST Endpoint',
                    slug: 'rest-endpoint',
                    file: file('docs/guides/developer-guide/rest-endpoint/index.mdx'),
                },
                {
                    title: 'Custom Permissions',
                    slug: 'custom-permissions',
                    file: file('docs/guides/developer-guide/custom-permissions/index.mdx'),
                },
                {
                    title: 'Database Entity',
                    slug: 'database-entity',
                    file: file('docs/guides/developer-guide/database-entity/index.mdx'),
                },
                {
                    title: 'Extend GraphQL API',
                    slug: 'extend-graphql-api',
                    file: file('docs/guides/developer-guide/extend-graphql-api/index.mdx'),
                },
                // Advanced Topics section
                {
                    title: 'Custom Strategies in Plugins',
                    slug: 'custom-strategies-in-plugins',
                    file: file('docs/guides/developer-guide/custom-strategies-in-plugins/index.mdx'),
                },
                {
                    title: 'Channel Aware',
                    slug: 'channel-aware',
                    file: file('docs/guides/developer-guide/channel-aware/index.mdx'),
                },
                {
                    title: 'Translatable',
                    slug: 'translatable',
                    file: file('docs/guides/developer-guide/translatable/index.mdx'),
                },
                {
                    title: 'Has Custom Fields',
                    slug: 'has-custom-fields',
                    file: file('docs/guides/developer-guide/has-custom-fields/index.mdx'),
                },
                {
                    title: 'Cache',
                    slug: 'cache',
                    file: file('docs/guides/developer-guide/cache/index.mdx'),
                },
                {
                    title: 'Dataloaders',
                    slug: 'dataloaders',
                    file: file('docs/guides/developer-guide/dataloaders/index.mdx'),
                },
                {
                    title: 'DB Subscribers',
                    slug: 'db-subscribers',
                    file: file('docs/guides/developer-guide/db-subscribers/index.mdx'),
                },
                {
                    title: 'Importing Data',
                    slug: 'importing-data',
                    file: file('docs/guides/developer-guide/importing-data/index.mdx'),
                },
                {
                    title: 'Logging',
                    slug: 'logging',
                    file: file('docs/guides/developer-guide/logging/index.mdx'),
                },
                {
                    title: 'Scheduled Tasks',
                    slug: 'scheduled-tasks',
                    file: file('docs/guides/developer-guide/scheduled-tasks/index.mdx'),
                },
                {
                    title: 'Stand-alone Scripts',
                    slug: 'stand-alone-scripts',
                    file: file('docs/guides/developer-guide/stand-alone-scripts/index.mdx'),
                },
                {
                    title: 'Translations',
                    slug: 'translations',
                    file: file('docs/guides/developer-guide/translations/index.mdx'),
                },
                {
                    title: 'Uploading Files',
                    slug: 'uploading-files',
                    file: file('docs/guides/developer-guide/uploading-files/index.mdx'),
                },
                {
                    title: 'Nest DevTools',
                    slug: 'nest-devtools',
                    file: file('docs/guides/developer-guide/nest-devtools/index.mdx'),
                },
                {
                    title: 'Telemetry',
                    slug: 'telemetry',
                    file: file('docs/guides/developer-guide/telemetry/index.mdx'),
                },
            ],
        },
        {
            title: 'How-to Guides',
            slug: 'how-to',
            children: [
                {
                    title: 'CMS Integration Plugin',
                    slug: 'cms-integration-plugin',
                    file: file('docs/guides/how-to/cms-integration-plugin/index.mdx'),
                },
                {
                    title: 'Codegen',
                    slug: 'codegen',
                    file: file('docs/guides/how-to/codegen/index.mdx'),
                },
                {
                    title: 'Configurable Products',
                    slug: 'configurable-products',
                    file: file('docs/guides/how-to/configurable-products/index.mdx'),
                },
                {
                    title: 'Digital Products',
                    slug: 'digital-products',
                    file: file('docs/guides/how-to/digital-products/index.mdx'),
                },
                {
                    title: 'GitHub OAuth Authentication',
                    slug: 'github-oauth-authentication',
                    file: file('docs/guides/how-to/github-oauth-authentication/index.mdx'),
                },
                {
                    title: 'Google OAuth Authentication',
                    slug: 'google-oauth-authentication',
                    file: file('docs/guides/how-to/google-oauth-authentication/index.mdx'),
                },
                {
                    title: 'Multi-vendor Marketplaces',
                    slug: 'multi-vendor-marketplaces',
                    file: file('docs/guides/how-to/multi-vendor-marketplaces/index.mdx'),
                },
                {
                    title: 'Paginated List',
                    slug: 'paginated-list',
                    file: file('docs/guides/how-to/paginated-list/index.mdx'),
                },
                {
                    title: 'Publish Plugin',
                    slug: 'publish-plugin',
                    file: file('docs/guides/how-to/publish-plugin/index.mdx'),
                },
                {
                    title: 'S3 Asset Storage',
                    slug: 's3-asset-storage',
                    file: file('docs/guides/how-to/s3-asset-storage/index.mdx'),
                },
                {
                    title: 'Telemetry',
                    slug: 'telemetry',
                    file: file('docs/guides/how-to/telemetry/index.mdx'),
                },
            ],
        },
        {
            title: 'React Admin Dashboard',
            slug: 'extending-the-dashboard',
            children: [
                {
                    title: 'Getting Started',
                    slug: 'getting-started',
                    file: file('docs/guides/extending-the-dashboard/getting-started/index.mdx'),
                },
                {
                    title: 'Extending Overview',
                    slug: 'extending-overview',
                    file: file('docs/guides/extending-the-dashboard/extending-overview/index.mdx'),
                },
                {
                    title: 'Public API & Imports',
                    slug: 'public-api',
                    file: file('docs/guides/extending-the-dashboard/public-api/index.mdx'),
                },
                {
                    title: 'Creating Pages',
                    slug: 'creating-pages',
                    file: file('docs/guides/extending-the-dashboard/creating-pages/index.mdx'),
                    children: [
                        {
                            title: 'List Pages',
                            slug: 'list-pages',
                            file: file('docs/guides/extending-the-dashboard/creating-pages/list-pages.mdx'),
                        },
                        {
                            title: 'Detail Pages',
                            slug: 'detail-pages',
                            file: file('docs/guides/extending-the-dashboard/creating-pages/detail-pages.mdx'),
                        },
                        {
                            title: 'Tabbed Pages',
                            slug: 'tabbed-pages',
                            file: file('docs/guides/extending-the-dashboard/creating-pages/tabbed-pages.mdx'),
                        },
                    ],
                },
                {
                    title: 'Customizing Pages',
                    slug: 'customizing-pages',
                    file: file('docs/guides/extending-the-dashboard/customizing-pages/index.mdx'),
                    children: [
                        {
                            title: 'Customizing List Pages',
                            slug: 'customizing-list-pages',
                            file: file(
                                'docs/guides/extending-the-dashboard/customizing-pages/customizing-list-pages.mdx',
                            ),
                        },
                        {
                            title: 'Customizing Detail Pages',
                            slug: 'customizing-detail-pages',
                            file: file(
                                'docs/guides/extending-the-dashboard/customizing-pages/customizing-detail-pages.mdx',
                            ),
                        },
                        {
                            title: 'Customizing Login Page',
                            slug: 'customizing-login-page',
                            file: file(
                                'docs/guides/extending-the-dashboard/customizing-pages/customizing-login-page.mdx',
                            ),
                        },
                        {
                            title: 'Page Blocks',
                            slug: 'page-blocks',
                            file: file(
                                'docs/guides/extending-the-dashboard/customizing-pages/page-blocks.mdx',
                            ),
                        },
                        {
                            title: 'Action Bar Items',
                            slug: 'action-bar-items',
                            file: file(
                                'docs/guides/extending-the-dashboard/customizing-pages/action-bar-items.mdx',
                            ),
                        },
                        {
                            title: 'Insights Widgets',
                            slug: 'insights-widgets',
                            file: file(
                                'docs/guides/extending-the-dashboard/customizing-pages/insights-widgets.mdx',
                            ),
                        },
                        {
                            title: 'History Entries',
                            slug: 'history-entries',
                            file: file(
                                'docs/guides/extending-the-dashboard/customizing-pages/history-entries.mdx',
                            ),
                        },
                    ],
                },
                {
                    title: 'Custom Form Elements',
                    slug: 'custom-form-components',
                    file: file('docs/guides/extending-the-dashboard/custom-form-components/index.mdx'),
                    children: [
                        {
                            title: 'Form Component Examples',
                            slug: 'form-component-examples',
                            file: file(
                                'docs/guides/extending-the-dashboard/custom-form-components/form-component-examples.mdx',
                            ),
                        },
                        {
                            title: 'Relation Selectors',
                            slug: 'relation-selectors',
                            file: file(
                                'docs/guides/extending-the-dashboard/custom-form-components/relation-selectors.mdx',
                            ),
                        },
                    ],
                },
                {
                    title: 'Navigation',
                    slug: 'navigation',
                    file: file('docs/guides/extending-the-dashboard/navigation/index.mdx'),
                },
                {
                    title: 'Alerts',
                    slug: 'alerts',
                    file: file('docs/guides/extending-the-dashboard/alerts/index.mdx'),
                },
                {
                    title: 'Data Fetching',
                    slug: 'data-fetching',
                    file: file('docs/guides/extending-the-dashboard/data-fetching/index.mdx'),
                },
                {
                    title: 'Theming',
                    slug: 'theming',
                    file: file('docs/guides/extending-the-dashboard/theming/index.mdx'),
                },
                {
                    title: 'Localization',
                    slug: 'localization',
                    file: file('docs/guides/extending-the-dashboard/localization/index.mdx'),
                },
                {
                    title: 'Deployment',
                    slug: 'deployment',
                    file: file('docs/guides/extending-the-dashboard/deployment/index.mdx'),
                },
                {
                    title: 'Tech Stack',
                    slug: 'tech-stack',
                    file: file('docs/guides/extending-the-dashboard/tech-stack/index.mdx'),
                },
                {
                    title: 'Migration',
                    slug: 'migration',
                    file: file('docs/guides/extending-the-dashboard/migration/index.mdx'),
                },
            ],
        },
        {
            title: 'Building a Storefront',
            slug: 'storefront',
            children: [
                {
                    title: 'Storefront Starters',
                    slug: 'storefront-starters',
                    file: file('docs/guides/storefront/storefront-starters/index.mdx'),
                },
                {
                    title: 'Connect API',
                    slug: 'connect-api',
                    file: file('docs/guides/storefront/connect-api/index.mdx'),
                },
                {
                    title: 'Codegen',
                    slug: 'codegen',
                    file: file('docs/guides/storefront/codegen/index.mdx'),
                },
                // Storefront Tasks
                {
                    title: 'Navigation Menu',
                    slug: 'navigation-menu',
                    file: file('docs/guides/storefront/navigation-menu/index.mdx'),
                },
                {
                    title: 'Listing Products',
                    slug: 'listing-products',
                    file: file('docs/guides/storefront/listing-products/index.mdx'),
                },
                {
                    title: 'Product Detail',
                    slug: 'product-detail',
                    file: file('docs/guides/storefront/product-detail/index.mdx'),
                },
                {
                    title: 'Active Order',
                    slug: 'active-order',
                    file: file('docs/guides/storefront/active-order/index.mdx'),
                },
                {
                    title: 'Checkout Flow',
                    slug: 'checkout-flow',
                    file: file('docs/guides/storefront/checkout-flow/index.mdx'),
                },
                {
                    title: 'Customer Accounts',
                    slug: 'customer-accounts',
                    file: file('docs/guides/storefront/customer-accounts/index.mdx'),
                },
            ],
        },
        {
            title: 'Deployment',
            slug: 'deployment',
            file: file('docs/guides/deployment/index.mdx'),
            children: [
                {
                    title: 'Production Configuration',
                    slug: 'production-configuration',
                    file: file('docs/guides/deployment/production-configuration/index.mdx'),
                },
                {
                    title: 'Using Docker',
                    slug: 'using-docker',
                    file: file('docs/guides/deployment/using-docker.mdx'),
                },
                {
                    title: 'Horizontal Scaling',
                    slug: 'horizontal-scaling',
                    file: file('docs/guides/deployment/horizontal-scaling.mdx'),
                },
                {
                    title: 'Getting Data into Production',
                    slug: 'getting-data-into-production',
                    file: file('docs/guides/deployment/getting-data-into-production.mdx'),
                },
                {
                    title: 'Server Resource Requirements',
                    slug: 'server-resource-requirements',
                    file: file('docs/guides/deployment/server-resource-requirements.mdx'),
                },
                {
                    title: 'Deploying Admin UI',
                    slug: 'deploying-admin-ui',
                    file: file('docs/guides/deployment/deploying-admin-ui.mdx'),
                },
                // Deployment Guides
                {
                    title: 'Deploy to Northflank',
                    slug: 'deploy-to-northflank',
                    file: file('docs/guides/deployment/deploy-to-northflank/index.mdx'),
                },
                {
                    title: 'Deploy to Digital Ocean App Platform',
                    slug: 'deploy-to-digital-ocean-app-platform',
                    file: file('docs/guides/deployment/deploy-to-digital-ocean-app-platform/index.mdx'),
                },
                {
                    title: 'Deploy to Railway',
                    slug: 'deploy-to-railway',
                    file: file('docs/guides/deployment/deploy-to-railway/index.mdx'),
                },
                {
                    title: 'Deploy to Render',
                    slug: 'deploy-to-render',
                    file: file('docs/guides/deployment/deploy-to-render/index.mdx'),
                },
                {
                    title: 'Deploy to Google Cloud Run',
                    slug: 'deploy-to-google-cloud-run',
                    file: file('docs/guides/deployment/deploy-to-google-cloud-run/index.mdx'),
                },
            ],
        },
        // Legacy APIs
        {
            title: 'Legacy APIs',
            slug: 'legacy-apis',
            hidden: true,
            children: [
                {
                    title: 'Angular Admin UI',
                    slug: 'extending-the-admin-ui',
                    children: [
                        {
                            title: 'Getting Started',
                            slug: 'getting-started',
                            file: file('docs/guides/extending-the-admin-ui/getting-started/index.mdx'),
                        },
                        {
                            title: 'UI Library',
                            slug: 'ui-library',
                            file: file('docs/guides/extending-the-admin-ui/ui-library/index.mdx'),
                        },
                        {
                            title: 'Admin UI Theming & Branding',
                            slug: 'admin-ui-theming-branding',
                            file: file(
                                'docs/guides/extending-the-admin-ui/admin-ui-theming-branding/index.mdx',
                            ),
                        },
                        {
                            title: 'Adding UI Translations',
                            slug: 'adding-ui-translations',
                            file: file('docs/guides/extending-the-admin-ui/adding-ui-translations/index.mdx'),
                        },
                        {
                            title: 'Using Other Frameworks',
                            slug: 'using-other-frameworks',
                            file: file('docs/guides/extending-the-admin-ui/using-other-frameworks/index.mdx'),
                        },
                        // Providers
                        {
                            title: 'Nav Menu',
                            slug: 'nav-menu',
                            file: file('docs/guides/extending-the-admin-ui/nav-menu/index.mdx'),
                        },
                        {
                            title: 'Alerts',
                            slug: 'alerts',
                            file: file('docs/guides/extending-the-admin-ui/alerts/index.mdx'),
                        },
                        {
                            title: 'Add Actions to Pages',
                            slug: 'add-actions-to-pages',
                            file: file('docs/guides/extending-the-admin-ui/add-actions-to-pages/index.mdx'),
                        },
                        {
                            title: 'Page Tabs',
                            slug: 'page-tabs',
                            file: file('docs/guides/extending-the-admin-ui/page-tabs/index.mdx'),
                        },
                        {
                            title: 'Custom Form Inputs',
                            slug: 'custom-form-inputs',
                            file: file('docs/guides/extending-the-admin-ui/custom-form-inputs/index.mdx'),
                        },
                        {
                            title: 'Custom Data Table Components',
                            slug: 'custom-data-table-components',
                            file: file(
                                'docs/guides/extending-the-admin-ui/custom-data-table-components/index.mdx',
                            ),
                        },
                        {
                            title: 'Custom Detail Components',
                            slug: 'custom-detail-components',
                            file: file(
                                'docs/guides/extending-the-admin-ui/custom-detail-components/index.mdx',
                            ),
                        },
                        {
                            title: 'Bulk Actions',
                            slug: 'bulk-actions',
                            file: file('docs/guides/extending-the-admin-ui/bulk-actions/index.mdx'),
                        },
                        {
                            title: 'Dashboard Widgets',
                            slug: 'dashboard-widgets',
                            file: file('docs/guides/extending-the-admin-ui/dashboard-widgets/index.mdx'),
                        },
                        {
                            title: 'Custom Timeline Components',
                            slug: 'custom-timeline-components',
                            file: file(
                                'docs/guides/extending-the-admin-ui/custom-timeline-components/index.mdx',
                            ),
                        },
                        // Routes
                        {
                            title: 'Defining Routes',
                            slug: 'defining-routes',
                            file: file('docs/guides/extending-the-admin-ui/defining-routes/index.mdx'),
                        },
                        {
                            title: 'Creating List Views',
                            slug: 'creating-list-views',
                            file: file('docs/guides/extending-the-admin-ui/creating-list-views/index.mdx'),
                        },
                        {
                            title: 'Creating Detail Views',
                            slug: 'creating-detail-views',
                            file: file('docs/guides/extending-the-admin-ui/creating-detail-views/index.mdx'),
                        },
                    ],
                },
                {
                    title: 'Migrating from v1',
                    slug: 'migrating-from-v1',
                    file: file('docs/guides/developer-guide/migrating-from-v1/index.mdx'),
                },
            ],
        },
        // Reference Sidebar
        {
            title: 'Reference',
            slug: 'reference',
            file: file('docs/reference/index.mdx'),
            children: [
                {
                    title: 'TypeScript API',
                    slug: 'typescript-api',
                    file: file('docs/reference/typescript-api/index.mdx'),
                    children: createNestedNavigationFromFolder(folder('docs/reference/typescript-api'), {
                        filter: (info: FileInfo) => info.filename !== 'index.mdx',
                    }),
                },
                {
                    title: 'Core Plugins',
                    slug: 'core-plugins',
                    file: file('docs/reference/core-plugins/index.mdx'),
                    children: [
                        {
                            title: 'AdminUiPlugin',
                            slug: 'admin-ui-plugin',
                            file: file('docs/reference/core-plugins/admin-ui-plugin/index.mdx'),
                            children: createNestedNavigationFromFolder(
                                folder('docs/reference/core-plugins/admin-ui-plugin'),
                                {
                                    filter: (info: FileInfo) => info.filename !== 'index.mdx',
                                },
                            ),
                        },
                        {
                            title: 'AssetServerPlugin',
                            slug: 'asset-server-plugin',
                            file: file('docs/reference/core-plugins/asset-server-plugin/index.mdx'),
                            children: createNestedNavigationFromFolder(
                                folder('docs/reference/core-plugins/asset-server-plugin'),
                                {
                                    filter: (info: FileInfo) => info.filename !== 'index.mdx',
                                },
                            ),
                        },
                        {
                            title: 'DashboardPlugin',
                            slug: 'dashboard-plugin',
                            file: file('docs/reference/core-plugins/dashboard-plugin/index.mdx'),
                            children: createNestedNavigationFromFolder(
                                folder('docs/reference/core-plugins/dashboard-plugin'),
                                {
                                    filter: (info: FileInfo) => info.filename !== 'index.mdx',
                                },
                            ),
                        },
                        {
                            title: 'EmailPlugin',
                            slug: 'email-plugin',
                            file: file('docs/reference/core-plugins/email-plugin/index.mdx'),
                            children: createNestedNavigationFromFolder(
                                folder('docs/reference/core-plugins/email-plugin'),
                                {
                                    filter: (info: FileInfo) => info.filename !== 'index.mdx',
                                },
                            ),
                        },
                        {
                            title: 'GraphiQLPlugin',
                            slug: 'graphiql-plugin',
                            file: file('docs/reference/core-plugins/graphiql-plugin/index.mdx'),
                            children: createNestedNavigationFromFolder(
                                folder('docs/reference/core-plugins/graphiql-plugin'),
                                {
                                    filter: (info: FileInfo) => info.filename !== 'index.mdx',
                                },
                            ),
                        },
                        {
                            title: 'HardenPlugin',
                            slug: 'harden-plugin',
                            file: file('docs/reference/core-plugins/harden-plugin/index.mdx'),
                            children: createNestedNavigationFromFolder(
                                folder('docs/reference/core-plugins/harden-plugin'),
                                {
                                    filter: (info: FileInfo) => info.filename !== 'index.mdx',
                                },
                            ),
                        },
                        {
                            title: 'JobQueuePlugin',
                            slug: 'job-queue-plugin',
                            file: file('docs/reference/core-plugins/job-queue-plugin/index.mdx'),
                            children: createNestedNavigationFromFolder(
                                folder('docs/reference/core-plugins/job-queue-plugin'),
                                {
                                    filter: (info: FileInfo) => info.filename !== 'index.mdx',
                                },
                            ),
                        },
                        {
                            title: 'TelemetryPlugin',
                            slug: 'telemetry-plugin',
                            file: file('docs/reference/core-plugins/telemetry-plugin/index.mdx'),
                            children: createNestedNavigationFromFolder(
                                folder('docs/reference/core-plugins/telemetry-plugin'),
                                {
                                    filter: (info: FileInfo) => info.filename !== 'index.mdx',
                                },
                            ),
                        },
                    ],
                },
                {
                    title: 'GraphQL API',
                    slug: 'graphql-api',
                    children: [
                        {
                            title: 'Admin API',
                            slug: 'admin',
                            file: file('docs/reference/graphql-api/admin/_index.mdx'),
                            children: createNestedNavigationFromFolder(
                                folder('docs/reference/graphql-api/admin'),
                                {
                                    filter: (info: FileInfo) => info.filename !== '_index.mdx',
                                },
                            ),
                        },
                        {
                            title: 'Shop API',
                            slug: 'shop',
                            file: file('docs/reference/graphql-api/shop/_index.mdx'),
                            children: createNestedNavigationFromFolder(
                                folder('docs/reference/graphql-api/shop'),
                                {
                                    filter: (info: FileInfo) => info.filename !== '_index.mdx',
                                },
                            ),
                        },
                    ],
                },
                {
                    title: 'Dashboard API',
                    slug: 'dashboard',
                    file: file('docs/reference/dashboard/index.mdx'),
                    children: createNestedNavigationFromFolder(folder('docs/reference/dashboard'), {
                        filter: (info: FileInfo) => info.filename !== 'index.mdx',
                    }),
                },
                {
                    title: 'Admin UI API',
                    slug: 'admin-ui-api',
                    file: file('docs/reference/admin-ui-api/index.mdx'),
                    children: createNestedNavigationFromFolder(folder('docs/reference/admin-ui-api'), {
                        filter: (info: FileInfo) => info.filename !== 'index.mdx',
                    }),
                },
            ],
        },
        // User Guide Sidebar
        {
            title: 'User Guide',
            slug: 'user-guide',
            hidden: true,
            file: file('docs/user-guide/index.mdx'),
            children: [
                {
                    title: 'Catalog',
                    slug: 'catalog',
                    file: file('docs/user-guide/catalog/index.mdx'),
                    children: [
                        {
                            title: 'Products',
                            slug: 'products',
                            file: file('docs/user-guide/catalog/products.mdx'),
                        },
                        {
                            title: 'Facets',
                            slug: 'facets',
                            file: file('docs/user-guide/catalog/facets.mdx'),
                        },
                        {
                            title: 'Collections',
                            slug: 'collections',
                            file: file('docs/user-guide/catalog/collections.mdx'),
                        },
                    ],
                },
                {
                    title: 'Orders',
                    slug: 'orders',
                    file: file('docs/user-guide/orders/index.mdx'),
                    children: [
                        {
                            title: 'Orders',
                            slug: 'orders',
                            file: file('docs/user-guide/orders/orders.mdx'),
                        },
                        {
                            title: 'Draft Orders',
                            slug: 'draft-orders',
                            file: file('docs/user-guide/orders/draft-orders.mdx'),
                        },
                    ],
                },
                {
                    title: 'Customers',
                    slug: 'customers',
                    file: file('docs/user-guide/customers/index.mdx'),
                },
                {
                    title: 'Promotions',
                    slug: 'promotions',
                    file: file('docs/user-guide/promotions/index.mdx'),
                },
                {
                    title: 'Settings',
                    slug: 'settings',
                    file: file('docs/user-guide/settings/index.mdx'),
                    children: [
                        {
                            title: 'Global Settings',
                            slug: 'global-settings',
                            file: file('docs/user-guide/settings/global-settings.mdx'),
                        },
                        {
                            title: 'Administrators & Roles',
                            slug: 'administrators-roles',
                            file: file('docs/user-guide/settings/administrators-roles.mdx'),
                        },
                        {
                            title: 'Channels',
                            slug: 'channels',
                            file: file('docs/user-guide/settings/channels.mdx'),
                        },
                        {
                            title: 'Countries & Zones',
                            slug: 'countries-zones',
                            file: file('docs/user-guide/settings/countries-zones.mdx'),
                        },
                        {
                            title: 'Payment Methods',
                            slug: 'payment-methods',
                            file: file('docs/user-guide/settings/payment-methods.mdx'),
                        },
                        {
                            title: 'Shipping Methods',
                            slug: 'shipping-methods',
                            file: file('docs/user-guide/settings/shipping-methods.mdx'),
                        },
                        {
                            title: 'Taxes',
                            slug: 'taxes',
                            file: file('docs/user-guide/settings/taxes.mdx'),
                        },
                    ],
                },
                {
                    title: 'Localization',
                    slug: 'localization',
                    file: file('docs/user-guide/localization/index.mdx'),
                },
            ],
        },
    ],
    github: {
        repository: 'vendurehq/vendure',
        branch: 'master',
        docsPath: 'docs',
    },
};

export const manifest = resolveManifest(manifestInput);
