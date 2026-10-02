import { VendurePlugin } from '@vendure/core';

/**
 * E2E-only plugin that provides a product list page declaring `defaultColumnFilters`,
 * so the default filters can be tested end to end.
 */
@VendurePlugin({
    dashboard: './default-filters-test-dashboard/index.tsx',
})
export class DefaultFiltersTestPlugin {}
