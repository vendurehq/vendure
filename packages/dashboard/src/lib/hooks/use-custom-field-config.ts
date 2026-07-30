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
 * The result is memoised so it keeps a stable identity across renders. The form
 * engine (`useGeneratedForm`) derives its zod schema and default values from this
 * config via `useMemo` and re-validates whenever the schema identity changes;
 * returning a fresh array on every render made the schema unstable, which — once
 * on-load validation was added — produced an infinite validate → re-render loop
 * (OSS-540).
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
