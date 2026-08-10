import { Injector } from '../../common/injector';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { User } from '../../entity/user/user.entity';
import {
    getUserChannelsPermissions,
    UserChannelPermissions,
} from '../../service/helpers/utils/get-user-channels-permissions';

import { RolePermissionResolverStrategy } from './role-permission-resolver-strategy';

/**
 * @description
 * The default RolePermissionResolverStrategy, which derives a User's per-channel permissions
 * from the legacy `User -> Role -> Channel` relations: for each of the User's Roles, the
 * Role's permissions apply on every Channel the Role is assigned to.
 *
 * When the given User entity already has its `roles` (and their `channels`) relations loaded,
 * they are used directly; otherwise the relations are loaded from the database.
 *
 * The DB fallback is a deliberate behavior change: the pre-strategy code handled an
 * unhydrated User inconsistently per call site — `RequestContextService.create()` silently
 * produced a permissionless context (`user.roles ? getUserChannelsPermissions(user) : []`),
 * while `RoleService.getActiveUserPermissionsOnChannel()` always loaded from the DB. A single
 * strategy contract cannot preserve both, and the `[]` shortcut would break the RoleService
 * path (which passes a stub User). All request-serving paths (login, `me`, session
 * serialization) pass fully-hydrated Users and take the pre-loaded fast path; the only core
 * caller which hits the fallback is the Populator's seed-time context creation, which
 * previously got the (unnoticed) empty result.
 *
 * TODO: before stabilizing, verify that no hot path outside core relies on passing unhydrated
 * Users to `RequestContextService.create()` — each such call now costs one query where it
 * previously returned `[]`.
 *
 * @docsCategory auth
 * @docsPage RolePermissionResolverStrategy
 * @since 3.8.0
 * @experimental
 */
export class DefaultRolePermissionResolverStrategy implements RolePermissionResolverStrategy {
    private connection: TransactionalConnection;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
    }

    async resolvePermissions(user: User): Promise<UserChannelPermissions[]> {
        if (user.roles && user.roles.every(role => role.channels != null)) {
            return getUserChannelsPermissions(user);
        }
        const userWithRoles = await this.connection.rawConnection.getRepository(User).findOne({
            where: { id: user.id },
            relations: { roles: { channels: true } },
        });
        return userWithRoles ? getUserChannelsPermissions(userWithRoles) : [];
    }
}
