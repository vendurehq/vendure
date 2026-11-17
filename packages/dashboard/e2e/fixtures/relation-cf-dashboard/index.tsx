import { defineDashboardExtension } from '@vendure/dashboard';

/**
 * Custom form components for the readonly relation custom fields configured in
 * e2e-shared-config.ts (#4902). Each renders the id(s) it receives as `value`:
 *
 * - `relation-cf.related-asset` for `Product.relatedAsset` renders `asset:<id>`.
 * - `relation-cf.related-assets` for `Product.relatedAssets` renders `assets:<id>,<id>`.
 *
 * Either renders `none` without a value.
 */
defineDashboardExtension({
    customFormComponents: {
        customFields: [
            {
                id: 'relation-cf.related-asset',
                component: ({ value }) => (
                    <div data-testid="related-asset-cf">{value ? `asset:${value}` : 'none'}</div>
                ),
            },
            {
                id: 'relation-cf.related-assets',
                component: ({ value }) => (
                    <div data-testid="related-assets-cf">
                        {Array.isArray(value) && value.length ? `assets:${value.join(',')}` : 'none'}
                    </div>
                ),
            },
        ],
    },
});
