import { unique } from '@vendure/common/lib/unique';

import { Injector } from '../../common/injector';
import { RolePermissionResolverStrategy } from '../../config/auth/role-permission-resolver-strategy';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { User } from '../../entity/user/user.entity';
import { UserChannelPermissions } from '../../service/helpers/utils/get-user-channels-permissions';

import { RoleAssignment } from './role-assignment.entity';

/**
 * @description
 * A {@link RolePermissionResolverStrategy} which resolves a User's per-channel permissions
 * from the explicit {@link RoleAssignment} rows rather than from the legacy
 * `User -> Role -> Channel` relations: for each of the User's assignments, the assigned
 * Role's permissions apply on the assignment's Channel — the Role's own channel list plays
 * no part.
 *
 * This strategy is installed automatically by the `RoleAssignmentPlugin` when the
 * `experimental.roleAssignments` flag is enabled.
 *
 * This is part of the experimental `RoleAssignmentPlugin` API and may change.
 */
export class RoleAssignmentPermissionResolverStrategy implements RolePermissionResolverStrategy {
    private connection: TransactionalConnection;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
    }

    async resolvePermissions(user: User): Promise<UserChannelPermissions[]> {
        const assignments = await this.connection.rawConnection.getRepository(RoleAssignment).find({
            where: { userId: user.id },
            relations: { role: true, channel: true },
        });
        const channelsMap = new Map<string, UserChannelPermissions>();
        for (const { role, channel } of assignments) {
            let entry = channelsMap.get(channel.code);
            if (!entry) {
                entry = {
                    id: channel.id,
                    token: channel.token,
                    code: channel.code,
                    permissions: [],
                };
                channelsMap.set(channel.code, entry);
            }
            entry.permissions = unique([...entry.permissions, ...role.permissions]);
        }
        // Sorted by channel id to match the shape produced by `getChannelPermissions()`.
        return [...channelsMap.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    }
}
