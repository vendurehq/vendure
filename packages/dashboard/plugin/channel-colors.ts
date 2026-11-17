import { Permission, SettingsStoreFieldConfig, SettingsStoreScopes } from '@vendure/core';

export const channelColorValues = ['neutral', 'viz-1', 'viz-2', 'viz-3', 'viz-4', 'viz-5'] as const;

export function validateChannelColors(value: unknown): string | undefined {
    if (
        value == null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.values(value).some(color => !channelColorValues.includes(color as any))
    ) {
        return 'Channel colors must map channel IDs to a supported palette color';
    }
}

export const channelColorsSettingsStoreField: SettingsStoreFieldConfig = {
    name: 'channelColors',
    scope: SettingsStoreScopes.global,
    requiresPermission: {
        read: Permission.Authenticated,
        write: Permission.UpdateChannel,
    },
    validate: validateChannelColors,
};
