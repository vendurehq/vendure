import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { CustomFieldConfig } from '@/vdb/providers/server-config.js';

import { useServerConfig } from './use-server-config.js';

/**
 * @description
 * Returns the custom field config for the given entity type (e.g. 'Product').
 * Also filters out any custom fields that the current active user does not
 * have permissions to access.
 *
 * @docsCategory hooks
 * @since 3.4.0
 */
export function useCustomFieldConfig(entityType: string): CustomFieldConfig[] {
    const serverConfig = useServerConfig();
    const { hasPermissions } = usePermissions();
    if (!serverConfig) {
        return [];
    }
    // Country is an alias of Region: its custom fields are configured under `Region`.
    // The detail query applies the same alias in `add-custom-fields.ts`.
    const entityName = entityType === 'Country' ? 'Region' : entityType;
    const customFieldConfig = serverConfig.entityCustomFields.find(field => field.entityName === entityName);
    return (
        customFieldConfig?.customFields?.filter(config => {
            return config.requiresPermission ? hasPermissions(config.requiresPermission) : true;
        }) ?? []
    );
}
