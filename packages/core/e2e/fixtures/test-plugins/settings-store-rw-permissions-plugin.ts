import { Permission, RwPermissionDefinition, SettingsStoreScopes, VendurePlugin } from '@vendure/core';

/**
 * Custom RwPermissionDefinition for testing dashboard saved views
 */
export const dashboardSavedViewsPermission = new RwPermissionDefinition('DashboardSavedViews');

/**
 * Test plugin that demonstrates the new read/write permission functionality
 * for settings store fields.
 */
@VendurePlugin({
    configuration: config => {
        // Add custom permissions
        config.authOptions = {
            ...config.authOptions,
            customPermissions: [
                ...(config.authOptions?.customPermissions || []),
                dashboardSavedViewsPermission,
            ],
        };

        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            rwtest: [
                {
                    name: 'separateReadWrite',
                    scope: SettingsStoreScopes.global,
                    // User can read with ReadCatalog but write with UpdateCatalog
                    requiresPermission: {
                        read: Permission.ReadCatalog,
                        write: Permission.UpdateCatalog,
                    },
                },
                {
                    name: 'dashboardSavedViews',
                    scope: SettingsStoreScopes.global,
                    // Using custom RwPermissionDefinition for dashboard saved views
                    requiresPermission: {
                        read: dashboardSavedViewsPermission.Read,
                        write: dashboardSavedViewsPermission.Write,
                    },
                },
                {
                    name: 'multipleReadPermissions',
                    scope: SettingsStoreScopes.global,
                    // Multiple permissions for read (OR logic)
                    requiresPermission: {
                        read: [Permission.ReadCatalog, Permission.ReadSettings],
                        write: Permission.UpdateSettings,
                    },
                },
                {
                    name: 'backwardCompatible',
                    scope: SettingsStoreScopes.global,
                    // Still supports old requiresPermission (applies to both read and write)
                    requiresPermission: Permission.UpdateSettings,
                },
                {
                    name: 'readOnlyAccess',
                    scope: SettingsStoreScopes.global,
                    // Read-only field - anyone with ReadSettings can read, no one can write via API
                    requiresPermission: {
                        read: Permission.ReadSettings,
                        // No write permission means only authenticated users can write (will be blocked by readonly)
                    },
                    readonly: true,
                },
                {
                    name: 'publicRead',
                    scope: SettingsStoreScopes.global,
                    // Anyone authenticated can read, but only admins can write
                    requiresPermission: {
                        read: Permission.Authenticated,
                        write: Permission.CreateAdministrator,
                    },
                },
            ],
        };
        return config;
    },
})
export class SettingsStoreRwPermissionsPlugin {}
