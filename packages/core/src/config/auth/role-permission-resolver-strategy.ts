import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { User } from '../../entity/user/user.entity';
import { UserChannelPermissions } from '../../service/helpers/utils/get-user-channels-permissions';

/**
 * @description
 * A RolePermissionResolverStrategy determines how the per-channel permissions of a User are
 * derived. The result is the single source of truth for all permission checks: it is cached
 * on the session (see `CachedSession.channelPermissions`), returned by the `me` query, and
 * consulted by service-level checks such as `RoleService.userHasPermissionOnChannel()`.
 *
 * The {@link DefaultRolePermissionResolverStrategy} implements the standard Vendure behavior
 * of deriving permissions from the User's Roles and each Role's Channels. The experimental
 * `RoleAssignmentPlugin` replaces it with a strategy which resolves permissions from explicit
 * per-(user, role, channel) `RoleAssignment` rows instead.
 *
 * :::info
 *
 * This is configured via the `authOptions.rolePermissionResolverStrategy` property
 * of your VendureConfig.
 *
 * :::
 *
 * @docsCategory auth
 * @docsPage RolePermissionResolverStrategy
 * @docsWeight 0
 * @since 3.8.0
 * @experimental
 */
export interface RolePermissionResolverStrategy extends InjectableStrategy {
    /**
     * @description
     * Resolves the per-channel permissions of the given User. The strategy is responsible
     * for loading whatever data it needs — callers are not required to pass a fully
     * hydrated entity. Implementations may however use already-loaded relations (such as
     * `user.roles` with their `channels`) as an optimization when present.
     */
    resolvePermissions(user: User): Promise<UserChannelPermissions[]>;
}
