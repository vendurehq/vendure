import { Permission } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { Channel } from '../../../entity/channel/channel.entity';
import { Role } from '../../../entity/role/role.entity';

import {
    getChannelPermissions,
    mergeChannelPermissions,
    UserChannelPermissions,
} from './get-user-channels-permissions';

function channel(id: number, code: string): Channel {
    return new Channel({ id, code, token: `${code}-token` });
}

const channelA = channel(1, 'channel-a');
const channelB = channel(2, 'channel-b');

function scoped(target: Channel, permissions: Permission[]): UserChannelPermissions[] {
    return getChannelPermissions([new Role({ permissions, channels: [target] })]);
}

describe('mergeChannelPermissions()', () => {
    it('returns an empty array when given nothing', () => {
        expect(mergeChannelPermissions()).toEqual([]);
        expect(mergeChannelPermissions([], undefined, [])).toEqual([]);
    });

    it('returns the single non-empty set unchanged', () => {
        const globalPermissions = scoped(channelA, [Permission.ReadProduct]);
        expect(mergeChannelPermissions(globalPermissions, [])).toEqual(globalPermissions);
        expect(mergeChannelPermissions([], globalPermissions)).toEqual(globalPermissions);
    });

    it('unions the permissions of a channel present in both sets', () => {
        const result = mergeChannelPermissions(
            scoped(channelA, [Permission.ReadProduct]),
            scoped(channelA, [Permission.UpdateProduct]),
        );

        expect(result.length).toBe(1);
        expect(result[0].code).toBe('channel-a');
        expect(result[0].permissions).toEqual([Permission.ReadProduct, Permission.UpdateProduct]);
    });

    it('keeps channels which appear in only one set separate', () => {
        const result = mergeChannelPermissions(
            scoped(channelA, [Permission.ReadProduct]),
            scoped(channelB, [Permission.UpdateProduct]),
        );

        expect(result.map(c => c.code)).toEqual(['channel-a', 'channel-b']);
        expect(result[0].permissions).toEqual([Permission.ReadProduct]);
        expect(result[1].permissions).toEqual([Permission.UpdateProduct]);
    });

    it('does not mutate the input sets', () => {
        const globalPermissions = scoped(channelA, [Permission.ReadProduct]);
        mergeChannelPermissions(globalPermissions, scoped(channelA, [Permission.DeleteProduct]));

        expect(globalPermissions[0].permissions).toEqual([Permission.ReadProduct]);
    });

    // The core guarantee of channel-scoped roles: an admin role granted on one channel must never
    // confer its permissions on another channel.
    it('does not leak channel-scoped permissions across channels', () => {
        const adminOnA = scoped(channelA, [Permission.DeleteProduct]);
        const supportOnB = scoped(channelB, [Permission.ReadProduct]);

        const result = mergeChannelPermissions(adminOnA, supportOnB);

        const permissionsOnB = result.find(c => c.code === 'channel-b');
        expect(permissionsOnB?.permissions).toEqual([Permission.ReadProduct]);
        expect(permissionsOnB?.permissions).not.toContain(Permission.DeleteProduct);
    });
});
