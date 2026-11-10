import { Injectable } from '@nestjs/common';
import { Permission } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { IsNull, ObjectLiteral, ObjectType } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { getAllPermissionsMetadata } from '../../../common/constants';
import { ConfigService } from '../../../config/config.service';
import { UserChannelPermissions } from '../../../config/session-cache/session-cache-strategy';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { Customer } from '../../../entity/customer/customer.entity';
import { RoleAssignment } from '../../../entity/role-assignment/role-assignment.entity';

/**
 * @description
 * The fixed permissions a Customer's User holds on every Channel the Customer is a member
 * of. Customer permissions are membership-derived: there is no Customer role and customers
 * have no {@link RoleAssignment} rows, so this constant is the definition of what a
 * membership grants.
 *
 * @docsCategory auth
 * @since 4.0.0
 */
export const CUSTOMER_PERMISSIONS: Permission[] = [Permission.Authenticated];

/**
 * @description
 * The effective permissions of a User, as resolved by the {@link RolePermissionResolver}.
 *
 * @docsCategory auth
 * @since 4.0.0
 */
export interface ResolvedUserPermissions {
    /**
     * @description
     * The per-channel permissions derived from the User's explicit {@link RoleAssignment}s
     * and, for customer Users, from the Customer's channel memberships.
     */
    channels: UserChannelPermissions[];
    /**
     * @description
     * Permissions the User holds on _every_ Channel, including Channels created after the
     * permissions were resolved. Populated for SuperAdmin users, whose effective permissions
     * are derived at check time rather than stored per Channel.
     */
    globalPermissions: Permission[];
}

/**
 * @description
 * Resolves a User's effective per-channel permissions from {@link RoleAssignment} rows.
 * This is the single source of truth for permission resolution, used by the session cache,
 * `login`/`me`, {@link RequestContextService} and the permission guards.
 *
 * Two cases are special-cased rather than materialized per channel:
 *
 * - **SuperAdmin**: a User holding a Role which carries the `SuperAdmin` permission (only
 *   the system SuperAdmin role can) receives all assignable permissions on every Channel,
 *   resolved at check time. Access therefore never depends on per-channel assignment rows —
 *   a new Channel is administrable the moment it exists — and the SuperAdmin role's own
 *   permission array does not need re-syncing when custom permissions are added. The Role
 *   is therefore stored as a single row on the default Channel, standing for every Channel
 *   (see {@link RoleAssignment}); Channel creation writes no assignment rows.
 * - **Customers**: a User with a Customer record receives the fixed customer permissions
 *   (`Authenticated`) on the Customer's member Channels, derived from the channel
 *   membership itself. There is no Customer role and customers have no assignment rows —
 *   rows would only duplicate the membership relation, at one row per customer per channel.
 *
 * @docsCategory auth
 * @since 4.0.0
 */
@Injectable()
export class RolePermissionResolver {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
    ) {}

    /**
     * @description
     * Resolves the effective permissions of the given User.
     *
     * Without a `ctx` this reads through the raw connection, outside any request-scoped
     * transaction, so only committed data counts. That is what a cached session needs: reading
     * inside a transaction which later rolls back would cache permissions that never existed.
     * Pass the `ctx` where the result only describes the current request, such as the
     * `CurrentUser` a login returns, so that a Customer created in the same transaction (e.g. on
     * a first login through an external authentication strategy) is taken into account.
     */
    async resolvePermissions(userId: ID, ctx?: RequestContext): Promise<ResolvedUserPermissions> {
        const assignments = await this.getRepository(ctx, RoleAssignment).find({
            where: { userId },
            relations: { role: true, channel: true },
        });
        const channelsMap = new Map<string, UserChannelPermissions>();
        const addPermissions = (channel: Channel, permissions: Permission[]) => {
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
            entry.permissions = unique([...entry.permissions, ...permissions]);
        };

        let isSuperAdmin = false;
        for (const { role, channel } of assignments) {
            addPermissions(channel, role.permissions);
            if (role.permissions.includes(Permission.SuperAdmin)) {
                isSuperAdmin = true;
            }
        }
        const customer = await this.getRepository(ctx, Customer).findOne({
            where: { user: { id: userId }, deletedAt: IsNull() },
            relations: { channels: true },
        });
        if (customer) {
            for (const channel of customer.channels) {
                addPermissions(channel, CUSTOMER_PERMISSIONS);
            }
        }
        return {
            channels: [...channelsMap.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
            globalPermissions: isSuperAdmin ? this.getAllAssignablePermissions() : [],
        };
    }

    /**
     * @description
     * Expands {@link ResolvedUserPermissions} into a plain per-channel array covering every
     * Channel the User has permissions on, with `globalPermissions` applied to all Channels.
     * Used where an explicit channel list is part of the API contract (`me`/`login`'s
     * `CurrentUser.channels`); the session cache stores the compact form instead.
     */
    async expandGlobalPermissions(
        resolved: ResolvedUserPermissions,
        ctx?: RequestContext,
    ): Promise<UserChannelPermissions[]> {
        if (resolved.globalPermissions.length === 0) {
            return resolved.channels;
        }
        const allChannels = await this.getRepository(ctx, Channel).find();
        return allChannels
            .map(channel => {
                const entry = resolved.channels.find(c => c.id === channel.id);
                return {
                    id: channel.id,
                    token: channel.token,
                    code: channel.code,
                    permissions: unique([...(entry?.permissions ?? []), ...resolved.globalPermissions]),
                };
            })
            .sort((a, b) => (a.id < b.id ? -1 : 1));
    }

    private getRepository<T extends ObjectLiteral>(ctx: RequestContext | undefined, target: ObjectType<T>) {
        return ctx
            ? this.connection.getRepository(ctx, target)
            : this.connection.rawConnection.getRepository(target);
    }

    private getAllAssignablePermissions(): Permission[] {
        return getAllPermissionsMetadata(this.configService.authOptions.customPermissions)
            .filter(p => p.assignable)
            .map(p => p.name as Permission);
    }
}
