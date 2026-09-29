import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { CustomFieldConfig } from '@/vdb/providers/server-config.js';
import { useMemo } from 'react';

import { useServerConfig } from './use-server-config.js';

/**
 * @description
 * Returns the custom field config for the given entity type (e.g. 'Product').
 * Also filters out any custom fields that the current active user does not
 * have permissions to access.
 *
 * The result keeps the same identity across renders until the server config or
 * the active user's permissions change, so it can be used as a memo dependency.
 *
 * @docsCategory hooks
 * @since 3.4.0
 */
export function useCustomFieldConfig(entityType: string): CustomFieldConfig[] {
    const serverConfig = useServerConfig();
    const { hasPermissions } = usePermissions();
    return useMemo(() => {
        if (!serverConfig) {
            return [];
        }
        const customFieldConfig = serverConfig.entityCustomFields.find(
            field => field.entityName === entityType,
        );
        return (
            customFieldConfig?.customFields?.filter(config =>
                config.requiresPermission ? hasPermissions(config.requiresPermission) : true,
            ) ?? []
        );
    }, [serverConfig, entityType, hasPermissions]);
}
