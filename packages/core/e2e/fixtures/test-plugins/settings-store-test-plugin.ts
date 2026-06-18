import { Permission, SettingsStoreScopes, VendurePlugin } from '@vendure/core';

/**
 * Test plugin that registers various settings store fields for testing different
 * scoping, validation, and permission scenarios.
 */
@VendurePlugin({
    configuration: config => {
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            test: [
                {
                    name: 'globalSetting',
                    scope: SettingsStoreScopes.global,
                },
                {
                    name: 'userSetting',
                    scope: SettingsStoreScopes.user,
                },
                {
                    name: 'channelSetting',
                    scope: SettingsStoreScopes.channel,
                },
                {
                    name: 'userAndChannelSetting',
                    scope: SettingsStoreScopes.userAndChannel,
                },
                {
                    name: 'readonlyField',
                    scope: SettingsStoreScopes.global,
                    readonly: true,
                },
                {
                    name: 'validatedField',
                    scope: SettingsStoreScopes.global,
                    validate: value => {
                        if (!['valid-option', 'another-option'].includes(value)) {
                            return 'Value must be valid-option or another-option';
                        }
                    },
                },
                {
                    name: 'complexData',
                    scope: SettingsStoreScopes.global,
                },
                {
                    name: 'bulk1',
                    scope: SettingsStoreScopes.global,
                },
                {
                    name: 'bulk2',
                    scope: SettingsStoreScopes.global,
                },
                {
                    name: 'adminOnlyField',
                    scope: SettingsStoreScopes.global,
                    requiresPermission: Permission.CreateAdministrator,
                },
            ],
        };
        return config;
    },
})
export class SettingsStoreTestPlugin {}
