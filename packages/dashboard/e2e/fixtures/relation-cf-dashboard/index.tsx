import { defineDashboardExtension } from '@vendure/dashboard';

/**
 * Custom form components for the readonly relation custom fields configured in
 * e2e-shared-config.ts (#4902). Each renders the id(s) it receives as `value`, and the related
 * entity object(s) it receives as `relatedEntity`:
 *
 * - `relation-cf.related-asset` for `Product.relatedAsset` renders `asset:<id>:<name> value:<id>`.
 * - `relation-cf.related-assets` for `Product.relatedAssets` renders
 *   `assets:<id>:<name>,<id>:<name> value:<id>,<id>`.
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
                        {relatedEntity && !Array.isArray(relatedEntity)
                            ? `asset:${relatedEntity.id}:${relatedEntity.name} value:${value}`
                            : 'none'}
                    </div>
                ),
            },
            {
                id: 'relation-cf.related-assets',
                component: ({ value, relatedEntity }) => {
                    const assets = Array.isArray(relatedEntity)
                        ? relatedEntity.map(asset => [asset.id, asset.name].join(':'))
                        : [];
                    return (
                        <div data-testid="related-assets-cf">
                            {assets.length
                                ? `assets:${assets.join(',')} value:${(value as string[]).join(',')}`
                                : 'none'}
                        </div>
                    );
                },
            },
        ],
    },
});
