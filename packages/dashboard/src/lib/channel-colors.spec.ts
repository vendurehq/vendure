import { describe, expect, it } from 'vitest';

import { Permission, SettingsStoreScopes } from '@vendure/core';
import { channelColorsSettingsStoreField, validateChannelColors } from '../../plugin/channel-colors.js';

describe('validateChannelColors', () => {
    it('accepts an empty map and all supported palette values', () => {
        expect(validateChannelColors({})).toBeUndefined();
        expect(
            validateChannelColors({
                channel1: 'neutral',
                channel2: 'viz-1',
                channel3: 'viz-5',
            }),
        ).toBeUndefined();
    });

    it('rejects invalid palette values and non-map input', () => {
        expect(validateChannelColors({ channel1: 'red' })).toBeTruthy();
        expect(validateChannelColors(['viz-1'])).toBeTruthy();
        expect(validateChannelColors(null)).toBeTruthy();
    });

    it('uses authenticated reads and UpdateChannel writes in global scope', () => {
        expect(channelColorsSettingsStoreField.scope).toBe(SettingsStoreScopes.global);
        expect(channelColorsSettingsStoreField.requiresPermission).toEqual({
            read: Permission.Authenticated,
            write: Permission.UpdateChannel,
        });
    });
});
