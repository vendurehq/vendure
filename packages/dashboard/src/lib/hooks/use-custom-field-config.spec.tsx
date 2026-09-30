import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { useCustomFieldConfig } from './use-custom-field-config.js';

const hasPermissionsMock = vi.hoisted(() => vi.fn((_perms: string[]) => true));

vi.mock('./use-server-config.js', () => ({
    useServerConfig: () => ({
        entityCustomFields: [
            { entityName: 'Product', customFields: [{ name: 'warranty', type: 'string', list: false }] },
            {
                entityName: 'Region',
                customFields: [
                    { name: 'regionCode', type: 'string', list: false },
                    {
                        name: 'taxOffice',
                        type: 'string',
                        list: false,
                        requiresPermission: ['UpdateSettings'],
                    },
                ],
            },
        ],
    }),
}));

vi.mock('@/vdb/hooks/use-permissions.js', () => ({
    usePermissions: () => ({
        hasPermissions: hasPermissionsMock,
    }),
}));

function getCustomFieldNames(entityType: string): string[] {
    let names: string[] = [];
    function Probe() {
        names = useCustomFieldConfig(entityType).map(field => field.name);
        return null;
    }
    renderToStaticMarkup(<Probe />);
    return names;
}

describe('useCustomFieldConfig', () => {
    it('returns the custom fields configured for the entity type', () => {
        expect(getCustomFieldNames('Product')).toEqual(['warranty']);
    });

    it('returns an empty array for an entity type without custom fields', () => {
        expect(getCustomFieldNames('Customer')).toEqual([]);
    });

    it('handles Country as alias of Region', () => {
        // Custom fields are configured for Region, not Country
        expect(getCustomFieldNames('Country')).toEqual(['regionCode', 'taxOffice']);
    });

    it('omits fields the active user has no permission for', () => {
        hasPermissionsMock.mockReturnValueOnce(false);

        expect(getCustomFieldNames('Region')).toEqual(['regionCode']);
    });
});
