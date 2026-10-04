import { defineDashboardExtension } from '@vendure/dashboard';

/**
 * Registers a custom form component for the readonly single `relation` custom field
 * `Product.relatedAsset` (configured in e2e-shared-config.ts). The component renders the
 * related entity from `props.value`.
 *
 * This exercises OSS-584 (#4902): a custom form component bound to a readonly relation custom
 * field must receive the related entity *object* as `value`. Before the fix it received
 * `undefined`, because the form control binds to the scalar `<name>Id` which does not exist for
 * a readonly relation (readonly custom fields are excluded from the update/create input types).
 */
defineDashboardExtension({
    customFormComponents: {
        customFields: [
            {
                id: 'relation-cf.related-asset',
                component: ({ value }) => (
                    <div data-testid="related-asset-cf">
                        {value?.id ? `asset:${value.id}` : 'none'}
                    </div>
                ),
            },
        ],
    },
});
