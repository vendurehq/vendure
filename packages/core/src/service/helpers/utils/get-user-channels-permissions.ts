import { Permission } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';

import { Role } from '../../../entity/role/role.entity';
import { User } from '../../../entity/user/user.entity';

export interface UserChannelPermissions {
    id: ID;
    token: string;
    code: string;
    permissions: Permission[];
}

/**
 * Returns an array of Channels and permissions on those Channels for the given User.
 */
export function getUserChannelsPermissions(user: User): UserChannelPermissions[] {
    return getChannelPermissions(user.roles);
}

/**
 * @description
 * Returns an array of Channels and permissions on those Channels for the given Roles.
 */
export function getChannelPermissions(roles: Role[]): UserChannelPermissions[] {
    const channelsMap: { [code: string]: UserChannelPermissions } = {};

    for (const role of roles) {
        for (const channel of role.channels) {
            if (!channelsMap[channel.code]) {
                channelsMap[channel.code] = {
                    id: channel.id,
                    token: channel.token,
                    code: channel.code,
                    permissions: [],
                };
            }
            channelsMap[channel.code].permissions = unique([
                ...channelsMap[channel.code].permissions,
                ...role.permissions,
            ]);
        }
    }

    return Object.values(channelsMap).sort((a, b) => (a.id < b.id ? -1 : 1));
}
