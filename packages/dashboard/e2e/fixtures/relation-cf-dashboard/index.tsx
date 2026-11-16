import { defineDashboardExtension } from '@vendure/dashboard';

/**
 * Custom form components for the readonly relation custom fields configured in
 * e2e-shared-config.ts (#4902). Each renders the id(s) it receives as `value`, and the related
 * entity object(s) it receives as `relatedEntity`:
 *
 * - `relation-cf.related-asset` for `Product.relatedAsset` renders `asset:<id> value:<id>`.
 * - `relation-cf.related-assets` for `Product.relatedAssets` renders `assets:<id>,<id> value:<id>,<id>`.
 *
 * Either renders `none` without a related entity.
 */
defineDashboardExtension({
    customFormComponents: {
        customFields: [
            {
                id: 'relation-cf.related-asset',
                component: ({ value, relatedEntity }) => (
                    <div data-testid="related-asset-cf">
                        {relatedEntity?.id ? `asset:${relatedEntity.id} value:${value}` : 'none'}
                    </div>
                ),
            },
            {
                id: 'relation-cf.related-assets',
                component: ({ value, relatedEntity }) => (
                    <div data-testid="related-assets-cf">
                        {Array.isArray(relatedEntity) && relatedEntity.length
                            ? `assets:${relatedEntity.map((asset: { id: string }) => asset.id).join(',')} value:${(value as string[]).join(',')}`
                            : 'none'}
                    </div>
                ),
            },
        ],
    },
});
